/**
 * AgroSense - harvest alerts
 * ---------------------------------------------------------------
 * Every planting has a harvest window: the crop's earliest and latest
 * days to maturity, counted from the day it went in. The module works
 * out where each block sits against that window and joins the answer
 * to the three things that decide whether "ready" means "harvest today":
 *
 *   - the FORECAST: is the window wet? Where is the next dry run?
 *   - the MARKET: is the price worth selling straight off the field, or
 *     is this a crop to dry and store?
 *   - the PRE-HARVEST INTERVAL: a spray that has not cleared yet holds
 *     the harvest back whatever the calendar says.
 *
 * Alerts fire in tiers as the window approaches and are pushed to the
 * user two ways: in the interface (bell, cockpit) and, once permission
 * is given, as browser notifications - once a day per block, so a
 * harvest is nagged about, not spammed.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var settings = cfg.harvest;
  var fmt = NS.fmt;
  var DAY_MS = 86400000;

  var STATUS = {
    overdue:     { rank: 0, level: 'critical', label: 'Window closing',   tone: 'critical' },
    ready:       { rank: 1, level: 'serious',  label: 'Ready to harvest', tone: 'serious' },
    imminent:    { rank: 2, level: 'warning',  label: 'Ready this week',  tone: 'warning' },
    approaching: { rank: 3, level: 'info',     label: 'Approaching',      tone: 'neutral' },
    growing:     { rank: 4, level: 'ok',       label: 'Growing',          tone: 'ok' }
  };

  function statusFor(daysToOpen, daysToClose) {
    if (daysToClose < 0) return 'overdue';
    if (daysToOpen <= 0) return 'ready';
    if (daysToOpen <= 7) return 'imminent';
    if (daysToOpen <= settings.leadDays) return 'approaching';
    return 'growing';
  }

  /* ---------- the forecast join ---------- */

  /**
   * Is the harvest going to land in the wet? Only answerable when the
   * window opens inside the forecast horizon. Returns the wet days and
   * the first pair of dry days on or after the opening.
   */
  function weatherWindow(weather, daysToOpen) {
    if (!weather || !weather.daily.length) return null;
    var from = Math.max(0, daysToOpen);
    if (from >= weather.daily.length) return null;

    var span = weather.daily.slice(from);
    var wetDays = span.filter(function (d) { return d.precipSum >= settings.wetDayMm; });
    var dryStart = null;
    for (var i = 0; i + 1 < span.length; i++) {
      if (span[i].precipSum < settings.wetDayMm && span[i + 1].precipSum < settings.wetDayMm) { dryStart = span[i]; break; }
    }
    var opening = span[0];
    return {
      openingWet: opening.precipSum >= settings.wetDayMm,
      openingMm: opening.precipSum,
      wetDays: wetDays.map(function (d) { return d.label; }),
      dryStart: dryStart,
      note: opening.precipSum >= settings.wetDayMm
        ? Math.round(opening.precipSum) + ' mm of rain on ' + opening.label.toLowerCase() +
          (dryStart ? '  the first dry pair of days starts ' + dryStart.label.toLowerCase() + '.' : ' and no dry pair of days in the forecast.')
        : (dryStart ? 'Dry from ' + dryStart.label.toLowerCase() + ', a good pair of days to bring it in.' : 'Only ' + Math.round(opening.precipSum) + ' mm forecast on ' + opening.label.toLowerCase() + '.')
    };
  }

  /* ---------- the market join ---------- */

  function marketNote(crop, quote) {
    if (!quote) return null;
    var code = quote.signal.code;
    var strength = Math.round(Math.abs(quote.price / quote.ma12 - 1) * 100);
    var lead;
    if (code === 'sell' || code === 'soon') {
      lead = crop.name + ' is ' + strength + '% above its 12-month average — worth selling straight off the field.';
    } else if (code === 'hold') {
      lead = crop.name + ' is ' + strength + '% below its 12-month average. ' +
             (crop.shelfLifeDays >= 60
               ? 'It keeps ' + crop.shelfLifeDays + ' days in the ' + crop.store.toLowerCase() + ' — store it and wait for the price.'
               : 'It will not keep, so plan the sale before it comes out of the ground.');
    } else {
      lead = crop.name + ' is trading close to its 12-month average.';
    }
    return { code: code, label: quote.signal.label, tone: quote.signal.tone, text: lead, mode: quote.mode };
  }

  /* ---------- the block view ---------- */

  function assessPlantings(weather, quotes, constraints) {
    var now = Date.now();
    var blocks = constraints || {};

    return cfg.plantings.map(function (planting) {
      var crop = cfg.crops[planting.cropId];
      var quote = quotes ? quotes[planting.cropId] : null;
      var minDays = crop.maturityDays[0], maxDays = crop.maturityDays[1];
      var daysToOpen = minDays - planting.plantedDaysAgo;
      var daysToClose = maxDays - planting.plantedDaysAgo;
      var status = statusFor(daysToOpen, daysToClose);
      var meta = STATUS[status];

      var plantedOn = new Date(now - planting.plantedDaysAgo * DAY_MS);
      var opensOn = new Date(now + daysToOpen * DAY_MS);
      var closesOn = new Date(now + daysToClose * DAY_MS);

      var expectedT = planting.hectares * planting.expectedTPerHa;
      var price = quote ? quote.price : crop.basePrice;
      var expectedValue = expectedT * 1000 * price;

      var block = blocks[planting.field] || null;
      var phi = null;
      if (block && block.clearsOn && block.clearsOn.getTime() > opensOn.getTime()) {
        var lag = Math.ceil((block.clearsOn.getTime() - opensOn.getTime()) / DAY_MS);
        phi = {
          conflict: true,
          clearsOn: block.clearsOn,
          daysAfterOpen: lag,
          text: (block.detail || 'A pre-harvest interval') + ' clears ' + fmt.dayMonth(block.clearsOn) +
                ', ' + lag + ' day' + (lag === 1 ? '' : 's') + ' after the window opens. Nothing from this block can be sold before then.'
        };
      }

      var wx = (status === 'ready' || status === 'imminent' || status === 'overdue') ? weatherWindow(weather, daysToOpen) : null;
      var mkt = marketNote(crop, quote);

      var title, when;
      if (status === 'overdue') {
        title = crop.name + ' in ' + planting.field + ' is past its window';
        when = 'Closed ' + fmt.inDays(daysToClose);
      } else if (status === 'ready') {
        title = crop.name + ' in ' + planting.field + ' is ready';
        when = 'Window closes ' + fmt.inDays(daysToClose);
      } else if (status === 'imminent') {
        title = crop.name + ' in ' + planting.field + ' is ready ' + fmt.inDays(daysToOpen);
        when = 'From ' + fmt.dayMonth(opensOn);
      } else if (status === 'approaching') {
        title = crop.name + ' in ' + planting.field + ' harvests ' + fmt.inDays(daysToOpen);
        when = fmt.dayMonth(opensOn) + ' – ' + fmt.dayMonth(closesOn);
      } else {
        title = crop.name + ' in ' + planting.field;
        when = 'Harvest from ' + fmt.dayMonth(opensOn);
      }

      var parts = [];
      parts.push('About ' + fmt.mass(expectedT * 1000) + ' expected off ' + planting.hectares + ' ha, worth ' +
                 fmt.moneyShort(expectedValue) + ' at ' + fmt.price(price) + '/kg.');
      if (phi) parts.push(phi.text);
      if (wx) parts.push(wx.note);
      if (mkt) parts.push(mkt.text);

      return {
        id: planting.id,
        field: planting.field,
        cropId: planting.cropId,
        cropName: crop.name,
        color: crop.color,
        hectares: planting.hectares,
        plantedOn: plantedOn,
        plantedDaysAgo: planting.plantedDaysAgo,
        maturityDays: crop.maturityDays,
        daysToOpen: daysToOpen,
        daysToClose: daysToClose,
        opensOn: opensOn,
        closesOn: closesOn,
        progress: Math.max(0, Math.min(1, planting.plantedDaysAgo / minDays)),
        status: status,
        level: meta.level,
        tone: meta.tone,
        label: meta.label,
        rank: meta.rank,
        title: title,
        when: when,
        detail: parts.join(' '),
        expectedT: expectedT,
        expectedValue: expectedValue,
        price: price,
        market: mkt,
        weather: wx,
        phi: phi,
        harvestNote: crop.harvestNote,
        store: crop.store,
        shelfLifeDays: crop.shelfLifeDays,
        alert: status !== 'growing'
      };
    }).sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.daysToOpen - b.daysToOpen;
    });
  }

  /* ---------- livestock coming to market weight ---------- */

  function assessLivestock() {
    return cfg.livestock.herds.map(function (herd) {
      var days = herd.marketAgeDays - herd.ageDays;
      var status = days < 0 ? 'ready' : days <= 7 ? 'imminent' : days <= settings.leadDays ? 'approaching' : 'growing';
      var meta = STATUS[status];
      return {
        id: herd.id,
        name: herd.name,
        head: herd.head,
        daysToMarket: days,
        status: status,
        level: meta.level,
        tone: meta.tone,
        label: status === 'ready' ? 'At market weight' : status === 'imminent' ? 'Market weight this week' : status === 'approaching' ? 'Approaching market weight' : 'Growing',
        title: herd.name + (days <= 0 ? ' are at market weight' : ' reach market weight ' + fmt.inDays(days)),
        alert: status !== 'growing'
      };
    }).filter(function (r) { return r.alert; }).sort(function (a, b) { return a.daysToMarket - b.daysToMarket; });
  }

  /* ---------- notifications ---------- */

  var NOTIFIED_KEY = 'harvestNotified';

  function permission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  }

  function notify(assessment) {
    if (permission() !== 'granted') return [];
    var today = new Date().toISOString().slice(0, 10);
    var sent = NS.store.local.get(NOTIFIED_KEY, {});
    var fired = [];

    assessment.alerts.forEach(function (a) {
      if (a.level === 'info' || a.level === 'ok') return;
      var key = a.id + ':' + a.status;
      if (sent[key] === today) return;
      try {
        var n = new Notification('AgroSense · ' + a.title, {
          body: a.when + '. ' + a.detail,
          tag: a.id,
          icon: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1f6a45"/><path d="M32 50V26M32 26c0-8-6-12-14-12 0 8 6 12 14 12Zm0 6c0-6 5-10 12-10 0 6-5 10-12 10Z" fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/></svg>')
        });
        n.onclick = function () { window.focus(); n.close(); };
        sent[key] = today;
        fired.push(a);
      } catch (err) {
        console.warn('[harvest] notification failed', err);
      }
    });

    NS.store.local.set(NOTIFIED_KEY, sent);
    return fired;
  }

  NS.harvest = {
    settings: settings,
    STATUS: STATUS,

    assess: function (weather, quotes, constraints) {
      var rows = assessPlantings(weather, quotes, constraints);
      var livestock = assessLivestock();
      var alerts = rows.filter(function (r) { return r.alert; });
      var urgent = alerts.filter(function (r) { return r.level === 'critical' || r.level === 'serious'; });
      return {
        rows: rows,
        alerts: alerts,
        livestock: livestock,
        summary: {
          total: alerts.length + livestock.length,
          urgent: urgent.length,
          thisWeek: alerts.filter(function (r) { return r.status === 'imminent' || r.status === 'ready' || r.status === 'overdue'; }).length,
          tonnesReady: urgent.reduce(function (a, r) { return a + r.expectedT; }, 0),
          valueReady: urgent.reduce(function (a, r) { return a + r.expectedValue; }, 0),
          next: alerts[0] || null
        }
      };
    },

    permission: permission,

    requestPermission: function () {
      if (typeof Notification === 'undefined') return Promise.resolve('unsupported');
      try {
        var result = Notification.requestPermission();
        return result && result.then ? result : Promise.resolve(Notification.permission);
      } catch (err) {
        return Promise.resolve(Notification.permission);
      }
    },

    notify: notify
  };
})(window.AgroSense);
