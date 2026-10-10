# Bio Track, Agricultural Intelligence Dashboard

**Live demo: <https://bio-track-farms.vercel.app>**

A decision cockpit for a commercial farm. It answers one question at a glance:
**what is the farm worth right now, in the barn and on the hoof, and what should
I do about it today?**

Three data streams feed that answer, live weather for the farm's own coordinates,
real monthly market prices from the World Food Programme, and the farm's own
records, and the dashboard joins them rather than displaying them side by side.

---

## Run it

No build step, no dependencies to install.

```bash
python tools/devserver.py
```

Then open <http://localhost:5173>. `tools/devserver.py` is a plain static server with
caching switched off, so an edited file is never served stale. The landing page's **Log in** button goes
straight to the cockpit; there is no authentication yet.

Any static server works (`npx serve`, VS Code Live Server, Apache, GitHub Pages).
Opening `index.html` directly from disk also works; the bundled price snapshot
is a script, not a fetch, so nothing depends on a same-origin request.

---

## The pages

| Page | File | What is on it |
|---|---|---|
| **Landing** | `index.html` | A single hero. Real telemetry chips (current weather for the default location, the latest WFP rice price, the next harvest) and the log-in button. |
| **The cockpit** | `cockpit.html` | The farm's value (crops + livestock), how prices moved it, the sell priority, field and herd advisories, and the harvest calendar. |
| **Live data** | `live.html` | Weather for the farm's coordinates; market prices for crops and livestock products, with a provenance card that says exactly where each figure came from. |
| **Operations** | `operations.html` | Irrigation control and pest control, both driven by the forecast. |
| **The farm** | `farm.html` | Inventory analytics, fields and the harvest calendar, and livestock, valuation, heat stress, health calendar. |

The sidebar, top bar, price board and footer are built once in `js/shell.js` and
injected into every page. The alerts bell in the top bar follows the user to every
page. Anything the user does, open a valve, record a spray, mark a vaccination
done, pick a location, is kept in `localStorage`, so it survives a page change.

---

## What is real and what is not

| Data | Source | Notes |
|---|---|---|
| Weather, soil, ET₀, hourly humidity and wind | **Open-Meteo** (live) | Forecast-model output for the selected coordinates, not on-farm sensors. Re-queried every 15 minutes; cached in `sessionStorage` between pages. |
| Rice, yam, tomato prices | **WFP market monitor via HDX HAPI** (live, monthly) | Retail, median across the WFP-monitored markets reporting for Nigeria, at the time of writing, Borno, Yobe and Adamawa. |
| Maize price | WFP **maize flour** series | A **proxy**: WFP Nigeria has published no maize-grain series since January 2023. Labelled as such on every screen. |
| Beef, goat meat, eggs | WFP (live, monthly) | Meat per kg, eggs per 30 converted to per egg. |
| Mutton, catfish | WFP goat meat / "Fish" series | **Proxies**, labelled. |
| Cassava, soybean, dressed chicken | **Modelled** | No WFP series exists. A seeded seasonal random walk around a reference price, dashed on the chart and badged "Modelled". |
| Inventory, fields, plantings, herds, zones, pest programme | `js/config.js` | Seed data for a fictional farm. |
| Irrigation runs, treatments, health tasks | Browser | Recorded in `localStorage`; nothing is controlled or sent anywhere. |

Every quote carries a `mode`, `live`, `proxy` or `modelled`, and the board, the
tables and the provenance card show it. The footer of every page prints the live
HTTP status and latency of the last weather call and which tier the prices came from.

---

## Market prices

### Where they come from

