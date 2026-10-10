/**
 * AgroSense - DOM helpers
 * ---------------------------------------------------------------
 * The handful of helpers every page module shares. The rule they
 * serve: anything that changes on a data refresh is *updated in place*,
 * never re-rendered from a template string - re-writing innerHTML drops
 * text selection, kills hover states and reallocates every canvas.
 */
(function (NS) {
  'use strict';

  function el(name, root) {
    return (root || document).querySelector('[data-el="' + name + '"]');
  }

  function all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function tag(name, className, text) {
    var node = document.createElement(name);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function icon(id, className) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon' + (className ? ' ' + className : ''));
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    return svg;
  }

  /**
   * A product picture in a round chip. The ring is the product's series colour:
   * on a chart page the colour is what ties a legend entry or table row to its
   * line, so the picture replaces the old coloured square without losing that.
   */
  function picture(id, color) {
    var chip = tag('span', 'pic');
    if (color) chip.style.setProperty('--ring', color);
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pic-svg');
    svg.setAttribute('aria-hidden', 'true');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    chip.appendChild(svg);
    return chip;
  }

  /** The picture for a crop or livestock product id, or null if it has none. */
  function pictureFor(id) {
    var cfg = NS.config;
    var item = (cfg.crops && cfg.crops[id]) || (cfg.livestock && cfg.livestock.products && cfg.livestock.products[id]);
    return item && item.picture ? picture(item.picture, item.color) : null;
  }

  /** Picture if the product has one, otherwise the plain coloured square. */
  function mark(id, color, swatchClass) {
    var pic = pictureFor(id);
    if (pic) return pic;
    var sw = tag('span', swatchClass || 'crop-swatch');
    sw.style.background = color;
    return sw;
  }

  /** A badge with an icon and a label, the pattern used for every status. */
  function badge(tone, iconId, text) {
    var b = tag('span', 'badge ' + tone);
    if (iconId) b.appendChild(icon(iconId));
    b.appendChild(document.createTextNode(text));
    return b;
  }

  /** Briefly paint an element to show a value just moved. */
  function flash(node, direction) {
    if (!node || !direction) return;
    var cls = direction > 0 ? 'tick-up' : 'tick-down';
    node.classList.remove('tick-up', 'tick-down');
    void node.offsetWidth;   // reflow so the class re-applies on consecutive updates
    node.classList.add(cls);
    setTimeout(function () { node.classList.remove(cls); }, 900);
  }

  function deltaClass(v) { return v > 0.0001 ? 'up' : v < -0.0001 ? 'down' : 'flat'; }

  /**
   * Extra text that opens when its row is hovered, focused or clicked.
   * The row becomes focusable so a keyboard or a touch screen reaches it
   * too; `into` is where the text lives when that is not the row itself
   * (a numbered list item keeps its text in a body column).
   */
  function peek(row, content, into) {
    row.classList.add('peek');
    row.tabIndex = 0;
    var more = tag('div', 'peek-more');
    var inner = tag('div');
    inner.appendChild(content);
    more.appendChild(inner);
    (into || row).appendChild(more);
    return more;
  }

  /** Only run a renderer when its host is on this page. */
  function has(name) { return !!el(name); }

  NS.dom = {
    el: el,
    all: all,
    setText: setText,
    tag: tag,
    icon: icon,
    badge: badge,
    picture: picture,
    pictureFor: pictureFor,
    mark: mark,
    flash: flash,
    deltaClass: deltaClass,
    peek: peek,
    has: has
  };
})(window.AgroSense);
