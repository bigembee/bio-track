/**
 * AgroSense - weather intelligence service
 * ---------------------------------------------------------------
 * Live data from Open-Meteo (https://open-meteo.com), queried against the
 * farm's own coordinates. No API key, no sign-up, CORS-open - the dashboard
 * works the moment it is opened.
 *
 * Beyond the forecast this module answers the question a farmer actually
 * asks: given the next 72 hours, what should I do or not do on the farm?
 * That is deriveAdvisories(), and it is the reason the agronomic fields
 * (soil moisture, soil temperature, reference evapotranspiration) are
 * requested alongside the ordinary temperature and rainfall.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;

  /* ---------- WMO weather interpretation codes ---------- */

  var WMO = {
    0:  ['Clear sky', 'sun'],
    1:  ['Mainly clear', 'sun-cloud'],
    2:  ['Partly cloudy', 'sun-cloud'],
    3:  ['Overcast', 'cloud'],
    45: ['Fog', 'fog'],
    48: ['Rime fog', 'fog'],
    51: ['Light drizzle', 'drizzle'],
    53: ['Drizzle', 'drizzle'],
    55: ['Heavy drizzle', 'drizzle'],
    56: ['Freezing drizzle', 'drizzle'],
    57: ['Freezing drizzle', 'drizzle'],
    61: ['Light rain', 'rain'],
    63: ['Rain', 'rain'],
    65: ['Heavy rain', 'rain'],
    66: ['Freezing rain', 'rain'],
    67: ['Freezing rain', 'rain'],
    71: ['Light snow', 'snow'],
    73: ['Snow', 'snow'],
    75: ['Heavy snow', 'snow'],
    77: ['Snow grains', 'snow'],
    80: ['Light showers', 'rain'],
    81: ['Showers', 'rain'],
    82: ['Violent showers', 'rain'],
    85: ['Snow showers', 'snow'],
    86: ['Snow showers', 'snow'],
    95: ['Thunderstorm', 'storm'],
    96: ['Thunderstorm, hail', 'storm'],
    99: ['Thunderstorm, hail', 'storm']
  };

  function interpret(code) {
    var entry = WMO[code] || ['Unknown', 'cloud'];
    return { code: code, label: entry[0], icon: entry[1] };
  }

  /* ---------- request ---------- */

  var CURRENT_FIELDS = [
    'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
    'precipitation', 'weather_code', 'cloud_cover', 'wind_speed_10m',
    'surface_pressure', 'is_day'
  ];

  var HOURLY_FIELDS = [
    'temperature_2m', 'relative_humidity_2m', 'precipitation',
    'precipitation_probability', 'soil_moisture_0_to_1cm', 'soil_temperature_0cm',
    'wind_speed_10m'
  ];

  var DAILY_FIELDS = [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_sum', 'precipitation_probability_max',
    'et0_fao_evapotranspiration', 'wind_speed_10m_max', 'sunrise', 'sunset'
  ];

  function buildUrl(location) {
    var params = new URLSearchParams({
      latitude: location.lat,
      longitude: location.lon,
      current: CURRENT_FIELDS.join(','),
      hourly: HOURLY_FIELDS.join(','),
      daily: DAILY_FIELDS.join(','),
      timezone: 'auto',
      forecast_days: String(cfg.weather.forecastDays),
      past_days: String(cfg.weather.pastDays),
      wind_speed_unit: 'kmh'
    });
    return cfg.weather.endpoint + '?' + params.toString();
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

  /* ---------- normalisation ---------- */

  var DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Transpose the parallel hourly arrays into one row per hour, 72 ahead. */
  function buildHourlyWindow(h, slice) {
    var time = slice(h.time, 72);
    var temp = slice(h.temperature_2m, 72);
    var humidity = slice(h.relative_humidity_2m, 72);
    var precip = slice(h.precipitation, 72);
    var precipProb = slice(h.precipitation_probability, 72);
    var wind = slice(h.wind_speed_10m, 72);

    return time.map(function (iso, i) {
      return {
        time: new Date(iso),
        temp: temp[i],
        humidity: humidity[i],
        precip: precip[i],
        precipProb: precipProb[i],
        wind: wind[i]
      };
    });
  }

  function normalise(raw, location) {
    var c = raw.current || {};
    var h = raw.hourly || {};
    var d = raw.daily || {};

    // With past_days in the request the daily arrays start two weeks back,
    // so "today" has to be found by date rather than assumed to be index 0.
    var now0 = new Date();
    var todayIso = [
      now0.getFullYear(),
      String(now0.getMonth() + 1).padStart(2, '0'),
      String(now0.getDate()).padStart(2, '0')
    ].join('-');

    var allDaily = (d.time || []).map(function (iso, i) {
      var date = new Date(iso + 'T12:00:00');
      return {
        date: date,
        iso: iso,
        label: DAY_LABELS[date.getDay()],
        condition: interpret(d.weather_code[i]),
        tempMax: d.temperature_2m_max[i],
        tempMin: d.temperature_2m_min[i],
        precipSum: d.precipitation_sum[i],
        precipProb: d.precipitation_probability_max[i],
        et0: d.et0_fao_evapotranspiration[i],
        windMax: d.wind_speed_10m_max[i],
        sunrise: d.sunrise[i],
        sunset: d.sunset[i]
      };
    });

    var pastDaily = allDaily.filter(function (x) { return x.iso < todayIso; });
    var daily = allDaily.filter(function (x) { return x.iso >= todayIso; });
    if (daily.length) daily[0].label = 'Today';
    daily = daily.slice(0, cfg.weather.forecastDays);

    // Index of the first hourly slot at or after "now" - the API returns the
    // whole of today, including hours already past.
    var now = Date.now();
    var startIdx = 0;
    var times = h.time || [];
    for (var i = 0; i < times.length; i++) {
      if (new Date(times[i]).getTime() >= now) { startIdx = i; break; }
    }

    function slice(arr, count) {
      return (arr || []).slice(startIdx, startIdx + count);
    }

    var next48 = {
      precipTotal: slice(h.precipitation, 48).reduce(function (a, b) { return a + (b || 0); }, 0),
      maxProb: Math.max.apply(null, slice(h.precipitation_probability, 48).concat([0])),
      maxTemp: Math.max.apply(null, slice(h.temperature_2m, 48).concat([-99])),
      humidHours: slice(h.relative_humidity_2m, 48).filter(function (v) { return v >= 85; }).length
    };

    var next72Precip = slice(h.precipitation, 72).reduce(function (a, b) { return a + (b || 0); }, 0);
    var soilMoisture = (h.soil_moisture_0_to_1cm || [])[startIdx];
    var soilTemp = (h.soil_temperature_0cm || [])[startIdx];

    return {
      location: location,
      fetchedAt: Date.now(),
      timezone: raw.timezone,
      current: {
        temp: c.temperature_2m,
        feelsLike: c.apparent_temperature,
        humidity: c.relative_humidity_2m,
        precip: c.precipitation,
        wind: c.wind_speed_10m,
        pressure: c.surface_pressure,
        cloud: c.cloud_cover,
        isDay: c.is_day === 1,
        condition: interpret(c.weather_code)
      },
      hourly: {
        time: slice(h.time, 24),
        temp: slice(h.temperature_2m, 24),
        precipProb: slice(h.precipitation_probability, 24),
        precip: slice(h.precipitation, 24),
        humidity: slice(h.relative_humidity_2m, 24),
        soilMoisture: slice(h.soil_moisture_0_to_1cm, 24)
      },
      daily: daily,
      pastDaily: pastDaily,

      /* A flat 72-hour view from now, one object per hour. The pest models
         walk this looking for infection windows, and the sprayer looks for
         a run of hours calm and dry enough to work in. */
      hourlyWindow: buildHourlyWindow(h, slice),

      soil: {
        // Open-Meteo reports volumetric water content, m3/m3.
        moisture: soilMoisture,
        moisturePct: soilMoisture != null ? soilMoisture * 100 : null,
        temp: soilTemp
      },
      next48: next48,
      next72Precip: next72Precip,
      units: {
        temp: (raw.current_units && raw.current_units.temperature_2m) || 'C',
        wind: (raw.current_units && raw.current_units.wind_speed_10m) || 'km/h',
        precip: 'mm'
      }
    };
  }

  /* ---------- agronomic advisories ---------- */

  var SEVERITY_RANK = { critical: 0, serious: 1, warning: 2, good: 3, info: 4 };

  /**
   * Turn the forecast into things to do or not do. Each rule states the
   * threshold it fired on, so the advice can be argued with rather than
   * just trusted.
   */
  function deriveAdvisories(w) {
    var out = [];
    if (!w) return out;

    var next48 = w.next48;
    var soilPct = w.soil.moisturePct;
    var et0Today = w.daily[0] ? w.daily[0].et0 : null;

    if (next48.precipTotal >= 25) {
      out.push({
        id: 'heavy-rain',
        severity: 'critical',
        icon: 'rain',
        title: 'Hold all fertiliser and spraying',
        detail: Math.round(next48.precipTotal) + ' mm of rain forecast in the next 48 hours. Applied urea or foliar spray will wash off before it is taken up.',
        window: 'Next 48 hours'
      });
    } else if (next48.precipTotal >= 10) {
      out.push({
        id: 'rain-window',
        severity: 'warning',
        icon: 'rain',
        title: 'Narrow window for field work',
        detail: Math.round(next48.precipTotal) + ' mm expected over 48 hours, peaking at ' + next48.maxProb + '% chance. Get top-dressing done today or wait it out.',
        window: 'Next 48 hours'
      });
    }

    if (w.next72Precip < 2 && soilPct != null && soilPct < 20) {
      out.push({
        id: 'irrigate',
        severity: 'serious',
        icon: 'droplet',
        title: 'Irrigate the shallow-rooted blocks',
        detail: 'Topsoil moisture is at ' + soilPct.toFixed(0) + '% with under 2 mm of rain due in 72 hours' +
                (et0Today ? ' and evapotranspiration running at ' + et0Today.toFixed(1) + ' mm/day' : '') +
                '. Tomato and vegetable beds will feel it first.',
        window: 'Next 72 hours'
      });
    }

    if (next48.humidHours >= 12 && next48.maxTemp >= 22 && next48.maxTemp <= 34) {
      out.push({
        id: 'fungal',
        severity: 'serious',
        icon: 'leaf',
        title: 'Scout tomato and cassava for leaf disease',
        detail: next48.humidHours + ' of the next 48 hours sit above 85% humidity at ' + Math.round(next48.maxTemp) + 'C. That is the window blight and leaf spot need.',
        window: 'Next 48 hours'
      });
    }

    var windyDay = w.daily.find(function (d) { return d.windMax >= 30; });
    if (windyDay) {
      out.push({
        id: 'wind',
        severity: 'warning',
        icon: 'wind',
        title: 'Do not spray on ' + windyDay.label.toLowerCase(),
        detail: 'Gusts to ' + Math.round(windyDay.windMax) + ' km/h. Drift will take the chemical off-target and off your budget.',
        window: windyDay.label
      });
    }

    var hotDay = w.daily.find(function (d) { return d.tempMax >= 36; });
    if (hotDay) {
      out.push({
        id: 'heat',
        severity: 'warning',
        icon: 'sun',
        title: 'Heat stress risk on ' + hotDay.label.toLowerCase(),
        detail: 'Peak of ' + Math.round(hotDay.tempMax) + 'C. Shift irrigation to early morning and keep harvested tomato out of the sun.',
        window: hotDay.label
      });
    }

    // A run of dry days is an opportunity, not a warning - the maize has to
    // hit 13% moisture before it can be bagged and sold.
    var dryRun = 0, dryStart = null;
    for (var i = 0; i < w.daily.length; i++) {
      if (w.daily[i].precipSum < 1) {
        if (dryRun === 0) dryStart = w.daily[i];
        dryRun++;
        if (dryRun >= 3) break;
      } else {
        dryRun = 0;
      }
    }
    if (dryRun >= 3) {
      out.push({
        id: 'drying',
        severity: 'good',
        icon: 'sun',
        title: 'Good drying window opens ' + dryStart.label.toLowerCase(),
        detail: dryRun + ' dry days in a row. Bring the maize out to dry and bag it while the weather holds.',
        window: dryStart.label + ' onward'
      });
    }

    if (!out.length) {
      out.push({
        id: 'settled',
        severity: 'info',
        icon: 'sun-cloud',
        title: 'Settled conditions, no constraints',
        detail: 'Nothing in the next seven days blocks field work. A good week to catch up on land preparation.',
        window: 'Next 7 days'
      });
    }

    return out.sort(function (a, b) { return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]; });
  }

  /* ---------- service ---------- */

  var status = {
    source: 'Open-Meteo',
    endpoint: cfg.weather.endpoint,
    state: 'idle',        // idle | loading | ok | error
    lastFetched: null,
    lastError: null,
    latencyMs: null,
    restored: false
  };

  var cache = null;

  /* The raw response is kept in sessionStorage so moving between pages
     does not re-query the API - the forecast has not changed in the two
     seconds it takes to click a link. It is re-normalised on read, so
     "now"-relative slices (the next 72 hours) stay correct. */
  var SESSION_KEY = 'weather';

  function restore(location) {
    var saved = NS.store.session.get(SESSION_KEY, null);
    if (!saved || saved.locationId !== location.id) return null;
    if (Date.now() - saved.fetchedAt > cfg.weather.refreshMs) return null;
    try {
      cache = normalise(saved.raw, location);
      cache.fetchedAt = saved.fetchedAt;
      status.state = 'ok';
      status.lastFetched = saved.fetchedAt;
      status.latencyMs = saved.latencyMs;
      status.restored = true;
      return cache;
    } catch (err) {
      return null;
    }
  }

  var weather = {
    status: status,

    interpret: interpret,
    deriveAdvisories: deriveAdvisories,

    getCached: function () { return cache; },

    /** A forecast fetched on another page within the refresh window, or null. */
    restore: restore,

    /** Fetch the forecast for a location, with one retry on failure. */
    load: function (location) {
      var url = buildUrl(location);
      var started = performance.now();
      status.state = 'loading';
      status.lastError = null;
      status.restored = false;

      function attempt(retriesLeft) {
        return fetchWithTimeout(url, 12000)
          .then(function (res) {
            if (!res.ok) throw new Error('Open-Meteo returned HTTP ' + res.status);
            return res.json();
          })
          .then(function (raw) {
            if (raw.error) throw new Error(raw.reason || 'Open-Meteo rejected the request');
            cache = normalise(raw, location);
            status.state = 'ok';
            status.lastFetched = Date.now();
            status.latencyMs = Math.round(performance.now() - started);
            NS.store.session.set(SESSION_KEY, {
              locationId: location.id, raw: raw, fetchedAt: status.lastFetched, latencyMs: status.latencyMs
            });
            return cache;
          })
          .catch(function (err) {
            if (retriesLeft > 0) return attempt(retriesLeft - 1);
            status.state = 'error';
            status.lastError = err.name === 'AbortError'
              ? 'Request timed out after 12 seconds'
              : err.message;
            throw err;
          });
      }

      return attempt(1);
    }
  };

  NS.weather = weather;
})(window.AgroSense);
