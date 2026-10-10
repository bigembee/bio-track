/**
 * Bio Track - the live data page
 * ---------------------------------------------------------------
 * The two external feeds, shown with their provenance: Open-Meteo for
 * the farm's coordinates, and WFP market prices via HDX for crops and
 * livestock products. Every figure says where it came from and when.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var fmt = NS.fmt;
  var dom = NS.dom;
  var el = dom.el, all = dom.all, setText = dom.setText, tag = dom.tag, icon = dom.icon, badge = dom.badge;
  var charts = NS.charts;
  var market = NS.market;
  var weather = NS.weather;

  var state = {
    range: 12,
    visible: {},
    built: false
  };

  /* ---------- weather ---------- */

  function renderWeather(ctx) {
    var w = ctx.weather;
    var errHost = el('weatherError');

    if (!w) {
      if (ctx.weatherError) {
        errHost.hidden = false;
        errHost.innerHTML = '';
        var notice = tag('div', 'notice');
        notice.appendChild(tag('strong', null, 'The weather forecast did not load'));
        notice.appendChild(tag('span', null, ctx.weatherError + '. Prices below are unaffected — they do not depend on this request.'));
        var retry = tag('button', null, 'Try again');
        retry.addEventListener('click', function () { NS.app.loadWeather(); });
        notice.appendChild(retry);
        errHost.appendChild(notice);
      }
      return;
    }
    errHost.hidden = true;

    // The current conditions live on the cockpit; this page is the forecast and its sources.
    setText(el('weatherPlace'), w.location.name + ', ' + w.location.region);
    setText(el('coordChip'), w.location.lat.toFixed(4) + ', ' + w.location.lon.toFixed(4));
    setText(el('weatherAge'), weather.status.lastFetched ? 'Updated ' + fmt.ago(weather.status.lastFetched) : 'Not loaded');

    if (typeof Chart !== 'undefined') {
      charts.forecastTemp(document.getElementById('tempChart'), w.daily);
      charts.forecastRain(document.getElementById('rainChart'), w.daily);
    }
  }

  /** The product's picture, or the old coloured square if it has none. */
  function markFor(inst, swatchClass) {
    if (inst.picture) return dom.picture(inst.picture, inst.color);
    var sw = tag('span', swatchClass);
    sw.style.background = inst.color;
    return sw;
  }

  /* ---------- market tables ---------- */

  var rows = {};

  function buildRows(kind, hostName) {
    var body = el(hostName);
    if (!body) return;
    body.innerHTML = '';

    market.ids(kind).forEach(function (id) {
      var inst = market.instruments.filter(function (i) { return i.id === id; })[0];
      var tr = tag('tr');

      var tdName = tag('td');
      var cell = tag('div', 'crop-cell');
      cell.appendChild(markFor(inst, 'crop-swatch'));
      var names = tag('span');
      names.appendChild(tag('span', 'crop-name', inst.name));
      var sub = tag('span', 'crop-sub', '');
      names.appendChild(sub);
      cell.appendChild(names);
      tdName.appendChild(cell);
      tr.appendChild(tdName);

      var tdPrice = tag('td', 'right num');
      var tdChange = tag('td', 'right');
      var change = tag('span', 'delta flat', '—');
      tdChange.appendChild(change);
      var tdAvg = tag('td', 'right num');
      var tdYoy = tag('td', 'right');
      var yoy = tag('span', 'delta flat', '—');
      tdYoy.appendChild(yoy);

      var tdSpark = tag('td');
      var canvas = document.createElement('canvas');
      canvas.className = 'spark';
      canvas.setAttribute('aria-hidden', 'true');
      tdSpark.appendChild(canvas);

      var tdSignal = tag('td');
      var sig = tag('span', 'badge neutral');
      tdSignal.appendChild(sig);

      var tdSource = tag('td');
      var src = tag('span', 'badge neutral');
      tdSource.appendChild(src);

      tr.appendChild(tdPrice);
      tr.appendChild(tdChange);
      tr.appendChild(tdAvg);
      tr.appendChild(tdYoy);
      tr.appendChild(tdSpark);
      tr.appendChild(tdSignal);
      tr.appendChild(tdSource);
      body.appendChild(tr);

      rows[id] = { sub: sub, price: tdPrice, change: change, avg: tdAvg, yoy: yoy, canvas: canvas, signal: sig, source: src, unit: inst.unit };
    });
  }

  var MODE_BADGE = {
    live: { tone: 'good', icon: 'i-database', label: 'WFP live' },
    proxy: { tone: 'warn', icon: 'i-database', label: 'Proxy' },
    modelled: { tone: 'neutral', icon: 'i-alert', label: 'Modelled' }
  };

  function updateRows(quotes) {
    Object.keys(rows).forEach(function (id) {
      var q = quotes[id];
      var r = rows[id];
      if (!q || !r) return;

      setText(r.sub, q.mode === 'modelled' ? 'No WFP series' : q.commodity + ' · ' + q.markets + ' markets');
      setText(r.price, fmt.price(q.price) + (r.unit === 'kg' ? '' : '/' + r.unit));
      setText(r.change, fmt.pctSigned(q.changePct, 1));
      r.change.className = 'delta ' + dom.deltaClass(q.changePct);
      setText(r.avg, fmt.price(q.ma12));
      setText(r.yoy, q.yoy != null ? fmt.pctSigned(q.yoy, 0) : '—');
      r.yoy.className = 'delta ' + (q.yoy != null ? dom.deltaClass(q.yoy) : 'flat');

      r.signal.className = 'badge ' + q.signal.tone;
      setText(r.signal, q.signal.label);
      r.signal.title = q.signal.reason;

      var m = MODE_BADGE[q.mode];
      r.source.className = 'badge ' + m.tone;
      r.source.innerHTML = '';
      r.source.appendChild(icon(m.icon));
      r.source.appendChild(document.createTextNode(m.label));
      r.source.title = q.note;

      charts.sparkline(r.canvas, q.spark, q.color);
    });
  }

  /* ---------- trend charts ---------- */

  function buildLegend(hostName, kind, key) {
    var host = el(hostName);
    if (!host) return;
    host.innerHTML = '';
    market.ids(kind).forEach(function (id) {
      var inst = market.instruments.filter(function (i) { return i.id === id; })[0];
      if (state.visible[id] == null) state.visible[id] = true;
      var btn = tag('button', 'legend-item');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', 'true');
      btn.appendChild(markFor(inst, 'legend-swatch'));
      btn.appendChild(document.createTextNode(inst.name));
      btn.addEventListener('click', function () {
        state.visible[id] = !state.visible[id];
        btn.classList.toggle('is-off', !state.visible[id]);
        btn.setAttribute('aria-pressed', String(state.visible[id]));
        applyVisibility(key);
      });
      host.appendChild(btn);
    });
  }

  function applyVisibility(key) {
    var chart = charts.instances[key];
    if (!chart) return;
    chart.data.datasets.forEach(function (ds) { ds.hidden = !state.visible[ds.cropId]; });
    chart.update('none');
  }

  function renderTrends() {
    if (typeof Chart === 'undefined') return;
    charts.marketTrend(document.getElementById('marketChart'), market.ids('crop'), state.range, 'market');
    applyVisibility('market');
    if (document.getElementById('livestockChart')) {
      charts.marketTrend(document.getElementById('livestockChart'), market.ids('livestock'), state.range, 'livestockTrend');
      applyVisibility('livestockTrend');
    }
    setText(el('rangeLabel'), 'Last ' + state.range + ' months');
    all('[data-range]').forEach(function (btn) {
      var selected = Number(btn.dataset.range) === state.range;
      btn.classList.toggle('is-selected', selected);
      btn.setAttribute('aria-pressed', String(selected));
    });
  }

  /* ---------- provenance card ---------- */

  function renderSource() {
    var s = market.status;
    var host = el('sourceCard');
    if (!host) return;
    host.innerHTML = '';

    function line(label, value) {
      var row = tag('div', 'source-line');
      row.appendChild(tag('span', 'eyebrow', label));
      var v = tag('span', null);
      if (typeof value === 'string') v.textContent = value; else v.appendChild(value);
      row.appendChild(v);
      host.appendChild(row);
    }

    var link = tag('a', null, s.source);
    link.href = s.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.appendChild(document.createTextNode(' '));
    link.appendChild(icon('i-external'));
    line('Feed', link);
    line('Latest complete month', (s.periodLabel || '—') + (s.markets ? ' · ' + s.markets + ' markets reporting' : ''));
    if (s.partialPeriod) line('Partial month', s.partialPeriod.label + ' · only ' + s.partialPeriod.markets + ' market' + (s.partialPeriod.markets === 1 ? '' : 's') + ' in so far — held back until ' + cfg.market.minMarkets + ' report');
    line('Reporting from', s.states.length ? s.states.join(', ') + ' — the WFP-monitored markets currently publishing for Nigeria' : '—');
    line('Price type', 'Retail, median across markets' + (cfg.market.farmgateFactor !== 1 ? ' × ' + cfg.market.farmgateFactor + ' farmgate factor' : ' — no farmgate adjustment applied'));
    line('Coverage', s.liveCount + ' live series, ' + s.proxyCount + ' proxies, ' + s.modelledCount + ' modelled (no WFP series exists)');
    line('Loaded from', s.tier === 'live' ? 'HDX HAPI, fetched ' + fmt.ago(s.fetchedAt) + ' in ' + s.latencyMs + ' ms'
                      : s.tier === 'cache' ? 'a cached fetch from ' + fmt.ago(s.fetchedAt) + (s.state === 'loading' ? ' — refreshing now' : '')
                      : s.tier === 'snapshot' ? 'the bundled snapshot' + (s.fetchedAt ? ' (' + fmt.dayMonth(s.fetchedAt) + ')' : '') + (s.state === 'loading' ? ' — refreshing now' : s.state === 'error' ? ' — live refresh failed: ' + s.lastError : '')
                      : 'nothing — every price is modelled');
  }

  /* ---------- page ---------- */

  NS.pages = NS.pages || {};
  NS.pages.live = {
    init: function () {
      buildRows('crop', 'marketRows');
      buildRows('livestock', 'livestockRows');
      buildLegend('marketLegend', 'crop', 'market');
      buildLegend('livestockLegend', 'livestock', 'livestockTrend');
      all('[data-range]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          state.range = Number(btn.dataset.range);
          renderTrends();
        });
      });
      var refresh = document.getElementById('pricesRefreshBtn');
      if (refresh) refresh.addEventListener('click', function () {
        if (refresh.disabled) return;
        refresh.disabled = true;
        refresh.classList.add('is-spinning');
        market.refresh().then(function () { return null; }, function (e) { return e; }).then(function (err) {
          refresh.disabled = false;
          refresh.classList.remove('is-spinning');
          var s = market.status;
          NS.shell.toast({
            tone: err ? 'warning' : 'good',
            icon: err ? 'i-alert' : 'i-check',
            title: err ? 'Prices could not be refreshed' : 'Prices refreshed',
            detail: err ? s.lastError + ' — still showing the ' + s.tier + ' copy.'
                        : s.periodLabel + ' · ' + s.liveCount + ' live, ' + s.proxyCount + ' proxy, ' + s.modelledCount + ' modelled',
            ms: 5000
          });
        });
      });
      setInterval(function () {
        setText(el('weatherAge'), weather.status.lastFetched ? 'Updated ' + fmt.ago(weather.status.lastFetched) : 'Not loaded');
      }, 15000);
    },
    render: function (ctx) {
      renderWeather(ctx);
      updateRows(ctx.quotes);
      renderTrends();
      renderSource();
    }
  };
})(window.AgroSense);
