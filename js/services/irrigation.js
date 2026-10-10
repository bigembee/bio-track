/**
 * AgroSense - irrigation control
 * ---------------------------------------------------------------
 * Two jobs in one module.
 *
 * 1. THE WATER BALANCE. How thirsty is each zone right now? This is the
 *    FAO-56 soil water balance, run backwards from the last time the zone
 *    was watered:
 *
 *      TAW = awcMmPerM x rootDepthM     total water the soil can hold
 *      RAW = TAW x depletionTrigger     what the crop can use comfortably
 *      ETc = ET0 x Kc                   what the crop transpires per day
 *      deficit += ETc - (rain x rainEffectiveness)
 *
 *    ET0 and rainfall come from the live forecast - the past days in that
 *    request are what make the backwards accumulation possible. Once the
 *    deficit passes RAW the crop starts to suffer, and the zone is due.
 *
 * 2. THE CONTROLLER. Zones can be started and stopped, and a running zone
 *    puts water on the ground: its deficit falls, water and cost accrue.
 *    Runs take hours, so the demo clock advances them at
 *    config.irrigation.simulationSpeed x real time. That multiplier is
 *    stated in the interface rather than hidden.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var settings = cfg.irrigation;

  var MM_PER_HA_TO_M3 = 10;   // 1 mm of water over 1 hectare is 10 m3

  /* ---------- state ---------- */

  var runs = {};        // zoneId -> active run
  var applied = {};     // zoneId -> mm put on since the page opened
  var ledger = { minutes: 0, waterM3: 0, cost: 0, runsCompleted: 0 };
  var subscribers = [];
  var timer = null;

  cfg.irrigation.zones.forEach(function (z) { applied[z.id] = 0; });

  /* A run started on one page must still be running on the next, so the
     controller's state lives in localStorage. Water applied today is kept
     for the day; a run in progress is caught up on the time that passed
     while no page was open, at the same demo clock speed. */
  var STORE_KEY = 'irrigation';

  function persist() {
    NS.store.local.set(STORE_KEY, {
      day: new Date().toDateString(),
      savedAt: Date.now(),
      runs: runs,
      applied: applied,
      ledger: ledger
    });
  }

  function restore() {
    var saved = NS.store.local.get(STORE_KEY, null);
    if (!saved || saved.day !== new Date().toDateString()) return;
    applied = saved.applied || applied;
    ledger = saved.ledger || ledger;
    runs = saved.runs || {};
    var gap = Math.max(0, Date.now() - (saved.savedAt || Date.now()));
    if (gap > 0 && Object.keys(runs).length) advance(gap / 1000);
  }

  function publish(event) {
    subscribers.forEach(function (fn) {
      try { fn(event); } catch (err) { console.error('[irrigation] subscriber failed', err); }
    });
  }

  /* ---------- the water balance ---------- */

  function zoneCrop(zone) {
    var field = cfg.fields.filter(function (f) { return f.id === zone.field; })[0];
    return field ? cfg.crops[field.cropId] : null;
  }

  function zoneHectares(zone) {
    var field = cfg.fields.filter(function (f) { return f.id === zone.field; })[0];
    return field ? field.hectares : 0;
  }

  /**
   * Walk forward from the last irrigation to now, adding each day's crop
   * water use and subtracting the rain that actually reached the roots.
   *
   * `weather` may be null - the forecast can be down while the pumps are
   * not. In that case a regional average ET0 stands in and the result is
   * marked as estimated, which the interface says out loud.
   */
  function accumulateDeficit(zone, crop, weather) {
    var taw = zone.awcMmPerM * zone.rootDepthM;
    var raw = taw * settings.depletionTrigger;

    // A rain-fed zone has never been irrigated; measure it from the start
    // of the past-weather window instead.
    var days = zone.lastRunDaysAgo == null ? cfg.weather.pastDays : zone.lastRunDaysAgo;
    var estimated = true;
    var deficit = 0;
    var et0Used = settings.fallbackEt0;

    if (weather && weather.pastDaily) {
      // Past days, oldest first, limited to the window since the last run.
      var past = weather.pastDaily.slice(-days);
      var series = past.concat(weather.daily.length ? [weather.daily[0]] : []);

      if (series.length) {
        estimated = false;
        var et0Total = 0, et0Count = 0;

        series.forEach(function (day) {
          var et0 = day.et0 != null ? day.et0 : settings.fallbackEt0;
          var etc = et0 * crop.kc;
          var effectiveRain = (day.precipSum || 0) * settings.rainEffectiveness;
          deficit = Math.max(0, deficit + etc - effectiveRain);
          et0Total += et0;
          et0Count += 1;
        });

        et0Used = et0Count ? et0Total / et0Count : settings.fallbackEt0;
      }
    }

    if (estimated) {
      deficit = Math.max(0, days * settings.fallbackEt0 * crop.kc);
    }

    // Water put on during this session comes straight off the deficit.
    deficit = Math.max(0, deficit - (applied[zone.id] || 0));

    return {
      taw: taw,
      raw: raw,
      deficit: Math.min(deficit, taw),
      depletionPct: taw ? Math.min(1, deficit / taw) : 0,
      et0: et0Used,
      etc: et0Used * crop.kc,
      estimated: estimated,
      daysSinceWater: days
    };
  }

  /** Will forecast rain cover the gap before the crop starts to suffer? */
  function rainRelief(weather, balance) {
    if (!weather) return null;
    var next72 = weather.daily.slice(0, 3).reduce(function (a, d) { return a + (d.precipSum || 0); }, 0);
    var effective = next72 * settings.rainEffectiveness;
    return {
      forecastMm: next72,
      effectiveMm: effective,
      covers: effective >= balance.deficit,
      helps: effective >= balance.deficit * 0.5
    };
  }

  /* ---------- recommendation ---------- */

  function recommend(zone, crop, balance, relief) {
    var hectares = zoneHectares(zone);
    var mmNeeded = Math.max(0, balance.deficit);
    var volumeM3 = mmNeeded * hectares * MM_PER_HA_TO_M3;
    var minutes = zone.applicationRateMmH ? (mmNeeded / zone.applicationRateMmH) * 60 : 0;
    var cost = volumeM3 * settings.waterCostPerM3;

    var state, tone, reason;

    var approaching = balance.deficit >= balance.raw * 0.75;

    if (!zone.applicationRateMmH) {
      state = 'Rain-fed';
      tone = 'neutral';
      reason = 'No irrigation on this block. ' +
        (balance.deficit > balance.raw
          ? 'It is ' + Math.round(balance.deficit) + ' mm short and depends entirely on the forecast.'
          : 'Soil water is holding.');
    } else if (approaching && relief && relief.covers) {
      // Rain only counts as displacing an irrigation when one was actually
      // coming. A zone sitting at a tenth of its allowance is just holding.
      state = 'Rain expected';
      tone = 'good';
      reason = Math.round(relief.forecastMm) + ' mm forecast over three days covers the ' +
        Math.round(balance.deficit) + ' mm shortfall. Skip the run and save ' + Math.round(volumeM3) + ' m³.';
    } else if (balance.deficit >= balance.raw) {
      state = 'Irrigate now';
      tone = 'critical';
      reason = Math.round(balance.deficit) + ' mm short against a ' + Math.round(balance.raw) +
        ' mm comfortable limit. ' + crop.name + ' is drawing ' + balance.etc.toFixed(1) + ' mm a day.';
    } else if (balance.deficit >= balance.raw * 0.75) {
      state = 'Due soon';
      tone = 'warn';
      reason = 'At ' + Math.round(balance.deficit) + ' mm of a ' + Math.round(balance.raw) +
        ' mm allowance. Roughly ' + Math.max(1, Math.round((balance.raw - balance.deficit) / balance.etc)) +
        ' days before it needs water.';
    } else {
      state = 'Holding';
      tone = 'ok';
      reason = 'Soil water is comfortable at ' + Math.round(balance.deficit) + ' mm depleted of ' +
        Math.round(balance.raw) + ' mm.';
    }

    return {
      state: state,
      tone: tone,
      reason: reason,
      mmNeeded: mmNeeded,
      volumeM3: volumeM3,
      minutes: minutes,
      cost: cost,
      hectares: hectares
    };
  }

  /* ---------- the zone view ---------- */

  function computeZones(weather) {
    return settings.zones.map(function (zone) {
      var crop = zoneCrop(zone);
      var balance = accumulateDeficit(zone, crop, weather);
      var relief = rainRelief(weather, balance);
      var advice = recommend(zone, crop, balance, relief);
      var run = runs[zone.id] || null;

      return {
        id: zone.id,
        field: zone.field,
        method: zone.method,
        soil: zone.soil,
        crop: crop,
        canIrrigate: zone.applicationRateMmH > 0,
        applicationRateMmH: zone.applicationRateMmH,
        flowM3H: zone.flowM3H,
        balance: balance,
        relief: relief,
        advice: advice,
        appliedThisSession: applied[zone.id] || 0,
        run: run && {
          plannedMinutes: run.plannedMinutes,
          elapsedMinutes: run.elapsedMinutes,
          progress: run.plannedMinutes ? Math.min(1, run.elapsedMinutes / run.plannedMinutes) : 0,
          appliedMm: run.appliedMm,
          volumeM3: run.volumeM3,
          cost: run.cost
        }
      };
    });
  }

  function summarise(zones) {
    var due = zones.filter(function (z) { return z.advice.state === 'Irrigate now'; });
    var running = zones.filter(function (z) { return z.run; });
    var plannedM3 = due.reduce(function (a, z) { return a + z.advice.volumeM3; }, 0);

    /* Water the farm does not have to pump because rain is covering the
       crop's demand. Counting the whole forecast deficit here would have
       overstated it; a 4 mm shortfall would never have been irrigated in
       the first place. What is genuinely displaced is the crop's own use
       over the next three days, up to the rain that actually arrives. */
    var savedM3 = zones.reduce(function (total, z) {
      if (!z.canIrrigate || !z.relief) return total;
      var demandMm = z.balance.etc * 3;
      var savedMm = Math.min(z.relief.effectiveMm, demandMm);
      return total + savedMm * z.advice.hectares * MM_PER_HA_TO_M3;
    }, 0);

    return {
      zoneCount: zones.length,
      dueCount: due.length,
      runningCount: running.length,
      plannedM3: plannedM3,
      plannedCost: plannedM3 * settings.waterCostPerM3,
      savedM3: savedM3,
      savedCost: savedM3 * settings.waterCostPerM3,
      ledger: ledger,
      estimated: zones.some(function (z) { return z.balance.estimated; })
    };
  }

  /* ---------- the controller ---------- */

  var TICK_MS = 1000;

  function loop() {
    if (!Object.keys(runs).length) return;
    advance(TICK_MS / 1000);
  }

  /** Move every open run on by `seconds` of wall-clock time. */
  function advance(seconds) {
    var ids = Object.keys(runs);
    if (!ids.length) return;

    var minutesPerTick = (seconds / 60) * settings.simulationSpeed;
    var finished = [];

    ids.forEach(function (id) {
      var run = runs[id];
      var zone = settings.zones.filter(function (z) { return z.id === id; })[0];
      var step = Math.min(minutesPerTick, run.plannedMinutes - run.elapsedMinutes);

      run.elapsedMinutes += step;
      var mm = (step / 60) * zone.applicationRateMmH;
      run.appliedMm += mm;
      run.volumeM3 += mm * zoneHectares(zone) * MM_PER_HA_TO_M3;
      run.cost = run.volumeM3 * settings.waterCostPerM3;

      applied[id] = (applied[id] || 0) + mm;
      ledger.minutes += step;
      ledger.waterM3 += mm * zoneHectares(zone) * MM_PER_HA_TO_M3;
      ledger.cost = ledger.waterM3 * settings.waterCostPerM3;

      if (run.elapsedMinutes >= run.plannedMinutes - 0.0001) finished.push(id);
    });

    finished.forEach(function (id) {
      delete runs[id];
      ledger.runsCompleted += 1;
    });

    persist();
    publish({ type: finished.length ? 'completed' : 'progress', finished: finished });
  }

  var irrigation = {
    settings: settings,

    computeZones: computeZones,
    summarise: summarise,

    /** Snapshot both together - what every view of this module needs. */
    snapshot: function (weather) {
      var zones = computeZones(weather);
      return { zones: zones, summary: summarise(zones) };
    },

    isRunning: function (zoneId) { return !!runs[zoneId]; },
    anyRunning: function () { return Object.keys(runs).length > 0; },

    /**
     * Open a zone for `minutes`. Returns the run, or null if the zone
     * cannot irrigate or is already going.
     */
    start: function (zoneId, minutes) {
      var zone = settings.zones.filter(function (z) { return z.id === zoneId; })[0];
      if (!zone || !zone.applicationRateMmH || runs[zoneId]) return null;

      runs[zoneId] = {
        zoneId: zoneId,
        startedAt: Date.now(),
        plannedMinutes: Math.max(1, Math.round(minutes || 60)),
        elapsedMinutes: 0,
        appliedMm: 0,
        volumeM3: 0,
        cost: 0
      };

      persist();
      publish({ type: 'started', zoneId: zoneId });
      return runs[zoneId];
    },

    /** Close a zone early. Water already applied stays applied. */
    stop: function (zoneId) {
      if (!runs[zoneId]) return false;
      delete runs[zoneId];
      persist();
      publish({ type: 'stopped', zoneId: zoneId });
      return true;
    },

    stopAll: function () {
      Object.keys(runs).forEach(function (id) { delete runs[id]; });
      persist();
      publish({ type: 'stopped', zoneId: null });
    },

    /** Open every zone the balance says is short. */
    startAllDue: function (weather) {
      var started = [];
      computeZones(weather).forEach(function (z) {
        if (z.canIrrigate && !z.run && z.advice.state === 'Irrigate now') {
          if (irrigation.start(z.id, z.advice.minutes)) started.push(z.id);
        }
      });
      return started;
    },

    subscribe: function (fn) {
      subscribers.push(fn);
      return function unsubscribe() {
        var i = subscribers.indexOf(fn);
        if (i > -1) subscribers.splice(i, 1);
      };
    },

    startClock: function () {
      if (!timer) timer = setInterval(loop, TICK_MS);
      return irrigation;
    },

    stopClock: function () {
      clearInterval(timer);
      timer = null;
      return irrigation;
    }
  };

  restore();

  NS.irrigation = irrigation;
})(window.AgroSense);
