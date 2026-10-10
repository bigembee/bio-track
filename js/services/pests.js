/**
 * AgroSense - pest and disease control
 * ---------------------------------------------------------------
 * Three models, all driven by the same live forecast.
 *
 * 1. INSECTS run on growing degree days. An insect develops on
 *    accumulated warmth, not on the calendar, so
 *
 *      GDD(day) = max(0, (Tmax + Tmin) / 2 - baseTemp)
 *
 *    is summed from the last scouting visit. When the running total
 *    reaches the species' generation threshold, the next generation is
 *    emerging - which is the moment a treatment actually works. The past
 *    days in the weather request are what make this sum possible, and the
 *    seven-day forecast projects the crossing date forward.
 *
 * 2. DISEASES run on infection conditions: an unbroken run of hours inside
 *    a humidity and temperature band. Scattered humid hours do not infect a
 *    crop; ten consecutive ones do, which is why the longest run is scored
 *    rather than the total.
 *
 * 3. THE SPRAY WINDOW is an operational constraint, not a risk. Wind takes
 *    the chemical off-target and rain washes it off, so the module finds the
 *    next run of hours calm and dry enough to work in.
 *
 * Applying a treatment starts a PRE-HARVEST INTERVAL. Produce from a treated
 * block cannot be sold until that interval expires, so treatments feed back
 * into inventory valuation and the sell priority through getFieldConstraints().
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var settings = cfg.pests;
  var DAY_MS = 86400000;

  /* ---------- session state, kept out of config ---------- */

  var treatmentSeq = 200;
  var sessionTreatments = [];   // recorded while the dashboard is open
  var sessionScouts = {};       // pestId -> timestamp
  var subscribers = [];

  /* Recorded treatments and scouting visits outlive the page - a spray
     logged on the operations page must still block sales on the farm page. */
  var STORE_KEY = 'pests';

  function persist() {
    NS.store.local.set(STORE_KEY, {
      treatments: sessionTreatments.map(function (t) { return Object.assign({}, t, { recordedNow: false }); }),
      scouts: sessionScouts,
      seq: treatmentSeq
    });
  }

  function restore() {
    var saved = NS.store.local.get(STORE_KEY, null);
    if (!saved) return;
    sessionTreatments = saved.treatments || [];
    sessionScouts = saved.scouts || {};
    if (saved.seq > treatmentSeq) treatmentSeq = saved.seq;
  }

  function publish(event) {
    subscribers.forEach(function (fn) {
      try { fn(event); } catch (err) { console.error('[pests] subscriber failed', err); }
    });
  }

  function fieldsForCrop(cropId) {
    return cfg.fields.filter(function (f) { return f.cropId === cropId; });
  }

  /* ---------- 1. degree days ---------- */

  /**
   * Sum degree days from the pest's last scouting visit to today, then
   * project the forecast forward. Returns the running series so the
   * crossing can be drawn, not just stated.
   */
  function degreeDays(pest, weather) {
    if (pest.type !== 'insect') return null;

    var scoutedDaysAgo = sessionScouts[pest.id] != null
      ? Math.floor((Date.now() - sessionScouts[pest.id]) / DAY_MS)
      : pest.scoutedDaysAgo;

    var past = weather ? weather.pastDaily.slice(-Math.max(1, scoutedDaysAgo)) : [];
    var ahead = weather ? weather.daily : [];

    var total = pest.ddAtLastScout;
    var series = [];
    var dailyTotal = 0;

    function step(day, projected) {
      var mean = (day.tempMax + day.tempMin) / 2;
      var gdd = Math.max(0, mean - pest.baseTempC);
      total += gdd;
      if (!projected) dailyTotal += gdd;
      series.push({
        t: day.date.getTime(),
        label: NS.fmt.dayMonth(day.date),
        value: total,
        projected: projected
      });
    }

    past.forEach(function (d) { step(d, false); });
    ahead.forEach(function (d, i) { step(d, i > 0); });

    var avgDaily = past.length ? dailyTotal / past.length : 0;
    var accumulated = total;
    var remaining = pest.generationDD - accumulated;

    return {
      accumulated: accumulated,
      threshold: pest.generationDD,
      progress: pest.generationDD ? Math.min(1, accumulated / pest.generationDD) : 0,
      exceeded: accumulated > pest.generationDD,
      avgDaily: avgDaily,
      remaining: remaining,
      daysToGeneration: avgDaily > 0 ? remaining / avgDaily : null,
      series: series,
      scoutedDaysAgo: scoutedDaysAgo
    };
  }

  /* ---------- 2. infection windows ---------- */

  /**
   * The longest unbroken run of hours inside the pathogen's infection band,
   * within the next 48 hours.
   */
  function infectionWindow(pest, weather) {
    if (pest.type !== 'disease' || !weather) return null;

    var hours = weather.hourlyWindow.slice(0, 48);
    var longest = 0, current = 0, total = 0;
    var startsAt = null, bestStart = null;

    hours.forEach(function (h) {
      var inBand = h.humidity >= pest.minRh &&
                   h.temp >= pest.tempRange[0] &&
                   h.temp <= pest.tempRange[1];

      if (inBand) {
        total += 1;
        if (current === 0) startsAt = h.time;
        current += 1;
        if (current > longest) { longest = current; bestStart = startsAt; }
      } else {
        current = 0;
      }
    });

    // Past the trigger the window is simply met — twice the required hours
    // is not "twice as infected", so the ratio is capped rather than left
    // to report figures like 200%.
    var ratio = pest.wetHoursTrigger ? longest / pest.wetHoursTrigger : 0;

    return {
      longestRun: longest,
      totalHours: total,
      trigger: pest.wetHoursTrigger,
      progress: Math.min(1, ratio),
      exceeded: ratio > 1,
      startsAt: bestStart,
      scoutedDaysAgo: sessionScouts[pest.id] != null
        ? Math.floor((Date.now() - sessionScouts[pest.id]) / DAY_MS)
        : pest.scoutedDaysAgo
    };
  }

  /* ---------- 3. the spray window ---------- */

  /**
   * The next stretch of at least two hours where the sprayer can work:
   * calm enough not to drift, dry enough not to wash off, cool enough
   * not to evaporate before it lands.
   */
  function sprayWindow(weather) {
    if (!weather) return null;
    var limits = settings.sprayLimits;
    var hours = weather.hourlyWindow;

    var runStart = null, runLength = 0;

    for (var i = 0; i < hours.length; i++) {
      var h = hours[i];
      var ok = h.wind <= limits.maxWindKmh &&
               (h.precipProb == null || h.precipProb <= limits.maxPrecipProb) &&
               h.temp <= limits.maxTempC;

      if (ok) {
        if (runLength === 0) runStart = h;
        runLength += 1;
        if (runLength >= 2 && i + 1 < hours.length) {
          var nextH = hours[i + 1];
          var nextOk = nextH.wind <= limits.maxWindKmh &&
                       (nextH.precipProb == null || nextH.precipProb <= limits.maxPrecipProb) &&
                       nextH.temp <= limits.maxTempC;
          if (!nextOk) {
            return { start: runStart.time, end: nextH.time, hours: runLength, open: runStart === hours[0] };
          }
        }
      } else {
        runLength = 0;
      }
    }

    if (runLength >= 2) {
      return {
        start: runStart.time,
        end: hours[hours.length - 1].time,
        hours: runLength,
        open: runStart === hours[0]
      };
    }
    return null;
  }

  /* ---------- pre-harvest intervals ---------- */

  function allTreatments() {
    var fromConfig = settings.treatments.map(function (t) {
      return {
        id: t.id,
        field: t.field,
        pestId: t.pestId,
        product: t.product,
        phiDays: t.phiDays,
        hectares: t.hectares,
        appliedAt: Date.now() - t.appliedDaysAgo * DAY_MS,
        recordedNow: false
      };
    });
    return fromConfig.concat(sessionTreatments);
  }

  function treatmentRows() {
    return allTreatments().map(function (t) {
      var daysSince = (Date.now() - t.appliedAt) / DAY_MS;
      var daysRemaining = t.phiDays - daysSince;
      return {
        id: t.id,
        field: t.field,
        pestId: t.pestId,
        product: t.product,
        phiDays: t.phiDays,
        hectares: t.hectares,
        appliedAt: t.appliedAt,
        daysSince: daysSince,
        daysRemaining: daysRemaining,
        blocked: daysRemaining > 0,
        recordedNow: t.recordedNow
      };
    }).sort(function (a, b) { return b.daysRemaining - a.daysRemaining; });
  }

  /**
   * Which fields cannot have produce sold, and until when. This is the
   * module's contract with the inventory analytics - it deliberately
   * returns plain data, so analytics knows nothing about pests.
   */
  function getFieldConstraints() {
    var map = {};

    treatmentRows().forEach(function (t) {
      if (!t.blocked) return;
      var existing = map[t.field];
      if (existing && existing.daysRemaining >= t.daysRemaining) return;
      map[t.field] = {
        daysRemaining: t.daysRemaining,
        reason: 'Pre-harvest interval',
        detail: t.product + ' applied ' + Math.round(t.daysSince) + ' days ago · ' +
                t.phiDays + '-day interval',
        clearsOn: new Date(t.appliedAt + t.phiDays * DAY_MS)
      };
    });

    return map;
  }

  /* ---------- scoring ---------- */

  function levelFor(progress, overdueScouting) {
    var p = progress + (overdueScouting ? 0.12 : 0);
    if (p >= 1) return { level: 'critical', label: 'Act now' };
    if (p >= 0.8) return { level: 'serious', label: 'Treat this week' };
    if (p >= 0.55) return { level: 'warning', label: 'Watch closely' };
    return { level: 'ok', label: 'Under control' };
  }

  var LEVEL_RANK = { critical: 0, serious: 1, warning: 2, ok: 3 };

  function assess(weather) {
    var constraints = getFieldConstraints();
    var window = sprayWindow(weather);

    var rows = settings.watchlist.map(function (pest) {
      var crop = cfg.crops[pest.cropId];
      var fields = fieldsForCrop(pest.cropId);
      var hectares = fields.reduce(function (a, f) { return a + f.hectares; }, 0);

      var dd = degreeDays(pest, weather);
      var infection = infectionWindow(pest, weather);
      var model = dd || infection;
      var progress = model ? model.progress : 0;
      var scoutedDaysAgo = model ? model.scoutedDaysAgo : pest.scoutedDaysAgo;
      var overdue = scoutedDaysAgo > 10;
      var status = levelFor(progress, overdue);

      var blockedField = fields.filter(function (f) { return constraints[f.id]; })[0];
      var underPhi = blockedField ? constraints[blockedField.id] : null;

      var driver;
      if (pest.type === 'insect' && dd) {
        driver = dd.progress >= 1
          ? 'A new generation is emerging now — ' + Math.round(dd.accumulated) + ' degree days against a ' + pest.generationDD + ' threshold.'
          : Math.round(dd.accumulated) + ' of ' + pest.generationDD + ' degree days since the last visit, gaining ' +
            dd.avgDaily.toFixed(1) + ' a day. Next generation in about ' +
            Math.max(1, Math.round(dd.daysToGeneration || 0)) + ' days.';
      } else if (infection) {
        driver = infection.longestRun >= infection.trigger
          ? infection.longestRun + ' unbroken hours above ' + pest.minRh + '% humidity at ' +
            pest.tempRange[0] + '–' + pest.tempRange[1] + '°C. That is a full infection window.'
          : 'Longest humid run ahead is ' + infection.longestRun + ' hours against the ' +
            infection.trigger + ' hours this pathogen needs.';
      } else {
        driver = 'No forecast available, so the model cannot run.';
      }

      return {
        id: pest.id,
        name: pest.name,
        type: pest.type,
        cropId: pest.cropId,
        cropName: crop.name,
        color: crop.color,
        fields: fields.map(function (f) { return f.id; }),
        hectares: hectares,
        progress: progress,
        exceeded: model ? !!model.exceeded : false,
        status: status,
        driver: driver,
        dd: dd,
        infection: infection,
        scoutedDaysAgo: scoutedDaysAgo,
        overdueScouting: overdue,
        product: pest.product,
        phiDays: pest.phiDays,
        costPerHa: pest.costPerHa,
        treatmentCost: pest.costPerHa * hectares,
        underPhi: underPhi,
        canSpray: !!window
      };
    }).sort(function (a, b) {
      var d = LEVEL_RANK[a.status.level] - LEVEL_RANK[b.status.level];
      if (d !== 0) return d;
      // Progress is capped at 1, so several pests tie at the top. Anything
      // already past its threshold outranks anything merely at it.
      var ex = (b.exceeded ? 1 : 0) - (a.exceeded ? 1 : 0);
      return ex !== 0 ? ex : b.progress - a.progress;
    });

    var treatments = treatmentRows();
    var blocked = treatments.filter(function (t) { return t.blocked; });

    return {
      rows: rows,
      sprayWindow: window,
      treatments: treatments,
      constraints: constraints,
      summary: {
        urgent: rows.filter(function (r) { return r.status.level === 'critical' || r.status.level === 'serious'; }).length,
        overdueScouting: rows.filter(function (r) { return r.overdueScouting; }).length,
        blockedFields: blocked.length,
        plannedCost: rows
          .filter(function (r) { return r.status.level === 'critical' || r.status.level === 'serious'; })
          .reduce(function (a, r) { return a + r.treatmentCost; }, 0),
        hectaresAtRisk: rows
          .filter(function (r) { return r.status.level === 'critical' || r.status.level === 'serious'; })
          .reduce(function (a, r) { return a + r.hectares; }, 0)
      }
    };
  }

  /* ---------- actions ---------- */

  var pests = {
    settings: settings,

    assess: assess,
    sprayWindow: sprayWindow,
    getFieldConstraints: getFieldConstraints,
    treatmentRows: treatmentRows,

    /**
     * Record a treatment against every field growing the affected crop.
     * This starts the pre-harvest interval, so it is the one action here
     * that changes what the farm is allowed to sell.
     */
    treat: function (pestId) {
      var pest = settings.watchlist.filter(function (p) { return p.id === pestId; })[0];
      if (!pest) return null;

      var fields = fieldsForCrop(pest.cropId);
      var added = fields.map(function (field) {
        var record = {
          id: 'TR-' + (++treatmentSeq),
          field: field.id,
          pestId: pest.id,
          product: pest.product,
          phiDays: pest.phiDays,
          hectares: field.hectares,
          appliedAt: Date.now(),
          recordedNow: true
        };
        sessionTreatments.push(record);
        return record;
      });

      persist();
      publish({ type: 'treated', pestId: pestId, treatments: added });
      return added;
    },

    /** Log a scouting visit. Clears the overdue flag; development carries on. */
    scout: function (pestId) {
      sessionScouts[pestId] = Date.now();
      persist();
      publish({ type: 'scouted', pestId: pestId });
      return true;
    },

    /** Forget everything recorded in the browser; config treatments remain. */
    reset: function () {
      sessionTreatments = [];
      sessionScouts = {};
      NS.store.local.remove(STORE_KEY);
      publish({ type: 'reset' });
    },

    subscribe: function (fn) {
      subscribers.push(fn);
      return function unsubscribe() {
        var i = subscribers.indexOf(fn);
        if (i > -1) subscribers.splice(i, 1);
      };
    }
  };

  restore();

  NS.pests = pests;
})(window.AgroSense);
