/**
 * Bio Track - today's jobs
 * ---------------------------------------------------------------
 * The cockpit's task list is not a separate to-do app. It is the rest
 * of the dashboard, collapsed into one ranked list of things a person
 * could actually go and do this morning:
 *
 *   harvest a block that is inside its window
 *   open a valve on a zone past its refill point
 *   treat a pest whose threshold has been crossed, if the wind allows
 *   walk a block that has not been scouted in a fortnight
 *   give a herd the vaccination its calendar says is due
 *   move the stock the sell priority has put at the top
 *
 * Nothing here is invented: every row names the service it came from
 * and carries that service's own reason. Ticking a row stores the
 * completion for the rest of the day - except livestock health, which
 * delegates to livestock.markDone so the farm page agrees with this one.
 */
(function (NS) {
  'use strict';

  var fmt = NS.fmt;
  var DONE_KEY = 'tasksDone';

  function today() { return new Date().toISOString().slice(0, 10); }

  /** Completions are scoped to the day; yesterday's ticks do not carry over. */
  function doneIds() {
    var saved = NS.store.local.get(DONE_KEY, null);
    return saved && saved.day === today() ? (saved.ids || {}) : {};
  }

  function setDayDone(id, on) {
    var ids = doneIds();
    if (on) ids[id] = true; else delete ids[id];
    NS.store.local.set(DONE_KEY, { day: today(), ids: ids });
  }

  /* ---------- building the list ---------- */

  var RANK = { critical: 0, serious: 1, warning: 2, info: 3, ok: 4 };

  function build(ctx) {
    var out = [];
    var done = doneIds();

    function add(t) {
      t.done = t.source === 'health' ? t.done : !!done[t.id];
      out.push(t);
    }

    /* 1. harvest - a block inside or past its window */
    (ctx.harvest.alerts || []).forEach(function (a) {
      if (a.level !== 'critical' && a.level !== 'serious') return;
      add({
        id: 'harvest:' + a.id,
        source: 'day',
        icon: 'i-harvest',
        level: a.level,
        title: 'Harvest ' + a.cropName.toLowerCase() + ' in ' + a.field,
        detail: fmt.mass(a.expectedT * 1000) + ' expected, worth ' + fmt.moneyShort(a.expectedValue) + '.',
        when: a.when,
        href: 'farm.html#fields'
      });
    });

    /* 2. irrigation - a zone past its refill point */
    (ctx.irrigation.zones || []).forEach(function (z) {
      if (!z.canIrrigate || z.advice.state !== 'Irrigate now') return;
      add({
        id: 'irrigate:' + z.id,
        source: 'day',
        icon: 'i-droplet',
        level: 'serious',
        title: 'Irrigate ' + z.field + ' · ' + z.crop.name.toLowerCase(),
        detail: Math.round(z.advice.mmNeeded) + ' mm short · about ' + Math.round(z.advice.minutes) +
                ' min · ' + Math.round(z.advice.volumeM3) + ' m³.',
        when: 'Today',
        href: 'operations.html#irrigation'
      });
    });

    /* 3. pest treatment - threshold crossed and a spray window open */
    (ctx.pests.rows || []).forEach(function (pst) {
      if (pst.status.level !== 'critical' && pst.status.level !== 'serious') return;
      if (!pst.canSpray) return;
      add({
        id: 'treat:' + pst.id,
        source: 'day',
        icon: 'i-spray',
        level: pst.status.level,
        title: 'Treat ' + pst.name.toLowerCase() + ' on ' + pst.fields.join(', '),
        detail: pst.product + ' · ' + pst.phiDays + '-day pre-harvest interval · ' + fmt.moneyShort(pst.treatmentCost) + '.',
        when: ctx.pests.sprayWindow && ctx.pests.sprayWindow.open ? 'Window open now' : 'Next spray window',
        href: 'operations.html#pests'
      });
    });

    /* 4. scouting overdue - but not for a pest already queued for treatment,
          since going out to spray it means walking the block anyway */
    var treating = {};
    out.forEach(function (t) {
      if (t.id.indexOf('treat:') === 0) treating[t.id.slice(6)] = true;
    });
    (ctx.pests.rows || []).forEach(function (pst) {
      if (!pst.overdueScouting || treating[pst.id]) return;
      add({
        id: 'scout:' + pst.id,
        source: 'day',
        icon: 'i-search',
        level: 'warning',
        title: 'Scout ' + pst.fields.join(', ') + ' for ' + pst.name.toLowerCase(),
        detail: 'Last walked ' + pst.scoutedDaysAgo + ' days ago. The model is running blind until it is checked.',
        when: 'Overdue',
        href: 'operations.html#pests'
      });
    });

    /* 5. livestock health - delegates its completion to livestock.js */
    (ctx.health || []).forEach(function (h) {
      if (h.dueInDays > 3) return;
      add({
        id: 'health:' + h.id,
        source: 'health',
        healthId: h.id,
        done: h.completed,
        icon: 'i-syringe',
        level: h.level === 'ok' ? 'info' : h.level,
        title: h.task + ' · ' + h.herdName.toLowerCase(),
        detail: fmt.head(h.head) + ' · ' + (h.completed ? 'done' : 'due ' + fmt.inDays(h.dueInDays)),
        when: h.completed ? 'Done' : fmt.dayMonth(h.dueOn),
        href: 'farm.html#livestock'
      });
    });

    /* 6. the top of the sell priority, when it is actually urgent */
    var top = (ctx.snapshot.priority || [])[0];
    if (top && top.score >= 0.55) {
      add({
        id: 'sell:' + top.cropId,
        source: 'day',
        icon: 'i-coins',
        level: top.level === 'ok' ? 'warning' : top.level,
        title: 'Move the ' + top.name.toLowerCase(),
        detail: top.driver + '.',
        when: fmt.mass(top.quantityKg) + ' · ' + fmt.moneyShort(top.marketValue),
        href: 'cockpit.html#actions'
      });
    }

    // Outstanding first, then by urgency; finished jobs sink to the bottom.
    out.sort(function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      return (RANK[a.level] == null ? 3 : RANK[a.level]) - (RANK[b.level] == null ? 3 : RANK[b.level]);
    });

    var completed = out.filter(function (t) { return t.done; }).length;
    return {
      rows: out,
      total: out.length,
      completed: completed,
      outstanding: out.length - completed,
      progress: out.length ? completed / out.length : 0
    };
  }

  /** Tick or untick a row. Health tasks are owned by livestock.js. */
  function toggle(task) {
    if (task.source === 'health') {
      if (task.done) NS.livestock.reopen(task.healthId);
      else NS.livestock.markDone(task.healthId);
    } else {
      setDayDone(task.id, !task.done);
    }
  }

  NS.tasks = { build: build, toggle: toggle };
})(window.AgroSense);
