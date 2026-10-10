/**
 * AgroSense - livestock
 * ---------------------------------------------------------------
 * Three things a stockman wants from the same screen the crops are on.
 *
 * 1. WHAT THE HERD IS WORTH. Head x live weight x dressing percentage
 *    gives carcass weight, and the live meat price prices it. Layers are
 *    an income stream rather than a carcass, so they are held at book
 *    value and their egg output is priced per day instead.
 *
 * 2. HEAT STRESS, from the real hourly forecast. The temperature-humidity
 *    index (THI = 0.8T + RH/100 x (T - 14.4) + 46.4) is the standard
 *    measure; each species has its own thresholds, because a West
 *    African Dwarf goat shrugs off an afternoon that puts a Fulani bull
 *    off its feed. Fish are scored on air temperature, which drives pond
 *    temperature and dissolved oxygen.
 *
 * 3. THE HEALTH CALENDAR - vaccinations and treatments coming due.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var settings = cfg.livestock;
  var fmt = NS.fmt;
  var DAY_MS = 86400000;

  /* ---------- 1. valuation ---------- */

  function product(herd) { return settings.products[herd.productId]; }

  function valueHerds(quotes) {
    return settings.herds.map(function (herd) {
      var prod = product(herd);
      var quote = quotes[herd.productId];
      var price = quote ? quote.price : prod.basePrice;
      var isLayer = herd.layRate != null;

      var carcassKg = isLayer ? 0 : herd.head * herd.avgLiveKg * (herd.dressing || 1);
      var marketValue = isLayer ? herd.head * herd.costPerHead : carcassKg * price;
      var costValue = herd.head * herd.costPerHead;
      var eggsPerDay = isLayer ? herd.head * herd.layRate : 0;
      var eggIncomePerDay = eggsPerDay * price;
      var feedPerDay = herd.head * (settings.feedCostPerHeadDay[herd.species] || 0);
      var daysToMarket = herd.marketAgeDays - herd.ageDays;

      return {
        id: herd.id,
        species: herd.species,
        name: herd.name,
        breed: herd.breed,
        housing: herd.housing,
        head: herd.head,
        avgLiveKg: herd.avgLiveKg,
        liveKg: herd.head * herd.avgLiveKg,
        carcassKg: carcassKg,
        isLayer: isLayer,
        productId: herd.productId,
        productName: prod.name,
        unit: prod.unit,
        color: prod.color,
        price: price,
        quote: quote || null,
        marketValue: marketValue,
        costValue: costValue,
        margin: marketValue - costValue,
        marginPct: costValue ? (marketValue - costValue) / costValue : 0,
        eggsPerDay: eggsPerDay,
        eggIncomePerDay: eggIncomePerDay,
        feedPerDay: feedPerDay,
        ageDays: herd.ageDays,
        marketAgeDays: herd.marketAgeDays,
        daysToMarket: daysToMarket,
        mode: quote ? quote.mode : 'modelled'
      };
    }).sort(function (a, b) { return b.marketValue - a.marketValue; });
  }

  function summarise(rows) {
    var s = { totalValue: 0, totalCost: 0, head: 0, carcassKg: 0, eggsPerDay: 0, eggIncomePerDay: 0, feedPerDay: 0, herds: rows.length };
    rows.forEach(function (r) {
      s.totalValue += r.marketValue;
      s.totalCost += r.costValue;
      s.head += r.head;
      s.carcassKg += r.carcassKg;
      s.eggsPerDay += r.eggsPerDay;
      s.eggIncomePerDay += r.eggIncomePerDay;
      s.feedPerDay += r.feedPerDay;
    });
    s.margin = s.totalValue - s.totalCost;
    s.marginPct = s.totalCost ? s.margin / s.totalCost : 0;
    var top = rows[0];
    s.topHerd = top ? top.name : null;
    s.concentration = top && s.totalValue ? top.marketValue / s.totalValue : 0;
    return s;
  }

  /**
   * Quantities held per product, in the product's price unit, so the
   * portfolio history can value the herd at each month's price. Layers
   * contribute a constant book value instead of a quantity.
   */
  function holdings() {
    var kg = {};
    var book = 0;
    settings.herds.forEach(function (herd) {
      if (herd.layRate != null) { book += herd.head * herd.costPerHead; return; }
      kg[herd.productId] = (kg[herd.productId] || 0) + herd.head * herd.avgLiveKg * (herd.dressing || 1);
    });
    return { quantities: kg, bookValue: book };
  }

  /* ---------- 2. heat stress ---------- */

  var THI_BANDS = {
    cattle:  { mild: 68, moderate: 72, severe: 80 },
    sheep:   { mild: 72, moderate: 78, severe: 84 },
    goat:    { mild: 74, moderate: 80, severe: 86 },
    poultry: { mild: 74, moderate: 78, severe: 83 }
  };

  var FISH_BANDS = { mild: 32, moderate: 34, severe: 36 };   // air °C

  var RELIEF = {
    cattle:  'Move to shade, keep troughs full, and shift feeding to early morning and evening.',
    sheep:   'Shade and water in the pens; shear or crutch heavy fleeces if it persists.',
    goat:    'Open the pens for airflow and put water in the shade; goats will not drink hot water.',
    poultry: 'Run the fans, wet the roof, and feed at dawn, birds stop eating in the heat and lay less.',
    fish:    'Aerate the ponds overnight and hold feeding during the hottest hours; warm water carries less oxygen.'
  };

  function thi(temp, rh) {
    return 0.8 * temp + (rh / 100) * (temp - 14.4) + 46.4;
  }

  function levelFor(value, bands) {
    if (value >= bands.severe) return 'severe';
    if (value >= bands.moderate) return 'moderate';
    if (value >= bands.mild) return 'mild';
    return 'ok';
  }

  var LEVEL_META = {
    severe:   { rank: 0, tone: 'critical', label: 'Severe heat stress' },
    moderate: { rank: 1, tone: 'serious',  label: 'Moderate heat stress' },
    mild:     { rank: 2, tone: 'warning',  label: 'Mild heat stress' },
    ok:       { rank: 3, tone: 'ok',       label: 'Comfortable' }
  };

  function heatStress(weather) {
    var hours = weather ? weather.hourlyWindow.slice(0, 48) : [];

    var rows = settings.herds.map(function (herd) {
      var bands = herd.species === 'fish' ? FISH_BANDS : THI_BANDS[herd.species];
      var peak = null, hoursAbove = 0;

      hours.forEach(function (h) {
        var value = herd.species === 'fish' ? h.temp : thi(h.temp, h.humidity);
        if (value >= bands.mild) hoursAbove += 1;
        if (!peak || value > peak.value) peak = { value: value, time: h.time, temp: h.temp, humidity: h.humidity };
      });

      var level = peak ? levelFor(peak.value, bands) : 'ok';
      var meta = LEVEL_META[level];
      var detail;
      if (!peak) {
        detail = 'Waiting on the forecast.';
      } else if (level === 'ok') {
        detail = 'Peak ' + (herd.species === 'fish' ? Math.round(peak.value) + '°C air' : 'THI ' + Math.round(peak.value)) +
                 ' in the next 48 hours, under the ' + bands.mild + ' this species minds.';
      } else {
        detail = (herd.species === 'fish' ? Math.round(peak.value) + '°C' : 'THI ' + Math.round(peak.value)) +
                 ' at ' + fmt.time(peak.time) + ' ' + fmt.dayMonth(peak.time) + ' (' + Math.round(peak.temp) + '°C, ' +
                 Math.round(peak.humidity) + '% humidity) · ' + hoursAbove + ' of the next 48 hours above ' + bands.mild + '. ' +
                 RELIEF[herd.species];
      }

      return {
        herdId: herd.id,
        name: herd.name,
        species: herd.species,
        head: herd.head,
        level: level,
        tone: meta.tone,
        label: meta.label,
        rank: meta.rank,
        peak: peak,
        hoursAbove: hoursAbove,
        threshold: bands.mild,
        detail: detail
      };
    }).sort(function (a, b) { return a.rank - b.rank; });

    return { rows: rows, worst: rows[0] || null, hasForecast: hours.length > 0 };
  }

  /** Heat stress as advisories, in the same shape the weather module uses. */
  function deriveAdvisories(weather) {
    var out = [];
    var stress = heatStress(weather);
    if (!stress.hasForecast) return out;

    var affected = stress.rows.filter(function (r) { return r.level === 'moderate' || r.level === 'severe'; });
    if (!affected.length) return out;

    var worst = affected[0];
    var names = affected.map(function (r) { return r.name.toLowerCase(); });
    out.push({
      id: 'heat-stress',
      severity: worst.level === 'severe' ? 'critical' : 'serious',
      icon: 'thermometer',
      title: worst.label + ' on ' + (names.length > 2 ? names.slice(0, 2).join(', ') + ' and ' + (names.length - 2) + ' more' : names.join(' and ')),
      detail: worst.detail,
      window: fmt.dayMonth(worst.peak.time) + ' ' + fmt.time(worst.peak.time)
    });
    return out;
  }

  /* ---------- 3. health calendar ---------- */

  var DONE_KEY = 'livestockDone';

  function health() {
    var done = NS.store.local.get(DONE_KEY, {});
    return settings.health.map(function (task) {
      var herd = settings.herds.filter(function (h) { return h.id === task.herdId; })[0];
      var completed = done[task.id];
      var level, label;
      if (completed) { level = 'ok'; label = 'Done'; }
      else if (task.dueInDays < 0) { level = 'critical'; label = 'Overdue'; }
      else if (task.dueInDays <= 3) { level = 'serious'; label = 'Due now'; }
      else if (task.dueInDays <= 14) { level = 'warning'; label = 'Coming up'; }
      else { level = 'ok'; label = 'Scheduled'; }
      return {
        id: task.id,
        herdId: task.herdId,
        herdName: herd ? herd.name : task.herdId,
        head: herd ? herd.head : 0,
        task: task.task,
        dueInDays: task.dueInDays,
        dueOn: new Date(Date.now() + task.dueInDays * DAY_MS),
        completed: !!completed,
        level: level,
        label: label
      };
    }).sort(function (a, b) {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.dueInDays - b.dueInDays;
    });
  }

  NS.livestock = {
    settings: settings,
    thi: thi,

    value: function (quotes) {
      var rows = valueHerds(quotes || {});
      return { herds: rows, summary: summarise(rows) };
    },
    holdings: holdings,
    heatStress: heatStress,
    deriveAdvisories: deriveAdvisories,
    health: health,

    markDone: function (taskId) {
      var done = NS.store.local.get(DONE_KEY, {});
      done[taskId] = new Date().toISOString().slice(0, 10);
      NS.store.local.set(DONE_KEY, done);
    },
    reopen: function (taskId) {
      var done = NS.store.local.get(DONE_KEY, {});
      delete done[taskId];
      NS.store.local.set(DONE_KEY, done);
    }
  };
})(window.AgroSense);
