/**
 * AgroSense — configuration & seed data
 * ---------------------------------------------------------------
 * Everything a deployment needs to change lives in this one file:
 * the farm profile, the coordinates weather is pulled for, the crop
 * and livestock catalogues that drive the price feed, what is planted
 * where, and the physical stock in the barn.
 */
window.AgroSense = window.AgroSense || {};

(function (NS) {
  'use strict';

  /* Categorical series colours.
     Fixed slot order from a CVD-validated palette (worst adjacent ΔE 9.1
     protan / 19.6 normal against a white chart surface). A crop keeps its
     colour for the life of the session — colour follows the entity, never
     its rank in a sorted table. */
  var SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];

  /* Livestock products get a second, muted slot order so they never
     collide with a crop on the same chart. */
  var LIVESTOCK_SERIES = ['#8b5a2b', '#b8860b', '#6b4c9a', '#d2691e', '#c71585', '#2e8b8b'];

  NS.config = {
    farm: {
      name: 'Adegoke Integrated Farms',
      manager: 'Farm Manager',
      initials: 'AF',
      hectares: 118,
      established: 2016
    },

    /* Coordinates the weather service is queried against.
       Open-Meteo needs no key, so any of these work out of the box. */
    locations: [
      { id: 'ibadan',   name: 'Ibadan',       region: 'Oyo State',     lat: 7.3775, lon: 3.9470 },
      { id: 'ogbomoso', name: 'Ogbomoso',     region: 'Oyo State',     lat: 8.1333, lon: 4.2500 },
      { id: 'makurdi',  name: 'Makurdi',      region: 'Benue State',   lat: 7.7322, lon: 8.5391 },
      { id: 'kano',     name: 'Kano',         region: 'Kano State',    lat: 12.0022, lon: 8.5920 },
      { id: 'jos',      name: 'Jos',          region: 'Plateau State', lat: 9.8965, lon: 8.8583 },
      { id: 'abeokuta', name: 'Abeokuta',     region: 'Ogun State',    lat: 7.1475, lon: 3.3619 }
    ],
    defaultLocationId: 'ibadan',

    /**
     * Crop catalogue.
     *  picture     — the sprite symbol (js/icons.js) drawn beside its name.
     *  feed        — which WFP commodity series prices this crop. `proxy`
     *                says when a related product stands in (maize flour
     *                for maize grain). null means no live series exists
     *                and the price is modelled the interface says so.
     *  basePrice   — ₦/kg reference used only when a series is missing.
     *  volatility  — monthly sigma of the modelled walk.
     *  seasonalAmp — amplitude of the annual price cycle, as a fraction.
     *  peakMonth   — month (0-11) the seasonal premium peaks (lean season).
     *  shelfLife   — days the crop holds condition in the store it uses.
     *  kc          — FAO-56 mid-season crop coefficient. Water use is
     *                ETc = ET0 x Kc.
     *  maturityDays — [earliest, latest] days from planting to a harvest
     *                window, for the harvest alerts.
     */
    crops: {
      maize:   { id: 'maize',   name: 'Maize', picture: 'p-maize',        unit: 'kg', feed: { commodity: 'Maize flour', proxy: 'Maize flour stands in for grain — WFP Nigeria has published no maize grain series since 2023' },
                 basePrice:  850, volatility: 0.05, seasonalAmp: 0.16, peakMonth: 6,  shelfLifeDays: 240, store: 'Dry crib',    kc: 1.20, maturityDays: [90, 120],  harvestNote: 'Harvest once grain moisture is under 25%, then dry to 13% before bagging.', color: SERIES[0] },
      rice:    { id: 'rice',    name: 'Rice (paddy)', picture: 'p-rice', unit: 'kg', feed: { commodity: 'Rice (local)' },
                 basePrice: 1450, volatility: 0.04, seasonalAmp: 0.12, peakMonth: 5,  shelfLifeDays: 180, store: 'Dry crib',    kc: 1.20, maturityDays: [110, 130], harvestNote: 'Harvest when 80–85% of panicles have turned straw-coloured.', color: SERIES[1] },
      cassava: { id: 'cassava', name: 'Cassava', picture: 'p-cassava',      unit: 'kg', feed: null,
                 basePrice:  520, volatility: 0.06, seasonalAmp: 0.22, peakMonth: 4,  shelfLifeDays: 7,   store: 'Field heap',  kc: 1.10, maturityDays: [270, 365], harvestNote: 'Tubers keep in the ground; lift only what can be sold or processed within a week.', color: SERIES[2] },
      tomato:  { id: 'tomato',  name: 'Tomato', picture: 'p-tomato',       unit: 'kg', feed: { commodity: 'Tomatoes' },
                 basePrice: 1200, volatility: 0.15, seasonalAmp: 0.34, peakMonth: 2,  shelfLifeDays: 12,  store: 'Cool room',   kc: 1.15, maturityDays: [70, 90],   harvestNote: 'Pick at breaker stage for distant markets, fully ripe for local sale.', color: SERIES[3] },
      yam:     { id: 'yam',     name: 'Yam', picture: 'p-yam',          unit: 'kg', feed: { commodity: 'Yam' },
                 basePrice: 1100, volatility: 0.05, seasonalAmp: 0.20, peakMonth: 3,  shelfLifeDays: 90,  store: 'Yam barn',    kc: 1.10, maturityDays: [240, 300], harvestNote: 'Harvest when vines have senesced; cure tubers 4 days before barn storage.', color: SERIES[4] },
      soybean: { id: 'soybean', name: 'Soybean', picture: 'p-soybean',      unit: 'kg', feed: null,
                 basePrice: 1650, volatility: 0.04, seasonalAmp: 0.10, peakMonth: 7,  shelfLifeDays: 300, store: 'Sealed silo', kc: 1.15, maturityDays: [95, 110],  harvestNote: 'Harvest at 95% pod browning — shattering losses climb fast after that.', color: SERIES[5] }
    },

    /**
     * Physical stock on hand. Harvest dates are stored as an age in days
     * rather than a fixed date so the spoilage maths stays truthful no
     * matter when the dashboard is opened.
     *   costPerKg — what the lot cost to grow and put in store. The gap
     *               between this and the live price is the real margin.
     */
    inventory: [
      { id: 'LOT-2411', cropId: 'maize',   quantityKg: 24000, harvestedDaysAgo: 34,  costPerKg: 610,  grade: 'A', field: 'Field A' },
      { id: 'LOT-2418', cropId: 'maize',   quantityKg: 12500, harvestedDaysAgo: 12,  costPerKg: 648,  grade: 'A', field: 'Field A' },
      { id: 'LOT-2402', cropId: 'maize',   quantityKg:  5800, harvestedDaysAgo: 96,  costPerKg: 574,  grade: 'B', field: 'Field G' },
      { id: 'LOT-2390', cropId: 'rice',    quantityKg: 13200, harvestedDaysAgo: 51,  costPerKg: 1105, grade: 'A', field: 'Field D' },
      { id: 'LOT-2421', cropId: 'rice',    quantityKg:  4900, harvestedDaysAgo:  8,  costPerKg: 1188, grade: 'B', field: 'Field D' },
      { id: 'LOT-2426', cropId: 'cassava', quantityKg: 41000, harvestedDaysAgo:  3,  costPerKg: 388,  grade: 'A', field: 'Field C' },
      { id: 'LOT-2427', cropId: 'cassava', quantityKg: 22400, harvestedDaysAgo:  6,  costPerKg: 402,  grade: 'B', field: 'Field C' },
      { id: 'LOT-2429', cropId: 'tomato',  quantityKg:  4500, harvestedDaysAgo:  5,  costPerKg: 1310, grade: 'A', field: 'Field B' },
      { id: 'LOT-2404', cropId: 'yam',     quantityKg: 19000, harvestedDaysAgo: 62,  costPerKg: 742,  grade: 'A', field: 'Field E' },
      { id: 'LOT-2412', cropId: 'yam',     quantityKg:  9300, harvestedDaysAgo: 29,  costPerKg: 795,  grade: 'B', field: 'Field E' },
      { id: 'LOT-2408', cropId: 'soybean', quantityKg: 12000, harvestedDaysAgo: 44,  costPerKg: 1215, grade: 'A', field: 'Field F' }
    ],

    /* Named fields, used by the field strip and to tie alerts to a place. */
    fields: [
      { id: 'Field A', cropId: 'maize',   hectares: 26 },
      { id: 'Field B', cropId: 'tomato',  hectares: 6  },
      { id: 'Field C', cropId: 'cassava', hectares: 31 },
      { id: 'Field D', cropId: 'rice',    hectares: 22 },
      { id: 'Field E', cropId: 'yam',     hectares: 18 },
      { id: 'Field F', cropId: 'soybean', hectares: 15 }
    ],

    /**
     * What is in the ground right now. The harvest alerts work from these:
     * planting age against the crop's maturity window, joined to the
     * forecast (is the window wet?), the market (is the price worth
     * selling straight off the field?) and any pre-harvest interval.
     *   expectedTPerHa  the yield the farm plans on, for the tonnage estimate.
     */
    plantings: [
      { id: 'PL-2601', field: 'Field A', cropId: 'maize',   plantedDaysAgo: 101, hectares: 26, expectedTPerHa: 3.2 },
      { id: 'PL-2602', field: 'Field B', cropId: 'tomato',  plantedDaysAgo:  66, hectares: 6,  expectedTPerHa: 18  },
      { id: 'PL-2603', field: 'Field C', cropId: 'cassava', plantedDaysAgo: 251, hectares: 31, expectedTPerHa: 14  },
      { id: 'PL-2604', field: 'Field D', cropId: 'rice',    plantedDaysAgo:  97, hectares: 22, expectedTPerHa: 3.8 },
      { id: 'PL-2605', field: 'Field E', cropId: 'yam',     plantedDaysAgo: 172, hectares: 18, expectedTPerHa: 11  },
      { id: 'PL-2606', field: 'Field F', cropId: 'soybean', plantedDaysAgo:  89, hectares: 15, expectedTPerHa: 1.6 }
    ],

    /**
     * Harvest alerts.
     *   leadDays  — how far ahead of the window opening the first alert fires.
     *   checkMs   — how often the open dashboard re-evaluates.
     *   wetDayMm  — rain on a harvest day above this makes it a wet day.
     */
    harvest: {
      leadDays: 21,
      checkMs: 60 * 60 * 1000,
      wetDayMm: 8
    },

    /**
     * Livestock.
     *
     * Herds are valued on what they would fetch as product: head x live
     * weight x dressing percentage x the live meat price. Layers are held
     * at book value (they are an income stream, not a carcass) and their
     * egg output is priced separately per day.
     *
     * Each product maps onto a WFP series in the same way crops do.
     */
    livestock: {
      herds: [
        { id: 'HD-01', species: 'cattle',  name: 'Beef cattle',      breed: 'White Fulani',  head: 42,   avgLiveKg: 310, dressing: 0.52, productId: 'beef',    costPerHead: 620000, housing: 'Paddock 1',   ageDays: 700, marketAgeDays: 900 },
        { id: 'HD-02', species: 'goat',    name: 'Goats',            breed: 'West African Dwarf', head: 135, avgLiveKg: 26, dressing: 0.48, productId: 'goat', costPerHead: 38000, housing: 'Goat pens', ageDays: 300, marketAgeDays: 365 },
        { id: 'HD-03', species: 'sheep',   name: 'Sheep',            breed: 'Balami',        head: 60,   avgLiveKg: 38,  dressing: 0.50, productId: 'mutton',  costPerHead: 55000,  housing: 'Sheep pens',  ageDays: 260, marketAgeDays: 365 },
        { id: 'HD-04', species: 'poultry', name: 'Layers',           breed: 'Isa Brown',     head: 2400, avgLiveKg: 1.8, layRate: 0.82,  productId: 'eggs',    costPerHead: 4200,   housing: 'Layer house', ageDays: 300, marketAgeDays: 540 },
        { id: 'HD-05', species: 'poultry', name: 'Broilers',         breed: 'Cobb 500',      head: 1800, avgLiveKg: 2.1, dressing: 0.72, productId: 'chicken', costPerHead: 3600,   housing: 'Broiler house', ageDays: 34, marketAgeDays: 42 },
        { id: 'HD-06', species: 'fish',    name: 'Catfish',          breed: 'Clarias',       head: 6000, avgLiveKg: 0.9, dressing: 1,    productId: 'catfish', costPerHead: 900,    housing: 'Ponds 1–4',   ageDays: 150, marketAgeDays: 180 }
      ],

      products: {
        beef:    { id: 'beef',    name: 'Beef', picture: 'p-cow',         unit: 'kg',  feed: { commodity: 'Meat (beef)' },
                   basePrice: 6800, volatility: 0.04, seasonalAmp: 0.08, peakMonth: 11, color: LIVESTOCK_SERIES[0] },
        goat:    { id: 'goat',    name: 'Goat meat', picture: 'p-goat',    unit: 'kg',  feed: { commodity: 'Meat (goat)' },
                   basePrice: 7400, volatility: 0.04, seasonalAmp: 0.10, peakMonth: 11, color: LIVESTOCK_SERIES[1] },
        mutton:  { id: 'mutton',  name: 'Mutton', picture: 'p-sheep',       unit: 'kg',  feed: { commodity: 'Meat (goat)', proxy: 'Goat meat stands in for mutton — WFP publishes no sheep series for Nigeria' },
                   basePrice: 7400, volatility: 0.04, seasonalAmp: 0.10, peakMonth: 11, color: LIVESTOCK_SERIES[2] },
        eggs:    { id: 'eggs',    name: 'Eggs', picture: 'p-egg',         unit: 'egg', feed: { commodity: 'Eggs' },
                   basePrice: 220,  volatility: 0.03, seasonalAmp: 0.05, peakMonth: 11, color: LIVESTOCK_SERIES[3] },
        chicken: { id: 'chicken', name: 'Chicken (dressed)', picture: 'p-chicken', unit: 'kg', feed: null,
                   basePrice: 4500, volatility: 0.04, seasonalAmp: 0.08, peakMonth: 11, color: LIVESTOCK_SERIES[4] },
        catfish: { id: 'catfish', name: 'Catfish', picture: 'p-fish',      unit: 'kg',  feed: { commodity: 'Fish', proxy: 'WFP’s mixed "Fish" series stands in for catfish' },
                   basePrice: 2400, volatility: 0.05, seasonalAmp: 0.06, peakMonth: 11, color: LIVESTOCK_SERIES[5] }
      },

      /* Health calendar. Due dates are relative so the demo stays current. */
      health: [
        { id: 'HL-01', herdId: 'HD-01', task: 'CBPP vaccination',            dueInDays: 4 },
        { id: 'HL-02', herdId: 'HD-02', task: 'PPR vaccination',             dueInDays: 25 },
        { id: 'HL-03', herdId: 'HD-03', task: 'Deworming (albendazole)',     dueInDays: -2 },
        { id: 'HL-04', herdId: 'HD-04', task: 'Newcastle (LaSota) booster',  dueInDays: 12 },
        { id: 'HL-05', herdId: 'HD-05', task: 'Gumboro booster',             dueInDays: 1 },
        { id: 'HL-06', herdId: 'HD-06', task: 'Water quality check (ammonia)', dueInDays: 3 }
      ],

      /* Feed, ₦ per head per day - what the herd costs to hold. */
      feedCostPerHeadDay: { cattle: 1450, goat: 190, sheep: 230, poultry: 48, fish: 22 }
    },

    /**
     * Irrigation zones.
     * The water balance is FAO-56: a zone's soil holds
     *   TAW = awcMmPerM x rootDepthM  millimetres of usable water,
     * of which the crop can comfortably use the first
     *   RAW = TAW x depletionTrigger  before it starts to suffer.
     * Deficit accumulates as ETc minus effective rainfall, day by day,
     * from the moment the zone was last watered.
     */
    irrigation: {
      waterCostPerM3: 165,        // ₦ per cubic metre, pumping and diesel
      depletionTrigger: 0.5,      // fraction of TAW that is readily available
      rainEffectiveness: 0.75,    // the rest runs off or drains past the roots
      fallbackEt0: 4.2,           // mm/day, used only if the forecast is down
      // A full irrigation run takes hours. The demo clock advances a run at
      // this multiple of real time so a cycle can be watched end to end;
      // the figure is stated in the interface, never hidden.
      simulationSpeed: 60,
      zones: [
        { id: 'ZN-A', field: 'Field A', method: 'Sprinkler', applicationRateMmH: 8,  flowM3H: 46, soil: 'Sandy loam', awcMmPerM: 120, rootDepthM: 0.60, lastRunDaysAgo: 5 },
        { id: 'ZN-B', field: 'Field B', method: 'Drip',      applicationRateMmH: 4,  flowM3H: 11, soil: 'Loam',       awcMmPerM: 160, rootDepthM: 0.40, lastRunDaysAgo: 2 },
        { id: 'ZN-C', field: 'Field C', method: 'Rain-fed',  applicationRateMmH: 0,  flowM3H: 0,  soil: 'Sandy loam', awcMmPerM: 120, rootDepthM: 0.80, lastRunDaysAgo: null },
        { id: 'ZN-D', field: 'Field D', method: 'Flood',     applicationRateMmH: 25, flowM3H: 130, soil: 'Clay loam', awcMmPerM: 180, rootDepthM: 0.50, lastRunDaysAgo: 3 },
        { id: 'ZN-E', field: 'Field E', method: 'Sprinkler', applicationRateMmH: 8,  flowM3H: 34, soil: 'Loam',       awcMmPerM: 160, rootDepthM: 0.70, lastRunDaysAgo: 9 },
        { id: 'ZN-F', field: 'Field F', method: 'Rain-fed',  applicationRateMmH: 0,  flowM3H: 0,  soil: 'Clay loam',  awcMmPerM: 180, rootDepthM: 0.60, lastRunDaysAgo: null }
      ]
    },

    /**
     * Pest and disease programme.
     *
     * Insects are tracked on growing degree days: development is driven by
     * accumulated warmth above a species-specific base temperature, so
     * GDD predicts when the next generation emerges far better than a
     * calendar does. Diseases are tracked on infection conditions instead —
     * a run of hours inside a humidity and temperature band.
     *
     * Every product carries a pre-harvest interval. Spray a block and its
     * produce cannot legally be sold until the interval has run out, which
     * is why treatments feed straight back into the sell priority.
     */
    pests: {
      sprayLimits: { maxWindKmh: 12, maxPrecipProb: 25, maxTempC: 32 },
      watchlist: [
        { id: 'faw',      name: 'Fall armyworm',    cropId: 'maize',   type: 'insect',
          baseTempC: 12, generationDD: 390, ddAtLastScout: 155,
          product: 'Emamectin benzoate', phiDays: 7,  costPerHa: 14500, scoutedDaysAgo: 6 },
        { id: 'blast',    name: 'Rice blast',       cropId: 'rice',    type: 'disease',
          minRh: 89, tempRange: [20, 30], wetHoursTrigger: 10,
          product: 'Tricyclazole',       phiDays: 21, costPerHa: 19800, scoutedDaysAgo: 11 },
        { id: 'mealybug', name: 'Cassava mealybug', cropId: 'cassava', type: 'insect',
          baseTempC: 15, generationDD: 280, ddAtLastScout: 96,
          product: 'Neem + soap drench', phiDays: 3,  costPerHa: 8200,  scoutedDaysAgo: 4 },
        { id: 'blight',   name: 'Tomato late blight', cropId: 'tomato', type: 'disease',
          minRh: 85, tempRange: [10, 26], wetHoursTrigger: 8,
          product: 'Mancozeb',           phiDays: 14, costPerHa: 12400, scoutedDaysAgo: 2 },
        { id: 'beetle',   name: 'Yam beetle',       cropId: 'yam',     type: 'insect',
          baseTempC: 14, generationDD: 450, ddAtLastScout: 210,
          product: 'Chlorpyrifos drench', phiDays: 30, costPerHa: 16700, scoutedDaysAgo: 15 },
        { id: 'rust',     name: 'Soybean rust',     cropId: 'soybean', type: 'disease',
          minRh: 80, tempRange: [15, 28], wetHoursTrigger: 12,
          product: 'Azoxystrobin',       phiDays: 21, costPerHa: 21300, scoutedDaysAgo: 8 }
      ],
      // Treatments already applied. Anything still inside its PHI blocks
      // the sale of produce from that block.
      treatments: [
        { id: 'TR-118', field: 'Field E', pestId: 'beetle', product: 'Chlorpyrifos drench', appliedDaysAgo: 12, phiDays: 30, hectares: 18 },
        { id: 'TR-121', field: 'Field B', pestId: 'blight', product: 'Mancozeb',            appliedDaysAgo: 16, phiDays: 14, hectares: 6 }
      ]
    },

    /**
     * Market prices.
     *
     * The live source is the WFP market price database, served through the
     * HDX Humanitarian API. It is the only free, CORS-open feed of Nigerian
     * food prices; it is monthly, retail, and — at the time of writing —
     * reported from WFP-monitored markets in Borno, Yobe and Adamawa. The
     * dashboard says all of that on the board rather than hiding it.
     *
     *   months       — how much history to request and chart.
     *   minMarkets   — a month counts as complete once this many markets
     *                  have reported. The newest month is usually partial.
     *   farmgateFactor — retail → farmgate adjustment applied to every live
     *                  price. 1 = show the retail figure as published. Set
     *                  from the farm's own experience of the spread.
     *   cacheHours   — how long a fetched series is reused before refetching.
     */
    market: {
      source: {
        name: 'WFP market monitor via HDX HAPI',
        shortName: 'WFP · HDX',
        endpoint: 'https://hapi.humdata.org/api/v2/food-security-nutrition-poverty/food-prices-market-monitor',
        appIdentifier: 'agrosense-dashboard:hello@agrosense.app',
        location: 'NGA',
        url: 'https://data.humdata.org/dataset/wfp-food-prices-for-nigeria'
      },
      months: 24,
      minMarkets: 4,
      farmgateFactor: 1,
      cacheHours: 12,
      timeoutMs: 45000,
      seed: 20260909       // deterministic history for modelled series
    },

    weather: {
      refreshMs: 15 * 60 * 1000,
      forecastDays: 7,
      // Past days are not decoration: the irrigation deficit is accumulated
      // backwards from the last time a zone ran, and degree days are summed
      // over the weeks a pest has been developing.
      pastDays: 14,
      endpoint: 'https://api.open-meteo.com/v1/forecast'
    },

    locale: 'en-NG',
    currency: 'NGN'
  };

  NS.SERIES = SERIES;
  NS.LIVESTOCK_SERIES = LIVESTOCK_SERIES;
})(window.AgroSense);
