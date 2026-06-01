/**
 * Tests for WDK Automator — replay engine.
 *
 * Covers selector resolution (CSS + ::wdk-text sentinel), waitForSelector
 * polling, and the replay() control flow (onStep / onError / abort /
 * continueOnError).
 *
 * Browser globals are mocked at the top of the file. The mock is light:
 * enough to support querySelector, querySelectorAll, createTreeWalker,
 * dispatchEvent, MouseEvent / KeyboardEvent / Event, getBoundingClientRect.
 */
'use strict';

var { describe, it, beforeEach } = require('node:test');
var assert = require('node:assert/strict');

/* ------------------------------------------------------------------ */
/*  Tiny DOM mock                                                      */
/* ------------------------------------------------------------------ */

function MockEvent(type, init) {
  this.type = type;
  this.bubbles = !!(init && init.bubbles);
  this.cancelable = !!(init && init.cancelable);
  this.defaultPrevented = false;
  if (init && init.key != null) { this.key = init.key; }
  if (init && init.clientX != null) { this.clientX = init.clientX; }
  if (init && init.clientY != null) { this.clientY = init.clientY; }
}
MockEvent.prototype.preventDefault = function () { this.defaultPrevented = true; };

function MockEl(tag, opts) {
  opts = opts || {};
  this.tagName = tag.toUpperCase();
  this.id = opts.id || '';
  this.className = opts.className || '';
  this._attrs = opts.attrs || {};
  this.children = [];
  this.parentNode = null;
  this.ownerDocument = null;
  this._textContent = opts.text || '';
  this._listeners = {};
  this.value = opts.value != null ? opts.value : '';
  this.scrollLeft = 0;
  this.scrollTop = 0;
  this._rect = opts.rect || { left: 0, top: 0, width: 100, height: 30, bottom: 30, right: 100 };
}
MockEl.prototype.appendChild = function (c) {
  c.parentNode = this;
  c.ownerDocument = this.ownerDocument;
  this.children.push(c);
  return c;
};
MockEl.prototype.getAttribute = function (name) {
  return this._attrs[name] != null ? this._attrs[name] : null;
};
MockEl.prototype.setAttribute = function (name, value) {
  this._attrs[name] = String(value);
};
MockEl.prototype.matches = function (selector) {
  return matchSelector(this, selector);
};
MockEl.prototype.addEventListener = function (type, fn) {
  (this._listeners[type] = this._listeners[type] || []).push(fn);
};
MockEl.prototype.dispatchEvent = function (ev) {
  ev.target = this;
  var fns = this._listeners[ev.type] || [];
  for (var i = 0; i < fns.length; i++) { fns[i](ev); }
  return !ev.defaultPrevented;
};
MockEl.prototype.getBoundingClientRect = function () { return this._rect; };
MockEl.prototype.scrollIntoView = function () { /* noop */ };
MockEl.prototype.focus = function () { document.activeElement = this; };
Object.defineProperty(MockEl.prototype, 'textContent', {
  get: function () {
    if (this.children.length === 0) { return this._textContent; }
    var s = this._textContent || '';
    for (var i = 0; i < this.children.length; i++) {
      s += this.children[i].textContent || '';
    }
    return s;
  },
  set: function (v) { this._textContent = v; this.children = []; }
});

