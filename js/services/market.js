/**
 * AgroSense - market price service
 * ---------------------------------------------------------------
 * Real Nigerian market prices from the World Food Programme's price
 * database, served through the HDX Humanitarian API (HAPI). It is the
 * one free, CORS-open feed of Nigerian food prices, so its shape sets
 * the shape of this module:
 *
 *   - it is MONTHLY. There is no intraday print to flash; the board shows
 *     the latest complete month and the change on the month before.
 *   - it is RETAIL, at WFP-monitored markets. config.market.farmgateFactor
 *     lets a farm apply its own farmgate spread.
 *   - the newest month is usually PARTIAL - a few markets in early. A
 *     month counts as complete once config.market.minMarkets have reported.
 *   - not every crop has a series. Where WFP publishes a related product
 *     (maize flour for maize grain) it stands in and is labelled a proxy.
 *     Where nothing exists the price is modelled and labelled as such.
 *
 * Three tiers keep the board populated: a live fetch, a cached copy of the
 * last live fetch, and the snapshot bundled in data/prices-snapshot.js.
 * Every quote says which tier it came from.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var settings = cfg.market;
  var store = NS.store;
  var fmt = NS.fmt;

  /* ---------- instruments: everything that has a price ---------- */

  function instruments() {
    var list = [];
    Object.keys(cfg.crops).forEach(function (id) {
      list.push(Object.assign({ kind: 'crop' }, cfg.crops[id]));
    });
    Object.keys(cfg.livestock.products).forEach(function (id) {
      list.push(Object.assign({ kind: 'livestock' }, cfg.livestock.products[id]));
    });
    return list;
  }

  var INSTRUMENTS = instruments();
  var byId = {};
  INSTRUMENTS.forEach(function (i) { byId[i.id] = i; });

  /* ---------- deterministic randomness for modelled series ---------- */

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  function hashSeed(str, salt) {
    var h = salt >>> 0;
    for (var i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
    return h;
  }

  function seasonalFactor(inst, date) {
    var yearFraction = (date.getMonth() + date.getDate() / 30) / 12;
    var peakFraction = inst.peakMonth / 12;
    return 1 + inst.seasonalAmp * Math.cos(2 * Math.PI * (yearFraction - peakFraction));
  }

  /* ---------- months ---------- */

  function monthKey(date) {
    return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
  }

  function addMonths(ym, n) {
    var d = fmt.monthToDate(ym);
    d.setMonth(d.getMonth() + n);
    return monthKey(d);
  }

  /** The last `count` months ending at `endYm`, oldest first. */
  function monthAxis(endYm, count) {
    var out = [];
    for (var i = count - 1; i >= 0; i--) out.push(addMonths(endYm, -i));
    return out;
  }

  /* ---------- units ---------- */

  /** How many base units (kg, pieces, litres) one WFP unit holds. */
  function unitFactor(unit) {
    var u = String(unit || '').trim();
    var m = /^([\d.]+)\s*KG$/i.exec(u);
    if (m) return { base: 'kg', factor: parseFloat(m[1]) };
    if (/^KG$/i.test(u)) return { base: 'kg', factor: 1 };
    m = /^([\d.]+)\s*G$/i.exec(u);
    if (m) return { base: 'kg', factor: parseFloat(m[1]) / 1000 };
    m = /^([\d.]+)\s*pcs$/i.exec(u);
    if (m) return { base: 'pc', factor: parseFloat(m[1]) };
    if (/^L$/i.test(u)) return { base: 'L', factor: 1 };
    return { base: 'unit', factor: 1 };
  }

  /* ---------- normalising raw HAPI rows into the compact form ---------- */

  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  /**
   * Group rows by month, one price per market, median across markets,
   * converted to the base unit. The same reduction the snapshot tool does.
   */
  function compactSeries(rows, commodity) {
    rows = rows.filter(function (r) { return r.commodity_name === commodity; });
    if (!rows.length) return null;

    var unit = rows[0].unit;
    var uf = unitFactor(unit);
    var byMonth = {};
    var states = {};

    rows.forEach(function (r) {
      var month = String(r.reference_period_start).slice(0, 7);
      if (!byMonth[month]) byMonth[month] = {};
      byMonth[month][r.market_name] = r.price / uf.factor;
      states[r.admin1_name] = true;
    });

    var points = Object.keys(byMonth).sort().map(function (month) {
      var prices = Object.keys(byMonth[month]).map(function (k) { return byMonth[month][k]; });
      return { m: month, p: Math.round(median(prices) * 100) / 100, n: prices.length };
    });

    return { unit: unit, base: uf.base, priceType: rows[0].price_type, states: Object.keys(states).sort(), points: points };
  }

  /* ---------- state ---------- */

  var data = null;        // { series: { commodity: compact }, fetchedAt, tier }
  var axis = [];          // month keys, oldest first
  var histories = {};     // instrumentId -> [{ t, month, close, markets, filled }]
  var quotes = {};
  var subscribers = [];

  var status = {
    source: settings.source.name,
    shortSource: settings.source.shortName,
    sourceUrl: settings.source.url,
    tier: 'none',          // live | cache | snapshot | none
    state: 'idle',         // idle | loading | ok | error
    fetchedAt: null,
    lastError: null,
    latencyMs: null,
    period: null,          // latest complete month, 'YYYY-MM'
    periodLabel: null,
    partialPeriod: null,   // a newer month with too few markets, if any
    markets: 0,
    states: [],
    liveCount: 0,
    proxyCount: 0,
    modelledCount: 0
  };

  function publish(event) {
    subscribers.forEach(function (fn) {
      try { fn(event); } catch (err) { console.error('[market] subscriber failed', err); }
    });
  }

  /* ---------- building histories on a shared month axis ---------- */

  function liveHistory(inst, compact) {
    var complete = compact.points.filter(function (p) { return p.n >= settings.minMarkets; });
    var byMonth = {};
    complete.forEach(function (p) { byMonth[p.m] = p; });

    var last = null;
    return axis.map(function (month) {
      var p = byMonth[month];
      if (p) {
        last = p;
        return { t: fmt.monthToDate(month).getTime(), month: month, close: p.p * settings.farmgateFactor, markets: p.n, filled: false };
      }
      // A month with no complete data carries the previous month forward,
      // and says so - a flat segment is better than a hole in a valuation.
      return { t: fmt.monthToDate(month).getTime(), month: month, close: last ? last.p * settings.farmgateFactor : null, markets: 0, filled: true };
    });
  }

  function modelledHistory(inst) {
    var rand = mulberry32(hashSeed(inst.id, settings.seed));
    var kappa = 0.3;
    var sigma = inst.volatility;
    var first = fmt.monthToDate(axis[0]);
    var price = inst.basePrice * seasonalFactor(inst, first);

    return axis.map(function (month) {
      var date = fmt.monthToDate(month);
      var target = inst.basePrice * seasonalFactor(inst, date);
      price = price * Math.exp(sigma * gaussian(rand) - 0.5 * sigma * sigma);
      price = price + kappa * (target - price);
      price = Math.max(price, inst.basePrice * 0.35);
      return { t: date.getTime(), month: month, close: price, markets: 0, filled: false };
    });
  }

  function latestCompleteMonth(series) {
    var latest = null;
    Object.keys(series).forEach(function (name) {
      series[name].points.forEach(function (p) {
        if (p.n >= settings.minMarkets && (!latest || p.m > latest)) latest = p.m;
      });
    });
    return latest;
  }

  function latestPartialMonth(series, after) {
    var latest = null;
    Object.keys(series).forEach(function (name) {
      series[name].points.forEach(function (p) {
        if (p.n < settings.minMarkets && p.m > after && (!latest || p.m > latest.m)) latest = p;
      });
    });
    return latest;
  }

  function rebuild() {
    var series = (data && data.series) || {};
    var end = latestCompleteMonth(series);

    if (!end) {
      // Nothing live at all: model everything up to last month.
      var d = new Date();
      d.setMonth(d.getMonth() - 1);
      end = monthKey(d);
    }
    axis = monthAxis(end, settings.months);

    var live = 0, proxy = 0, modelled = 0;
    var marketSet = {}, stateSet = {};

    INSTRUMENTS.forEach(function (inst) {
      var compact = inst.feed && series[inst.feed.commodity];
      var usable = compact && compact.points.some(function (p) { return p.n >= settings.minMarkets; });

      if (usable) {
        histories[inst.id] = liveHistory(inst, compact);
        histories[inst.id].mode = inst.feed.proxy ? 'proxy' : 'live';
        histories[inst.id].compact = compact;
        if (inst.feed.proxy) proxy++; else live++;
        compact.states.forEach(function (s) { stateSet[s] = true; });
        var lastPoint = compact.points.filter(function (p) { return p.n >= settings.minMarkets; }).pop();
        marketSet[inst.feed.commodity] = lastPoint ? lastPoint.n : 0;
      } else {
        histories[inst.id] = modelledHistory(inst);
        histories[inst.id].mode = 'modelled';
        modelled++;
      }
      rebuildQuote(inst.id);
    });

    status.period = end;
    status.periodLabel = fmt.monthYearLong(fmt.monthToDate(end));
    var partial = latestPartialMonth(series, end);
    status.partialPeriod = partial ? { month: partial.m, label: fmt.monthYearLong(fmt.monthToDate(partial.m)), markets: partial.n } : null;
    status.liveCount = live;
    status.proxyCount = proxy;
    status.modelledCount = modelled;
    status.states = Object.keys(stateSet);
    status.markets = Object.keys(marketSet).reduce(function (a, k) { return Math.max(a, marketSet[k]); }, 0);
  }

  /* ---------- signals ---------- */

  /**
   * A plain-language call on a monthly series: is this month's price
   * strong or weak against the last twelve months, and which way is it
   * moving? Not a prediction - a position.
   */
  function deriveSignal(price, ma12, momentum) {
    var ratio = ma12 ? price / ma12 : 1;
    if (ratio >= 1.10 && momentum > 0) {
      return { code: 'sell', label: 'Sell now', tone: 'good',
        reason: 'Trading ' + Math.round((ratio - 1) * 100) + '% above its 12-month average and still climbing.' };
    }
    if (ratio >= 1.04) {
      return { code: 'soon', label: 'Sell soon', tone: 'good',
        reason: Math.round((ratio - 1) * 100) + '% above the 12-month average' + (momentum < 0 ? ', but it slipped last month.' : '. A strong window.') };
    }
    if (ratio <= 0.94) {
      return { code: 'hold', label: 'Hold', tone: 'warn',
        reason: Math.round((1 - ratio) * 100) + '% below its 12-month average. Selling here locks in the dip.' };
    }
    return { code: 'watch', label: 'Watch', tone: 'neutral',
      reason: 'Within a few percent of its 12-month average. No clear edge either way.' };
  }

  /* ---------- quotes ---------- */

  function average(values) {
    var v = values.filter(function (x) { return x != null; });
    if (!v.length) return 0;
    return v.reduce(function (a, b) { return a + b; }, 0) / v.length;
  }

  function rebuildQuote(id) {
    var inst = byId[id];
    var series = histories[id];
    var closes = series.map(function (p) { return p.close; });
    var last = series[series.length - 1];
    var prev = series[series.length - 2] || last;
    var price = last.close;
    var ma3 = average(closes.slice(-3));
    var ma12 = average(closes.slice(-12));
    var threeAgo = closes[closes.length - 4];
    var yearAgo = closes[closes.length - 13];
    var changePct = prev.close ? (price - prev.close) / prev.close : 0;
    var compact = series.compact;

    var note;
    if (series.mode === 'modelled') {
      note = 'No live series for ' + inst.name.toLowerCase() + ' in the WFP Nigeria database — this price is modelled around a ₦' +
             fmt.number(inst.basePrice) + ' reference and seasonal curve.';
    } else if (series.mode === 'proxy') {
      note = inst.feed.proxy + '. Series: “' + inst.feed.commodity + '”, ' + compact.priceType.toLowerCase() +
             ', median of ' + last.markets + ' markets in ' + fmt.monthYearLong(last.t) + '.';
    } else {
      note = 'WFP “' + inst.feed.commodity + '”, ' + compact.priceType.toLowerCase() + ' price, median of ' +
             last.markets + ' markets in ' + fmt.monthYearLong(last.t) + '.';
    }

    quotes[id] = {
      id: id,
      cropId: id,
      kind: inst.kind,
      name: inst.name,
      color: inst.color,
      unit: inst.unit,
      price: price,
      prevClose: prev.close,
      change: price - prev.close,
      changePct: changePct,
      ma3: ma3,
      ma12: ma12,
      momentum3: threeAgo ? price / threeAgo - 1 : 0,
      yoy: yearAgo ? price / yearAgo - 1 : null,
      rangeLow: Math.min.apply(null, closes.filter(function (x) { return x != null; })),
      rangeHigh: Math.max.apply(null, closes.filter(function (x) { return x != null; })),
      signal: deriveSignal(price, ma12, changePct),
      spark: closes.slice(-12),
      period: last.month,
      periodLabel: fmt.monthYearLong(last.t),
      periodShort: fmt.monthYear(last.t),
      markets: last.markets,
      filled: last.filled,
      mode: series.mode,
      commodity: inst.feed ? inst.feed.commodity : null,
      note: note,
      updatedAt: Date.now(),
      direction: 0
    };
    return quotes[id];
  }

  /* ---------- loading tiers ---------- */

  function loadSnapshot() {
    var snap = NS.pricesSnapshot;
    if (!snap || !snap.series) return null;
    return { series: snap.series, fetchedAt: Date.parse(snap.generatedAt) || null, tier: 'snapshot' };
  }

  function loadCache() {
    var cached = store.local.get('prices', null);
    if (!cached || !cached.series || !cached.fetchedAt) return null;
    return { series: cached.series, fetchedAt: cached.fetchedAt, tier: 'cache' };
  }

  function isFresh(entry) {
    return entry && entry.fetchedAt && (Date.now() - entry.fetchedAt) < settings.cacheHours * 3600000;
  }

  function apply(entry) {
    data = entry;
    status.tier = entry.tier;
    status.fetchedAt = entry.fetchedAt;
    rebuild();
  }

  /* ---------- the live fetch ---------- */

  function appIdentifier() {
    try { return btoa(settings.source.appIdentifier); } catch (err) { return ''; }
  }

  function fetchWithTimeout(url, ms) {
    if (typeof AbortController === 'undefined') return fetch(url);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, ms);
    return fetch(url, { signal: controller.signal }).then(
      function (res) { clearTimeout(timer); return res; },
      function (err) { clearTimeout(timer); throw err; }
    );
  }

  function fetchCommodity(commodity) {
    var start = new Date();
    start.setMonth(start.getMonth() - settings.months - 1);
    start.setDate(1);

    var params = new URLSearchParams({
      location_code: settings.source.location,
      commodity_name: commodity,
      start_date: start.toISOString().slice(0, 10),
      limit: '10000',
      output_format: 'json',
      app_identifier: appIdentifier()
    });

    return fetchWithTimeout(settings.source.endpoint + '?' + params.toString(), settings.timeoutMs)
      .then(function (res) {
        if (!res.ok) throw new Error('HDX HAPI returned HTTP ' + res.status);
        return res.json();
      })
      .then(function (json) { return compactSeries(json.data || [], commodity); });
  }

  /** Promise.allSettled for browsers that predate it. */
  function settle(promises) {
    return Promise.all(promises.map(function (p) {
      return p.then(
        function (value) { return { ok: true, value: value }; },
        function (err) { return { ok: false, error: err }; }
      );
    }));
  }

  function refresh() {
    var commodities = {};
    INSTRUMENTS.forEach(function (i) { if (i.feed) commodities[i.feed.commodity] = true; });
    var names = Object.keys(commodities);

    status.state = 'loading';
    status.lastError = null;
    var started = performance.now();
    publish({ type: 'loading' });

    return settle(names.map(fetchCommodity)).then(function (results) {
      var series = {};
      var failures = [];
      results.forEach(function (r, i) {
        if (r.ok && r.value) series[names[i]] = r.value;
        else failures.push(names[i] + (r.error ? ' (' + r.error.message + ')' : ''));
      });

      status.latencyMs = Math.round(performance.now() - started);

      if (!Object.keys(series).length) {
        throw new Error(failures.length ? failures[0] : 'no series returned');
      }

      // Keep whatever an earlier tier had for any commodity that failed
      // this time, so one bad request does not knock a crop back to modelled.
      if (data && data.series) {
        Object.keys(data.series).forEach(function (name) {
          if (!series[name]) series[name] = data.series[name];
        });
      }

      var entry = { series: series, fetchedAt: Date.now(), tier: 'live' };
      store.local.set('prices', { series: series, fetchedAt: entry.fetchedAt });
      apply(entry);
      status.state = 'ok';
      status.lastError = failures.length ? 'Partial: ' + failures.join(', ') : null;
      publish({ type: 'update', quotes: quotes, tier: 'live' });
      return quotes;
    }).catch(function (err) {
      status.state = 'error';
      status.lastError = err.name === 'AbortError' ? 'Request timed out' : err.message;
      publish({ type: 'error', quotes: quotes, error: status.lastError });
      throw err;
    });
  }

  /* ---------- public surface ---------- */

  var market = {
    status: status,
    instruments: INSTRUMENTS,

    /**
     * Populate from the freshest offline tier and publish at once, so the
     * page paints with real figures; then go to the API if the copy in
     * hand is older than the cache window.
     */
    init: function () {
      var cache = loadCache();
      var snap = loadSnapshot();

      var best = null;
      if (cache && (!snap || cache.fetchedAt >= (snap.fetchedAt || 0))) best = cache;
      else if (snap) best = snap;

      if (best) apply(best);
      else apply({ series: {}, fetchedAt: null, tier: 'none' });

      status.state = 'ok';
      publish({ type: 'snapshot', quotes: quotes, tier: status.tier });

      if (!isFresh(best) && typeof fetch === 'function') {
        refresh().catch(function () { /* status carries the error; offline tier stays up */ });
      }
      return market;
    },

    refresh: refresh,

    getQuote: function (id) { return quotes[id]; },
    getQuotes: function () { return quotes; },

    /** Which instruments a page wants: 'crop', 'livestock' or all. */
    ids: function (kind) {
      return INSTRUMENTS.filter(function (i) { return !kind || i.kind === kind; }).map(function (i) { return i.id; });
    },

    /** Monthly closes for one instrument, ready for a line chart. */
    getSeries: function (id, months) {
      var series = histories[id] || [];
      return series.slice(-(months || settings.months));
    },

    /** Aligned monthly closes for every instrument - used to value the farm historically. */
    getHistoryMatrix: function (months) {
      var n = months || settings.months;
      var matrix = {};
      Object.keys(histories).forEach(function (id) { matrix[id] = histories[id].slice(-n); });
      return matrix;
    },

    getAxis: function () { return axis.slice(); },

    subscribe: function (fn) {
      subscribers.push(fn);
      return function unsubscribe() {
        var i = subscribers.indexOf(fn);
        if (i > -1) subscribers.splice(i, 1);
      };
    }
  };

  NS.market = market;
})(window.AgroSense);
