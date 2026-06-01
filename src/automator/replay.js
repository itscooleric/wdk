/**
 * WDK Automator — in-page replay engine.
 *
 * Plays back a list of WDK actions in the current tab using synthetic
 * DOM events. Single-page only. Multi-page flows are handled by the
 * external Chrome DevTools Recorder; WDK Automator picks up after the
 * page is loaded.
 *
 * Usage:
 *   var ctrl = DK.automator.replay(actions, {
 *     stepDelay: 200,                // ms between steps
 *     timeout:   5000,               // default per-step wait
 *     onStep:    function (i, act, el) { ... },
 *     onError:   function (i, act, err) { ... },
 *     onDone:    function (results) { ... }
 *   });
 *   ctrl.stop();   // abort mid-flight
 *   ctrl.promise;  // resolves with results array
 *
 * Action types supported:
 *   navigate, click, doubleClick, type, select, press, scroll, hover,
 *   wait (waitForElement), waitForExpression, custom, viewport, noop
 *
 * Selector resolution mirrors recorder-import.js output:
 *   - plain CSS                    -> document.querySelector
 *   - [aria-label="X"]             -> document.querySelector (also tries
 *                                     role-and-name fallback)
 *   - ::wdk-text("X")              -> textContent walk
 */
(function () {
  'use strict';
  if (!window.DK) { window.DK = {}; }
  if (!window.DK.automator) { window.DK.automator = {}; }

  /* ------------------------------------------------------------------ */
  /*  Selector resolution                                                */
  /* ------------------------------------------------------------------ */

  // Match leading ::wdk-text("…")
  var TEXT_SENTINEL = /^::wdk-text\("(.+)"\)$/;

  // Recursive resolveOne — searches the given root document first, then
  // pierces same-origin iframes in DOM order. Cross-origin iframes are
  // silently skipped (contentDocument access throws).
  function resolveOne(selector, root) {
    if (!selector) { return null; }
    root = root || document;

    var m = selector.match(TEXT_SENTINEL);
    if (m) {
      var t = unescapeAttr(m[1]);
      var hit = findByText(t, root);
      if (hit) { return hit; }
      // Recurse into iframes for text-sentinel matches
      var fr = _safeIframes(root);
      for (var k = 0; k < fr.length; k++) {
        var fd = _frameDoc(fr[k]);
        if (!fd) { continue; }
        hit = resolveOne(selector, fd);
        if (hit) { return hit; }
      }
      return null;
    }

    try {
      var localHit = root.querySelector(selector);
      if (localHit) { return localHit; }
    } catch (e) { /* invalid selector — try iframes */ }

    var frames = _safeIframes(root);
    for (var i = 0; i < frames.length; i++) {
      var doc = _frameDoc(frames[i]);
      if (!doc) { continue; }
      var subHit = resolveOne(selector, doc);
      if (subHit) { return subHit; }
    }
    return null;
  }

  function resolveAll(selector, root) {
    if (!selector) { return []; }
    root = root || document;

    var hits = [];
    var m = selector.match(TEXT_SENTINEL);
    if (m) {
      hits = findAllByText(unescapeAttr(m[1]), root);
    } else {
      try {
        hits = Array.prototype.slice.call(root.querySelectorAll(selector));
      } catch (e) { /* invalid selector — try iframes only */ }
    }

    var frames = _safeIframes(root);
    for (var i = 0; i < frames.length; i++) {
      var doc = _frameDoc(frames[i]);
      if (!doc) { continue; }
      var sub = resolveAll(selector, doc);
      for (var j = 0; j < sub.length; j++) { hits.push(sub[j]); }
    }
    return hits;
  }

  function _safeIframes(root) {
    try {
      if (root.querySelectorAll) {
        return Array.prototype.slice.call(root.querySelectorAll('iframe'));
      }
    } catch (e) { /* swallow */ }
    return [];
  }

  function _frameDoc(iframeEl) {
    // contentDocument throws on cross-origin in some browsers; access
    // safely and return null on failure.
    try { return iframeEl.contentDocument || null; }
    catch (e) { return null; }
  }

  function findByText(text, root) {
    var all = findAllByText(text, root);
    return all.length ? all[0] : null;
  }

  function findAllByText(text, root) {
    if (!text) { return []; }
    var t = text.trim();
    var hits = [];
    // Walk all elements; pick the leaf-most match (no element-children
    // contain the same text).
    var walker = root.ownerDocument
      ? root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null)
      : document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
    var el;
    while ((el = walker.nextNode())) {
      var inner = (el.textContent || '').trim();
      if (inner !== t) { continue; }
      // leaf-ish: no descendant matches the same text
      var leaf = true;
      for (var i = 0; i < el.children.length; i++) {
        if ((el.children[i].textContent || '').trim() === t) { leaf = false; break; }
      }
      if (leaf) { hits.push(el); }
    }
    return hits;
  }

  function unescapeAttr(s) {
    return String(s).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }

  /* ------------------------------------------------------------------ */
  /*  Wait helpers                                                       */
  /* ------------------------------------------------------------------ */

  function waitForSelector(selector, opts) {
    var timeout = (opts && opts.timeout) || 5000;
    var operator = (opts && opts.operator) || '>=';
    var count = (opts && opts.count) != null ? opts.count : 1;
    var poll = (opts && opts.pollInterval) || 80;

    return new Promise(function (resolve, reject) {
      var start = Date.now();
      function tick() {
        var els = resolveAll(selector);
        if (compareCount(els.length, operator, count)) {
          resolve(els[0] || null);
          return;
        }
        if (Date.now() - start >= timeout) {
          reject(new Error(
            'wait timeout: ' + selector + ' (got ' + els.length +
            ', need ' + operator + ' ' + count + ')'
          ));
          return;
        }
        setTimeout(tick, poll);
      }
      tick();
    });
  }

  function compareCount(actual, op, expected) {
    switch (op) {
      case '==': return actual === expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      case '>':  return actual > expected;
      case '<':  return actual < expected;
      case '!=': return actual !== expected;
      default:   return actual >= expected;
    }
  }

  function waitForExpression(expression, timeout) {
    var to = timeout || 5000;
    var poll = 80;
    return new Promise(function (resolve, reject) {
      var start = Date.now();
      function tick() {
        var ok = false;
        try { ok = !!new Function('return (' + expression + ')')(); }
        catch (e) { /* keep polling */ }
        if (ok) { resolve(true); return; }
        if (Date.now() - start >= to) {
          reject(new Error('expression timeout: ' + expression));
          return;
        }
        setTimeout(tick, poll);
      }
      tick();
    });
  }

  function delay(ms) {
    return new Promise(function (r) { setTimeout(r, ms || 0); });
  }

  /* ------------------------------------------------------------------ */
  /*  Synthetic event dispatch                                           */
  /* ------------------------------------------------------------------ */

  function fireMouse(el, type, opts) {
    opts = opts || {};
    var rect = el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: 0, height: 0 };
    var x = rect.left + (opts.offsetX != null ? opts.offsetX : rect.width / 2);
    var y = rect.top + (opts.offsetY != null ? opts.offsetY : rect.height / 2);

    var ev = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      button: 0,
      clientX: x,
      clientY: y
    });
    el.dispatchEvent(ev);
  }

  function fireClick(el, opts) {
    fireMouse(el, 'mousedown', opts);
    fireMouse(el, 'mouseup', opts);
    fireMouse(el, 'click', opts);
  }

  function fireDoubleClick(el, opts) {
    fireClick(el, opts);
    fireClick(el, opts);
    fireMouse(el, 'dblclick', opts);
  }

  function fireHover(el, opts) {
    fireMouse(el, 'mouseover', opts);
    fireMouse(el, 'mouseenter', opts);
    fireMouse(el, 'mousemove', opts);
  }

  // Type into INPUT/TEXTAREA: set value, then fire input + change.
  // For React/Vue, we set value via the prototype descriptor so
  // their internal trackers see the change.
  function setValue(el, value) {
    var tag = el.tagName;
    if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
      el.value = value;
      return;
    }

    var proto = tag === 'SELECT'
      ? window.HTMLSelectElement && window.HTMLSelectElement.prototype
      : tag === 'TEXTAREA'
      ? window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement && window.HTMLInputElement.prototype;

    var desc = proto && Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) {
      desc.set.call(el, value);
    } else {
      el.value = value;
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function fireKey(el, key) {
    el = el || document.activeElement || document.body;
    var common = { bubbles: true, cancelable: true, key: key };
    el.dispatchEvent(new KeyboardEvent('keydown', common));
    el.dispatchEvent(new KeyboardEvent('keypress', common));
    el.dispatchEvent(new KeyboardEvent('keyup', common));
  }

  function scrollTo(el, x, y) {
    if (el && el !== document && el !== document.documentElement && el !== document.body) {
      el.scrollLeft = x || 0;
      el.scrollTop = y || 0;
    } else {
      window.scrollTo(x || 0, y || 0);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Step executors                                                     */
  /* ------------------------------------------------------------------ */

  function execStep(action, ctx) {
    switch (action.action) {
      case 'navigate':
        // Same-origin nav only. Cross-origin will reload and abort the
        // replay loop (acceptable for v1; multi-page flows go through
        // DevTools Recorder).
        return navigateSamePage(action.url);

      case 'click':
        return waitForSelector(action.selector, { timeout: ctx.timeout })
          .then(function (el) {
            scrollIntoViewIfNeeded(el);
            fireClick(el, { offsetX: action.offsetX, offsetY: action.offsetY });
            return el;
          });

      case 'doubleClick':
        return waitForSelector(action.selector, { timeout: ctx.timeout })
          .then(function (el) {
            scrollIntoViewIfNeeded(el);
            fireDoubleClick(el);
            return el;
          });

      case 'type':
        return waitForSelector(action.selector, { timeout: ctx.timeout })
          .then(function (el) {
            scrollIntoViewIfNeeded(el);
            if (typeof el.focus === 'function') { el.focus(); }
            setValue(el, action.value || '');
            return el;
          });

      case 'select':
        return waitForSelector(action.selector, { timeout: ctx.timeout })
          .then(function (el) {
            setValue(el, action.value || '');
            return el;
          });

      case 'press':
        fireKey(document.activeElement, action.key);
        return Promise.resolve(null);

      case 'scroll':
        if (action.selector) {
          return waitForSelector(action.selector, { timeout: ctx.timeout })
            .then(function (el) { scrollTo(el, action.x, action.y); return el; });
        }
        scrollTo(null, action.x, action.y);
        return Promise.resolve(null);

      case 'hover':
        return waitForSelector(action.selector, { timeout: ctx.timeout })
          .then(function (el) { fireHover(el); return el; });

      case 'wait':
        return waitForSelector(action.selector, {
          timeout: action.timeout || ctx.timeout,
          operator: action.operator,
          count: action.count
        });

      case 'waitForExpression':
        return waitForExpression(action.expression, action.timeout || ctx.timeout);

      case 'custom':
        if (ctx.customHandlers && ctx.customHandlers[action.name]) {
          return Promise.resolve(ctx.customHandlers[action.name](action.parameters || {}));
        }
        return Promise.resolve(null);

      case 'viewport':
      case 'noop':
        return Promise.resolve(null);

      default:
        return Promise.reject(new Error('unknown action: ' + action.action));
    }
  }

  function scrollIntoViewIfNeeded(el) {
    if (!el || !el.getBoundingClientRect) { return; }
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < 0 || r.bottom > vh) {
      try { el.scrollIntoView({ block: 'center', inline: 'center' }); }
      catch (e) { el.scrollIntoView(); }
    }
  }

  function navigateSamePage(url) {
    if (!url) { return Promise.resolve(null); }
    var current = location.href;
    if (url === current) { return Promise.resolve(null); }
    location.href = url;
    // Bail; the page will reload and replay loop will be torn down.
    return Promise.resolve({ navigated: url });
  }

  /* ------------------------------------------------------------------ */
  /*  Public replay()                                                    */
  /* ------------------------------------------------------------------ */

  function replay(actions, options) {
    var opts = options || {};
    var ctx = {
      timeout: opts.timeout || 5000,
      customHandlers: opts.customHandlers || {}
    };
    var stepDelay = opts.stepDelay != null ? opts.stepDelay : 100;
    var stopFlag = { aborted: false };
    var results = [];

    var promise = (function loop() {
      var i = 0;
      function next() {
        if (stopFlag.aborted) {
          return Promise.resolve({ aborted: true, results: results });
        }
        if (i >= actions.length) {
          if (typeof opts.onDone === 'function') { opts.onDone(results); }
          return Promise.resolve({ aborted: false, results: results });
        }
        var act = actions[i];
        var idx = i;
        i += 1;

        return execStep(act, ctx).then(function (el) {
          var entry = { index: idx, action: act, ok: true, element: el };
          results.push(entry);
          if (typeof opts.onStep === 'function') {
            try { opts.onStep(idx, act, el); } catch (_) { /* swallow */ }
          }
          return delay(stepDelay).then(next);
        }, function (err) {
          var entry = { index: idx, action: act, ok: false, error: err };
          results.push(entry);
          if (typeof opts.onError === 'function') {
            try { opts.onError(idx, act, err); } catch (_) { /* swallow */ }
          }
          if (opts.continueOnError) {
            return delay(stepDelay).then(next);
          }
          return Promise.resolve({ aborted: false, results: results, error: err });
        });
      }
      return next();
    }());

    return {
      promise: promise,
      stop: function () { stopFlag.aborted = true; }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  window.DK.automator.replay = replay;
  window.DK.automator.resolveOne = resolveOne;
  window.DK.automator.resolveAll = resolveAll;
  window.DK.automator.waitForSelector = waitForSelector;
  window.DK.automator.waitForExpression = waitForExpression;

  // Module exports for testing under Node
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      replay: replay,
      resolveOne: resolveOne,
      resolveAll: resolveAll,
      waitForSelector: waitForSelector,
      waitForExpression: waitForExpression,
      _internal: {
        compareCount: compareCount,
        unescapeAttr: unescapeAttr
      }
    };
  }
})();