The [WFP food prices dataset for Nigeria](https://data.humdata.org/dataset/wfp-food-prices-for-nigeria)
is the only free, CORS-open feed of Nigerian food prices. The dashboard reads it
through the [HDX Humanitarian API](https://hapi.humdata.org) (`food-prices-market-monitor`),
one request per commodity, in parallel, straight from the browser.

That feed sets the shape of the market module, and the dashboard is honest about it:

- **It is monthly.** There is no intraday print. The board shows the latest
  complete month and the change on the month before. The earlier version's
  four-second ticking simulation is gone, real Nigerian farmgate prices do not
  tick, and flashing a fake movement over real data would have been worse than
  either alone.
- **It is retail**, at the markets WFP monitors. `config.market.farmgateFactor`
  applies a farm's own retail-to-farmgate spread; it ships at 1, meaning no
  adjustment.
- **The newest month is usually partial**; a handful of markets in early. A
  month counts once `config.market.minMarkets` (4) have reported; the partial
  month is shown on the provenance card but not traded on.
- **Not every crop has a series.** Related products stand in where WFP publishes
  one; where nothing exists the price is modelled, dashed and labelled.

### Three tiers

1. **Live**, fetched from HAPI when the page opens, if the copy in hand is older
   than `config.market.cacheHours` (12), or when the user presses refresh.
2. **Cache**; the last live fetch, in `localStorage`.
3. **Snapshot**, `data/prices-snapshot.js`, generated by `tools/fetch-prices.py`
   and committed, so the board has real figures on first paint and the dashboard
   still works when HAPI is unreachable.

The board always says which tier is on screen. To refresh the snapshot:

```bash
python tools/fetch-prices.py
```

HAPI asks callers to identify themselves with an application name and contact
email (`config.market.source.appIdentifier`). Set your own before deploying.

### Signals

Each instrument carries a signal, *Sell now / Sell soon / Watch / Hold*, from
where this month's price sits against its own 12-month average and whether it
rose or fell last month. Every signal states the threshold it fired on.

---

## Weather intelligence

Live from the **Open-Meteo forecast API** for the farm's coordinates. No API key,
no sign-up, CORS-open. The request asks for soil moisture, soil temperature and
reference evapotranspiration alongside temperature and rainfall, because those
are what decide irrigation, and for hourly humidity and wind, because those
decide disease pressure, spray windows and heat stress.

Advisories name the action, the threshold and the window: hold fertiliser ahead
of heavy rain, irrigate when the topsoil is dry and ET₀ is high, scout for leaf
disease when humidity sits above 85% in the blight window, do not spray in wind,
take the drying window when three dry days line up, and, from the livestock
module, shade the cattle when the afternoon THI passes 72.

---

## Livestock

Six herds in `config.livestock.herds`: beef cattle, goats, sheep, layers,
broilers and catfish.

**Valuation.** Head × live weight × dressing percentage gives carcass weight;
this month's meat price prices it. Layers are an income stream rather than a
carcass, so they are held at book value and their egg output is priced per day.
Livestock value is part of the cockpit headline and of the portfolio history
(carcass kilos at each month's price, book value for layers).

**Heat stress**, from the real hourly forecast. The temperature-humidity index,
THI = 0.8 T + RH/100 × (T − 14.4) + 46.4, is scored over the next 48 hours with
species-specific thresholds; a West African Dwarf goat shrugs off an afternoon
that puts a Fulani bull off its feed. Fish are scored on air temperature, which
drives pond oxygen. Anything moderate or worse becomes a cockpit advisory with
the relief action.

**Health calendar.** Vaccinations and treatments coming due, with "mark done"
kept in the browser.

---

## Harvest alerts

Every planting in `config.plantings` is placed against its crop's maturity window
(`crops[id].maturityDays`, earliest and latest days from planting). Each block is
then joined to:

- **the forecast**, is the opening day wet, and where is the first dry pair of
  days after it;
- **the market**, is the price worth selling straight off the field, or is this
  a crop to dry and store (`shelfLifeDays` decides which advice is given);
- **the pre-harvest interval**; a spray that clears after the window opens holds
  the harvest back whatever the calendar says.

Alerts fire from `config.harvest.leadDays` (21) out and escalate: *Approaching →
Ready this week → Ready to harvest → Window closing*. They reach the user three
ways:

1. **The bell** in the top bar, on every page, with a count and a panel.
2. **Toasts** for anything urgent, once per browser session.
3. **Browser notifications**, once permission is granted from the bell, one per
   block per day, so a harvest is nagged about, not spammed.

The open dashboard re-evaluates every hour (`config.harvest.checkMs`). Livestock
reaching market weight appears in the same panel.

---

## Irrigation control

Six zones, each with its own soil, root depth and delivery method. The deficit is
a FAO-56 soil water balance run backwards from the last time the zone was watered:

```
TAW = awcMmPerM x rootDepthM      what the soil can hold
RAW = TAW x 0.5                   what the crop can draw comfortably
ETc = ET0 x Kc                    what the crop transpires per day
deficit += ETc - (rain x 0.75)    accumulated, day by day, floored at zero
```

ET₀ and rainfall are the real ones from Open-Meteo; the `past_days` in that
request is what makes the backwards accumulation possible. Switch the location
from Ibadan to Kano and the same zones jump from *Holding* to *Due soon*, because
the rain simply is not there.

A running zone puts water on the ground at 60× real time (stated on the card),
and keeps running if the user moves to another page: the controller's state is
in `localStorage` and catches up on the time that passed.

---

## Pest control

Insects run on growing degree days summed from the last scouting visit; diseases
on the longest unbroken run of humid hours inside the pathogen's band; the spray
window is the next run of calm, dry hours. Every product carries a pre-harvest
interval, and recording a treatment starts that clock, which reaches straight
into the sell priority (produce that cannot be sold before it spoils is
**stranded**) and the harvest calendar (a window that opens before the interval
clears is flagged).

---

## Architecture

```
index.html                landing page (hero + log-in button)
cockpit.html              the four dashboard pages share one skeleton:
live.html                 four shell placeholders, page sections, scripts
operations.html
farm.html
css/styles.css            design tokens and every dashboard component
css/landing.css           the landing page only
data/prices-snapshot.js   bundled WFP prices (generated, committed)
tools/fetch-prices.py     regenerates the snapshot from HDX HAPI
js/
  config.js               farm profile, crops, livestock, plantings, zones, pests, feeds
  store.js                namespaced, guarded localStorage / sessionStorage
  format.js               naira, mass, time, month and percentage formatting
  dom.js                  the DOM helpers every page shares
  icons.js                the inline SVG sprite, injected on every page
  services/
    market.js             HDX HAPI client, three tiers, monthly series, signals
    weather.js            Open-Meteo client, normalisation, advisories, session cache
    irrigation.js         FAO-56 water balance + the zone controller (persisted)
    pests.js              degree days, infection windows, spray windows, PHIs (persisted)
    livestock.js          herd valuation, THI heat stress, health calendar
    harvest.js            maturity windows, forecast/market/PHI joins, notifications
  analytics.js            lot valuation, aggregation, spoilage, sell priority, farm total
  charts.js               all Chart.js configuration + canvas sparklines
  shell.js                sidebar, top bar, board, bell, toasts, footer
  pages/
    cockpit.js  live.js  operations.js  farm.js   one renderer per page
  app.js                  boot: services → compute → chrome → page
  landing.js              the landing page's live chips
assets/                   logo files
```

Plain scripts on a global `AgroSense` namespace rather than ES modules, so the
pages run from `file://` as well as over HTTP. Services know nothing about the
DOM; `shell.js` and the page modules are the only files that touch it.

**Data flow.** On every page, `app.js` starts every service, so the sidebar counts
and the alerts bell are right wherever the user is standing. `market.init()`
publishes the offline tier synchronously, so the page paints with real figures
before any request is answered; a live fetch follows if the copy in hand is stale.
Weather is fetched independently, so an outage in one feed cannot take the other
down. Every change runs `compute()` once, valuation, advisories, irrigation,
pests, harvest, heat stress, and hands the result to the chrome and the page.

**Updated in place, never re-rendered.** Anything that changes on a refresh has
its text node written directly. Re-writing `innerHTML` would drop text selection,
kill hover states and reallocate every sparkline canvas.

---

## Charts

| Chart | Form | Why that form |
|---|---|---|
| Farm value, 24 months | Area line | One series over time. The endpoint carries a direct label. |
| Crop price trend | Multi-line, 6 series | Comparing trajectories. Legend doubles as a series filter. Modelled series are dashed; a different kind of claim. |
| Livestock product trend | Multi-line, 6 series | Same, second palette so nothing collides with a crop. |
| Value composition (crops, herds) | Doughnut | Part-to-whole at a glance. |
| Market value vs cost | Grouped horizontal bar | Two measures on one scale, per crop. |
| 7-day temperature / rainfall | Line with band / bar | Two charts, never two y-axes. |
| Soil water deficit | Grouped horizontal bar | Deficit against refill point, per zone. |
| Degree-day accumulation | Line, measured + dashed forecast | Dashing means projection. |
| Maturity window | CSS bar | Planted → opens → closes, today marked. |
| Per-instrument 12-month | Canvas sparkline | Cheap enough to redraw on every refresh. |

**No dual-axis charts.** **Colour follows the entity, never its rank.** Crops keep
a CVD-validated six-slot palette; livestock products get a second, muted slot
order so the two never share a colour on the board.

---

## Accessibility & responsiveness

- Sidebar becomes a drawer below 860px, single column below 980px, single-column
  tiles below 620px. The page body never scrolls horizontally, wide tables scroll
  inside their own container.
- Skip link, visible focus rings, `aria-sort` on sortable columns, `aria-pressed`
  on toggles, `aria-expanded` on the drawer and the bell, `<caption>` on every
  data table.
- `prefers-reduced-motion` disables the entrance sequence, the live pulse and the
  landing page's drift and scan.
- Status colours never carry meaning alone; each pairs with an icon and a label.

---

## Scope notes

- **Prices are real but monthly, retail, and from the north-east.** That is what
  exists in the open. The board says so; the provenance card says exactly which
  month, how many markets, and which states.
- **Weather is a model, not a sensor.** Open-Meteo snaps to the nearest ~11 km
  grid point; soil moisture is the model's estimate, not a probe in the field.
- **The log-in button has no logic behind it.** By design, for now.
- **Inventory, plantings, herds and zones are seed data** in `js/config.js`.
  Ages are stored relative to today so the spoilage, harvest and maturity maths
  stay truthful whenever the dashboard is opened.
- **Single light theme for the dashboard**, chosen deliberately; a daylight tool.
  The landing page is dark, deliberately; it is the door, not the desk.
