/**
 * AgroSense - application boot
 * ---------------------------------------------------------------
 * One orchestrator for every dashboard page. It starts the services,
 * computes the whole farm picture on every change, hands the shared
 * chrome its counts and board, and then calls whichever page module
 * registered itself for this page. The pages know how to draw; this
 * file knows when.
 *
 * Every service runs on every page - the sidebar counts and the alerts
 * bell have to be right wherever the user is standing.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var fmt = NS.fmt;
  var dom = NS.dom;
  var el = dom.el, setText = dom.setText;
  var market = NS.market;
  var weather = NS.weather;
  var analytics = NS.analytics;
  var shell = NS.shell;
  var charts = NS.charts;

  var state = {
    location: null,
    weatherError: null,
    ctx: null
  };

  var pageModule = null;

  /* ---------- the whole picture, computed once per change ---------- */

  var SEVERITY_RANK = { critical: 0, serious: 1, warning: 2, good: 3, info: 4 };

  function compute() {
    var quotes = market.getQuotes();
    var w = weather.getCached();
    var constraints = NS.pests.getFieldConstraints();

    var snapshot = analytics.snapshot(quotes, constraints);
    var history = analytics.portfolioHistory(cfg.market.months);

    var advisories = [];
    if (w) {
      advisories = weather.deriveAdvisories(w).concat(NS.livestock.deriveAdvisories(w));
      advisories.sort(function (a, b) { return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]; });
      // The "nothing to do" card only belongs at the end of an empty list.
      if (advisories.length > 1) advisories = advisories.filter(function (a) { return a.id !== 'settled'; });
    }

    var irrigation = NS.irrigation.snapshot(w);
    var pests = NS.pests.assess(w);
    var harvest = NS.harvest.assess(w, quotes, constraints);
    var heat = NS.livestock.heatStress(w);
    var health = NS.livestock.health();

    return {
      page: shell.page,
      location: state.location,
      quotes: quotes,
      weather: w,
      weatherError: state.weatherError,
      snapshot: snapshot,
      history: history,
      advisories: advisories,
      irrigation: irrigation,
      pests: pests,
      harvest: harvest,
      heat: heat,
      health: health,
      constraints: constraints
    };
  }

  function chrome(ctx) {
    shell.updateBoard(ctx.quotes);

    // One count per page: how many things there want attention.
    var urgentAdvisories = ctx.advisories.filter(function (a) { return a.severity === 'critical' || a.severity === 'serious'; }).length;
    var heatIssues = ctx.heat.rows.filter(function (r) { return r.level === 'moderate' || r.level === 'severe'; }).length;
    var healthDue = ctx.health.filter(function (h) { return !h.completed && h.dueInDays <= 3; }).length;
    shell.setCount('cockpitCount', urgentAdvisories + ctx.harvest.summary.urgent);
    shell.setCount('operationsCount', operationsAttention(ctx));
    shell.setCount('farmCount', ctx.harvest.alerts.length + heatIssues + healthDue);

    shell.renderAlerts(ctx.harvest);
    renderSources();
    refreshLivePill();
  }

  function renderSources() {
    var ws = weather.status;
    setText(el('srcWeather'), ws.state === 'ok'
      ? 'Open-Meteo forecast API · HTTP 200 · ' + ws.latencyMs + ' ms' + (ws.restored ? ' (cached this session)' : '')
      : ws.state === 'error' ? 'Open-Meteo · unavailable — ' + ws.lastError : 'Open-Meteo · loading');

    var ms = market.status;
    var text = ms.source + ' · ' + (ms.periodLabel || '—') + ' · ' + ms.liveCount + ' live, ' + ms.proxyCount + ' proxy, ' +
               ms.modelledCount + ' modelled · ' + ms.tier +
               (ms.state === 'error' ? ' — refresh failed: ' + ms.lastError : ms.lastError ? ' — ' + ms.lastError : '');
    setText(el('srcMarket'), text);
  }

  function refreshLivePill() {
    if (weather.status.state === 'error') {
      shell.setLiveState('error', 'Weather offline', weather.status.lastError);
      return;
    }
    if (weather.status.state === 'loading' || market.status.state === 'loading') {
      shell.setLiveState('loading', 'Loading');
      return;
    }
    var ms = market.status;
    shell.setLiveState('ok', 'Live',
      'Weather updated ' + fmt.ago(weather.status.lastFetched) + ' · prices ' + (ms.periodLabel || '') + ' (' + ms.tier + ')');
  }

  /* ---------- render pipeline ---------- */

  function renderAll() {
    var ctx = compute();
    state.ctx = ctx;
    chrome(ctx);
    if (pageModule && pageModule.render) {
      try { pageModule.render(ctx); } catch (err) { console.error('[AgroSense] page render failed', err); }
    }
  }

  function operationsAttention(ctx) {
    return ctx.irrigation.summary.dueCount + ctx.irrigation.summary.runningCount + ctx.pests.summary.urgent;
  }

  /** The light path: an irrigation clock tick or a pest/health action. */
  function renderOperations() {
    var ctx = compute();
    state.ctx = ctx;
    shell.setCount('operationsCount', operationsAttention(ctx));
    if (pageModule && pageModule.renderOperations) {
      try { pageModule.renderOperations(ctx); } catch (err) { console.error('[AgroSense] operations render failed', err); }
    } else if (pageModule && pageModule.render) {
      try { pageModule.render(ctx); } catch (err) { console.error('[AgroSense] page render failed', err); }
    }
  }

  /* ---------- weather ---------- */

  var weatherLoad = null;        // the request in flight, if any
  var weatherLoadFor = null;     // ...and which location it is for

  /**
   * Asking again while a request for the same place is already running joins
   * that request instead of starting another. Asking for a different place
   * starts a fresh one, and the service discards the older response.
   */
  function loadWeather() {
    if (weatherLoad && weatherLoadFor === state.location.id) return weatherLoad;
    weatherLoadFor = state.location.id;
    shell.setLiveState('loading', 'Loading');
    var p = weather.load(state.location)
      .then(function () { state.weatherError = null; })
      .catch(function (err) { state.weatherError = weather.status.lastError || err.message; })
      .then(function () {
        renderAll();
        pingHarvest();
      });
    weatherLoad = p;
    p.then(function () { if (weatherLoad === p) weatherLoad = null; });
    return p;
  }

  /* ---------- harvest pings ---------- */

  var TOASTED_KEY = 'toasted';

  function pingHarvest() {
    var ctx = state.ctx;
    if (!ctx) return;
    var fired = NS.harvest.notify(ctx.harvest);

    // In-app toasts once per browser session, for anything urgent.
    var toasted = NS.store.session.get(TOASTED_KEY, {});
    ctx.harvest.alerts.forEach(function (a) {
      if (a.level !== 'critical' && a.level !== 'serious') return;
      if (toasted[a.id]) return;
      toasted[a.id] = true;
      shell.toast({ tone: a.level, icon: 'i-harvest', title: a.title, detail: a.when + '. ' + a.detail.split('. ')[0] + '.' });
    });
    ctx.harvest.livestock.forEach(function (s) {
      if (s.level !== 'critical' && s.level !== 'serious') return;
      if (toasted[s.id]) return;
      toasted[s.id] = true;
      shell.toast({ tone: s.level, icon: 'i-cow', title: s.title, detail: fmt.head(s.head) + ' ready to sell.' });
    });
    NS.store.session.set(TOASTED_KEY, toasted);

    if (fired.length) console.info('[AgroSense] harvest notifications sent', fired.map(function (a) { return a.id; }));
  }

  /* ---------- chrome bindings ---------- */

  function bindChrome() {
    var select = document.getElementById('locationSelect');
    cfg.locations.forEach(function (loc) {
      var opt = document.createElement('option');
      opt.value = loc.id;
      opt.textContent = loc.name + ', ' + loc.region;
      select.appendChild(opt);
    });
    select.value = state.location.id;
    select.addEventListener('change', function () {
      state.location = cfg.locations.filter(function (l) { return l.id === select.value; })[0];
      NS.store.local.set('location', state.location.id);
      loadWeather();
    });

    // The top-bar refresh updates both feeds. The button spins and is disabled
    // while it runs, and a toast says how it went - the data is often identical,
    // so without that a successful refresh looks exactly like a dead button.
    var refreshBtn = document.getElementById('refreshBtn');
    refreshBtn.addEventListener('click', function () {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      refreshBtn.classList.add('is-spinning');
      Promise.all([
        loadWeather(),
        market.refresh().then(function () { return null; }, function (e) { return e; })
      ]).then(function (results) {
        refreshBtn.disabled = false;
        refreshBtn.classList.remove('is-spinning');
        var weatherOk = weather.status.state === 'ok';
        var pricesErr = results[1];
        shell.toast({
          tone: weatherOk && !pricesErr ? 'good' : 'warning',
          icon: weatherOk && !pricesErr ? 'i-check' : 'i-alert',
          title: weatherOk && !pricesErr ? 'Weather and prices refreshed' : 'Refresh finished with a problem',
          detail: (weatherOk ? 'Forecast updated' : 'Forecast failed: ' + weather.status.lastError) + ' · ' +
                  (pricesErr ? 'prices failed: ' + market.status.lastError + ', showing the ' + market.status.tier + ' copy'
                             : (market.status.periodLabel || 'prices') + ' · ' + market.status.tier),
          ms: 5000
        });
      });
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    var savedLocation = NS.store.local.get('location', cfg.defaultLocationId);
    state.location = cfg.locations.filter(function (l) { return l.id === savedLocation; })[0] ||
                     cfg.locations.filter(function (l) { return l.id === cfg.defaultLocationId; })[0] ||
                     cfg.locations[0];

    charts.init();
    shell.build();
    bindChrome();

    // The page builds its static rows and bindings before any data lands.
    pageModule = NS.pages && NS.pages[shell.page];
    if (pageModule && pageModule.init) {
      try { pageModule.init({ renderAll: renderAll, renderOperations: renderOperations, loadWeather: loadWeather }); }
      catch (err) { console.error('[AgroSense] page init failed', err); }
    }

    // Prices first: the offline tier publishes synchronously, so the page
    // paints with real figures before any request is answered.
    market.subscribe(function (event) {
      if (event.type === 'loading') { refreshLivePill(); return; }
      renderAll();
    });
    market.init();

    // A running zone redraws its own progress; a finished one changes the
    // water balance, so the operations view is rebuilt.
    NS.irrigation.subscribe(function () { renderOperations(); });
    NS.irrigation.startClock();

    NS.pests.subscribe(function () { renderAll(); });

    // A forecast fetched on the previous page is reused if still fresh.
    if (weather.restore(state.location)) {
      renderAll();
      pingHarvest();
    } else {
      renderAll();
      loadWeather();
    }

    setInterval(function () {
      if (document.hidden) return;
      if (Date.now() - (weather.status.lastFetched || 0) > cfg.weather.refreshMs) loadWeather();
    }, 60000);

    setInterval(function () { renderAll(); pingHarvest(); }, cfg.harvest.checkMs);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        NS.irrigation.stopClock();
      } else {
        NS.irrigation.startClock();
        if (Date.now() - (weather.status.lastFetched || 0) > cfg.weather.refreshMs) loadWeather();
      }
    });

    // Charts paint to a canvas, so one drawn before Jost arrives keeps the fallback face.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        Object.keys(charts.instances).forEach(function (k) {
          if (charts.instances[k] && charts.instances[k].update) charts.instances[k].update('none');
        });
      });
    }

    if (typeof Chart === 'undefined') {
      console.warn('[AgroSense] Chart.js did not load — tables and figures still work, charts will be blank.');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  NS.app = { renderAll: renderAll, renderOperations: renderOperations, loadWeather: loadWeather, state: state };
})(window.AgroSense);
