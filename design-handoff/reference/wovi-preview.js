/*
 * wovi-preview.js — a ~100-line stand-in for the design canvas runtime, so the
 * reference screens in this folder open as plain local HTML files.
 * It supports exactly what the reference files use: {{ path }} holes,
 * <sc-for list as>, <sc-if value>, onClick/onChange/onSubmit bindings,
 * <helmet> (moved into <head>) and a React-like `class Component extends DCLogic`
 * with state / setState / componentDidMount.
 * It is a VIEWER for the design, not production code. Do not ship it.
 */
(function () {
  var s = document.createElement('style');
  s.textContent = 'x-dc{display:none}';
  document.head.appendChild(s);

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var WHOLE = /^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/;
  var EVENTS = { onclick: 'click', onchange: 'input', oninput: 'input', onsubmit: 'submit' };
  var root, tpl, inst, pending = false;

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p) {
    var n = typeof p === 'function' ? p(this.state) : p;
    this.state = Object.assign({}, this.state, n);
    schedule();
  };
  DCLogic.prototype.forceUpdate = function () { schedule(); };
  window.DCLogic = DCLogic;

  function schedule() {
    if (pending) return;
    pending = true;
    Promise.resolve().then(function () { pending = false; render(); });
  }

  function get(scope, path) {
    path = path.trim();
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), v = scope[parts[0]];
    for (var i = 1; i < parts.length && v != null; i++) v = v[parts[i]];
    return v;
  }
  function interp(str, scope) {
    return str.replace(HOLE, function (m, p) { var v = get(scope, p); return v == null ? '' : String(v); });
  }

  function renderNode(node, scope, parent) {
    if (node.nodeType === 3) { parent.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    var tag = node.localName, kids = Array.prototype.slice.call(node.childNodes);
    if (tag === 'sc-for') {
      var list = get(scope, (node.getAttribute('list').match(WHOLE) || [])[1] || '') || [];
      var as = node.getAttribute('as') || 'item';
      list.forEach(function (it, i) {
        var sc = Object.create(scope); sc[as] = it; sc.$index = i;
        kids.forEach(function (c) { renderNode(c, sc, parent); });
      });
      return;
    }
    if (tag === 'sc-if') {
      var v = get(scope, (node.getAttribute('value').match(WHOLE) || [])[1] || '');
      if (v) kids.forEach(function (c) { renderNode(c, scope, parent); });
      return;
    }
    if (tag === 'helmet') return;
    var el = document.createElementNS(node.namespaceURI, node.tagName.toLowerCase() === tag ? tag : node.tagName);
    Array.prototype.slice.call(node.attributes).forEach(function (a) {
      var name = a.name, val = a.value, w = val.match(WHOLE);
      if (name.indexOf('on') === 0 && w) {
        var fn = get(scope, w[1]);
        if (typeof fn === 'function') el.addEventListener(EVENTS[name] || name.slice(2), fn);
        return;
      }
      if (w) {
        var x = get(scope, w[1]);
        if (name === 'value' && 'value' in el) el.value = x == null ? '' : x;
        if (x === false || x == null) return;
        el.setAttribute(name, x === true ? '' : String(x));
        return;
      }
      el.setAttribute(name, interp(val, scope));
    });
    kids.forEach(function (c) { renderNode(c, scope, el); });
    parent.appendChild(el);
  }

  function pathOf(el) {
    var p = [];
    while (el && el !== root) { p.unshift(Array.prototype.indexOf.call(el.parentNode.childNodes, el)); el = el.parentNode; }
    return el === root ? p : null;
  }
  function byPath(p) {
    var el = root;
    for (var i = 0; el && i < p.length; i++) el = el.childNodes[p[i]];
    return el;
  }

  function render() {
    var ae = document.activeElement, keep = null;
    if (ae && ae.tagName === 'INPUT' && root.contains(ae)) keep = { p: pathOf(ae), s: ae.selectionStart };
    var vals = inst.renderVals ? inst.renderVals() : {};
    var frag = document.createDocumentFragment();
    Array.prototype.slice.call(tpl.childNodes).forEach(function (c) { renderNode(c, vals, frag); });
    root.textContent = '';
    root.appendChild(frag);
    if (keep && keep.p) {
      var n = byPath(keep.p);
      if (n && n.tagName === 'INPUT') { n.focus(); try { n.setSelectionRange(keep.s, keep.s); } catch (e) {} }
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    tpl = document.querySelector('x-dc');
    var helmet = tpl.querySelector('helmet');
    if (helmet) { Array.prototype.slice.call(helmet.childNodes).forEach(function (n) { document.head.appendChild(n); }); helmet.remove(); }
    var sc = document.querySelector('script[data-dc-script]');
    root = document.createElement('div');
    root.id = 'dc-root';
    tpl.parentNode.insertBefore(root, tpl);
    tpl.remove();
    var Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    inst = new Comp({});
    render();
    if (inst.componentDidMount) inst.componentDidMount();
  });
})();
