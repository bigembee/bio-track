/**
 * AgroSense - landing page
 * ---------------------------------------------------------------
 * The door has no lock: the log-in button is a link to the cockpit.
 * What this script does is make the telemetry chips honest - they show
 * the real current weather for the farm's default location and a real
 * WFP price from the bundled snapshot, or say why they cannot.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;

  function el(name) { return document.querySelector('[data-el="' + name + '"]'); }
  function setText(name, text) { var n = el(name); if (n) n.textContent = text; }

  document.getElementById('year').textContent = String(new Date().getFullYear());

  /* ---------- weather ---------- */

  var WMO = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
    80: 'Light showers', 81: 'Showers', 82: 'Violent showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, hail'
  };

  function loadWeather() {
    var loc = cfg.locations.filter(function (l) { return l.id === cfg.defaultLocationId; })[0] || cfg.locations[0];
    var params = new URLSearchParams({
      latitude: loc.lat, longitude: loc.lon,
      current: 'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      hourly: 'soil_moisture_0_to_1cm',
      daily: 'et0_fao_evapotranspiration',
      timezone: 'auto', forecast_days: '1', wind_speed_unit: 'kmh'
    });
    var chipW = document.getElementById('chipWeather');
    var chipS = document.getElementById('chipSoil');
    chipW.querySelector('.chip-label').textContent = loc.name + ' · now';

    return fetch(cfg.weather.endpoint + '?' + params.toString())
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (raw) {
        var c = raw.current;
        setText('temp', Math.round(c.temperature_2m));
        setText('cond', (WMO[c.weather_code] || 'Cloud') + ' · ' + Math.round(c.relative_humidity_2m) + '% humidity · ' + Math.round(c.wind_speed_10m) + ' km/h');

        var now = Date.now();
        var idx = 0;
        (raw.hourly.time || []).some(function (t, i) { if (new Date(t).getTime() >= now) { idx = i; return true; } return false; });
        var sm = raw.hourly.soil_moisture_0_to_1cm[idx];
        setText('soil', sm != null ? (sm * 100).toFixed(0) : '—');
        var et0 = raw.daily.et0_fao_evapotranspiration[0];
        setText('et0', 'ET₀ ' + (et0 != null ? et0.toFixed(1) : '—') + ' mm/day · Open-Meteo, live');
      })
      .catch(function (err) {
        chipW.setAttribute('data-state', 'error');
        chipS.setAttribute('data-state', 'error');
        setText('cond', 'Forecast unreachable — ' + err.message);
        setText('et0', 'Open-Meteo did not answer');
        throw err;
      });
  }

  /* ---------- price ---------- */

  function loadPrice() {
    var snap = NS.pricesSnapshot;
    var chip = document.getElementById('chipPrice');
    if (!snap || !snap.series) {
      chip.setAttribute('data-state', 'error');
      setText('priceSub', 'No price snapshot bundled');
      return false;
    }
    // Rice (local) is the cleanest series: a real grain price, no proxy.
    var name = snap.series['Rice (local)'] ? 'Rice (local)' : Object.keys(snap.series)[0];
    var s = snap.series[name];
    var complete = s.points.filter(function (p) { return p.n >= (snap.minMarkets || 4); });
    var last = complete[complete.length - 1];
    var prev = complete[complete.length - 2];
    if (!last) return false;

    var d = new Date(Number(last.m.slice(0, 4)), Number(last.m.slice(5, 7)) - 1, 15);
    var change = prev ? (last.p - prev.p) / prev.p : 0;
    setText('priceLabel', name + ' · WFP');
    setText('price', Math.round(last.p).toLocaleString('en-NG'));
    setText('priceSub', d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) + ' · ' + last.n + ' markets · ' +
      (change >= 0 ? '+' : '') + (change * 100).toFixed(1) + '% m/m');
    return true;
  }

  /* ---------- harvest ---------- */

  function loadHarvest() {
    var soonest = null;
    cfg.plantings.forEach(function (p) {
      var crop = cfg.crops[p.cropId];
      var days = crop.maturityDays[0] - p.plantedDaysAgo;
      if (!soonest || days < soonest.days) soonest = { crop: crop, field: p.field, days: days, close: crop.maturityDays[1] - p.plantedDaysAgo };
    });
    if (!soonest) return;
    var when = soonest.days <= 0 ? 'ready now' : soonest.days === 1 ? 'ready tomorrow' : 'ready in ' + soonest.days + ' days';
    setText('harvest', soonest.crop.name + ' · ' + soonest.field);
    setText('harvestSub', when.charAt(0).toUpperCase() + when.slice(1) + ' · window closes in ' + soonest.close + ' days');
  }

  /* ---------- boot ---------- */

  var status = document.getElementById('topStatus');
  var priceOk = loadPrice();
  loadHarvest();
  loadWeather().then(function () {
    status.innerHTML = '<span class="dot"></span> Live feeds connected';
  }).catch(function () {
    status.setAttribute('data-state', 'error');
    status.innerHTML = '<span class="dot"></span> Weather offline' + (priceOk ? ' · prices from snapshot' : '');
  });
})(window.AgroSense);
