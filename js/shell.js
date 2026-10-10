/**
 * Bio Track - the shell
 * ---------------------------------------------------------------
 * The chrome every dashboard page shares: sidebar navigation, top bar,
 * the price board rail, the alerts bell and its panel, toasts, and the
 * sources footer. Pages carry four placeholders; this module fills them,
 * so the chrome is written once and every page stays a page.
 */
(function (NS) {
  'use strict';

  var cfg = NS.config;
  var fmt = NS.fmt;
  var dom = NS.dom;
  var el = dom.el, all = dom.all, setText = dom.setText, tag = dom.tag, icon = dom.icon;

  /* ---------- navigation map ---------- */

  /* One entry per page. `count` names a data-el that app.js fills with
     how many things on that page want attention; it hides at zero. */
  var NAV = [
    { id: 'cockpit',    label: 'The cockpit', href: 'cockpit.html',    icon: 'i-gauge',   count: 'cockpitCount' },
    { id: 'live',       label: 'Live data',   href: 'live.html',       icon: 'i-trend' },
    { id: 'operations', label: 'Operations',  href: 'operations.html', icon: 'i-valve',   count: 'operationsCount' },
    { id: 'farm',       label: 'The farm',    href: 'farm.html',       icon: 'i-harvest', count: 'farmCount' }
  ];

  var page = document.body.getAttribute('data-page') || 'cockpit';

  /* ---------- markup ---------- */

  /**
   * A rail chip. The label is always in the DOM — a screen reader reads it,
   * and the mobile drawer shows it — but CSS hides it on the narrow rail,
   * where the title attribute carries it as a tooltip instead.
   */
  function navLink(group) {
    var a = tag('a', 'nav-link' + (group.id === page ? ' is-active' : ''));
    a.href = group.href;
    a.title = group.label;
    a.setAttribute('aria-label', group.label);
    if (group.id === page) a.setAttribute('aria-current', 'page');
    a.appendChild(icon(group.icon));
    a.appendChild(tag('span', 'nav-label', group.label));
    if (group.count) {
      var c = tag('span', 'nav-count', '–');
      c.setAttribute('data-el', group.count);
      c.hidden = true;
      a.appendChild(c);
    }
    return a;
  }

  function buildSidebar(host) {
    var aside = tag('aside', 'sidebar');
    aside.id = 'sidebar';
    aside.setAttribute('aria-label', 'Dashboard sections');

    // On the rail only the green disc shows; the wordmark is for the drawer.
    var brand = tag('a', 'brand');
    brand.href = 'cockpit.html';
    brand.title = 'Bio Track';
    brand.setAttribute('aria-label', 'Bio Track — go to the cockpit');
    var mark = tag('span', 'brand-mark');
    mark.appendChild(icon('i-sprout'));
    brand.appendChild(mark);
    var names = tag('span', 'brand-text');
    names.appendChild(tag('span', 'brand-name', 'Bio Track'));
    names.appendChild(tag('span', 'brand-sub', 'See tomorrow’s harvest today'));
    brand.appendChild(names);
    aside.appendChild(brand);

    var nav = tag('nav');
    var ul = tag('ul', 'nav-list');
    NAV.forEach(function (group) {
      var li = tag('li');
      li.appendChild(navLink(group));
      ul.appendChild(li);
    });
    nav.appendChild(ul);
    aside.appendChild(nav);

    var foot = tag('div', 'sidebar-foot');
    var name = tag('strong'); name.setAttribute('data-el', 'farmName'); name.textContent = cfg.farm.name;
    foot.appendChild(name);
    foot.appendChild(document.createElement('br'));
    var meta = tag('span'); meta.setAttribute('data-el', 'farmMeta');
    meta.textContent = cfg.farm.hectares + ' ha · farming since ' + cfg.farm.established;
    foot.appendChild(meta);
    var out = tag('a', 'nav-logout');
    out.href = 'index.html';
    out.title = 'Log out';
    out.setAttribute('aria-label', 'Log out');
    out.appendChild(icon('i-logout'));
    out.appendChild(tag('span', 'nav-label', 'Log out'));
    foot.appendChild(out);
    aside.appendChild(foot);

    host.replaceWith(aside);

    var scrim = tag('div', 'scrim');
    scrim.id = 'scrim';
    scrim.hidden = true;
    aside.parentNode.insertBefore(scrim, aside.nextSibling);
  }

  function buildTopbar(host) {
    var header = tag('header', 'topbar');

    var toggle = tag('button', 'menu-toggle icon-btn');
    toggle.id = 'menuToggle';
    toggle.setAttribute('aria-label', 'Open navigation');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'sidebar');
    toggle.appendChild(icon('i-menu'));
    header.appendChild(toggle);

    var titles = tag('div', 'topbar-title');
    var h1 = tag('h1'); h1.setAttribute('data-el', 'greeting'); h1.textContent = 'Good day';
    var p = tag('p'); p.setAttribute('data-el', 'dateLine'); p.textContent = '—';
    titles.appendChild(h1); titles.appendChild(p);
    header.appendChild(titles);

    header.appendChild(tag('div', 'topbar-spacer'));

    var label = tag('label', 'field-select');
    label.appendChild(icon('i-pin'));
    label.appendChild(tag('span', 'sr-only', 'Farm location for the weather forecast'));
    var select = document.createElement('select');
    select.id = 'locationSelect';
    label.appendChild(select);
    header.appendChild(label);

    var pill = tag('span', 'live-pill');
    pill.setAttribute('data-el', 'livePill');
    pill.setAttribute('data-state', 'loading');
    pill.setAttribute('role', 'status');
    pill.appendChild(tag('span', 'live-dot'));
    var text = tag('span', 'live-text', 'Connecting'); text.setAttribute('data-el', 'liveText');
    pill.appendChild(text);
    header.appendChild(pill);

    var bell = tag('button', 'icon-btn bell');
    bell.id = 'alertsBtn';
    bell.setAttribute('aria-label', 'Harvest and farm alerts');
    bell.setAttribute('aria-expanded', 'false');
    bell.setAttribute('aria-controls', 'alertsPanel');
    bell.appendChild(icon('i-bell'));
    var count = tag('span', 'bell-count', '0');
    count.setAttribute('data-el', 'bellCount');
    count.hidden = true;
    bell.appendChild(count);
    header.appendChild(bell);

    var refresh = tag('button', 'icon-btn');
    refresh.id = 'refreshBtn';
    refresh.title = 'Refresh weather and prices now';
    refresh.setAttribute('aria-label', 'Refresh weather and prices now');
    refresh.appendChild(icon('i-refresh'));
    header.appendChild(refresh);

    var avatar = tag('span', 'avatar', cfg.farm.initials);
    avatar.setAttribute('data-el', 'avatar');
    avatar.setAttribute('aria-hidden', 'true');
    header.appendChild(avatar);

    host.replaceWith(header);

    // The alerts panel sits just under the top bar.
    var panel = tag('div', 'alerts-panel');
    panel.id = 'alertsPanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Alerts');
    var head = tag('div', 'alerts-head');
    head.appendChild(tag('h3', null, 'Alerts'));
    var sub = tag('span', 'eyebrow'); sub.setAttribute('data-el', 'alertsSub'); sub.textContent = '—';
    head.appendChild(sub);
    panel.appendChild(head);
    var body = tag('div', 'alerts-body'); body.setAttribute('data-el', 'alertsBody');
    panel.appendChild(body);
    var foot = tag('div', 'alerts-foot'); foot.setAttribute('data-el', 'alertsFoot');
    panel.appendChild(foot);
    header.parentNode.insertBefore(panel, header.nextSibling);
  }

  function buildBoard(host) {
    var board = tag('div', 'board');
    var inner = tag('div', 'board-inner');
    inner.setAttribute('data-el', 'board');
    inner.setAttribute('aria-live', 'off');

    var label = tag('div', 'board-label');
    label.appendChild(icon('i-board'));
    label.appendChild(document.createTextNode(' Market board'));
    var vintage = tag('span', 'board-vintage'); vintage.setAttribute('data-el', 'boardVintage'); vintage.textContent = '—';
    label.appendChild(vintage);
    inner.appendChild(label);

    board.appendChild(inner);
    host.replaceWith(board);
  }

  function buildFooter(host) {
    // The three provenance lines are always in the DOM (the app keeps them current),
    // but only the words "Data sources" show until the label is hovered or focused.
    var footer = tag('footer', 'sources');
    footer.tabIndex = 0;
    var label = tag('span', 'sources-label');
    label.appendChild(icon('i-database'));
    label.appendChild(document.createTextNode('Data sources'));
    footer.appendChild(label);
    var more = tag('div', 'sources-more');
    function line(strong, elName) {
      var span = tag('span');
      span.appendChild(tag('strong', null, strong));
      span.appendChild(document.createTextNode(' '));
      var code = tag('span'); code.setAttribute('data-el', elName); code.textContent = '—';
      span.appendChild(code);
      return span;
    }
    more.appendChild(line('Weather', 'srcWeather'));
    more.appendChild(line('Prices', 'srcMarket'));
    var inv = tag('span');
    inv.appendChild(tag('strong', null, 'Farm records'));
    inv.appendChild(document.createTextNode(' inventory, plantings, herds and zones in '));
    inv.appendChild(tag('code', null, 'js/config.js'));
    more.appendChild(inv);
    footer.appendChild(more);
    host.replaceWith(footer);

    var toasts = tag('div', 'toasts');
    toasts.setAttribute('data-el', 'toasts');
    toasts.setAttribute('aria-live', 'polite');
    document.body.appendChild(toasts);
  }

  /* ---------- behaviour ---------- */

  /**
   * The hamburger does two different jobs depending on the screen.
   *   narrow (≤ 860px): the sidebar is a drawer over the page — open/close it.
   *   wide:             the sidebar is a column — collapse/expand it, and
   *                     remember the choice so it stays put across pages.
   */
  var COLLAPSE_KEY = 'sidebarCollapsed';

  function bindDrawer() {
    var sidebar = document.getElementById('sidebar');
    var scrim = document.getElementById('scrim');
    var toggle = document.getElementById('menuToggle');
    var narrow = window.matchMedia('(max-width: 860px)');

    function setDrawer(open) {
      sidebar.classList.toggle('is-open', open);
      scrim.hidden = !open;
      scrim.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    }

    function setCollapsed(collapsed) {
      document.body.classList.toggle('sidebar-collapsed', collapsed);
      toggle.setAttribute('aria-expanded', String(!collapsed));
      NS.store.local.set(COLLAPSE_KEY, collapsed);
    }

    // Restore a collapsed desktop sidebar without animating it shut on load.
    if (!narrow.matches && NS.store.local.get(COLLAPSE_KEY, false)) {
      document.body.classList.add('no-motion');
      setCollapsed(true);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { document.body.classList.remove('no-motion'); });
      });
    }

    toggle.addEventListener('click', function () {
      if (narrow.matches) setDrawer(!sidebar.classList.contains('is-open'));
      else setCollapsed(!document.body.classList.contains('sidebar-collapsed'));
    });
    scrim.addEventListener('click', function () { setDrawer(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { setDrawer(false); closeAlerts(); }
    });
    all('.nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        if (window.matchMedia('(max-width: 860px)').matches) setDrawer(false);
      });
    });
  }

  /* =====================================================================
     Alerts and read state
     ---------------------------------------------------------------------
     Every alert is derived from live conditions, so there is nothing to
     "delete" - what can be tracked is whether the user has SEEN it. An
     alert's key is its id plus its status, so one that escalates (ready
     this week -> ready now) is a new alert and rings the bell again.

     Opening the panel marks everything read and the count clears; the
     rows that were new stay highlighted until the panel closes, so you can
     still tell what you just learned. Clicking a row marks it read too.
     ===================================================================== */

  var READ_KEY = 'alertsRead';
  var lastAssessment = null;
  var openSnapshot = null;       // { key: true } of what was unread when the panel opened

  function collectAlerts(assessment) {
    var out = [];
    assessment.alerts.forEach(function (a) {
      out.push({ key: 'h:' + a.id + ':' + a.status, level: a.level, kind: 'harvest', data: a });
    });
    assessment.livestock.forEach(function (s) {
      out.push({ key: 'l:' + s.id + ':' + s.status, level: s.level, kind: 'livestock', data: s });
    });
    return out;
  }

  function readMap() { return NS.store.local.get(READ_KEY, {}); }

  function markRead(keys) {
    var map = readMap();
    keys.forEach(function (k) { map[k] = true; });
    NS.store.local.set(READ_KEY, map);
  }

  var drawnPermission = null;     // what the views were last drawn with

  /**
   * Browsers answer a permission prompt on their own schedule, and Chrome in
   * particular may show the prompt as a small address-bar icon rather than a
   * dialog - so the answer can arrive long after the click, or never through
   * the promise at all. Rather than trust one callback, re-check whenever the
   * window gets attention, and poll for a while after a request.
   */
  function syncPermission() {
    var now = NS.harvest.permission();
    if (drawnPermission !== null && now !== drawnPermission && NS.app) {
      var became = now;
      NS.app.renderAll();
      if (became === 'granted') {
        toast({ tone: 'good', icon: 'i-check', title: 'Harvest pings are on',
                detail: 'You will get a browser notification once a day for each block that needs attention.' });
      }
    }
  }

  var permTimer = null;
  function watchPermission() {
    if (permTimer) return;
    var ticks = 0;
    permTimer = setInterval(function () {
      syncPermission();
      if (NS.harvest.permission() !== 'default' || ++ticks > 90) { clearInterval(permTimer); permTimer = null; }
    }, 1000);
  }

  function bindAlerts() {
    window.addEventListener('focus', syncPermission);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) syncPermission(); });
    var btn = document.getElementById('alertsBtn');
    var panel = document.getElementById('alertsPanel');

    btn.addEventListener('click', function () {
      var open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));

      if (open && lastAssessment) {
        var items = collectAlerts(lastAssessment);
        var read = readMap();
        openSnapshot = {};
        items.forEach(function (it) { if (!read[it.key]) openSnapshot[it.key] = true; });
        markRead(items.map(function (it) { return it.key; }));
      } else {
        openSnapshot = null;
      }
      if (lastAssessment) renderAlerts(lastAssessment);
    });

    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      closeAlerts();
    });

    // The permission can change outside the page (the lock icon in the address
    // bar, browser settings). Every view that shows it has to follow.
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'notifications' }).then(function (status) {
        status.onchange = function () { if (NS.app) NS.app.renderAll(); };
      }).catch(function () { /* not every browser exposes it */ });
    }
  }

  function closeAlerts() {
    var panel = document.getElementById('alertsPanel');
    var btn = document.getElementById('alertsBtn');
    if (panel && !panel.hidden) {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
      openSnapshot = null;
      if (lastAssessment) renderAlerts(lastAssessment);
    }
  }

  function renderIdentity() {
    var hour = new Date().getHours();
    var part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    setText(el('greeting'), part + ', ' + cfg.farm.manager.toLowerCase());
    setText(el('dateLine'), new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    }));
  }

  /* ---------- the price board ---------- */

  var boardCells = {};

  function buildBoardCells() {
    var board = el('board');
    var groups = [
      { kind: 'crop', label: 'Crops · ₦/kg' },
      { kind: 'livestock', label: 'Livestock' }
    ];
    groups.forEach(function (group) {
      var ids = NS.market.ids(group.kind);
      var divider = tag('span', 'board-group', group.label);
      board.appendChild(divider);
      ids.forEach(function (id) {
        var inst = NS.market.instruments.filter(function (i) { return i.id === id; })[0];
        var cell = tag('div', 'board-cell');
        var name = tag('span', 'board-crop', inst.name);
        cell.appendChild(name);
        var price = tag('span', 'board-price', '—');
        var delta = tag('span', 'board-delta flat', '—');
        var mode = tag('span', 'board-mode', '');
        cell.appendChild(price);
        cell.appendChild(delta);
        cell.appendChild(mode);
        board.appendChild(cell);
        boardCells[id] = { cell: cell, price: price, delta: delta, mode: mode, unit: inst.unit };
      });
    });
  }

  var MODE_LABEL = { live: 'WFP', proxy: 'proxy', modelled: 'modelled' };

  function updateBoard(quotes) {
    Object.keys(boardCells).forEach(function (id) {
      var q = quotes[id];
      var refs = boardCells[id];
      if (!q || !refs) return;
      var was = refs.price.textContent;
      var now = fmt.price(q.price) + (refs.unit === 'kg' ? '' : '/' + refs.unit);
      setText(refs.price, now);
      setText(refs.delta, fmt.pctSigned(q.changePct, 1) + ' m/m');
      refs.delta.className = 'board-delta ' + dom.deltaClass(q.changePct);
      setText(refs.mode, MODE_LABEL[q.mode] || q.mode);
      refs.mode.className = 'board-mode is-' + q.mode;
      refs.cell.title = q.note;
      if (was !== '—' && was !== now) dom.flash(refs.cell, q.change > 0 ? 1 : -1);
    });

    var s = NS.market.status;
    var vintage = s.periodLabel ? s.periodLabel : '—';
    if (s.tier === 'snapshot') vintage += ' · bundled snapshot';
    else if (s.tier === 'cache') vintage += ' · cached ' + fmt.ago(s.fetchedAt);
    else if (s.tier === 'live') vintage += ' · fetched ' + fmt.ago(s.fetchedAt);
    if (s.state === 'loading') vintage += ' · refreshing…';
    setText(el('boardVintage'), vintage);
  }

  /* ---------- counts, pill, alerts, toasts ---------- */

  /** A count pill. Zero is not news, so the pill disappears rather than reading "0". */
  function setCount(name, value, alert) {
    var node = el(name);
    if (!node) return;
    setText(node, String(value));
    node.classList.toggle('is-alert', !!alert);
    node.hidden = !value;
  }

  function setLiveState(stateName, text, title) {
    var pill = el('livePill');
    if (!pill) return;
    pill.setAttribute('data-state', stateName);
    pill.title = title || '';
    setText(el('liveText'), text);
  }

  function renderAlerts(assessment) {
    lastAssessment = assessment;
    var body = el('alertsBody');
    var foot = el('alertsFoot');
    if (!body) return;
    body.innerHTML = '';

    var items = collectAlerts(assessment);
    var read = readMap();

    // Forget read marks for alerts that no longer exist, so one that comes
    // back later is new again rather than silently pre-read.
    var live = {};
    items.forEach(function (it) { live[it.key] = true; });
    var pruned = {}, changed = false;
    Object.keys(read).forEach(function (k) { if (live[k]) pruned[k] = true; else changed = true; });
    if (changed) { read = pruned; NS.store.local.set(READ_KEY, pruned); }

    function isNew(it) { return openSnapshot ? !!openSnapshot[it.key] : !read[it.key]; }

    var unread = items.filter(function (it) { return !read[it.key]; });
    var fresh = items.filter(isNew);
    var urgentUnread = unread.some(function (it) { return it.level === 'critical' || it.level === 'serious'; });

    setCount('bellCount', unread.length, urgentUnread);
    var bell = document.getElementById('alertsBtn');
    if (bell) bell.setAttribute('aria-label', unread.length
      ? 'Alerts, ' + unread.length + ' unread' : 'Alerts, all read');

    setText(el('alertsSub'), items.length
      ? fresh.length + ' new · ' + items.length + ' total'
      : 'Nothing due');

    if (!items.length) {
      body.appendChild(tag('p', 'chart-caption', 'No harvest inside the next ' + cfg.harvest.leadDays + ' days and no stock at market weight.'));
    }

    items.forEach(function (it) {
      var row = tag('a', 'alert-row ' + (isNew(it) ? 'is-new' : 'is-read'));
      row.href = it.kind === 'harvest' ? 'farm.html#fields' : 'farm.html#livestock';
      row.setAttribute('data-level', it.level);
      var glyph = tag('span', 'alert-icon');
      glyph.appendChild(icon(it.kind === 'harvest' ? 'i-harvest' : 'i-cow'));
      row.appendChild(glyph);
      var txt = tag('div');
      var a = it.data;
      txt.appendChild(tag('strong', null, a.title));
      txt.appendChild(tag('span', 'alert-when', it.kind === 'harvest'
        ? a.when + (a.phi ? ' · PHI holds' : '') + (a.weather && a.weather.openingWet ? ' · wet' : '')
        : fmt.head(a.head) + ' · ' + a.label.toLowerCase()));
      row.appendChild(txt);
      row.addEventListener('click', function () { markRead([it.key]); });
      body.appendChild(row);
    });

    // Browser pings: ask once, say where it stands after that.
    foot.innerHTML = '';
    var perm = NS.harvest.permission();
    drawnPermission = perm;
    if (perm === 'granted') {
      var ok = tag('span', 'chip up');
      ok.appendChild(icon('i-check'));
      ok.appendChild(document.createTextNode(' Browser pings on — once a day per block'));
      foot.appendChild(ok);
    } else if (perm === 'denied') {
      foot.appendChild(tag('span', 'chip', 'Browser notifications are blocked for this site'));
    } else if (perm === 'unsupported') {
      foot.appendChild(tag('span', 'chip', 'This browser cannot show notifications'));
    } else {
      foot.appendChild(pingsButton());
    }
  }

  /**
   * The one control that asks for notification permission. It lives in the bell
   * panel and on the farm page's "Browser pings" tile; both call this so they
   * behave identically and both refresh every view when the answer comes back.
   */
  function pingsButton() {
    var btn = tag('button', 'btn btn-primary');
    btn.type = 'button';
    btn.appendChild(icon('i-bell'));
    btn.appendChild(document.createTextNode('Enable harvest pings'));
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      NS.harvest.requestPermission().then(function (result) {
        // Redraw everything that shows the permission: the bell panel, the farm tile.
        if (NS.app) NS.app.renderAll();
        if (result === 'granted') {
          toast({ tone: 'good', icon: 'i-check', title: 'Harvest pings are on',
                  detail: 'You will get a browser notification once a day for each block that needs attention.' });
          if (NS.app && NS.app.state.ctx) NS.harvest.notify(NS.app.state.ctx.harvest);
        } else if (result === 'denied') {
          toast({ tone: 'warning', icon: 'i-alert', title: 'Notifications were blocked',
                  detail: 'To turn them on later, allow notifications for this site from the lock icon in the address bar.' });
        } else {
          // No answer: the prompt was dismissed or the browser tucked it away as an
          // address-bar icon. Keep listening so an "Allow" there still turns this on.
          toast({ tone: 'warning', icon: 'i-alert', title: 'Waiting for your browser',
                  detail: 'Your browser did not confirm. Click the bell or lock icon at the left of the address bar and choose Allow - this will switch on by itself.',
                  ms: 12000 });
          watchPermission();
        }
      });
    });
    return btn;
  }

  function toast(opts) {
    var host = el('toasts');
    if (!host) return;
    var t = tag('div', 'toast');
    t.setAttribute('data-tone', opts.tone || 'neutral');
    var glyph = tag('span', 'toast-icon');
    glyph.appendChild(icon(opts.icon || 'i-bell'));
    t.appendChild(glyph);
    var body = tag('div');
    body.appendChild(tag('strong', null, opts.title));
    if (opts.detail) body.appendChild(tag('p', null, opts.detail));
    t.appendChild(body);
    var close = tag('button', 'icon-btn toast-close');
    close.setAttribute('aria-label', 'Dismiss');
    close.appendChild(icon('i-close'));
    close.addEventListener('click', function () { t.remove(); });
    t.appendChild(close);
    host.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.classList.add('is-leaving'); }, opts.ms || 9000);
    setTimeout(function () { if (t.parentNode) t.remove(); }, (opts.ms || 9000) + 400);
    return t;
  }

  /* =====================================================================
     Info tips
     ---------------------------------------------------------------------
     Explanatory prose - what a section is for, how a chart should be read -
     is worth having and not worth showing all the time. Every section
     description and every static chart caption is moved behind a small
     "i" beside its heading. Captions that carry LIVE figures (data-el)
     stay where they are: those are findings, not instructions.

     One shared popover serves every button. It opens on hover or keyboard
     focus, and a click pins it (which is how a touch screen reaches it).
     The text also stays in the DOM, visually hidden, so a screen reader
     reads it through aria-describedby without having to open anything.
     ===================================================================== */

  var infoSeq = 0;
  var infoPop = null;
  var infoOwner = null;

  function ensurePop() {
    if (infoPop) return infoPop;
    infoPop = tag('div', 'info-pop');
    infoPop.id = 'infoPop';
    infoPop.setAttribute('role', 'tooltip');
    infoPop.hidden = true;
    document.body.appendChild(infoPop);
    return infoPop;
  }

  /** Under the button, nudged to stay on screen; above it if there is no room below. */
  function placePop(btn) {
    infoPop.style.left = '0px';
    infoPop.style.top = '0px';
    var b = btn.getBoundingClientRect();
    var pw = infoPop.offsetWidth, ph = infoPop.offsetHeight;
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var left = Math.min(Math.max(12, b.left - 14), vw - pw - 12);
    var top = b.bottom + 8;
    if (top + ph > vh - 12) top = Math.max(12, b.top - ph - 8);
    infoPop.style.left = left + 'px';
    infoPop.style.top = top + 'px';
  }

  function showInfo(btn, pin) {
    var pop = ensurePop();
    if (infoOwner && infoOwner !== btn) {
      infoOwner.setAttribute('aria-expanded', 'false');
      infoOwner.classList.remove('is-pinned');
    }
    pop.innerHTML = btn._html;
    pop.hidden = false;
    infoOwner = btn;
    btn.setAttribute('aria-expanded', 'true');
    if (pin) btn.classList.add('is-pinned');
    placePop(btn);
  }

  function hideInfo() {
    if (!infoPop || infoPop.hidden) return;
    infoPop.hidden = true;
    if (infoOwner) {
      infoOwner.setAttribute('aria-expanded', 'false');
      infoOwner.classList.remove('is-pinned');
    }
    infoOwner = null;
  }

  /** Put an info button (and its screen-reader text) at the end of `host`. */
  function attachInfo(host, html, subject) {
    var id = 'info-' + (++infoSeq);
    var btn = tag('button', 'info-btn');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'More about ' + subject);
    btn.setAttribute('aria-describedby', id);
    btn.setAttribute('aria-expanded', 'false');
    btn.appendChild(icon('i-info'));
    btn._html = html;

    btn.addEventListener('mouseenter', function () { if (!btn.classList.contains('is-pinned')) showInfo(btn, false); });
    btn.addEventListener('mouseleave', function () { if (!btn.classList.contains('is-pinned')) hideInfo(); });
    btn.addEventListener('focus', function () { if (!btn.classList.contains('is-pinned')) showInfo(btn, false); });
    btn.addEventListener('blur', function () { if (!btn.classList.contains('is-pinned')) hideInfo(); });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (infoOwner === btn && btn.classList.contains('is-pinned')) hideInfo();
      else showInfo(btn, true);
    });

    var sr = tag('span', 'sr-only');
    sr.id = id;
    sr.innerHTML = html;

    host.appendChild(btn);
    host.appendChild(sr);
    return btn;
  }

  function enhanceInfo() {
    // 1. Section descriptions: heading and button share a row, the paragraph moves into the popover.
    all('.section-head .section-titles').forEach(function (titles) {
      var h2 = titles.querySelector('h2');
      var p = titles.querySelector('p');
      if (!h2 || !p) return;
      var row = tag('div', 'title-row');
      titles.insertBefore(row, h2);
      row.appendChild(h2);
      attachInfo(row, p.innerHTML, h2.textContent.trim());
      p.parentNode.removeChild(p);
    });

    // 2. Static chart captions go behind an "i" on their card's heading.
    all('p.chart-caption').forEach(function (cap) {
      if (cap.hasAttribute('data-el')) return;
      var card = cap.closest('.card');
      var head = card && card.querySelector('.card-head');
      var h3 = head && head.querySelector('h3');
      if (!h3) return;

      var existing = head.querySelector('.info-btn');
      if (existing) {
        existing._html += '<br><br>' + cap.innerHTML;     // two captions, one card: one button
      } else {
        var wrap = tag('span', 'info-wrap');
        h3.parentNode.insertBefore(wrap, h3.nextSibling);
        attachInfo(wrap, cap.innerHTML, h3.textContent.trim());
      }
      cap.parentNode.removeChild(cap);
    });

    document.addEventListener('click', function (e) {
      if (infoOwner && !infoOwner.contains(e.target)) hideInfo();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hideInfo(); });
    window.addEventListener('resize', hideInfo);
    document.addEventListener('scroll', hideInfo, true);   // capture: .content scrolls, not the window
  }

  /* ---------- boot ---------- */

  function build() {
    var sidebar = document.querySelector('[data-shell="sidebar"]');
    var topbar = document.querySelector('[data-shell="topbar"]');
    var board = document.querySelector('[data-shell="board"]');
    var footer = document.querySelector('[data-shell="footer"]');
    if (sidebar) buildSidebar(sidebar);
    if (topbar) buildTopbar(topbar);
    if (board) buildBoard(board);
    if (footer) buildFooter(footer);

    renderIdentity();
    bindDrawer();
    bindAlerts();
    buildBoardCells();
    enhanceInfo();
  }

  NS.shell = {
    page: page,
    build: build,
    updateBoard: updateBoard,
    setCount: setCount,
    setLiveState: setLiveState,
    renderAlerts: renderAlerts,
    toast: toast,
    closeAlerts: closeAlerts,
    attachInfo: attachInfo,
    pingsButton: pingsButton
  };
})(window.AgroSense);
