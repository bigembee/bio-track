/**
 * Bio Track - the cockpit page
 * ---------------------------------------------------------------
 * One screen that answers "how is the farm, right now?" without
 * scrolling: conditions and the seven days ahead, the farm's own
 * figures, the market feed with its provenance, what the place is
 * worth, and the jobs that want doing today.
 *
 * Below the fold sits the reasoning - the ranked sell priority, the
 * advisories behind it, and the harvest calendar.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var fmt = NS.fmt;
  var dom = NS.dom;
  var el = dom.el, setText = dom.setText, tag = dom.tag, icon = dom.icon, badge = dom.badge, peek = dom.peek;
  var charts = NS.charts;

  var lastFarmValue = null;

  var WEATHER_ICONS = {
    sun: 'i-sun', 'sun-cloud': 'i-sun-cloud', cloud: 'i-cloud', rain: 'i-rain',
    drizzle: 'i-drizzle', storm: 'i-storm', fog: 'i-fog', snow: 'i-snow',
    droplet: 'i-droplet', wind: 'i-wind', leaf: 'i-leaf', thermometer: 'i-thermometer'
  };

  /* =====================================================================
     Conditions - where the farm is, what the sky is doing, seven days out
     ===================================================================== */

  function renderConditions(ctx) {
    var now = new Date();
    setText(el('ckDate'), now.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }));
    setText(el('ckTime'), fmt.time(now));

    setText(el('ckFarmName'), cfg.farm.name);
    setText(el('ckArea'), cfg.farm.hectares + ' ha');
    setText(el('ckBlocks'), String(cfg.fields.length));
    setText(el('ckHerds'), String(cfg.livestock.herds.length));

    var w = ctx.weather;
    var place = ctx.location ? ctx.location.name + ', ' + ctx.location.region : 'n/a';
    setText(el('ckPlace'), place);

    if (!w) {
      setText(el('ckTemp'), 'n/a');
      setText(el('ckCond'), ctx.weatherError ? 'Forecast unavailable' : 'Reading the sky…');
      setText(el('ckHL'), 'n/a');
      return;
    }

    var c = w.current;
    setText(el('ckTemp'), Math.round(c.temp) + '°');
    setText(el('ckCond'), c.condition.label);
    el('ckIcon').querySelector('use').setAttribute('href', '#' + (WEATHER_ICONS[c.condition.icon] || 'i-cloud'));

    var t = w.daily[0];
    setText(el('ckHL'), (t ? 'H ' + Math.round(t.tempMax) + '°  L ' + Math.round(t.tempMin) + '°  ·  ' : '') +
                        'Feels ' + Math.round(c.feelsLike) + '°');

    var host = el('ckForecast');
    host.innerHTML = '';
    w.daily.forEach(function (d, i) {
      var day = tag('div', 'fc-day' + (i === 0 ? ' is-today' : ''));
      day.appendChild(tag('span', 'fc-label', i === 0 ? 'Today' : d.label));
      var glyph = icon(WEATHER_ICONS[d.condition.icon] || 'i-cloud', 'fc-icon');
      day.appendChild(glyph);
      day.appendChild(tag('span', 'fc-high num', Math.round(d.tempMax) + '°'));
      day.appendChild(tag('span', 'fc-low num', Math.round(d.tempMin) + '°'));
      if (d.precipSum >= 1) {
        day.appendChild(tag('span', 'fc-rain num', d.precipSum.toFixed(d.precipSum >= 10 ? 0 : 1) + 'mm'));
      }
      day.title = d.label + ' · ' + d.condition.label + ' · ' +
                  Math.round(d.tempMax) + '°/' + Math.round(d.tempMin) + '° · ' +
                  d.precipSum.toFixed(1) + ' mm · ' + d.precipProb + '% chance';
      host.appendChild(day);
    });
  }

  /* =====================================================================
     The six tiles - three of the sky, three of the farm
     ===================================================================== */

  function renderTiles(ctx) {
    var s = ctx.snapshot.summary;
    var stock = ctx.snapshot.livestock.summary;
    var w = ctx.weather;

    if (w) {
      setText(el('tileSoil'), w.soil.moisturePct != null ? w.soil.moisturePct.toFixed(1) + '%' : 'n/a');
      var et0 = w.daily[0] && w.daily[0].et0 != null ? w.daily[0].et0.toFixed(1) : null;
      setText(el('tileSoilNote'),
        (w.soil.temp != null ? 'Soil ' + Math.round(w.soil.temp) + '° · ' : '') +
        (et0 ? 'crops losing ' + et0 + ' mm/day to the air' : 'volumetric water in the top centimetre') +
        (ctx.irrigation.summary.dueCount ? ' · ' + ctx.irrigation.summary.dueCount + ' zone(s) due' : ''));

      setText(el('tileHumidity'), Math.round(w.current.humidity) + '%');
      setText(el('tileHumidityNote'), w.next48.humidHours + ' of the next 48 hours above 85%; the band disease needs');

      setText(el('tileRain'), w.next48.precipTotal.toFixed(1) + ' mm');
      setText(el('tileRainNote'), 'Peaking at ' + w.next48.maxProb + '% chance · ' + Math.round(w.current.wind) + ' km/h wind now');
    } else {
      ['tileSoil', 'tileHumidity', 'tileRain'].forEach(function (k) { setText(el(k), 'n/a'); });
      ['tileSoilNote', 'tileHumidityNote', 'tileRainNote'].forEach(function (k) {
        setText(el(k), ctx.weatherError ? 'Needs the forecast' : 'Waiting on the forecast…');
      });
    }

    setText(el('tileMass'), fmt.mass(s.totalKg));
    setText(el('tileMassNote'), s.cropCount + ' crops · ' + s.lotCount + ' lots · biggest holding ' + s.topCrop +
                                ' at ' + fmt.pct(s.concentration, 0) + ' of crop value');

    setText(el('tileStock'), fmt.moneyShort(stock.totalValue));
    setText(el('tileStockNote'), fmt.head(stock.head) + ' in ' + stock.herds + ' herds · ' +
                                 fmt.moneyShort(stock.eggIncomePerDay) + ' a day in eggs');

    setText(el('tileRisk'), fmt.moneyShort(s.valueAtRisk));
    var risky = ctx.snapshot.lots.filter(function (l) { return l.risk.level !== 'ok'; });
    setText(el('tileRiskNote'), risky.length
      ? fmt.pct(s.atRiskPct, 0) + ' of crop value across ' + risky.length + ' perishable lot' + (risky.length === 1 ? '' : 's')
      : 'Nothing in store is near the end of its window');
  }

  /* =====================================================================
     The market feed - every instrument, with where its price came from
     ===================================================================== */

  var MODE_NOTE = { proxy: 'Proxy series', modelled: 'Modelled, no WFP series' };

  function renderFeed(ctx) {
    var host = el('ckFeed');
    host.innerHTML = '';

    var ms = NS.market.status;
    setText(el('ckCrops'), String(NS.market.ids('crop').length));
    setText(el('ckStock'), String(NS.market.ids('livestock').length));
    setText(el('ckPeriod'), ms.periodLabel ? fmt.monthYear(fmt.monthToDate(ms.period)) : 'n/a');

    NS.market.ids().forEach(function (id) {
      var q = ctx.quotes[id];
      if (!q) return;

      var row = tag('a', 'feed-row');
      row.href = 'live.html#market';
      row.title = q.note;

      // The picture stands in for the old direction dot; the change figure is
      // already coloured up or down beside it.
      row.appendChild(dom.mark(id, q.color));

      var body = tag('div', 'feed-body');
      var top = tag('div', 'feed-top');
      top.appendChild(tag('span', 'feed-name', q.name));
      top.appendChild(tag('span', 'feed-price num', fmt.price(q.price) + (q.unit === 'kg' ? '' : '/' + q.unit)));
      body.appendChild(top);

      var sub = tag('div', 'feed-sub');
      sub.appendChild(tag('span', null, q.mode === 'modelled' ? 'No WFP series' : q.commodity + ' · ' + q.markets + ' markets'));
      sub.appendChild(tag('span', 'delta num ' + dom.deltaClass(q.changePct), fmt.pctSigned(q.changePct, 1)));
      body.appendChild(sub);

      // The reference puts a warning strip on a sensor that is not reporting;
      // ours says when a price is standing in for one we cannot get.
      if (MODE_NOTE[q.mode]) {
        var warn = tag('div', 'feed-warn');
        warn.appendChild(icon('i-alert'));
        warn.appendChild(document.createTextNode(MODE_NOTE[q.mode]));
        body.appendChild(warn);
      }

      row.appendChild(body);
      host.appendChild(row);
    });
  }

  /* =====================================================================
     What the farm is worth
     ===================================================================== */

  function renderValue(ctx) {
    var s = ctx.snapshot.summary;
    var history = ctx.history;
    var value = s.farmValue;
    var node = el('portfolioValue');

    if (lastFarmValue != null && Math.abs(value - lastFarmValue) > 1) {
      dom.flash(node, value > lastFarmValue ? 1 : -1);
    }
    lastFarmValue = value;
    setText(node, fmt.money(value));

    setText(el('portfolioCaption'),
      fmt.moneyShort(s.totalValue) + ' in store plus ' + fmt.moneyShort(s.livestockValue) +
      ' on the hoof, at ' + (NS.market.status.periodLabel || 'current') + ' prices.');

    var deltas = el('portfolioDeltas');
    deltas.innerHTML = '';
    if (history.points.length > 1) {
      [['Month', history.changeVsMonth, history.changeVsMonthPct],
       ['Year', history.changeVsYear, history.changeVsYearPct]].forEach(function (d) {
        var c = tag('span', 'chip ' + (d[1] >= 0 ? 'up' : 'down'));
        c.appendChild(document.createTextNode(d[0] + ' '));
        c.appendChild(tag('span', 'num', fmt.pctSigned(d[2])));
        c.title = d[0] === 'Month' ? 'Against last month: ' + fmt.moneySigned(d[1])
                                   : 'Against a year ago: ' + fmt.moneySigned(d[1]);
        deltas.appendChild(c);
      });
    }

    if (typeof Chart !== 'undefined' && document.getElementById('portfolioChart')) {
      charts.portfolioValue(document.getElementById('portfolioChart'), history, { on: 'accent', bare: true });
    }
  }

  /* =====================================================================
     Today's jobs
     ===================================================================== */

  function renderTasks(ctx) {
    var host = el('ckTasks');
    host.innerHTML = '';

    var list = NS.tasks.build(ctx);

    setText(el('ckTaskSummary'), list.total
      ? list.outstanding + ' of ' + list.total + ' open'
      : 'Nothing due');
    el('ckTaskFill').style.width = (list.progress * 100).toFixed(0) + '%';
    setText(el('ckTaskPct'), Math.round(list.progress * 100) + '%');
    setText(el('ckTaskDone'), list.completed + '/' + list.total + ' done');

    if (!list.total) {
      host.appendChild(tag('p', 'chart-caption',
        'No block is inside its harvest window, no zone is past its refill point, and nothing is overdue. A good morning.'));
      return;
    }

    list.rows.forEach(function (t) {
      var row = tag('div', 'task-row' + (t.done ? ' is-done' : ''));
      row.setAttribute('data-level', t.level);

      var check = tag('button', 'task-check');
      check.type = 'button';
      check.setAttribute('aria-pressed', String(t.done));
      check.setAttribute('aria-label', (t.done ? 'Reopen: ' : 'Mark done: ') + t.title);
      if (t.done) check.appendChild(icon('i-check'));
      check.addEventListener('click', function () {
        NS.tasks.toggle(t);
        NS.app.renderAll();
      });
      row.appendChild(check);

      var body = tag('div', 'task-body');
      var link = tag('a', 'task-title', t.title);
      link.href = t.href;
      body.appendChild(link);
      body.appendChild(tag('p', 'task-detail', t.detail));
      var foot = tag('div', 'task-foot');
      foot.appendChild(icon(t.icon));
      foot.appendChild(tag('span', null, t.when));
      body.appendChild(foot);
      row.appendChild(body);

      host.appendChild(row);
    });
  }

  /* =====================================================================
     Below the fold - the reasoning behind the cockpit
     ===================================================================== */

  function renderPriority(ctx) {
    var list = el('priorityList');
    list.innerHTML = '';

    ctx.snapshot.priority.slice(0, 5).forEach(function (item) {
      var li = tag('li', 'priority-item');
      li.appendChild(tag('span', 'priority-rank'));

      var body = tag('div', 'priority-body');
      var title = tag('div', 'priority-title');

      title.appendChild(dom.mark(item.cropId, item.color));
      title.appendChild(tag('strong', null, item.name));

      if (item.signal) title.appendChild(badge(item.signal.tone, item.signal.code === 'hold' ? 'i-clock' : 'i-trend', item.signal.label));
      if (item.level !== 'ok') title.appendChild(badge(item.level, 'i-alert', fmt.days(item.daysRemaining)));
      if (item.blocked) title.appendChild(badge('neutral', 'i-shield', 'Sale blocked'));

      body.appendChild(title);
      body.appendChild(tag('div', 'priority-driver', item.driver));
      peek(li, tag('p', 'priority-detail', item.detail), body);
      li.appendChild(body);
      list.appendChild(li);
    });
  }

  function renderAdvisories(ctx) {
    var host = el('advisoryList');
    host.innerHTML = '';

    if (!ctx.weather) {
      host.appendChild(tag('p', 'chart-caption', ctx.weatherError
        ? 'The forecast did not load (' + ctx.weatherError + '). Advisories need it; prices and inventory are unaffected.'
        : 'Waiting on the forecast…'));
      return;
    }

    ctx.advisories.forEach(function (a) {
      var row = tag('div', 'advisory');
      row.setAttribute('data-severity', a.severity);
      var glyph = tag('span', 'advisory-icon');
      glyph.appendChild(icon(WEATHER_ICONS[a.icon] || 'i-alert'));
      row.appendChild(glyph);
      var body = tag('div');
      body.appendChild(tag('h4', null, a.title));
      body.appendChild(tag('p', null, a.detail));
      body.appendChild(tag('span', 'advisory-window', a.window));
      row.appendChild(body);
      host.appendChild(row);
    });
  }

  function renderHarvest(ctx) {
    var host = el('harvestList');
    if (!host) return;
    host.innerHTML = '';

    var h = ctx.harvest;
    setText(el('harvestSummary'), h.summary.urgent
      ? h.summary.urgent + ' block' + (h.summary.urgent === 1 ? '' : 's') + ' ready · ' + fmt.mass(h.summary.tonnesReady * 1000) +
        ' · ' + fmt.moneyShort(h.summary.valueReady)
      : h.summary.total ? h.summary.total + ' coming up' : 'Nothing due');

    h.rows.slice(0, 6).forEach(function (r) {
      var row = tag('div', 'harvest-row');
      row.setAttribute('data-level', r.level);

      // Line 1: what, and where it stands. Flags only when they apply.
      var head = tag('div', 'harvest-head');
      head.appendChild(dom.mark(r.cropId, r.color));
      head.appendChild(tag('strong', null, r.cropName + ' · ' + r.field));
      if (r.phi) head.appendChild(badge('neutral', 'i-shield', 'PHI to ' + fmt.dayMonth(r.phi.clearsOn)));
      if (r.weather && r.weather.openingWet) head.appendChild(badge('warn', 'i-rain', 'Wet'));
      var status = badge(r.tone === 'ok' ? 'ok' : r.tone, r.status === 'growing' ? 'i-sprout' : 'i-harvest', r.label);
      status.classList.add('harvest-status');
      head.appendChild(status);
      row.appendChild(head);

      var track = tag('div', 'harvest-track');
      var fill = tag('span', 'harvest-fill');
      fill.style.width = (r.progress * 100).toFixed(1) + '%';
      track.appendChild(fill);
      row.appendChild(track);

      // Line 2: when, and how much. Everything else waits for the hover.
      var line = tag('div', 'harvest-line');
      line.appendChild(tag('span', null, r.when));
      line.appendChild(tag('span', 'num', fmt.mass(r.expectedT * 1000) + ' · ' + fmt.moneyShort(r.expectedValue)));
      row.appendChild(line);

      var more = document.createDocumentFragment();
      more.appendChild(tag('p', 'harvest-sub', 'Planted ' + fmt.dayMonth(r.plantedOn) + ' · day ' + r.plantedDaysAgo +
                           ' of ' + r.maturityDays[0] + '–' + r.maturityDays[1]));
      if (r.alert) more.appendChild(tag('p', 'harvest-detail', r.detail));
      peek(row, more);
      host.appendChild(row);
    });

    h.livestock.forEach(function (s) {
      var row = tag('div', 'harvest-row harvest-wide');
      row.setAttribute('data-level', s.level);
      var head = tag('div', 'harvest-head');
      var glyph = tag('span', 'alert-icon'); glyph.appendChild(icon('i-cow'));
      head.appendChild(glyph);
      head.appendChild(tag('strong', null, s.title));
      var tone = badge(s.tone, 'i-scale', s.label);
      tone.classList.add('harvest-status');
      head.appendChild(tone);
      row.appendChild(head);
      var line = tag('div', 'harvest-line');
      line.appendChild(tag('span', null, fmt.head(s.head)));
      row.appendChild(line);
      host.appendChild(row);
    });
  }

  /* ---------- page ---------- */

  NS.pages = NS.pages || {};
  NS.pages.cockpit = {
    init: function () {
      // The clock in the conditions card has to move on its own.
      setInterval(function () { setText(el('ckTime'), fmt.time(new Date())); }, 20000);
    },
    render: function (ctx) {
      renderConditions(ctx);
      renderTiles(ctx);
      renderFeed(ctx);
      renderValue(ctx);
      renderTasks(ctx);
      renderPriority(ctx);
      renderAdvisories(ctx);
      renderHarvest(ctx);
    }
  };
})(window.AgroSense);
