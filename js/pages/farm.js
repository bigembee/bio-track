/**
 * Bio Track - the farm page
 * ---------------------------------------------------------------
 * The physical farm: lots in store, fields and what is growing in them
 * (with the harvest calendar), and the herds - valued, checked for heat
 * stress against the forecast, and their health calendar.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var fmt = NS.fmt;
  var dom = NS.dom;
  var el = dom.el, all = dom.all, setText = dom.setText, tag = dom.tag, icon = dom.icon, badge = dom.badge, peek = dom.peek;
  var charts = NS.charts;

  var state = {
    sort: { key: 'marketValue', dir: -1 },
    built: false,
    snapshot: null
  };

  /* =====================================================================
     Inventory
     ===================================================================== */

  var lotRows = {};

  function sortedLots(lots) {
    var key = state.sort.key, dir = state.sort.dir;
    return lots.slice().sort(function (a, b) {
      var av = a[key], bv = b[key];
      if (typeof av === 'string') return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function buildLotRows(lots) {
    var body = el('lotRows');
    body.innerHTML = '';
    lotRows = {};

    lots.forEach(function (lot) {
      var tr = tag('tr');
      tr.appendChild(tag('td', 'num', lot.id));

      var tdCrop = tag('td');
      var cell = tag('div', 'crop-cell');
      cell.appendChild(dom.mark(lot.cropId, lot.color));
      var names = tag('span');
      names.appendChild(tag('span', 'crop-name', lot.cropName));
      names.appendChild(tag('span', 'crop-sub', lot.field + ' · grade ' + lot.grade));
      cell.appendChild(names);
      tdCrop.appendChild(cell);
      tr.appendChild(tdCrop);

      var tdQty = tag('td', 'right num', fmt.mass(lot.quantityKg));
      var tdPrice = tag('td', 'right num');
      var tdValue = tag('td', 'right num');

      var tdMargin = tag('td', 'right');
      var marginWrap = tag('div', 'stack-cell');
      var margin = tag('span', 'delta flat');
      var marginPct = tag('span', 'crop-sub');
      marginWrap.appendChild(margin);
      marginWrap.appendChild(marginPct);
      tdMargin.appendChild(marginWrap);

      var tdShelf = tag('td');
      var shelf = tag('div', 'shelf-cell');
      var meter = tag('span', 'meter');
      var fill = tag('span', 'meter-fill');
      meter.appendChild(fill);
      shelf.appendChild(meter);
      var shelfText = tag('span', 'crop-sub');
      shelf.appendChild(shelfText);
      tdShelf.appendChild(shelf);

      tr.appendChild(tdQty);
      tr.appendChild(tdPrice);
      tr.appendChild(tdValue);
      tr.appendChild(tdMargin);
      tr.appendChild(tdShelf);
      body.appendChild(tr);

      lotRows[lot.id] = { row: tr, price: tdPrice, value: tdValue, margin: margin, marginPct: marginPct, fill: fill, shelfText: shelfText };
    });
    state.built = true;
  }

  function updateLotRows(lots) {
    lots.forEach(function (lot) {
      var r = lotRows[lot.id];
      if (!r) return;
      setText(r.price, fmt.price(lot.price));
      setText(r.value, fmt.money(lot.marketValue));
      setText(r.margin, fmt.moneySigned(lot.margin));
      setText(r.marginPct, fmt.pctSigned(lot.marginPct, 0) + ' over cost');
      r.margin.className = 'delta ' + dom.deltaClass(lot.margin);
      r.fill.className = 'meter-fill ' + lot.risk.level;
      r.fill.style.width = Math.max(3, lot.freshness * 100) + '%';

      if (lot.blocked) {
        setText(r.shelfText, fmt.days(lot.daysRemaining) + ' · sale blocked ' + Math.ceil(lot.blockedFor) + 'd');
        r.row.classList.add('is-blocked');
        r.row.title = lot.blockDetail || 'Inside a pre-harvest interval';
      } else {
        setText(r.shelfText, fmt.days(lot.daysRemaining) + ' · ' + lot.risk.label);
        r.row.classList.remove('is-blocked');
        r.row.removeAttribute('title');
      }
    });
  }

  function renderLotFoot(snap) {
    var foot = el('lotFoot');
    foot.innerHTML = '';
    var tr = tag('tr');
    var th = tag('th', null, 'Total');
    th.setAttribute('scope', 'row');
    th.colSpan = 2;
    tr.appendChild(th);
    tr.appendChild(tag('td', 'right num', fmt.mass(snap.summary.totalKg)));
    tr.appendChild(tag('td', 'right num', fmt.price(snap.summary.blendedPricePerKg)));
    tr.appendChild(tag('td', 'right num', fmt.money(snap.summary.totalValue)));
    var td = tag('td', 'right');
    var wrap = tag('div', 'stack-cell');
    wrap.appendChild(tag('span', 'delta ' + dom.deltaClass(snap.summary.margin), fmt.moneySigned(snap.summary.margin)));
    wrap.appendChild(tag('span', 'crop-sub', fmt.pctSigned(snap.summary.marginPct, 0) + ' over cost'));
    td.appendChild(wrap);
    tr.appendChild(td);
    tr.appendChild(tag('td'));
    foot.appendChild(tr);
  }

  function renderInventory(ctx) {
    var snap = ctx.snapshot;
    state.snapshot = snap;
    var ordered = sortedLots(snap.lots);

    if (!state.built) buildLotRows(ordered);
    updateLotRows(snap.lots);
    renderLotFoot(snap);

    if (typeof Chart !== 'undefined') {
      charts.inventoryMix(document.getElementById('mixChart'), snap.crops, 'mix');
      charts.valueVsCost(document.getElementById('valueCostChart'), snap.crops);
    }

    var top = snap.crops[0];
    if (top) {
      setText(el('mixCaption'),
        top.name + ' is ' + fmt.pct(snap.summary.concentration, 0) + ' of the total. A 10% price move there is worth ' +
        fmt.moneyShort(top.marketValue * 0.1) + ' on its own.');
    }
    buildLegend('mixLegend', snap.crops);
  }

  function buildLegend(hostName, rows) {
    var host = el(hostName);
    host.innerHTML = '';
    rows.forEach(function (row) {
      var item = tag('span', 'legend-item');
      item.appendChild(dom.mark(row.cropId || row.productId, row.color, 'legend-swatch'));
      item.appendChild(document.createTextNode(row.name + ' ' + fmt.moneyShort(row.marketValue)));
      host.appendChild(item);
    });
  }

  function bindSorting() {
    all('#lotTable th.sortable').forEach(function (th) {
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'columnheader');

      function apply() {
        var key = th.dataset.sort;
        if (state.sort.key === key) state.sort.dir *= -1;
        else { state.sort.key = key; state.sort.dir = -1; }
        all('#lotTable th.sortable').forEach(function (other) { other.removeAttribute('aria-sort'); });
        th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
        state.built = false;
        if (NS.app.state.ctx) renderInventory(NS.app.state.ctx);
      }

      th.addEventListener('click', apply);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(); }
      });
    });
  }

  /* =====================================================================
     Fields & harvest
     ===================================================================== */

  function renderFields(ctx) {
    var host = el('fieldList');
    host.innerHTML = '';
    var snap = ctx.snapshot;
    var byField = {};
    ctx.harvest.rows.forEach(function (r) { byField[r.field] = r; });

    cfg.fields.forEach(function (field) {
      var lots = snap.lots.filter(function (l) { return l.field === field.id; });
      var value = lots.reduce(function (a, l) { return a + l.marketValue; }, 0);
      var kg = lots.reduce(function (a, l) { return a + l.quantityKg; }, 0);
      var crop = cfg.crops[field.cropId];
      var planting = byField[field.id];

      var tile = tag('div', 'field-tile');
      tile.style.borderLeftColor = crop.color;
      if (planting) tile.setAttribute('data-level', planting.level);
      var top = tag('div', 'field-top');
      top.appendChild(dom.mark(field.cropId, crop.color));
      top.appendChild(tag('div', 'field-name', field.id));
      tile.appendChild(top);
      tile.appendChild(tag('div', 'field-crop', crop.name));
      tile.appendChild(tag('div', 'field-meta', field.hectares + ' ha · ' + (kg ? fmt.mass(kg) + ' in store' : 'nothing in store')));
      tile.appendChild(tag('div', 'field-value', value ? fmt.money(value) : 'n/a'));
      if (planting) {
        var line = tag('div', 'field-harvest');
        line.appendChild(badge(planting.tone === 'ok' ? 'ok' : planting.tone, planting.status === 'growing' ? 'i-sprout' : 'i-harvest', planting.label));
        line.appendChild(tag('span', 'crop-sub', planting.when));
        tile.appendChild(line);
      }
      host.appendChild(tile);
    });
  }

  function renderHarvestCalendar(ctx) {
    var host = el('plantingList');
    if (!host) return;
    host.innerHTML = '';
    var h = ctx.harvest;

    setText(el('harvestDue'), String(h.summary.urgent));
    setText(el('harvestDueNote'), h.summary.urgent
      ? fmt.mass(h.summary.tonnesReady * 1000) + ' expected · ' + fmt.moneyShort(h.summary.valueReady) + ' at today’s prices'
      : 'Nothing inside its harvest window');
    setText(el('harvestWeek'), String(h.summary.thisWeek));
    setText(el('harvestWeekNote'), h.summary.next ? 'Next: ' + h.summary.next.cropName + ' in ' + h.summary.next.field + ' · ' + h.summary.next.when : 'No block opens this week');
    var perm = NS.harvest.permission();
    setText(el('harvestPings'), perm === 'granted' ? 'On' : perm === 'denied' ? 'Blocked' : perm === 'unsupported' ? 'n/a' : 'Off');
    setText(el('harvestPingsNote'), perm === 'granted'
      ? 'Browser notifications fire once a day per block, from ' + cfg.harvest.leadDays + ' days out'
      : perm === 'denied' ? 'Notifications are blocked for this site in the browser settings'
      : 'Enable browser pings from the bell in the top bar');

    h.rows.forEach(function (r) {
      var row = tag('div', 'planting');
      row.setAttribute('data-level', r.level);

      var head = tag('div', 'planting-head');
      head.appendChild(dom.mark(r.cropId, r.color));
      head.appendChild(tag('strong', null, r.cropName));
      head.appendChild(tag('span', 'pest-crop', r.field + ' · ' + r.hectares + ' ha · planted ' + fmt.dayMonth(r.plantedOn)));
      head.appendChild(badge(r.tone === 'ok' ? 'ok' : r.tone, r.status === 'growing' ? 'i-sprout' : 'i-harvest', r.label));
      if (r.phi) head.appendChild(badge('neutral', 'i-shield', 'PHI clears ' + fmt.dayMonth(r.phi.clearsOn)));
      if (r.weather && r.weather.openingWet) head.appendChild(badge('warn', 'i-rain', 'Wet at opening'));
      row.appendChild(head);

      // The window as a bar: planted → opens → closes, with today marked.
      var timeline = tag('div', 'window');
      var span = r.maturityDays[1] + Math.max(0, -r.daysToClose) + 10;
      var openPct = (r.maturityDays[0] / span) * 100;
      var closePct = (r.maturityDays[1] / span) * 100;
      var todayPct = Math.min(100, (r.plantedDaysAgo / span) * 100);
      var band = tag('span', 'window-band');
      band.style.left = openPct + '%';
      band.style.width = (closePct - openPct) + '%';
      timeline.appendChild(band);
      var grown = tag('span', 'window-grown');
      grown.style.width = todayPct + '%';
      timeline.appendChild(grown);
      var today = tag('span', 'window-today');
      today.style.left = todayPct + '%';
      today.title = 'Today · day ' + r.plantedDaysAgo;
      timeline.appendChild(today);
      row.appendChild(timeline);

      var meta = tag('div', 'planting-meta');
      function m(label, value) {
        var s = tag('span', null, label + ' ');
        s.appendChild(tag('span', 'num', value));
        meta.appendChild(s);
      }
      m('Window', fmt.dayMonth(r.opensOn) + ' – ' + fmt.dayMonth(r.closesOn));
      m('Expected', fmt.mass(r.expectedT * 1000) + ' · ' + fmt.moneyShort(r.expectedValue));
      row.appendChild(meta);

      // Everything else opens on hover: where the crop is in its window, how long it
      // keeps, what the market says about selling it, and the harvest advice itself.
      var more = document.createDocumentFragment();
      var facts = tag('p', 'harvest-sub',
        'Day ' + r.plantedDaysAgo + ' of ' + r.maturityDays[0] + '–' + r.maturityDays[1] +
        ' · keeps ' + r.shelfLifeDays + ' days in the ' + r.store.toLowerCase() +
        (r.market ? ' · market says ' + r.market.label.toLowerCase() : ''));
      more.appendChild(facts);
      more.appendChild(tag('p', 'planting-detail', r.detail + ' ' + r.harvestNote));
      peek(row, more);
      host.appendChild(row);
    });
  }

  /* =====================================================================
     Livestock
     ===================================================================== */

  var SPECIES_ICON = { cattle: 'i-cow', goat: 'i-cow', sheep: 'i-cow', poultry: 'i-bird', fish: 'i-fish' };

  function renderLivestock(ctx) {
    var stock = ctx.snapshot.livestock;
    var s = stock.summary;

    setText(el('stockValue'), fmt.moneyShort(s.totalValue));
    setText(el('stockValueNote'), fmt.head(s.head) + ' across ' + s.herds + ' herds · ' + fmt.mass(s.carcassKg) + ' of carcass weight');
    setText(el('stockMargin'), fmt.moneyShort(s.margin));
    setText(el('stockMarginNote'), fmt.pctSigned(s.marginPct, 0) + ' over ' + fmt.moneyShort(s.totalCost) + ' of purchase and rearing cost');
    setText(el('stockEggs'), fmt.number(s.eggsPerDay));
    setText(el('stockEggsNote'), fmt.moneyShort(s.eggIncomePerDay) + ' a day at ' + fmt.price(ctx.quotes.eggs ? ctx.quotes.eggs.price : cfg.livestock.products.eggs.basePrice) + '/egg · feed bill ' + fmt.moneyShort(s.feedPerDay) + '/day for every herd');

    // Herd table
    var body = el('herdRows');
    body.innerHTML = '';
    stock.herds.forEach(function (h) {
      var tr = tag('tr');
      var tdName = tag('td');
      var cell = tag('div', 'crop-cell');
      cell.appendChild(dom.mark(h.productId, h.color));
      var names = tag('span');
      names.appendChild(tag('span', 'crop-name', h.name));
      names.appendChild(tag('span', 'crop-sub', h.breed + ' · ' + h.housing));
      cell.appendChild(names);
      tdName.appendChild(cell);
      tr.appendChild(tdName);
      tr.appendChild(tag('td', 'right num', fmt.number(h.head)));
      tr.appendChild(tag('td', 'right num', h.isLayer ? fmt.number(h.eggsPerDay) + ' eggs/day' : fmt.mass(h.carcassKg)));
      var tdPrice = tag('td', 'right num', fmt.price(h.price) + '/' + h.unit);
      tdPrice.title = h.quote ? h.quote.note : '';
      tr.appendChild(tdPrice);
      tr.appendChild(tag('td', 'right num', fmt.money(h.marketValue)));
      var tdMargin = tag('td', 'right');
      var wrap = tag('div', 'stack-cell');
      wrap.appendChild(tag('span', 'delta ' + dom.deltaClass(h.margin), fmt.moneySigned(h.margin)));
      wrap.appendChild(tag('span', 'crop-sub', fmt.pctSigned(h.marginPct, 0) + ' over cost'));
      tdMargin.appendChild(wrap);
      tr.appendChild(tdMargin);
      var tdReady = tag('td');
      var days = h.daysToMarket;
      tdReady.appendChild(badge(days <= 0 ? 'serious' : days <= 7 ? 'warn' : 'neutral', 'i-scale',
        h.isLayer ? 'In lay for ' + Math.max(0, days) + ' more days' : days <= 0 ? 'At market weight' : 'Market weight ' + fmt.inDays(days)));
      tr.appendChild(tdReady);
      var tdSrc = tag('td');
      tdSrc.appendChild(badge(h.mode === 'live' ? 'good' : h.mode === 'proxy' ? 'warn' : 'neutral', 'i-database',
        h.mode === 'live' ? 'WFP live' : h.mode === 'proxy' ? 'Proxy' : 'Modelled'));
      tdSrc.title = h.quote ? h.quote.note : '';
      tr.appendChild(tdSrc);
      body.appendChild(tr);
    });

    if (typeof Chart !== 'undefined' && document.getElementById('herdMixChart')) {
      charts.inventoryMix(document.getElementById('herdMixChart'), stock.herds, 'herdMix');
    }
    buildLegend('herdMixLegend', stock.herds);
    setText(el('herdMixCaption'), s.topHerd
      ? s.topHerd + ' carry ' + fmt.pct(s.concentration, 0) + ' of livestock value. Layers are held at book value; every other herd is priced as carcass weight at this month’s meat price.'
      : 'n/a');

    renderHeat(ctx);
    renderHealth(ctx);
  }

  function renderHeat(ctx) {
    var host = el('heatList');
    host.innerHTML = '';
    var heat = ctx.heat;

    if (!heat.hasForecast) {
      host.appendChild(tag('p', 'chart-caption', 'Heat stress needs the hourly forecast. It will appear once the weather request succeeds.'));
      return;
    }

    heat.rows.forEach(function (r) {
      var row = tag('div', 'heat');
      row.setAttribute('data-level', r.tone);
      var herd = cfg.livestock.herds.filter(function (x) { return x.id === r.herdId; })[0];
      row.appendChild(dom.mark(herd ? herd.productId : null, null));
      var body = tag('div');
      var head = tag('div', 'pest-head');
      head.appendChild(tag('span', 'pest-name', r.name));
      head.appendChild(tag('span', 'pest-crop', fmt.head(r.head)));
      head.appendChild(badge(r.tone === 'ok' ? 'ok' : r.tone, r.tone === 'ok' ? 'i-shield' : 'i-thermometer', r.label));
      body.appendChild(head);
      body.appendChild(tag('p', 'pest-driver', r.detail));
      row.appendChild(body);
      host.appendChild(row);
    });
  }

  function renderHealth(ctx) {
    var host = el('healthList');
    host.innerHTML = '';

    ctx.health.forEach(function (t) {
      var row = tag('div', 'treatment' + (t.completed ? ' is-done' : ''));
      row.setAttribute('data-level', t.level);
      var glyph = tag('span', 'pest-icon');
      glyph.appendChild(icon(t.completed ? 'i-check' : 'i-syringe'));
      row.appendChild(glyph);
      var body = tag('div', 'treatment-body');
      body.appendChild(tag('div', 'treatment-title', t.task + ' · ' + t.herdName));
      body.appendChild(tag('div', 'treatment-sub', fmt.head(t.head) + ' · ' + (t.completed ? 'done' : 'due ' + fmt.inDays(t.dueInDays) + ' (' + fmt.dayMonth(t.dueOn) + ')')));
      row.appendChild(body);
      row.appendChild(badge(t.level === 'ok' ? (t.completed ? 'good' : 'neutral') : t.level, t.completed ? 'i-check' : 'i-calendar', t.label));
      var btn = tag('button', 'btn btn-quiet');
      btn.appendChild(icon(t.completed ? 'i-refresh' : 'i-check'));
      btn.appendChild(document.createTextNode(t.completed ? 'Reopen' : 'Mark done'));
      btn.addEventListener('click', function () {
        if (t.completed) NS.livestock.reopen(t.id); else NS.livestock.markDone(t.id);
        NS.app.renderAll();
      });
      row.appendChild(btn);
      host.appendChild(row);
    });
  }

  /* ---------- page ---------- */

  NS.pages = NS.pages || {};
  NS.pages.farm = {
    init: function () {
      bindSorting();
      setText(el('herdCountLabel'), cfg.livestock.herds.length + ' herds');
    },
    render: function (ctx) {
      renderInventory(ctx);
      renderFields(ctx);
      renderHarvestCalendar(ctx);
      renderLivestock(ctx);
    }
  };
})(window.AgroSense);
