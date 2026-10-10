/**
 * AgroSense - formatting helpers
 * Currency, mass and time formatting shared by every view.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;

  var naira = new Intl.NumberFormat(cfg.locale, {
    style: 'currency', currency: cfg.currency, maximumFractionDigits: 0
  });
  var nairaPrecise = new Intl.NumberFormat(cfg.locale, {
    style: 'currency', currency: cfg.currency, minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  var plain = new Intl.NumberFormat(cfg.locale);

  NS.fmt = {
    /** Full naira amount, no kobo: ₦48,215,000 */
    money: function (n) {
      if (n == null || isNaN(n)) return '—';
      return naira.format(n);
    },

    /** Price per kg, kobo included: ₦852.40 */
    price: function (n) {
      if (n == null || isNaN(n)) return '—';
      return nairaPrecise.format(n);
    },

    /** Compact naira for axis ticks and tight chips: ₦48.2m */
    moneyShort: function (n) {
      if (n == null || isNaN(n)) return '—';
      var abs = Math.abs(n);
      var sign = n < 0 ? '-' : '';
      if (abs >= 1e9) return sign + '₦' + (abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'bn';
      if (abs >= 1e6) return sign + '₦' + (abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'm';
      if (abs >= 1e3) return sign + '₦' + (abs / 1e3).toFixed(0) + 'k';
      return sign + '₦' + Math.round(abs);
    },

    /** Signed naira with an explicit sign for deltas. */
    moneySigned: function (n) {
      if (n == null || isNaN(n)) return '—';
      return (n > 0 ? '+' : n < 0 ? '-' : '') + naira.format(Math.abs(n));
    },

    number: function (n, decimals) {
      if (n == null || isNaN(n)) return '—';
      return plain.format(decimals != null ? Number(n.toFixed(decimals)) : Math.round(n));
    },

    /** Mass in the unit a farmer would say out loud. */
    mass: function (kg) {
      if (kg == null || isNaN(kg)) return '—';
      if (kg >= 1000) return plain.format(Number((kg / 1000).toFixed(kg >= 10000 ? 1 : 2))) + ' t';
      return plain.format(Math.round(kg)) + ' kg';
    },

    pct: function (fraction, decimals) {
      if (fraction == null || isNaN(fraction)) return '—';
      return (fraction * 100).toFixed(decimals == null ? 1 : decimals) + '%';
    },

    pctSigned: function (fraction, decimals) {
      if (fraction == null || isNaN(fraction)) return '—';
      var v = fraction * 100;
      return (v > 0 ? '+' : '') + v.toFixed(decimals == null ? 1 : decimals) + '%';
    },

    /** Jun 26 - the label on every monthly axis. */
    monthYear: function (input) {
      var d = input instanceof Date ? input : new Date(input);
      return d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    },

    /** June 2026 - the long form for captions and the board. */
    monthYearLong: function (input) {
      var d = input instanceof Date ? input : new Date(input);
      return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    },

    /** "2026-06" -> a Date on the 15th, the day WFP labels its months by. */
    monthToDate: function (ym) {
      var parts = String(ym).split('-');
      return new Date(Number(parts[0]), Number(parts[1]) - 1, 15);
    },

    /** Whole animals or birds: 2,400 head. */
    head: function (n) {
      if (n == null || isNaN(n)) return '—';
      return plain.format(Math.round(n)) + ' head';
    },

    /** "in 4 days" / "today" / "3 days ago" - for calendars and alerts. */
    inDays: function (n) {
      if (n == null || isNaN(n)) return '—';
      var r = Math.round(n);
      if (r === 0) return 'today';
      if (r === 1) return 'tomorrow';
      if (r === -1) return 'yesterday';
      if (r < 0) return Math.abs(r) + ' days ago';
      return 'in ' + r + ' days';
    },

    /** 9 Sep - the label used across every time axis. */
    dayMonth: function (input) {
      var d = input instanceof Date ? input : new Date(input);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    },

    time: function (input) {
      var d = input instanceof Date ? input : new Date(input);
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    },

    clockSeconds: function (input) {
      var d = input instanceof Date ? input : new Date(input);
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    },

    /** "just now", "40s ago", "6m ago" - for the live status line. */
    ago: function (ts) {
      if (!ts) return 'never';
      var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
      if (s < 5) return 'just now';
      if (s < 60) return s + 's ago';
      var m = Math.round(s / 60);
      if (m < 60) return m + 'm ago';
      return Math.round(m / 60) + 'h ago';
    },

    /** "in 4 days" / "2 days over" - shelf life reads better as prose. */
    days: function (n) {
      if (n == null) return '—';
      if (n < 0) return Math.abs(Math.round(n)) + 'd over';
      if (n < 1) return 'today';
      return Math.round(n) + 'd left';
    }
  };
})(window.AgroSense);
