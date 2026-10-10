/**
 * AgroSense - the operations page
 * ---------------------------------------------------------------
 * Irrigation control and pest control. Both run off the same forecast,
 * and both can change what the farm is allowed to sell.
 */
(function (NS) {
  'use strict';

  var fmt = NS.fmt;
  var dom = NS.dom;
  var el = dom.el, setText = dom.setText, tag = dom.tag, icon = dom.icon, badge = dom.badge;
  var charts = NS.charts;

  /* ---------- irrigation ---------- */

  var ZONE_CLASS = {
    'Irrigate now': 'is-due',
    'Due soon': 'is-soon',
    'Holding': 'is-ok',
    'Rain expected': 'is-ok',
    'Rain-fed': 'is-rainfed'
  };

  function renderIrrigation(ctx) {
    var snap = ctx.irrigation;
    var s = snap.summary;

    setText(el('irrDue'), String(s.dueCount));
    setText(el('irrDueNote'), s.runningCount
      ? s.runningCount + ' zone' + (s.runningCount === 1 ? '' : 's') + ' running now · ' +
        Math.round(s.ledger.waterM3) + ' m³ applied today'
      : s.dueCount ? 'Past the refill point and drawing on reserve' : 'Every zone is inside its comfortable range');

    setText(el('irrWater'), Math.round(s.plannedM3) + ' m³');
    setText(el('irrWaterNote'), s.plannedM3
      ? fmt.money(s.plannedCost) + ' at ' + fmt.money(NS.irrigation.settings.waterCostPerM3) + '/m³'
      : 'Nothing to apply today');

    setText(el('irrSaved'), Math.round(s.savedM3) + ' m³');
    setText(el('irrSavedNote'), s.savedM3
      ? fmt.money(s.savedCost) + ' of pumping displaced over three days'
      : 'No rain in range — every millimetre has to be pumped');

    setText(el('irrBalanceSource'), s.estimated ? 'Estimated — forecast unavailable' : 'From Open-Meteo ET₀ and rainfall');
    setText(el('irrClockNote'), 'Demo clock: 1 second = ' + NS.irrigation.settings.simulationSpeed + ' seconds of run time');

    var due = snap.zones.filter(function (z) { return z.canIrrigate && z.advice.state === 'Irrigate now' && !z.run; });
    document.getElementById('irrigateAllBtn').disabled = due.length === 0;
    document.getElementById('irrigateStopBtn').disabled = s.runningCount === 0;

    renderZones(snap.zones);

    if (typeof Chart !== 'undefined') charts.waterDeficit(document.getElementById('deficitChart'), snap.zones);
  }

  function renderZones(zones) {
    var host = el('zoneList');
    host.innerHTML = '';

    zones.forEach(function (z) {
      var row = tag('div', 'zone ' + (z.run ? 'is-running' : (ZONE_CLASS[z.advice.state] || '')));

      var body = tag('div');
      var head = tag('div', 'zone-head');
      head.appendChild(tag('span', 'zone-id', z.id));
      head.appendChild(dom.mark(z.crop.id, z.crop.color));
      head.appendChild(tag('span', 'zone-name', z.field + ' · ' + z.crop.name));
      head.appendChild(badge(z.advice.tone === 'critical' ? 'critical' : z.advice.tone,
        z.run ? 'i-droplet' : (z.canIrrigate ? 'i-valve' : 'i-rain'), z.run ? 'Running' : z.advice.state));
      body.appendChild(head);
      body.appendChild(tag('p', 'zone-reason', z.advice.reason));

      var stats = tag('div', 'zone-stats');
      function stat(label, value) {
        var s = tag('span', null);
        s.appendChild(tag('b', null, value));
        s.appendChild(document.createTextNode(label));
        stats.appendChild(s);
      }
      stat('deficit', Math.round(z.balance.deficit) + ' mm');
      stat('refill at', Math.round(z.balance.raw) + ' mm');
      stat('crop use', z.balance.etc.toFixed(1) + ' mm/day');
      stat('method', z.method);
      if (z.canIrrigate && z.advice.mmNeeded > 0) {
        stat('run time', Math.round(z.advice.minutes) + ' min');
        stat('water', Math.round(z.advice.volumeM3) + ' m³');
        stat('cost', fmt.moneyShort(z.advice.cost));
      }
      body.appendChild(stats);
      row.appendChild(body);

      var actions = tag('div', 'zone-actions');
      if (z.canIrrigate) {
        if (z.run) {
          var stop = tag('button', 'btn btn-stop');
          stop.appendChild(icon('i-stop'));
          stop.appendChild(document.createTextNode('Close valve'));
          stop.addEventListener('click', function () { NS.irrigation.stop(z.id); });
          actions.appendChild(stop);
        } else {
          var start = tag('button', 'btn btn-primary');
          start.appendChild(icon('i-play'));
          start.appendChild(document.createTextNode('Open valve'));
          start.disabled = z.advice.mmNeeded <= 0.5;
          start.title = z.advice.mmNeeded <= 0.5
            ? 'Nothing to apply — the soil is at capacity'
            : 'Run for ' + Math.round(z.advice.minutes) + ' minutes to close a ' + Math.round(z.advice.mmNeeded) + ' mm deficit';
          start.addEventListener('click', function () { NS.irrigation.start(z.id, z.advice.minutes); });
          actions.appendChild(start);
        }
      } else {
        actions.appendChild(tag('span', 'chip', 'No valve'));
      }
      row.appendChild(actions);

      if (z.run) {
        var bar = tag('div', 'run-bar');
        var track = tag('div', 'run-track');
        var fill = tag('span', 'run-fill');
        fill.style.width = (z.run.progress * 100).toFixed(1) + '%';
        track.appendChild(fill);
        bar.appendChild(track);
        var meta = tag('div', 'run-meta');
        meta.appendChild(tag('span', null, Math.round(z.run.elapsedMinutes) + ' of ' + Math.round(z.run.plannedMinutes) + ' min · ' + z.run.appliedMm.toFixed(1) + ' mm applied'));
        meta.appendChild(tag('span', null, Math.round(z.run.volumeM3) + ' m³ · ' + fmt.money(z.run.cost)));
        bar.appendChild(meta);
        row.appendChild(bar);
      }

      host.appendChild(row);
    });
  }

  /* ---------- pests ---------- */

  function renderPests(ctx) {
    var assessment = ctx.pests;
    var s = assessment.summary;

    setText(el('pestUrgent'), String(s.urgent));
    setText(el('pestUrgentNote'), s.urgent
      ? Math.round(s.hectaresAtRisk) + ' ha exposed · ' + fmt.moneyShort(s.plannedCost) + ' to treat'
      : 'Nothing above the treatment threshold');

    var w = assessment.sprayWindow;
    setText(el('pestWindow'), w ? (w.open ? 'Open now' : fmt.dayMonth(w.start) + ' ' + fmt.time(w.start)) : (ctx.weather ? 'None in 72h' : '—'));
    setText(el('pestWindowNote'), w
      ? w.hours + ' usable hours · under ' + NS.pests.settings.sprayLimits.maxWindKmh + ' km/h wind, low rain risk'
      : ctx.weather ? 'Too wet or too windy for the next three days' : 'Waiting on the forecast');

    setText(el('pestBlocked'), String(s.blockedFields));
    setText(el('pestBlockedNote'), s.blockedFields
      ? 'Block' + (s.blockedFields === 1 ? '' : 's') + ' inside a pre-harvest interval'
      : 'Every block is clear to harvest and sell');

    renderPestList(assessment.rows);
    renderTreatments(assessment.treatments);
    renderDegreeDayChart(assessment.rows);
  }

  function renderPestList(rows) {
    var host = el('pestList');
    host.innerHTML = '';

    rows.forEach(function (p) {
      var row = tag('div', 'pest');
      row.setAttribute('data-level', p.status.level);

      var glyph = tag('span', 'pest-icon');
      glyph.appendChild(icon(p.type === 'insect' ? 'i-bug' : 'i-leaf'));
      row.appendChild(glyph);

      var body = tag('div');
      var head = tag('div', 'pest-head');
      head.appendChild(tag('span', 'pest-name', p.name));
      head.appendChild(dom.mark(p.cropId, p.color));
      head.appendChild(tag('span', 'pest-crop', p.cropName + ' · ' + p.fields.join(', ') + ' · ' + p.hectares + ' ha'));
      head.appendChild(badge(p.status.level === 'ok' ? 'ok' : p.status.level, p.status.level === 'ok' ? 'i-shield' : 'i-alert', p.status.label));
      if (p.overdueScouting) head.appendChild(badge('warn', 'i-search', 'Scouting overdue'));
      if (p.underPhi) {
        var phi = badge('neutral', 'i-shield', Math.round(p.underPhi.daysRemaining) + 'd until sale');
        phi.title = p.underPhi.detail;
        head.appendChild(phi);
      }
      body.appendChild(head);
      body.appendChild(tag('p', 'pest-driver', p.driver));

      var meta = tag('div', 'pest-meta');
      function m(label, value) {
        var span = tag('span', null, label + ' ');
        span.appendChild(tag('span', 'num', value));
        meta.appendChild(span);
      }
      m('Last scouted', p.scoutedDaysAgo + 'd ago');
      m('Product', p.product);
      m('Pre-harvest interval', p.phiDays + ' days');
      m('Treatment cost', fmt.moneyShort(p.treatmentCost));
      body.appendChild(meta);
      row.appendChild(body);

      var actions = tag('div', 'pest-actions');
      var treat = tag('button', 'btn btn-primary');
      treat.appendChild(icon('i-spray'));
      treat.appendChild(document.createTextNode('Record treatment'));
      treat.disabled = !p.canSpray;
      treat.title = p.canSpray
        ? 'Applies ' + p.product + ' across ' + p.hectares + ' ha and starts a ' + p.phiDays + '-day pre-harvest interval'
        : 'No spray window in the next 72 hours — too wet or too windy';
      treat.addEventListener('click', function () {
        if (!window.confirm(
          'Record ' + p.product + ' on ' + p.fields.join(', ') + '?\n\n' +
          'This starts a ' + p.phiDays + '-day pre-harvest interval, so ' + p.cropName.toLowerCase() +
          ' from ' + (p.fields.length === 1 ? 'this block' : 'these blocks') + ' cannot be sold until it expires.'
        )) return;
        NS.pests.treat(p.id);
      });
      actions.appendChild(treat);

      var scout = tag('button', 'btn btn-quiet');
      scout.appendChild(icon('i-search'));
      scout.appendChild(document.createTextNode('Log scouting'));
      scout.addEventListener('click', function () { NS.pests.scout(p.id); });
      actions.appendChild(scout);
      row.appendChild(actions);

      var pressure = tag('div', 'pressure');
      var track = tag('div', 'pressure-track');
      var fill = tag('span', 'pressure-fill ' + p.status.level);
      fill.style.width = Math.max(2, Math.min(100, p.progress * 100)) + '%';
      track.appendChild(fill);
      pressure.appendChild(track);
      var label;
      if (!p.dd && !p.infection) {
        label = 'Waiting on the forecast — this model needs hourly weather to run.';
      } else if (p.type === 'insect') {
        label = p.exceeded
          ? Math.round(p.dd.accumulated) + ' degree days — past the ' + p.dd.threshold + ' needed for a new generation'
          : Math.round(p.dd.accumulated) + ' of ' + p.dd.threshold + ' degree days to the next generation';
      } else {
        label = p.exceeded
          ? p.infection.longestRun + ' unbroken humid hours against the ' + p.infection.trigger + ' this pathogen needs'
          : p.infection.longestRun + ' of ' + p.infection.trigger + ' humid hours needed to infect';
      }
      pressure.appendChild(tag('span', 'pressure-label', label));
      row.appendChild(pressure);

      host.appendChild(row);
    });
  }

  function renderTreatments(treatments) {
    var host = el('treatmentList');
    host.innerHTML = '';

    if (!treatments.length) {
      host.appendChild(tag('p', 'chart-caption', 'No treatments on record. Nothing is blocked from sale.'));
      return;
    }

    treatments.forEach(function (t) {
      var row = tag('div', 'treatment' + (t.recordedNow ? ' is-new' : ''));
      var glyph = tag('span', 'pest-icon');
      glyph.appendChild(icon(t.blocked ? 'i-shield' : 'i-spray'));
      row.appendChild(glyph);
      var body = tag('div', 'treatment-body');
      body.appendChild(tag('div', 'treatment-title', t.product + ' · ' + t.field));
      body.appendChild(tag('div', 'treatment-sub',
        t.hectares + ' ha · applied ' + (t.daysSince < 1 ? 'today' : Math.round(t.daysSince) + ' days ago') + ' · ' + t.phiDays + '-day interval'));
      row.appendChild(body);
      row.appendChild(badge(t.blocked ? 'critical' : 'good', t.blocked ? 'i-clock' : 'i-shield',
        t.blocked ? Math.ceil(t.daysRemaining) + 'd to clear' : 'Clear to sell'));
      host.appendChild(row);
    });
  }

  var ddBound = false;

  function renderDegreeDayChart(rows) {
    var insects = rows.filter(function (r) { return r.type === 'insect' && r.dd; });
    if (!insects.length) return;

    var select = document.getElementById('pestSelect');
    if (!select.options.length) {
      insects.forEach(function (p) {
        var opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      select.value = insects[0].id;
    }
    if (!ddBound) {
      ddBound = true;
      select.addEventListener('change', function () {
        if (charts.instances.degreeDays) {
          charts.instances.degreeDays.destroy();
          delete charts.instances.degreeDays;
        }
        NS.app.renderOperations();
      });
    }

    var chosen = insects.filter(function (p) { return p.id === select.value; })[0] || insects[0];

    setText(el('ddCaption'),
      chosen.dd.progress >= 1
        ? chosen.name + ' has passed its generation threshold. Treat inside the next spray window.'
        : chosen.name + ' is gaining ' + chosen.dd.avgDaily.toFixed(1) +
          ' degree days a day. On the current forecast it crosses the threshold in about ' +
          Math.max(1, Math.round(chosen.dd.daysToGeneration || 0)) + ' days.');

    if (typeof Chart !== 'undefined') {
      charts.degreeDays(document.getElementById('ddChart'), chosen.dd, chosen.name, chosen.dd.threshold);
    }
  }

  /* ---------- page ---------- */

  NS.pages = NS.pages || {};
  NS.pages.operations = {
    init: function () {
      document.getElementById('irrigateAllBtn').addEventListener('click', function () {
        var started = NS.irrigation.startAllDue(NS.weather.getCached());
        if (!started.length) console.info('[AgroSense] no zones are past their refill point');
        NS.app.renderOperations();
      });
      document.getElementById('irrigateStopBtn').addEventListener('click', function () {
        NS.irrigation.stopAll();
        NS.app.renderOperations();
      });
    },
    render: function (ctx) {
      renderIrrigation(ctx);
      renderPests(ctx);
    },
    renderOperations: function (ctx) {
      renderIrrigation(ctx);
      renderPests(ctx);
    }
  };
})(window.AgroSense);