function matchSelector(el, selector) {
  // Tiny matcher: supports #id, .class, tag, [attr="val"], and combos
  // like 'tag.class' or 'tag#id' or '[attr="val"]'.
  var s = selector.trim();
  if (s === '*') { return true; }

  // attribute: [attr="val"] or [attr]
  var attrM = s.match(/^\[([\w-]+)(?:=["']([^"']*)["'])?\]$/);
  if (attrM) {
    var name = attrM[1];
    var val = attrM[2];
    var got = el.getAttribute(name);
    if (val == null) { return got != null; }
    return got === val;
  }

  if (s[0] === '#') { return el.id === s.slice(1); }
  if (s[0] === '.') {
    var classes = (el.className || '').split(/\s+/);
    return classes.indexOf(s.slice(1)) !== -1;
  }

  // tag.class or tag#id
  var tagM = s.match(/^(\w+)(?:([.#])([\w-]+))?$/);
  if (tagM) {
    if (el.tagName !== tagM[1].toUpperCase()) { return false; }
    if (!tagM[2]) { return true; }
    if (tagM[2] === '#') { return el.id === tagM[3]; }
    var c = (el.className || '').split(/\s+/);
    return c.indexOf(tagM[3]) !== -1;
  }

  return false;
}

function MockDocument() {
  this.documentElement = new MockEl('html');
  this.documentElement.ownerDocument = this;
  this.body = new MockEl('body');
  this.body.ownerDocument = this;
  this.documentElement.appendChild(this.body);
  this.activeElement = this.body;
  this._all = [this.documentElement, this.body];
}
MockDocument.prototype._index = function (el) {
  this._all.push(el);
  el.ownerDocument = this;
  for (var i = 0; i < el.children.length; i++) { this._index(el.children[i]); }
};
MockDocument.prototype.querySelector = function (selector) {
  for (var i = 0; i < this._all.length; i++) {
    if (matchSelector(this._all[i], selector)) { return this._all[i]; }
  }
  return null;
};
MockDocument.prototype.querySelectorAll = function (selector) {
  var hits = [];
  for (var i = 0; i < this._all.length; i++) {
    if (matchSelector(this._all[i], selector)) { hits.push(this._all[i]); }
  }
  return hits;
};
MockDocument.prototype.createTreeWalker = function (root, _what, _filter) {
  // Walk all elements descending from root (excluding root itself for
  // text-search use case is fine; we include root so root-match is
  // still found if its text equals).
  var startEls = [];
  if (root && root.documentElement) {
    // root is a MockDocument (any frame's document)
    startEls.push(root.documentElement);
  } else if (root === this) {
    startEls.push(this.documentElement);
  } else if (root && root.children) {
    startEls.push(root);
  }
  var nodes = [];
  function visit(el) {
    nodes.push(el);
    for (var i = 0; i < el.children.length; i++) { visit(el.children[i]); }
  }
  for (var i = 0; i < startEls.length; i++) { visit(startEls[i]); }
  var idx = -1;
  return {
    nextNode: function () {
      idx += 1;
      return idx < nodes.length ? nodes[idx] : null;
    }
  };
};

/* ------------------------------------------------------------------ */
/*  Wire up globals                                                    */
/* ------------------------------------------------------------------ */

var doc = new MockDocument();
global.document = doc;
global.window = {
  DK: {},
  innerHeight: 800,
  scrollTo: function (x, y) { doc._scrollX = x; doc._scrollY = y; },
  HTMLInputElement: { prototype: {} },
  HTMLTextAreaElement: { prototype: {} },
  HTMLSelectElement: { prototype: {} }
};
global.NodeFilter = { SHOW_ELEMENT: 1 };
global.MouseEvent = MockEvent;
global.KeyboardEvent = MockEvent;
global.Event = MockEvent;
global.location = { href: 'http://wdk.test/', hash: '' };

require('../src/automator/replay.js');
var R = require('../src/automator/replay.js');

/* ------------------------------------------------------------------ */
/*  Helper to (re)build a doc                                          */
/* ------------------------------------------------------------------ */

function freshDoc() {
  doc = new MockDocument();
  global.document = doc;
  return doc;
}

function add(parent, tag, opts) {
  var el = new MockEl(tag, opts);
  parent.appendChild(el);
  parent.ownerDocument._index(el);
  return el;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                       */
/* ------------------------------------------------------------------ */

describe('compareCount', function () {
  var cmp = R._internal.compareCount;

  it('==', function () { assert.equal(cmp(3, '==', 3), true); assert.equal(cmp(2, '==', 3), false); });
  it('>=', function () { assert.equal(cmp(3, '>=', 3), true); assert.equal(cmp(4, '>=', 3), true); assert.equal(cmp(2, '>=', 3), false); });
  it('<=', function () { assert.equal(cmp(2, '<=', 3), true); assert.equal(cmp(4, '<=', 3), false); });
  it('>',  function () { assert.equal(cmp(4, '>',  3), true); assert.equal(cmp(3, '>',  3), false); });
  it('<',  function () { assert.equal(cmp(2, '<',  3), true); assert.equal(cmp(3, '<',  3), false); });
  it('!=', function () { assert.equal(cmp(2, '!=', 3), true); assert.equal(cmp(3, '!=', 3), false); });
  it('defaults to >=', function () { assert.equal(cmp(3, undefined, 3), true); });
});

describe('unescapeAttr', function () {
  var u = R._internal.unescapeAttr;
  it('unescapes \\"', function () { assert.equal(u('a\\"b'), 'a"b'); });
  it('unescapes \\\\', function () { assert.equal(u('a\\\\b'), 'a\\b'); });
});

/* ------------------------------------------------------------------ */
/*  Selector resolution                                                */
/* ------------------------------------------------------------------ */

describe('resolveOne', function () {
  beforeEach(function () { freshDoc(); });

  it('finds by id', function () {
    var btn = add(doc.body, 'button', { id: 'submit' });
    var got = R.resolveOne('#submit');
    assert.equal(got, btn);
  });

  it('finds by class', function () {
    var d = add(doc.body, 'div', { className: 'card' });
    var got = R.resolveOne('.card');
    assert.equal(got, d);
  });

  it('finds by aria-label attr', function () {
    var b = add(doc.body, 'button', { attrs: { 'aria-label': 'Login' } });
    var got = R.resolveOne('[aria-label="Login"]');
    assert.equal(got, b);
  });

  it('returns null when missing', function () {
    assert.equal(R.resolveOne('#nope'), null);
  });

  it('handles ::wdk-text sentinel', function () {
    var s = add(doc.body, 'span', { text: 'Hello there' });
    var got = R.resolveOne('::wdk-text("Hello there")');
    assert.equal(got, s);
  });

  it('pierces into a same-origin iframe to find a selector', function () {
    var inner = new MockDocument();
    var innerBtn = add(inner.body, 'button', { id: 'inframe' });
    var iframeEl = new MockEl('iframe');
    iframeEl.contentDocument = inner;
    doc.body.appendChild(iframeEl);
    doc._index(iframeEl);
    assert.equal(R.resolveOne('#inframe'), innerBtn);
  });

  it('iframe text-sentinel match', function () {
    var inner = new MockDocument();
    var span = add(inner.body, 'span', { text: 'Inside Frame' });
    var iframeEl = new MockEl('iframe');
    iframeEl.contentDocument = inner;
    doc.body.appendChild(iframeEl);
    doc._index(iframeEl);
    assert.equal(R.resolveOne('::wdk-text("Inside Frame")'), span);
  });

  it('cross-origin iframe (contentDocument throws) silently skipped', function () {
    var iframeEl = new MockEl('iframe');
    Object.defineProperty(iframeEl, 'contentDocument', {
      get: function () { throw new Error('cross-origin'); }
    });
    doc.body.appendChild(iframeEl);
    doc._index(iframeEl);
    assert.equal(R.resolveOne('#nope-in-cross-origin'), null);
  });

  it('returns null on invalid CSS', function () {
    assert.equal(R.resolveOne('::completely-bogus'), null);
  });
});

describe('resolveAll', function () {
  beforeEach(function () { freshDoc(); });

  it('finds all by class', function () {
    var a = add(doc.body, 'div', { className: 'row' });
    var b = add(doc.body, 'div', { className: 'row' });
    var got = R.resolveAll('.row');
    assert.equal(got.length, 2);
    assert.equal(got[0], a);
    assert.equal(got[1], b);
  });

  it('returns empty for missing', function () {
    assert.deepEqual(R.resolveAll('#nope'), []);
  });

  it('finds all by ::wdk-text sentinel', function () {
    add(doc.body, 'span', { text: 'Foo' });
    add(doc.body, 'span', { text: 'Foo' });
    add(doc.body, 'span', { text: 'Bar' });
    var got = R.resolveAll('::wdk-text("Foo")');
    assert.equal(got.length, 2);
  });
});

/* ------------------------------------------------------------------ */
/*  waitForSelector                                                    */
/* ------------------------------------------------------------------ */

describe('waitForSelector', function () {
  beforeEach(function () { freshDoc(); });

  it('resolves immediately when match present', async function () {
    var btn = add(doc.body, 'button', { id: 'go' });
    var el = await R.waitForSelector('#go', { timeout: 200 });
    assert.equal(el, btn);
  });

  it('resolves after element appears', async function () {
    setTimeout(function () { add(doc.body, 'div', { id: 'late' }); }, 50);
    var el = await R.waitForSelector('#late', { timeout: 500 });
    assert.equal(el.id, 'late');
  });

  it('rejects on timeout', async function () {
    await assert.rejects(
      function () { return R.waitForSelector('#never', { timeout: 100 }); },
      /timeout/
    );
  });

  it('honors operator + count', async function () {
    add(doc.body, 'div', { className: 'row' });
    add(doc.body, 'div', { className: 'row' });
    var el = await R.waitForSelector('.row', { operator: '==', count: 2, timeout: 200 });
    assert.ok(el); // first match returned
  });

  it('rejects when count operator never matches', async function () {
    add(doc.body, 'div', { className: 'row' });
    await assert.rejects(
      function () { return R.waitForSelector('.row', { operator: '==', count: 5, timeout: 100 }); },
      /timeout/
    );
  });
});

/* ------------------------------------------------------------------ */
/*  waitForExpression                                                  */
/* ------------------------------------------------------------------ */

describe('waitForExpression', function () {
  it('resolves when expression is truthy', async function () {
    var ok = await R.waitForExpression('1+1===2', 200);
    assert.equal(ok, true);
  });

  it('rejects on timeout for falsy expression', async function () {
    await assert.rejects(
      function () { return R.waitForExpression('1===2', 100); },
      /expression timeout/
    );
  });

  it('treats throwing expression as falsy and times out', async function () {
    await assert.rejects(
      function () { return R.waitForExpression('throw new Error("x")', 100); },
      /expression timeout/
    );
  });
});

/* ------------------------------------------------------------------ */
/*  replay() control flow                                              */
/* ------------------------------------------------------------------ */

describe('replay()', function () {
  beforeEach(function () { freshDoc(); });

  it('runs noop actions in order, calls onStep and onDone', async function () {
    var seen = [];
    var done = null;
    var ctrl = R.replay(
      [{ action: 'noop' }, { action: 'viewport' }, { action: 'noop' }],
      {
        stepDelay: 0,
        onStep: function (i) { seen.push(i); },
        onDone: function (results) { done = results; }
      }
    );
    var out = await ctrl.promise;
    assert.deepEqual(seen, [0, 1, 2]);
    assert.equal(done.length, 3);
    assert.equal(out.aborted, false);
    assert.equal(out.results.length, 3);
    assert.ok(out.results.every(function (r) { return r.ok; }));
  });

  it('press fires keyboard events on activeElement', async function () {
    var captured = [];
    doc.body.addEventListener('keydown', function (e) { captured.push(e.key); });
    var ctrl = R.replay([{ action: 'press', key: 'Enter' }], { stepDelay: 0 });
    await ctrl.promise;
    assert.deepEqual(captured, ['Enter']);
  });

  it('click resolves selector and dispatches click', async function () {
    var btn = add(doc.body, 'button', { id: 'go' });
    var clicks = 0;
    btn.addEventListener('click', function () { clicks += 1; });
    var ctrl = R.replay([{ action: 'click', selector: '#go' }], { stepDelay: 0 });
    var out = await ctrl.promise;
    assert.equal(clicks, 1);
    assert.equal(out.results[0].ok, true);
  });

  it('type sets value and fires input + change', async function () {
    var input = add(doc.body, 'input', { id: 'name' });
    var inputs = 0; var changes = 0;
    input.addEventListener('input', function () { inputs += 1; });
    input.addEventListener('change', function () { changes += 1; });
    var ctrl = R.replay(
      [{ action: 'type', selector: '#name', value: 'alice' }],
      { stepDelay: 0 }
    );
    await ctrl.promise;
    assert.equal(input.value, 'alice');
    assert.equal(inputs, 1);
    assert.equal(changes, 1);
  });

  it('halts on first error by default', async function () {
    var errs = [];
    var ctrl = R.replay(
      [{ action: 'noop' }, { action: 'click', selector: '#nope' }, { action: 'noop' }],
      {
        stepDelay: 0,
        timeout: 50,
        onError: function (i, _a, e) { errs.push({ i: i, msg: e.message }); }
      }
    );
    var out = await ctrl.promise;
    assert.equal(errs.length, 1);
    assert.equal(errs[0].i, 1);
    assert.equal(out.results.length, 2);   // ran 0 and 1 (which failed)
    assert.equal(out.results[1].ok, false);
  });

  it('continueOnError keeps going after failures', async function () {
    var errs = [];
    var ctrl = R.replay(
      [{ action: 'noop' }, { action: 'click', selector: '#nope' }, { action: 'noop' }],
      {
        stepDelay: 0,
        timeout: 50,
        continueOnError: true,
        onError: function (i) { errs.push(i); }
      }
    );
    var out = await ctrl.promise;
    assert.equal(errs.length, 1);
    assert.equal(out.results.length, 3);
    assert.equal(out.results[0].ok, true);
    assert.equal(out.results[1].ok, false);
    assert.equal(out.results[2].ok, true);
  });

  it('stop() aborts mid-flight', async function () {
    var actions = [];
    for (var i = 0; i < 50; i++) { actions.push({ action: 'noop' }); }
    var hits = 0;
    var ctrl = R.replay(actions, {
      stepDelay: 5,
      onStep: function () { hits += 1; if (hits === 3) { ctrl.stop(); } }
    });
    var out = await ctrl.promise;
    assert.equal(out.aborted, true);
    assert.ok(hits >= 3 && hits < 50, 'hits=' + hits);
  });

  it('custom action invokes registered handler', async function () {
    var calls = [];
    var ctrl = R.replay(
      [{ action: 'custom', name: 'doThing', parameters: { n: 7 } }],
      {
        stepDelay: 0,
        customHandlers: { doThing: function (p) { calls.push(p); return 'ok'; } }
      }
    );
    await ctrl.promise;
    assert.deepEqual(calls, [{ n: 7 }]);
  });

  it('custom action with no handler is a no-op', async function () {
    var ctrl = R.replay(
      [{ action: 'custom', name: 'unknown' }],
      { stepDelay: 0 }
    );
    var out = await ctrl.promise;
    assert.equal(out.results[0].ok, true);
  });

  it('rejects (as failed result) on unknown action', async function () {
    var ctrl = R.replay([{ action: 'totally-unknown' }], { stepDelay: 0 });
    var out = await ctrl.promise;
    assert.equal(out.results[0].ok, false);
    assert.match(out.results[0].error.message, /unknown action/);
  });
});
