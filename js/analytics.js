/**
 * AgroSense - inventory analytics
 * ---------------------------------------------------------------
 * The layer that joins physical stock to live prices. Everything the
 * dashboard claims about money is computed here, from three inputs:
 * the lots in config.inventory, the live quotes from the market
 * service, and the clock.
 *
 * Estimated market value is the headline: quantity on hand x today's
 * price, summed over every lot. Around it sit the numbers that make
 * that figure actionable - margin over cost, how much of it is sitting
 * on perishable stock, and how it has moved as prices moved.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var DAY_MS = 86400000;

  /* ---------- spoilage ---------- */

  /**
   * How much of a lot's value is exposed if it is not moved.
   * Deliberately coarse - a farmer wants a flag, not a decimal.
   */
  function spoilage(daysRemaining) {
    if (daysRemaining <= 0)  return { factor: 1.00, level: 'critical', label: 'Past its window' };
    if (daysRemaining <= 2)  return { factor: 0.50, level: 'critical', label: 'Move immediately' };
    if (daysRemaining <= 5)  return { factor: 0.25, level: 'serious',  label: 'Sell this week' };
    if (daysRemaining <= 10) return { factor: 0.10, level: 'warning',  label: 'Watch closely' };
    return { factor: 0, level: 'ok', label: 'Stable in store' };
  }

  /* ---------- lot valuation ---------- */

  /**
   * Enrich every lot with its live value. Returns a new array; the
   * config data is never mutated.
   *
   * `constraints` maps a field to a rule that stops its produce being sold —
   * in practice a pre-harvest interval from the pest module. Analytics does
   * not know what a pesticide is; it only knows this block cannot be sold
   * for N more days, which is enough to price the consequence.
   */
  function valueLots(quotes, constraints) {
    var now = Date.now();
    var blocks = constraints || {};

    return cfg.inventory.map(function (lot) {
      var crop = cfg.crops[lot.cropId];
      var quote = quotes[lot.cropId];
      var price = quote ? quote.price : crop.basePrice;

      var harvestedOn = new Date(now - lot.harvestedDaysAgo * DAY_MS);
      var daysInStore = lot.harvestedDaysAgo;
      var daysRemaining = crop.shelfLifeDays - daysInStore;
      var risk = spoilage(daysRemaining);

      var marketValue = lot.quantityKg * price;
      var costValue = lot.quantityKg * lot.costPerKg;
      var margin = marketValue - costValue;

      // A sale block and a shelf life running out at the same time is the
      // expensive case: the produce spoils before it is legal to sell.
      var block = blocks[lot.field] || null;
      var stranded = !!(block && block.daysRemaining >= daysRemaining);

      return {
        id: lot.id,
        cropId: lot.cropId,
        cropName: crop.name,
        color: crop.color,
        field: lot.field,
        grade: lot.grade,
        store: crop.store,
        quantityKg: lot.quantityKg,

        harvestedOn: harvestedOn,
        daysInStore: daysInStore,
        shelfLifeDays: crop.shelfLifeDays,
        daysRemaining: daysRemaining,
        freshness: Math.max(0, Math.min(1, daysRemaining / crop.shelfLifeDays)),
        risk: risk,

        price: price,
        costPerKg: lot.costPerKg,
        marketValue: marketValue,
        costValue: costValue,
        margin: margin,
        marginPct: costValue ? margin / costValue : 0,
        valueAtRisk: marketValue * risk.factor,

        changePct: quote ? quote.changePct : 0,
        signal: quote ? quote.signal : null,

        blocked: !!block,
        blockedFor: block ? block.daysRemaining : 0,
        blockReason: block ? block.reason : null,
        blockDetail: block ? block.detail : null,
        clearsOn: block ? block.clearsOn : null,
        stranded: stranded,
        strandedValue: stranded ? marketValue : 0
      };
    });
  }

  /* ---------- aggregation ---------- */

  /** Roll lots up to one row per crop - what the pie and the bar chart show. */
  function byCrop(lots) {
    var map = {};

    lots.forEach(function (lot) {
      var row = map[lot.cropId];
      if (!row) {
        row = map[lot.cropId] = {
          cropId: lot.cropId,
          name: lot.cropName,
          color: lot.color,
          quantityKg: 0,
          marketValue: 0,
          costValue: 0,
          valueAtRisk: 0,
          lots: 0,
          price: lot.price,
          changePct: lot.changePct,
          signal: lot.signal,
          worstRisk: 'ok',
          soonestExpiry: Infinity,
          blockedValue: 0,
          strandedValue: 0,
          blockedFor: 0,
          blockDetail: null
        };
      }
      row.quantityKg += lot.quantityKg;
      row.marketValue += lot.marketValue;
      row.costValue += lot.costValue;
      row.valueAtRisk += lot.valueAtRisk;
      row.lots += 1;
      row.soonestExpiry = Math.min(row.soonestExpiry, lot.daysRemaining);
      if (RISK_RANK[lot.risk.level] < RISK_RANK[row.worstRisk]) row.worstRisk = lot.risk.level;

      if (lot.blocked) {
        row.blockedValue += lot.marketValue;
        row.strandedValue += lot.strandedValue;
        if (lot.blockedFor > row.blockedFor) {
          row.blockedFor = lot.blockedFor;
          row.blockDetail = lot.blockDetail;
        }
      }
    });

    return Object.keys(map).map(function (id) {
      var row = map[id];
      row.margin = row.marketValue - row.costValue;
      row.marginPct = row.costValue ? row.margin / row.costValue : 0;
      row.avgCostPerKg = row.quantityKg ? row.costValue / row.quantityKg : 0;
      return row;
    }).sort(function (a, b) { return b.marketValue - a.marketValue; });
  }

  var RISK_RANK = { critical: 0, serious: 1, warning: 2, ok: 3 };

  /* ---------- portfolio ---------- */

  function summary(lots, cropRows) {
    var totalValue = 0, totalCost = 0, totalKg = 0, atRisk = 0;
    var blockedValue = 0, strandedValue = 0, blockedLots = 0;

    lots.forEach(function (lot) {
      totalValue += lot.marketValue;
      totalCost += lot.costValue;
      totalKg += lot.quantityKg;
      atRisk += lot.valueAtRisk;
      if (lot.blocked) {
        blockedValue += lot.marketValue;
        strandedValue += lot.strandedValue;
        blockedLots += 1;
      }
    });

    var top = cropRows[0];

    return {
      totalValue: totalValue,
      totalCost: totalCost,
      margin: totalValue - totalCost,
      marginPct: totalCost ? (totalValue - totalCost) / totalCost : 0,
      totalKg: totalKg,
      lotCount: lots.length,
      cropCount: cropRows.length,
      valueAtRisk: atRisk,
      atRiskPct: totalValue ? atRisk / totalValue : 0,
      blockedValue: blockedValue,
      blockedLots: blockedLots,
      sellableValue: totalValue - blockedValue,
      strandedValue: strandedValue,
      topCrop: top ? top.name : null,
      concentration: top && totalValue ? top.marketValue / totalValue : 0,
      blendedPricePerKg: totalKg ? totalValue / totalKg : 0
    };
  }

  /**
   * What today's holdings would have been worth at each of the last N
   * months' prices - crops in store and the herd on the hoof.
   *
   * Holdings are held constant deliberately: the question this answers is
   * "what have prices done to the value of what I am sitting on", not
   * "how did the barn fill up". Mixing the two would make a price fall
   * look like a sale.
   */
  function portfolioHistory(months) {
    var matrix = NS.market.getHistoryMatrix(months);
    var ids = Object.keys(matrix);
    if (!ids.length) return { points: [], peak: null, trough: null };

    var length = matrix[ids[0]].length;

    // Kilos held per crop, computed once, plus carcass kilos per product.
    var held = {};
    cfg.inventory.forEach(function (lot) {
      held[lot.cropId] = (held[lot.cropId] || 0) + lot.quantityKg;
    });
    var stock = NS.livestock.holdings();
    Object.keys(stock.quantities).forEach(function (id) {
      held[id] = (held[id] || 0) + stock.quantities[id];
    });

    var points = [];
    for (var i = 0; i < length; i++) {
      var value = stock.bookValue;
      for (var c = 0; c < ids.length; c++) {
        var id = ids[c];
        var close = matrix[id][i].close;
        if (close != null) value += (held[id] || 0) * close;
      }
      points.push({ t: matrix[ids[0]][i].t, month: matrix[ids[0]][i].month, value: value });
    }

    var peak = points[0], trough = points[0];
    points.forEach(function (p) {
      if (p.value > peak.value) peak = p;
      if (p.value < trough.value) trough = p;
    });

    var latest = points[points.length - 1];
    var monthAgo = points[points.length - 2] || latest;
    var yearAgo = points[Math.max(0, points.length - 13)];

    return {
      points: points,
      peak: peak,
      trough: trough,
      latest: latest,
      changeVsMonth: latest.value - monthAgo.value,
      changeVsMonthPct: monthAgo.value ? (latest.value - monthAgo.value) / monthAgo.value : 0,
      changeVsYear: latest.value - yearAgo.value,
      changeVsYearPct: yearAgo.value ? (latest.value - yearAgo.value) / yearAgo.value : 0,
      belowPeak: peak.value - latest.value,
      belowPeakPct: peak.value ? (peak.value - latest.value) / peak.value : 0,
      monthsSincePeak: points.length - 1 - points.indexOf(peak)
    };
  }

  /* ---------- what to sell first ---------- */

  var SIGNAL_SCORE = { sell: 1, soon: 0.7, watch: 0.4, hold: 0.1 };

  /**
   * Rank crops by how urgently they should be moved. Two forces are in
   * play and they often disagree: perishability pushes stock out of the
   * door, a weak price holds it back. The score weights spoilage slightly
   * higher, because a rotten tuber has no price at all.
   */
  function sellPriority(cropRows) {
    return cropRows.map(function (row) {
      var spoilUrgency = Math.max(0, Math.min(1, 1 - row.soonestExpiry / 30));
      var marketUrgency = row.signal ? (SIGNAL_SCORE[row.signal.code] || 0.4) : 0.4;
      var score = spoilUrgency * 0.55 + marketUrgency * 0.45;

      var driver, detail;

      // A sale block overrides both forces: it does not matter what the
      // price is doing if the produce cannot legally leave the farm.
      if (row.strandedValue > 0) {
        // Blocked for longer than the produce will keep. Nothing to sell,
        // and the loss is already booked unless something changes.
        return {
          cropId: row.cropId, name: row.name, color: row.color,
          score: 1.2,                       // above every ordinary item
          driver: 'Will spoil before it can be sold',
          detail: NS.fmt.money(row.strandedValue) + ' of ' + row.name.toLowerCase() +
                  ' is inside a pre-harvest interval with ' + Math.round(row.blockedFor) +
                  ' days left to run, but only ' + NS.fmt.days(row.soonestExpiry) +
                  ' in store. ' + (row.blockDetail || ''),
          quantityKg: row.quantityKg, marketValue: row.marketValue,
          valueAtRisk: row.strandedValue, signal: row.signal,
          daysRemaining: row.soonestExpiry, level: 'critical', blocked: true
        };
      }

      if (row.blockedValue > 0) {
        return {
          cropId: row.cropId, name: row.name, color: row.color,
          score: score * 0.1,
          driver: 'Sale blocked for ' + Math.round(row.blockedFor) + ' more days',
          detail: NS.fmt.money(row.blockedValue) + ' cannot be sold yet. ' +
                  (row.blockDetail || '') + '. It keeps in store, so the wait costs nothing but time.',
          quantityKg: row.quantityKg, marketValue: row.marketValue,
          valueAtRisk: row.valueAtRisk, signal: row.signal,
          daysRemaining: row.soonestExpiry, level: row.worstRisk, blocked: true
        };
      }

      if (spoilUrgency > 0.7 && marketUrgency >= 0.7) {
        driver = 'Perishable and the price is strong';
        detail = 'Both reasons point the same way. ' + NS.fmt.mass(row.quantityKg) + ' of ' +
                 row.name.toLowerCase() + ' with ' + NS.fmt.days(row.soonestExpiry) +
                 ', priced above its 12-month average.';
      } else if (spoilUrgency > 0.7) {
        driver = 'Perishable, price is not helping';
        detail = NS.fmt.days(row.soonestExpiry) + ' on the oldest lot. ' +
                 NS.fmt.money(row.valueAtRisk) + ' of value is exposed if it sits, which outweighs waiting for a better price.';
      } else if (marketUrgency >= 0.7) {
        driver = 'Price window is open';
        detail = row.name + ' is trading at ' + NS.fmt.price(row.price) + '/kg. ' +
                 (row.signal ? row.signal.reason : '');
      } else if (marketUrgency <= 0.1) {
        driver = 'Hold - stock is stable';
        detail = 'Nothing forces a sale. ' + (row.signal ? row.signal.reason : '');
      } else {
        driver = 'No pressure either way';
        detail = 'Stable in store with ' + NS.fmt.days(row.soonestExpiry) + '. Watch the price.';
      }

      return {
        cropId: row.cropId,
        name: row.name,
        color: row.color,
        score: score,
        driver: driver,
        detail: detail,
        quantityKg: row.quantityKg,
        marketValue: row.marketValue,
        valueAtRisk: row.valueAtRisk,
        signal: row.signal,
        daysRemaining: row.soonestExpiry,
        level: row.worstRisk,
        blocked: false
      };
    }).sort(function (a, b) { return b.score - a.score; });
  }

  /* ---------- one call for the whole picture ---------- */

  function snapshot(quotes, constraints) {
    var lots = valueLots(quotes, constraints);
    var crops = byCrop(lots);
    var sum = summary(lots, crops);
    var stock = NS.livestock.value(quotes);

    // The whole farm: crops in store plus the herd, so the cockpit's
    // headline is one number a bank manager would recognise.
    sum.livestockValue = stock.summary.totalValue;
    sum.livestockCost = stock.summary.totalCost;
    sum.livestockHead = stock.summary.head;
    sum.farmValue = sum.totalValue + stock.summary.totalValue;
    sum.farmCost = sum.totalCost + stock.summary.totalCost;
    sum.farmMargin = sum.farmValue - sum.farmCost;
    sum.farmMarginPct = sum.farmCost ? sum.farmMargin / sum.farmCost : 0;

    return {
      lots: lots,
      crops: crops,
      livestock: stock,
      summary: sum,
      priority: sellPriority(crops)
    };
  }

  NS.analytics = {
    spoilage: spoilage,
    valueLots: valueLots,
    byCrop: byCrop,
    summary: summary,
    portfolioHistory: portfolioHistory,
    sellPriority: sellPriority,
    snapshot: snapshot
  };
})(window.AgroSense);
