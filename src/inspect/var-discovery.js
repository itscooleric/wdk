/**
 * INSPECT-008: Variable Discovery
 * Discovers app-specific globals, frameworks, structured data, hidden data,
 * client-side storage, and framework-specific state on unfamiliar web pages.
 * Zero dependencies, var declarations only.
 */
(function () {
  'use strict';

  /* ── Known browser globals (~150) packed as space-delimited string ── */
  var BROWSER_DEFAULTS_STR = 'undefined NaN Infinity eval isFinite isNaN parseFloat parseInt ' +
    'decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape ' +
    'Object Function Boolean Symbol Error EvalError RangeError ReferenceError ' +
    'SyntaxError TypeError URIError Number BigInt Math Date String RegExp Array ' +
    'Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array ' +
    'Uint32Array Float32Array Float64Array BigInt64Array BigUint64Array Map Set ' +
    'WeakMap WeakSet ArrayBuffer SharedArrayBuffer DataView Atomics JSON Promise ' +
    'Proxy Reflect Intl WebAssembly console globalThis window self document ' +
    'location navigator screen history frames parent top opener closed length ' +
    'name status frameElement customElements menubar toolbar locationbar ' +
    'personalbar scrollbars statusbar visualViewport performance crypto caches ' +
    'cookieStore crossOriginIsolated isSecureContext origin scheduler trustedTypes ' +
    'navigation alert confirm prompt print open close stop focus blur postMessage ' +
    'requestAnimationFrame cancelAnimationFrame requestIdleCallback ' +
    'cancelIdleCallback setTimeout clearTimeout setInterval clearInterval ' +
    'queueMicrotask createImageBitmap structuredClone atob btoa fetch ' +
    'XMLHttpRequest WebSocket EventSource BroadcastChannel MessageChannel ' +
    'MessagePort Worker SharedWorker Notification reportError addEventListener ' +
    'removeEventListener dispatchEvent getComputedStyle getSelection matchMedia ' +
    'moveTo moveBy resizeTo resizeBy scroll scrollTo scrollBy innerWidth ' +
    'innerHeight outerWidth outerHeight scrollX scrollY pageXOffset pageYOffset ' +
    'screenX screenY screenLeft screenTop devicePixelRatio localStorage ' +
    'sessionStorage indexedDB speechSynthesis chrome AbortController AbortSignal ' +
    'Blob File FileList FileReader FormData Headers Request Response URL ' +
    'URLSearchParams TextDecoder TextEncoder ReadableStream WritableStream ' +
    'TransformStream DOMException DOMParser XMLSerializer DocumentFragment ' +
    'Element HTMLElement Node NodeList Event CustomEvent EventTarget ' +
    'MutationObserver ResizeObserver IntersectionObserver PerformanceObserver ' +
    'Image Audio Option HTMLDocument HTMLCollection Range Selection CSSStyleSheet ' +
    'StyleSheet MediaQueryList CanvasRenderingContext2D WebGLRenderingContext ' +
    'WebGL2RenderingContext OffscreenCanvas ClipboardEvent DragEvent FocusEvent ' +
    'InputEvent KeyboardEvent MouseEvent PointerEvent TouchEvent WheelEvent ' +
    'AnimationEvent TransitionEvent ProgressEvent ErrorEvent StorageEvent ' +
    'PopStateEvent HashChangeEvent BeforeUnloadEvent PageTransitionEvent';

  var defaultSet = {};
  var _defaults = BROWSER_DEFAULTS_STR.split(' ');
  for (var i = 0; i < _defaults.length; i++) defaultSet[_defaults[i]] = true;

  /* ── Framework signatures ────────────────────────────────────────── */
  var FRAMEWORK_GLOBALS = {
    '__REACT_DEVTOOLS_GLOBAL_HOOK__': 'react', 'ReactDOM': 'react', 'React': 'react',
    '__VUE__': 'vue', 'Vue': 'vue', '__NEXT_DATA__': 'next.js', '__NUXT__': 'nuxt',
    'ng': 'angular', 'getAllAngularRootElements': 'angular',
    'jQuery': 'jquery', '$': 'jquery', 'Backbone': 'backbone', 'Ember': 'ember'
  };

  /* ── Helpers ─────────────────────────────────────────────────────── */
  function preview(val) {
    try {
      var t = typeof val;
      if (val === null) return 'null';
      if (t === 'undefined') return 'undefined';
      if (t === 'string') return val.length > 80 ? val.slice(0, 80) + '...' : val;
      if (t === 'number' || t === 'boolean') return String(val);
      if (t === 'function') return 'function(' + (val.length || 0) + ' args)';
      if (Array.isArray(val)) return 'Array(' + val.length + ')';
      if (t === 'object') {
        var keys = Object.keys(val);
        return '{' + keys.slice(0, 5).join(', ') + (keys.length > 5 ? ', ...' : '') + '}';
      }
      return String(val).slice(0, 80);
    } catch (e) { return '[unreadable]'; }
  }

  function safeJsonParse(str) {
    try { return JSON.parse(str); } catch (e) { return str; }
  }

  function byteLength(str) {
    try { return new Blob([str]).size; } catch (e) { return str.length; }
  }

  /* ── findAppGlobals ──────────────────────────────────────────────── */
  function findAppGlobals() {
    var results = [];
    var keys;
    try { keys = Object.getOwnPropertyNames(window); } catch (e) { keys = []; }
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (defaultSet[k]) continue;
      if (/^\d+$/.test(k)) continue;
      if (/^webkit|^on[a-z]/.test(k) && !FRAMEWORK_GLOBALS[k]) continue;
      var val, t;
      try { val = window[k]; t = typeof val; } catch (e) { t = 'inaccessible'; val = undefined; }
      results.push({ name: k, type: t, preview: preview(val), framework: FRAMEWORK_GLOBALS[k] || null });
    }
    return results;
  }

  /* ── findFramework ───────────────────────────────────────────────── */
  function findFramework() {
    var found = [];
    // React
    try {
      if (window.__REACT_DEVTOOLS_GLOBAL_HOOK__ || window.React || window.ReactDOM) {
        var ver = (window.React && window.React.version) ? window.React.version : null;
        found.push({ name: 'react', version: ver, detected_via: 'global' });
      }
    } catch (e) {}
    // Vue
    try {
      if (window.__VUE__ || window.Vue) {
        found.push({ name: 'vue', version: (window.Vue && window.Vue.version) || null, detected_via: 'global' });
      }
    } catch (e) {}
    // Angular
    try {
      if (window.ng || typeof window.getAllAngularRootElements === 'function') {
        var angVer = null;
        try { var v = document.querySelector('[ng-version]'); if (v) angVer = v.getAttribute('ng-version'); } catch (e2) {}
        found.push({ name: 'angular', version: angVer, detected_via: 'global' });
      }
    } catch (e) {}
    // Next.js
    try {
      if (window.__NEXT_DATA__) {
        found.push({ name: 'next.js', version: window.__NEXT_DATA__.buildId || null, detected_via: '__NEXT_DATA__' });
      }
    } catch (e) {}
    // Nuxt
    try { if (window.__NUXT__) found.push({ name: 'nuxt', version: null, detected_via: '__NUXT__' }); } catch (e) {}
    // Svelte — check DOM elements for __svelte property
    try {
      var allEls = document.querySelectorAll('*');
      for (var i = 0; i < Math.min(allEls.length, 500); i++) {
        var elKeys = Object.getOwnPropertyNames(allEls[i]);
        for (var j = 0; j < elKeys.length; j++) {
          if (elKeys[j].indexOf('__svelte') === 0) {
            found.push({ name: 'svelte', version: null, detected_via: 'dom_property' });
            i = 9999; break;
          }
        }
      }
    } catch (e) {}
    // jQuery
    try {
      if (window.jQuery) found.push({ name: 'jquery', version: window.jQuery.fn ? window.jQuery.fn.jquery : null, detected_via: 'global' });
    } catch (e) {}
    // Backbone
    try { if (window.Backbone) found.push({ name: 'backbone', version: window.Backbone.VERSION || null, detected_via: 'global' }); } catch (e) {}
    // Ember
    try { if (window.Ember) found.push({ name: 'ember', version: window.Ember.VERSION || null, detected_via: 'global' }); } catch (e) {}
    return found;
  }

  /* ── findStructuredData ──────────────────────────────────────────── */
  function findStructuredData() {
    var result = { jsonLd: [], microdata: [], metaTags: [], openGraph: {} };
    // JSON-LD
    try {
      var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < ldScripts.length; i++) {
        try { result.jsonLd.push(JSON.parse(ldScripts[i].textContent)); }
        catch (e) { result.jsonLd.push({ _raw: ldScripts[i].textContent, _error: 'parse_failed' }); }
      }
    } catch (e) {}
    // Microdata
    try {
      var items = document.querySelectorAll('[itemscope]');
      for (var m = 0; m < items.length; m++) {
        var entry = { type: items[m].getAttribute('itemtype'), id: items[m].getAttribute('itemid'), properties: {} };
        var props = items[m].querySelectorAll('[itemprop]');
        for (var p = 0; p < props.length; p++) {
          var pn = props[p].getAttribute('itemprop');
          entry.properties[pn] = props[p].getAttribute('content') || props[p].getAttribute('href') ||
            props[p].getAttribute('src') || props[p].textContent.trim().slice(0, 200);
        }
        result.microdata.push(entry);
      }
    } catch (e) {}
    // Meta tags + Open Graph
    try {
      var metas = document.querySelectorAll('meta[name], meta[property], meta[http-equiv]');
      for (var n = 0; n < metas.length; n++) {
        var prop = metas[n].getAttribute('property') || metas[n].getAttribute('name') || metas[n].getAttribute('http-equiv');
        var content = metas[n].getAttribute('content') || '';
        result.metaTags.push({ property: prop, content: content });
        if (prop && prop.indexOf('og:') === 0) result.openGraph[prop.slice(3)] = content;
      }
    } catch (e) {}
    return result;
  }

  /* ── findHiddenData ──────────────────────────────────────────────── */
  function findHiddenData() {
    var result = { hiddenInputs: [], dataAttributes: [] };
    // Hidden inputs
    try {
      var inputs = document.querySelectorAll('input[type="hidden"]');
      for (var i = 0; i < inputs.length; i++) {
        var formId = null;
        try { if (inputs[i].form) formId = inputs[i].form.id || inputs[i].form.getAttribute('name') || inputs[i].form.action; } catch (e) {}
        result.hiddenInputs.push({ name: inputs[i].name || inputs[i].id || null, value: (inputs[i].value || '').slice(0, 500), form: formId });
      }
    } catch (e) {}
    // Data attributes (limit 50)
    try {
      var allEls = document.querySelectorAll('*');
      var count = 0;
      for (var j = 0; j < allEls.length && count < 50; j++) {
        var el = allEls[j];
        var attrs = el.attributes;
        var dataAttrs = {};
        var hasData = false;
        for (var a = 0; a < attrs.length; a++) {
          if (attrs[a].name.indexOf('data-') === 0) {
            dataAttrs[attrs[a].name] = (attrs[a].value || '').slice(0, 200);
            hasData = true;
          }
        }
        if (hasData) {
          var tag = el.tagName.toLowerCase();
          var id = el.id ? '#' + el.id : '';
          var cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          result.dataAttributes.push({ element: tag + id + cls, attributes: dataAttrs });
          count++;
        }
      }
    } catch (e) {}
    return result;
  }

  /* ── findStorageData ─────────────────────────────────────────────── */
  function findStorageData() {
    var result = { localStorage: [], sessionStorage: [], cookies: [] };
    // localStorage
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        var raw = localStorage.getItem(key) || '';
        result.localStorage.push({ key: key, value: safeJsonParse(raw), size: byteLength(raw) });
      }
    } catch (e) {}
    // sessionStorage
    try {
      for (var j = 0; j < sessionStorage.length; j++) {
        var sKey = sessionStorage.key(j);
        var sRaw = sessionStorage.getItem(sKey) || '';
        result.sessionStorage.push({ key: sKey, value: safeJsonParse(sRaw), size: byteLength(sRaw) });
      }
    } catch (e) {}
    // Cookies
    try {
      var cookieStr = document.cookie || '';
      if (cookieStr) {
        var pairs = cookieStr.split(';');
        for (var c = 0; c < pairs.length; c++) {
          var eqIdx = pairs[c].indexOf('=');
          result.cookies.push({
            name: pairs[c].slice(0, eqIdx).trim(),
            value: pairs[c].slice(eqIdx + 1).trim(),
            domain: location.hostname,
            path: '/'
          });
        }
      }
    } catch (e) {}
    return result;
  }

  /* ── findReactState ──────────────────────────────────────────────── */
  function findReactState(root) {
    var results = [];
    try {
      root = root || document.getElementById('root') || document.getElementById('app') || document.body;
      if (!root) return results;
      var fiber = null;
      // React <18
      if (root._reactRootContainer) {
        try { fiber = root._reactRootContainer._internalRoot.current; } catch (e) {
          try { fiber = root._reactRootContainer.current; } catch (e2) {}
        }
      }
      // React 18+ — look for __reactFiber$ or __reactContainer$ key
      if (!fiber) {
        var rootKeys = Object.getOwnPropertyNames(root);
        for (var i = 0; i < rootKeys.length; i++) {
          if (rootKeys[i].indexOf('__reactFiber$') === 0 || rootKeys[i].indexOf('__reactContainer$') === 0) {
            fiber = root[rootKeys[i]]; break;
          }
        }
      }
      if (!fiber) return results;
      // BFS walk, depth-limited
      var queue = [{ node: fiber, depth: 0 }];
      var maxDepth = 10;
      var maxResults = 50;
      while (queue.length > 0 && results.length < maxResults) {
        var item = queue.shift();
        var node = item.node;
        var depth = item.depth;
        if (!node || depth > maxDepth) continue;
        try {
          var compName = null;
          if (node.type) compName = node.type.displayName || node.type.name || null;
          if (compName && (node.memoizedState || node.memoizedProps)) {
            var stateData = null;
            try {
              var hook = node.memoizedState;
              var states = [];
              var hookLimit = 10;
              while (hook && hookLimit > 0) {
                if (hook.memoizedState !== undefined && typeof hook.memoizedState !== 'function') states.push(hook.memoizedState);
                hook = hook.next; hookLimit--;
              }
              if (states.length > 0) stateData = states;
            } catch (e) {}
            results.push({ component: compName, props: node.memoizedProps ? Object.keys(node.memoizedProps) : [], state: stateData });
          }
        } catch (e) {}
        try { if (node.child) queue.push({ node: node.child, depth: depth + 1 }); } catch (e) {}
        try { if (node.sibling) queue.push({ node: node.sibling, depth: depth }); } catch (e) {}
      }
    } catch (e) {}
    return results;
  }

  /* ── findVueState ────────────────────────────────────────────────── */
  function findVueState(root) {
    var result = { version: null, instances: [] };
    try {
      root = root || document.getElementById('app') || document.getElementById('root') || document.body;
      if (!root) return result;
      if (window.Vue && window.Vue.version) result.version = window.Vue.version;
      var elements = root.querySelectorAll('*');
      var count = 0;
      for (var i = 0; i < elements.length && count < 30; i++) {
        var el = elements[i];
        var instance = null;
        try { if (el.__vue__) instance = el.__vue__; } catch (e) {}
        try { if (!instance && el.__vue_app__) instance = el.__vue_app__; } catch (e) {}
        if (!instance) continue;
        var entry = { el: el.tagName.toLowerCase() + (el.id ? '#' + el.id : ''), data: {}, computed: [] };
        // Vue 2
        try {
          if (instance.$data) {
            var dataKeys = Object.keys(instance.$data);
            for (var d = 0; d < dataKeys.length; d++) entry.data[dataKeys[d]] = preview(instance.$data[dataKeys[d]]);
          }
          if (instance.$options && instance.$options.computed) entry.computed = Object.keys(instance.$options.computed);
        } catch (e) {}
        // Vue 3
        try { if (instance.config) entry.data._appConfig = Object.keys(instance.config); } catch (e) {}
        result.instances.push(entry);
        count++;
      }
    } catch (e) {}
    return result;
  }

  /* ── discover (combined report) ──────────────────────────────────── */
  function discover() {
    var report = {};
    try { report.globals = findAppGlobals(); } catch (e) { report.globals = { error: e.message }; }
    try { report.frameworks = findFramework(); } catch (e) { report.frameworks = { error: e.message }; }
    try { report.structuredData = findStructuredData(); } catch (e) { report.structuredData = { error: e.message }; }
    try { report.hiddenData = findHiddenData(); } catch (e) { report.hiddenData = { error: e.message }; }
    try { report.storage = findStorageData(); } catch (e) { report.storage = { error: e.message }; }
    // Attempt framework-specific state extraction
    try { var rs = findReactState(); if (rs.length > 0) report.reactState = rs; } catch (e) {}
    try { var vs = findVueState(); if (vs.instances.length > 0) report.vueState = vs; } catch (e) {}
    report.summary = {
      appGlobals: report.globals.length || 0,
      frameworksDetected: report.frameworks.length || 0,
      jsonLdBlocks: report.structuredData.jsonLd ? report.structuredData.jsonLd.length : 0,
      hiddenInputs: report.hiddenData.hiddenInputs ? report.hiddenData.hiddenInputs.length : 0,
      localStorageKeys: report.storage.localStorage ? report.storage.localStorage.length : 0,
      sessionStorageKeys: report.storage.sessionStorage ? report.storage.sessionStorage.length : 0,
      cookies: report.storage.cookies ? report.storage.cookies.length : 0
    };
    return report;
  }

  /* ── Expose on DK namespace ──────────────────────────────────────── */
  if (!window.DK) window.DK = {};
  window.DK.varDiscovery = {
    findAppGlobals: findAppGlobals,
    findFramework: findFramework,
    findStructuredData: findStructuredData,
    findHiddenData: findHiddenData,
    findStorageData: findStorageData,
    findReactState: findReactState,
    findVueState: findVueState,
    discover: discover
  };

})();
