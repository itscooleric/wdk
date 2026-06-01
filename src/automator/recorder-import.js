/**
 * WDK Automator — Chrome DevTools Recorder JSON adapter.
 *
 * Converts a Recorder export (User Flow JSON) into WDK action format
 * consumable by replay.js / robo.js.
 *
 * Recorder JSON shape (v1):
 *   { title: "...", steps: [{ type, target?, selectors?, ... }, ...] }
 *
 * WDK action shape:
 *   { action: 'click'|'type'|'select'|'navigate'|'press'|'scroll'|'wait'|...,
 *     selector?: '...', value?: '...', url?: '...', key?: '...', x?, y? }
 *
 * Selector preference (Recorder gives an array of OR-groups, each group is
 * an array of selector strings):
 *   1. plain CSS (no scheme prefix)
 *   2. aria/<accessible name>     -> [aria-label="X"], role=button[name="X"], etc.
 *   3. text/<inner text>          -> :has-text() not standard; we emit a
 *                                    data attribute selector if possible,
 *                                    otherwise fall back to text-match in replay.
 *   4. xpath/...                  -> SKIPPED (replay does not support xpath in v1)
 *   5. pierce/...                 -> SKIPPED (shadow DOM, replay v1 does not pierce)
 */
(function () {
  'use strict';
  if (!window.DK) { window.DK = {}; }

  /* ------------------------------------------------------------------ */
  /*  Selector picker                                                    */
  /* ------------------------------------------------------------------ */

  // Recorder selectors are arrays of arrays. Outer array = OR groups
  // (try each in order until one matches). Inner array = AND chain
  // (e.g. iframe scoping). For v1 we collapse the AND chain to its
  // last element (the actual target inside the iframe).
  function pickSelector(selectorGroups) {
    if (!selectorGroups || !selectorGroups.length) { return null; }

    var candidates = [];
    for (var i = 0; i < selectorGroups.length; i++) {
      var group = selectorGroups[i];
      if (!group || !group.length) { continue; }
      // collapse AND chain: take last (innermost target)
      var sel = group[group.length - 1];
      if (typeof sel !== 'string') { continue; }
      candidates.push(sel);
    }

    // Tier 1: plain CSS (no scheme prefix, no shadow-pierce combinator)
    for (var j = 0; j < candidates.length; j++) {
      var c = candidates[j];
      if (!hasScheme(c) && c.indexOf('>>>') === -1) {
        return { type: 'css', value: c };
      }
    }

    // Tier 2: aria/
    for (var k = 0; k < candidates.length; k++) {
      if (candidates[k].indexOf('aria/') === 0) {
        return { type: 'aria', value: candidates[k].slice(5) };
      }
    }

    // Tier 3: text/
    for (var m = 0; m < candidates.length; m++) {
      if (candidates[m].indexOf('text/') === 0) {
        return { type: 'text', value: candidates[m].slice(5) };
      }
    }

    return null;
  }

  function hasScheme(sel) {
    return /^(aria|xpath|pierce|text)\//.test(sel);
  }

  // Convert structured selector { type, value } to a CSS-or-pseudo
  // selector string consumable by replay.js.
  // - css   -> as-is
  // - aria  -> [aria-label="X"] (best effort; replay also tries role+name)
  // - text  -> ::wdk-text("X") sentinel; replay handles by walking textContent
  function selectorToString(s) {
    if (!s) { return ''; }
    if (s.type === 'css')  { return s.value; }
    if (s.type === 'aria') { return '[aria-label="' + escAttr(s.value) + '"]'; }
    if (s.type === 'text') { return '::wdk-text("' + escAttr(s.value) + '")'; }
    return '';
  }

  function escAttr(v) {
    return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  /* ------------------------------------------------------------------ */
  /*  Step → action                                                      */
  /* ------------------------------------------------------------------ */

  function convertStep(step, opts) {
    var ignoreViewport = !opts || opts.ignoreViewport !== false;
    if (!step || !step.type) { return null; }

    switch (step.type) {
      case 'setViewport':
        // Single-page WDK Automator runs in current tab; viewport is
        // the user's window. Drop unless caller wants metadata.
        return ignoreViewport ? null : {
          action: 'viewport',
          width: step.width, height: step.height
        };

      case 'navigate': {
        if (!step.url) { return null; }
        return { action: 'navigate', url: step.url };
      }

      case 'click': {
        var s = pickSelector(step.selectors);
        if (!s) { return null; }
        var act = { action: 'click', selector: selectorToString(s) };
        if (step.offsetX != null) { act.offsetX = step.offsetX; }
        if (step.offsetY != null) { act.offsetY = step.offsetY; }
        return act;
      }

      case 'doubleClick': {
        var sd = pickSelector(step.selectors);
        if (!sd) { return null; }
        return { action: 'doubleClick', selector: selectorToString(sd) };
      }

      case 'change': {
        // Change = INPUT/TEXTAREA value set or SELECT option chosen
        var sc = pickSelector(step.selectors);
        if (!sc) { return null; }
        return {
          action: 'type', // replay decides type vs select via element tag
          selector: selectorToString(sc),
          value: step.value != null ? String(step.value) : ''
        };
      }

      case 'keyDown':
      case 'keyUp': {
        // Recorder emits keyDown+keyUp pairs. Collapse keyDown only;
        // skip keyUp (replay synthesizes both from press action).
        if (step.type === 'keyUp') { return null; }
        if (!step.key) { return null; }
        return { action: 'press', key: step.key };
      }

      case 'scroll': {
        var sx = step.x != null ? step.x : 0;
        var sy = step.y != null ? step.y : 0;
        var ss = step.selectors ? pickSelector(step.selectors) : null;
        var act2 = { action: 'scroll', x: sx, y: sy };
        if (ss) { act2.selector = selectorToString(ss); }
        return act2;
      }

      case 'hover': {
        var sh = pickSelector(step.selectors);
        if (!sh) { return null; }
        return { action: 'hover', selector: selectorToString(sh) };
      }

      case 'waitForElement': {
        var sw = pickSelector(step.selectors);
        if (!sw) { return null; }
        return {
          action: 'wait',
          selector: selectorToString(sw),
          operator: step.operator || '>=',
          count: step.count != null ? step.count : 1,
          timeout: step.timeout || 5000
        };
      }

      case 'waitForExpression': {
        if (!step.expression) { return null; }
        return {
          action: 'waitForExpression',
          expression: step.expression,
          timeout: step.timeout || 5000
        };
      }

      case 'customStep': {
        // User-defined; pass through verbatim under a wdk-custom action.
        return {
          action: 'custom',
          name: step.name,
          parameters: step.parameters || {}
        };
      }

      case 'emulateNetworkConditions':
      case 'setUserAgent':
      case 'close':
      case 'screenshot':
        // Recorder-only metadata steps; emit as no-op markers.
        return { action: 'noop', reason: step.type };

      default:
        return { action: 'noop', reason: 'unsupported:' + step.type };
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Top-level import                                                   */
  /* ------------------------------------------------------------------ */

  // Accepts: a Recorder JSON object, OR a JSON string, OR a File-like
  // input (Blob/File). Returns a script object compatible with
  // robo.createScript().
  function importRecorder(input, opts) {
    var options = opts || {};
    return parseInput(input).then(function (json) {
      if (!json || !Array.isArray(json.steps)) {
        throw new Error('Invalid Recorder JSON: missing steps array');
      }

      var actions = [];
      var skipped = [];

      for (var i = 0; i < json.steps.length; i++) {
        var step = json.steps[i];
        var act = convertStep(step, options);
        if (!act) {
          skipped.push({ index: i, type: step && step.type });
          continue;
        }
        if (act.action === 'noop' && options.dropNoops) {
          skipped.push({ index: i, type: step.type, reason: 'noop' });
          continue;
        }
        actions.push(act);
      }

      return {
        title: json.title || 'Imported Recording',
        actions: actions,
        skipped: skipped,
        sourceFormat: 'devtools-recorder',
        importedAt: new Date().toISOString()
      };
    });
  }

  function parseInput(input) {
    return new Promise(function (resolve, reject) {
      if (input == null) {
        reject(new Error('No input provided'));
        return;
      }
      if (typeof input === 'string') {
        try { resolve(JSON.parse(input)); }
        catch (e) { reject(new Error('Invalid JSON string: ' + e.message)); }
        return;
      }
      // File / Blob
      if (typeof Blob !== 'undefined' && input instanceof Blob) {
        var reader = new FileReader();
        reader.onload = function () {
          try { resolve(JSON.parse(reader.result)); }
          catch (e) { reject(new Error('Invalid JSON in file: ' + e.message)); }
        };
        reader.onerror = function () { reject(new Error('File read failed')); };
        reader.readAsText(input);
        return;
      }
      // Plain object
      if (typeof input === 'object') {
        resolve(input);
        return;
      }
      reject(new Error('Unsupported input type: ' + typeof input));
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  if (!window.DK.automator) { window.DK.automator = {}; }
  window.DK.automator.importRecorder = importRecorder;
  window.DK.automator.convertStep = convertStep;
  window.DK.automator.pickSelector = pickSelector;
  window.DK.automator.selectorToString = selectorToString;
})();
