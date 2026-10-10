/**
 * AgroSense - chart layer
 * ---------------------------------------------------------------
 * All Chart.js configuration lives here. Two rules shape it:
 *
 *  1. Charts are created once and updated in place. A dashboard that
 *     destroys and rebuilds a canvas every four seconds flickers and
 *     throws away the hover state the reader was using.
 *  2. No chart carries two y-axes. Where two measures have different
 *     scales - temperature and rainfall - they get two charts.
 *
 * Colours are read from the stylesheet at boot so the palette has a
 * single source of truth in css/styles.css.
 */
(function (NS) {
  'use strict';

  var fmt = NS.fmt;
  var instances = {};
  var ink = {};

  function readToken(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  function loadTokens() {
    ink = {
      surface: readToken('--surface', '#ffffff'),
      grid: readToken('--chart-grid', '#e6e8de'),
      axis: readToken('--chart-axis', '#c3c2b7'),
      muted: readToken('--ink-muted', '#8a8d80'),
      secondary: readToken('--ink-secondary', '#54584c'),
      primary: readToken('--ink-primary', '#171a13'),
      accent: readToken('--canopy-600', '#1f6a45'),
      tooltipBg: readToken('--soil-900', '#241a12')
    };
  }

  var SANS = "'Jost', system-ui, -apple-system, 'Segoe UI', sans-serif";
  var MONO = "'Jost', system-ui, -apple-system, 'Segoe UI', sans-serif";

  /* ---------- shared option builders ---------- */

  function baseOptions() {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 8, right: 8, bottom: 0, left: 0 } },
      plugins: {
        legend: { display: false },
        tooltip: tooltipStyle()
      }
    };
  }

  function tooltipStyle(extra) {
    return Object.assign({
      backgroundColor: ink.tooltipBg,
      titleFont: { family: SANS, size: 12, weight: '600' },
      bodyFont: { family: MONO, size: 12 },
      padding: 10,
      cornerRadius: 8,
      displayColors: true,
      boxWidth: 8,
      boxHeight: 8,
      boxPadding: 5,
      borderColor: 'rgba(255,255,255,0.12)',
      borderWidth: 1
    }, extra || {});
  }

  function categoryAxis(opts) {
    return Object.assign({
      grid: { display: false, drawTicks: false },
      border: { color: ink.axis, width: 1 },
      ticks: {
        color: ink.muted,
        font: { family: SANS, size: 11 },
        maxRotation: 0,
        autoSkipPadding: 16,
        padding: 6
      }
    }, opts || {});
  }

  function valueAxis(opts) {
    return Object.assign({
      grid: { color: ink.grid, drawTicks: false, lineWidth: 1 },
      border: { display: false },
      ticks: {
        color: ink.muted,
        font: { family: MONO, size: 11 },
        padding: 8,
        maxTicksLimit: 6
      }
    }, opts || {});
  }

  /* ---------- a plugin that labels the last point of a single series ---------- */

  var endLabel = {
    id: 'endLabel',
    afterDatasetsDraw: function (chart, args, opts) {
      if (!opts || !opts.enabled) return;
      var meta = chart.getDatasetMeta(0);
      var point = meta.data[meta.data.length - 1];
      if (!point) return;

      var ctx = chart.ctx;
      var text = opts.text || '';
      ctx.save();
      ctx.font = '600 12px ' + MONO;
      var w = ctx.measureText(text).width;
      var x = Math.min(point.x + 10, chart.chartArea.right - w - 10);
      var y = Math.max(point.y - 14, chart.chartArea.top + 12);

      ctx.fillStyle = opts.background || ink.accent;
      roundRect(ctx, x - 6, y - 12, w + 12, 20, 6);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x, y + 2);
      ctx.restore();
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* ---------- gradient fill for the hero area chart ---------- */

  function areaFill(ctx, area, hex) {
    if (!area) return hexToRgba(hex, 0.12);
    var g = ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, hexToRgba(hex, 0.22));
    g.addColorStop(1, hexToRgba(hex, 0.01));
    return g;
  }

  function hexToRgba(hex, alpha) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')';
  }

  /* =====================================================================
     1. Portfolio value - single-series area line
     ===================================================================== */

  /**
   * `opts.on` names the surface the chart is drawn on. The cockpit paints
   * this one on the green value card, where an accent-coloured line would
   * disappear, so everything flips to white there.
   */
  function portfolioValue(canvas, history, opts) {
    opts = opts || {};
    var onAccent = opts.on === 'accent';
    var line = onAccent ? '#ffffff' : ink.accent;
    var axisInk = onAccent ? 'rgba(255,255,255,0.7)' : ink.muted;
    var gridInk = onAccent ? 'rgba(255,255,255,0.18)' : ink.grid;
    var ring = onAccent ? 'rgba(255,255,255,0.9)' : ink.surface;
    var labelBg = onAccent ? 'rgba(255,255,255,0.22)' : ink.accent;

    var labels = history.points.map(function (p) { return fmt.monthYear(p.t); });
    var values = history.points.map(function (p) { return p.value; });

    if (instances.portfolio) {
      instances.portfolio.data.labels = labels;
      instances.portfolio.data.datasets[0].data = values;
      instances.portfolio.options.plugins.endLabel.text = fmt.moneyShort(values[values.length - 1]);
      instances.portfolio.update('none');
      return instances.portfolio;
    }

    var options = baseOptions();
    if (opts.bare) options.layout = { padding: { top: 10, right: 46, bottom: 0, left: 0 } };
    options.scales = {
      x: categoryAxis({
        display: !opts.bare,
        ticks: { color: axisInk, font: { family: SANS, size: 10 }, maxRotation: 0, autoSkipPadding: 20, padding: 4 },
        border: { color: gridInk, width: 1 }
      }),
      y: valueAxis({
        display: !opts.bare,
        grid: { color: gridInk, drawTicks: false, lineWidth: 1 },
        ticks: {
          color: axisInk, font: { family: MONO, size: 10 }, padding: 6, maxTicksLimit: 4,
          callback: function (v) { return fmt.moneyShort(v); }
        }
      })
    };
    options.plugins.tooltip = tooltipStyle({
      displayColors: false,
      callbacks: {
        title: function (items) { return items[0].label; },
        label: function (item) { return fmt.money(item.parsed.y); }
      }
    });
    options.plugins.endLabel = {
      enabled: true,
      text: fmt.moneyShort(values[values.length - 1]),
      background: labelBg
    };

    instances.portfolio = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Estimated market value',
          data: values,
          borderColor: line,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: line,
          pointHoverBorderColor: ring,
          pointHoverBorderWidth: 2,
          tension: 0.25,
          fill: true,
          backgroundColor: function (c) { return areaFill(c.chart.ctx, c.chart.chartArea, line); }
        }]
      },
      options: options,
      plugins: [endLabel]
    });
    return instances.portfolio;
  }

  /* =====================================================================
     2. Market trends - one line per crop
     ===================================================================== */

  function instrument(id) {
    return NS.market.instruments.filter(function (i) { return i.id === id; })[0];
  }

  function marketTrend(canvas, ids, months, key) {
    key = key || 'market';
    var series = ids.map(function (id) {
      return { inst: instrument(id), points: NS.market.getSeries(id, months) };
    }).filter(function (s) { return s.inst; });
    if (!series.length) return null;

    var labels = series[0].points.map(function (p) { return fmt.monthYear(p.t); });
    var datasets = series.map(function (s) {
      return {
        label: s.inst.name + (s.points.mode === 'modelled' ? ' (modelled)' : s.points.mode === 'proxy' ? ' (proxy)' : ''),
        cropId: s.inst.id,
        data: s.points.map(function (p) { return p.close; }),
        borderColor: s.inst.color,
        backgroundColor: s.inst.color,
        borderWidth: 2,
        // A modelled line is a different kind of claim from a measured one.
        borderDash: s.points.mode === 'modelled' ? [5, 4] : [],
        pointRadius: 0,
        pointHoverRadius: 5,
        pointHoverBorderColor: ink.surface,
        pointHoverBorderWidth: 2,
        tension: 0.2,
        fill: false
      };
    });

    if (instances[key]) {
      instances[key].data.labels = labels;
      instances[key].data.datasets = datasets;
      instances[key].update('none');
      return instances[key];
    }

    var options = baseOptions();
    options.scales = {
      x: categoryAxis(),
      y: valueAxis({
        ticks: Object.assign(valueAxis().ticks, {
          callback: function (v) { return '₦' + NS.fmt.number(v); }
        })
      })
    };
    options.plugins.tooltip = tooltipStyle({
      callbacks: {
        label: function (item) {
          var inst = instrument(item.dataset.cropId);
          return item.dataset.label + '  ' + fmt.price(item.parsed.y) + '/' + (inst ? inst.unit : 'kg');
        }
      }
    });

    instances[key] = new Chart(canvas, { type: 'line', data: { labels: labels, datasets: datasets }, options: options });
    return instances[key];
  }

  /* =====================================================================
     3. Inventory mix - value composition doughnut
     ===================================================================== */

  function inventoryMix(canvas, cropRows, key) {
    key = key || 'mix';
    var labels = cropRows.map(function (r) { return r.name; });
    var values = cropRows.map(function (r) { return r.marketValue; });
    var colors = cropRows.map(function (r) { return r.color; });

    if (instances[key]) {
      instances[key].data.labels = labels;
      instances[key].data.datasets[0].data = values;
      instances[key].data.datasets[0].backgroundColor = colors;
      instances[key].update('none');
      return instances[key];
    }

    var total = values.reduce(function (a, b) { return a + b; }, 0);
    var options = baseOptions();
    options.cutout = '62%';
    options.interaction = { mode: 'nearest', intersect: true };
    options.plugins.tooltip = tooltipStyle({
      callbacks: {
        label: function (item) {
          var share = total ? item.parsed / total : 0;
          return '  ' + fmt.money(item.parsed) + '  ·  ' + fmt.pct(share, 1);
        }
      }
    });

    instances[key] = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: values,
          backgroundColor: colors,
          // A 2px ring in the surface colour is the gap between segments,
          // not a border drawn around them.
          borderColor: ink.surface,
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: options
    });
    return instances[key];
  }

  /* =====================================================================
     4. Value against cost - grouped horizontal bars
     ===================================================================== */

  function valueVsCost(canvas, cropRows) {
    var labels = cropRows.map(function (r) { return r.name; });
    var market = cropRows.map(function (r) { return r.marketValue; });
    var cost = cropRows.map(function (r) { return r.costValue; });

    if (instances.valueCost) {
      instances.valueCost.data.labels = labels;
      instances.valueCost.data.datasets[0].data = market;
      instances.valueCost.data.datasets[1].data = cost;
      instances.valueCost.update('none');
      return instances.valueCost;
    }

    var options = baseOptions();
    options.indexAxis = 'y';
    options.scales = {
      x: valueAxis({
        ticks: Object.assign(valueAxis().ticks, {
          callback: function (v) { return fmt.moneyShort(v); }
        })
      }),
      y: categoryAxis({
        ticks: { color: ink.secondary, font: { family: SANS, size: 12, weight: '500' }, padding: 8 }
      })
    };
    options.plugins.tooltip = tooltipStyle({
      callbacks: {
        label: function (item) { return item.dataset.label + '  ' + fmt.money(item.parsed.x); }
      }
    });

    instances.valueCost = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Market value today',
            data: market,
            backgroundColor: ink.accent,
            borderRadius: 4,
            borderSkipped: 'start',
            // 2px of surface between the two bars in each group.
            borderColor: ink.surface,
            borderWidth: { top: 0, bottom: 1, left: 0, right: 0 }
          },
          {
            label: 'Cost to produce',
            data: cost,
            backgroundColor: readToken('--husk-400', '#c9cfbd'),
            borderRadius: 4,
            borderSkipped: 'start',
            borderColor: ink.surface,
            borderWidth: { top: 1, bottom: 0, left: 0, right: 0 }
          }
        ]
      },
      options: options
    });
    return instances.valueCost;
  }

  /* =====================================================================
     5 & 6. Forecast - temperature and rainfall as two charts, never two axes
     ===================================================================== */

  function forecastTemp(canvas, daily) {
    var labels = daily.map(function (d) { return d.label; });
    var high = daily.map(function (d) { return d.tempMax; });
    var low = daily.map(function (d) { return d.tempMin; });

    if (instances.temp) {
      instances.temp.data.labels = labels;
      instances.temp.data.datasets[0].data = high;
      instances.temp.data.datasets[1].data = low;
      instances.temp.update('none');
      return instances.temp;
    }

    var options = baseOptions();
    options.scales = {
      x: categoryAxis(),
      y: valueAxis({
        ticks: Object.assign(valueAxis().ticks, {
          callback: function (v) { return v + '°'; }
        })
      })
    };
    options.plugins.tooltip = tooltipStyle({
      callbacks: {
        label: function (item) { return item.dataset.label + '  ' + Math.round(item.parsed.y) + '°C'; }
      }
    });

    var warm = readToken('--laterite-500', '#c2562c');
    var cool = readToken('--series-1', '#2a78d6');

    instances.temp = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Daytime high', data: high,
            borderColor: warm,
            // Fills to the "night low" series, so this is the day's range as a
            // band. It has to stay a wash - a saturated block would swallow
            // the low line underneath it.
            backgroundColor: hexToRgba(warm, 0.13),
            borderWidth: 2, tension: 0.3,
            pointRadius: 4, pointHoverRadius: 6,
            pointBackgroundColor: warm, pointBorderColor: ink.surface, pointBorderWidth: 2,
            fill: '+1'
          },
          {
            label: 'Night low', data: low,
            borderColor: cool, backgroundColor: hexToRgba(cool, 0.08),
            borderWidth: 2, tension: 0.3,
            pointRadius: 4, pointHoverRadius: 6,
            pointBackgroundColor: cool, pointBorderColor: ink.surface, pointBorderWidth: 2,
            fill: false
          }
        ]
      },
      options: options
    });
    return instances.temp;
  }

  function forecastRain(canvas, daily) {
    var labels = daily.map(function (d) { return d.label; });
    var mm = daily.map(function (d) { return d.precipSum; });
    var prob = daily.map(function (d) { return d.precipProb; });

    if (instances.rain) {
      instances.rain.data.labels = labels;
      instances.rain.data.datasets[0].data = mm;
      instances.rain.$prob = prob;
      instances.rain.update('none');
      return instances.rain;
    }

    var options = baseOptions();
    options.scales = {
      x: categoryAxis(),
      y: valueAxis({
        beginAtZero: true,
        ticks: Object.assign(valueAxis().ticks, {
          callback: function (v) { return v + ' mm'; }
        })
      })
    };
    options.plugins.tooltip = tooltipStyle({
      displayColors: false,
      callbacks: {
        label: function (item) {
          var p = (item.chart.$prob || [])[item.dataIndex];
          return item.parsed.y.toFixed(1) + ' mm' + (p != null ? '  ·  ' + p + '% chance' : '');
        }
      }
    });

    var rainBlue = readToken('--series-1', '#2a78d6');

    instances.rain = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Rainfall',
          data: mm,
          backgroundColor: rainBlue,
          borderRadius: 4,
          borderSkipped: false,
          barPercentage: 0.62,
          categoryPercentage: 0.8
        }]
      },
      options: options
    });
    instances.rain.$prob = prob;
    return instances.rain;
  }

  /* =====================================================================
     7. Soil water deficit against the refill point, per zone
     ===================================================================== */

  function waterDeficit(canvas, zones) {
    var labels = zones.map(function (z) { return z.id + ' · ' + z.crop.name; });
    var deficit = zones.map(function (z) { return z.balance.deficit; });
    var raw = zones.map(function (z) { return z.balance.raw; });

    if (instances.deficit) {
      instances.deficit.data.labels = labels;
      instances.deficit.data.datasets[0].data = deficit;
      instances.deficit.data.datasets[1].data = raw;
      instances.deficit.update('none');
      return instances.deficit;
    }

    var options = baseOptions();
    options.indexAxis = 'y';
    options.scales = {
      x: valueAxis({
        beginAtZero: true,
        ticks: Object.assign(valueAxis().ticks, {
          callback: function (v) { return v + ' mm'; }
        })
      }),
      y: categoryAxis({
        ticks: { color: ink.secondary, font: { family: SANS, size: 11, weight: '500' }, padding: 8 }
      })
    };
    options.plugins.tooltip = tooltipStyle({
      callbacks: {
        label: function (item) { return item.dataset.label + '  ' + item.parsed.x.toFixed(1) + ' mm'; }
      }
    });

    instances.deficit = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Current deficit',
            data: deficit,
            backgroundColor: readToken('--series-2', '#eb6834'),
            borderRadius: 4,
            borderSkipped: 'start',
            borderColor: ink.surface,
            borderWidth: { top: 0, bottom: 1, left: 0, right: 0 }
          },
          {
            label: 'Refill point',
            data: raw,
            backgroundColor: readToken('--series-1', '#2a78d6'),
            borderRadius: 4,
            borderSkipped: 'start',
            borderColor: ink.surface,
            borderWidth: { top: 1, bottom: 0, left: 0, right: 0 }
          }
        ]
      },
      options: options
    });
    return instances.deficit;
  }

  /* =====================================================================
     8. Degree-day accumulation toward the next pest generation
     ---------------------------------------------------------------------
     Two datasets rather than one dashed line: measured days and forecast
     days are different kinds of claim, and the legend should say so. The
     forecast arm is dashed because it genuinely is a projection.
     ===================================================================== */

  function degreeDays(canvas, dd, pestName, threshold) {
    var labels = dd.series.map(function (p) { return p.label; });
    var splitAt = dd.series.findIndex(function (p) { return p.projected; });
    if (splitAt < 0) splitAt = dd.series.length;

    var measured = dd.series.map(function (p, i) { return i < splitAt ? p.value : null; });
    // Repeat the join value so the two lines meet instead of leaving a gap.
    var projected = dd.series.map(function (p, i) { return i >= splitAt - 1 ? p.value : null; });
    var line = dd.series.map(function () { return threshold; });

    if (instances.degreeDays) {
      instances.degreeDays.data.labels = labels;
      instances.degreeDays.data.datasets[0].data = measured;
      instances.degreeDays.data.datasets[1].data = projected;
      instances.degreeDays.data.datasets[2].data = line;
      instances.degreeDays.data.datasets[2].label = pestName + ' generation threshold';
      instances.degreeDays.update('none');
      return instances.degreeDays;
    }

    var options = baseOptions();
    options.scales = {
      x: categoryAxis(),
      y: valueAxis({
        ticks: Object.assign(valueAxis().ticks, {
          callback: function (v) { return NS.fmt.number(v) + ' DD'; }
        })
      })
    };
    options.plugins.tooltip = tooltipStyle({
      callbacks: {
        label: function (item) {
          if (item.datasetIndex === 2) return 'Threshold  ' + NS.fmt.number(item.parsed.y) + ' DD';
          return item.dataset.label + '  ' + NS.fmt.number(item.parsed.y) + ' DD';
        }
      }
    });

    var warm = readToken('--series-2', '#eb6834');
    var cool = readToken('--series-1', '#2a78d6');

    instances.degreeDays = new Chart(canvas, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Accumulated', data: measured,
            borderColor: cool, borderWidth: 2, tension: 0.2,
            pointRadius: 0, pointHoverRadius: 5,
            pointHoverBorderColor: ink.surface, pointHoverBorderWidth: 2,
            backgroundColor: function (c) { return areaFill(c.chart.ctx, c.chart.chartArea, cool); },
            fill: true
          },
          {
            label: 'Forecast', data: projected,
            borderColor: cool, borderWidth: 2, borderDash: [4, 4], tension: 0.2,
            pointRadius: 0, pointHoverRadius: 5,
            pointHoverBorderColor: ink.surface, pointHoverBorderWidth: 2,
            fill: false
          },
          {
            label: pestName + ' generation threshold', data: line,
            borderColor: warm, borderWidth: 1.5, tension: 0,
            pointRadius: 0, pointHoverRadius: 0, fill: false
          }
        ]
      },
      options: options
    });
    return instances.degreeDays;
  }

  /* =====================================================================
     Sparklines - plain canvas, no Chart.js. Six of these redraw on every
     tick, so they stay as cheap as possible.
     ===================================================================== */

  function sparkline(canvas, values, color) {
    if (!canvas || !values || values.length < 2) return;

    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth || 96;
    var h = canvas.clientHeight || 28;

    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    var span = max - min || 1;
    var pad = 3;
    var stepX = (w - pad * 2) / (values.length - 1);

    function px(i) { return pad + i * stepX; }
    function py(v) { return pad + (1 - (v - min) / span) * (h - pad * 2); }

    // Area under the line, then the line itself.
    ctx.beginPath();
    ctx.moveTo(px(0), h);
    for (var i = 0; i < values.length; i++) ctx.lineTo(px(i), py(values[i]));
    ctx.lineTo(px(values.length - 1), h);
    ctx.closePath();
    ctx.fillStyle = hexToRgba(color, 0.10);
    ctx.fill();

    ctx.beginPath();
    for (var j = 0; j < values.length; j++) {
      if (j === 0) ctx.moveTo(px(j), py(values[j]));
      else ctx.lineTo(px(j), py(values[j]));
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // The live end of the series gets a dot with a surface ring.
    var lastX = px(values.length - 1), lastY = py(values[values.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ink.surface;
    ctx.stroke();
  }

  /* ---------- boot ---------- */

  NS.charts = {
    init: function () {
      loadTokens();
      if (typeof Chart === 'undefined') return false;

      Chart.defaults.font.family = SANS;
      Chart.defaults.font.size = 12;
      Chart.defaults.color = ink.muted;
      Chart.defaults.animation.duration = 320;
      Chart.defaults.plugins.tooltip.rtl = false;
      return true;
    },
    portfolioValue: portfolioValue,
    marketTrend: marketTrend,
    inventoryMix: inventoryMix,
    valueVsCost: valueVsCost,
    forecastTemp: forecastTemp,
    forecastRain: forecastRain,
    waterDeficit: waterDeficit,
    degreeDays: degreeDays,
    sparkline: sparkline,
    instances: instances
  };
})(window.AgroSense);
