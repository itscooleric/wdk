/**
 * INSPECT-007 — Page Explorer
 * Mini DevTools for pages where real DevTools aren't available.
 * Enumerates globals, DOM structure, event listeners, performance, and meta info.
 *
 * @module DK.pageExplorer
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /*  Default browser globals snapshot (used to filter app-specific)    */
  /* ------------------------------------------------------------------ */
  var BROWSER_GLOBALS = [
    'undefined', 'NaN', 'Infinity', 'eval', 'isFinite', 'isNaN',
    'parseFloat', 'parseInt', 'decodeURI', 'decodeURIComponent',
    'encodeURI', 'encodeURIComponent', 'escape', 'unescape',
    'Object', 'Function', 'Boolean', 'Symbol', 'Error', 'EvalError',
    'RangeError', 'ReferenceError', 'SyntaxError', 'TypeError', 'URIError',
    'Number', 'BigInt', 'Math', 'Date', 'String', 'RegExp', 'Array',
    'Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array',
    'Uint16Array', 'Int32Array', 'Uint32Array', 'Float32Array',
    'Float64Array', 'BigInt64Array', 'BigUint64Array', 'Map', 'Set',
    'WeakMap', 'WeakSet', 'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
    'Atomics', 'JSON', 'Promise', 'Proxy', 'Reflect', 'Intl',
    'WebAssembly', 'globalThis',
    // DOM / BOM
    'window', 'self', 'document', 'navigator', 'location', 'history',
    'screen', 'alert', 'confirm', 'prompt', 'open', 'close', 'stop',
    'focus', 'blur', 'frames', 'length', 'top', 'parent', 'opener',
    'frameElement', 'name', 'status', 'closed', 'innerHeight',
    'innerWidth', 'outerHeight', 'outerWidth', 'screenX', 'screenY',
    'pageXOffset', 'pageYOffset', 'scrollX', 'scrollY',
    'console', 'performance', 'crypto', 'indexedDB', 'sessionStorage',
    'localStorage', 'caches', 'cookieStore', 'crossOriginIsolated',
    'isSecureContext', 'origin', 'scheduler',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
    'cancelIdleCallback', 'queueMicrotask', 'structuredClone',
    'atob', 'btoa', 'fetch', 'createImageBitmap', 'reportError',
    'getComputedStyle', 'getSelection', 'matchMedia', 'moveTo',
    'moveBy', 'resizeTo', 'resizeBy', 'scroll', 'scrollTo', 'scrollBy',
    'postMessage', 'print',
    'XMLHttpRequest', 'FormData', 'URL', 'URLSearchParams', 'Headers',
    'Request', 'Response', 'Blob', 'File', 'FileReader', 'FileList',
    'ReadableStream', 'WritableStream', 'TransformStream',
    'AbortController', 'AbortSignal', 'Event', 'EventTarget',
    'CustomEvent', 'MessageChannel', 'MessagePort', 'BroadcastChannel',
    'Worker', 'SharedWorker', 'ServiceWorker', 'Notification',
    'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
    'PerformanceObserver', 'ReportingObserver',
    'HTMLElement', 'HTMLDocument', 'Element', 'Node', 'NodeList',
    'DOMParser', 'XMLSerializer', 'Range', 'Selection', 'TreeWalker',
    'NodeIterator', 'DocumentFragment', 'ShadowRoot', 'Image', 'Audio',
    'Option', 'TextDecoder', 'TextEncoder', 'CompressionStream',
    'DecompressionStream', 'WebSocket', 'CloseEvent', 'MessageEvent',
    'PopStateEvent', 'HashChangeEvent', 'StorageEvent',
    'CanvasRenderingContext2D', 'WebGLRenderingContext',
    'WebGL2RenderingContext', 'OffscreenCanvas',
    'visualViewport', 'speechSynthesis', 'clientInformation',
    'styleMedia', 'devicePixelRatio', 'external', 'chrome', 'webkit',
    'FinalizationRegistry', 'WeakRef', 'AggregateError',
    'PromiseRejectionEvent', 'SecurityPolicyViolationEvent',
    'trustedTypes', 'TrustedHTML', 'TrustedScript', 'TrustedScriptURL'
  ];

  var browserGlobalsSet = {};
  var i;
  for (i = 0; i < BROWSER_GLOBALS.length; i++) {
    browserGlobalsSet[BROWSER_GLOBALS[i]] = true;
  }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                           */
  /* ------------------------------------------------------------------ */
  function truncate(str, max) {
    max = max || 80;
    if (str.length <= max) return str;
    return str.slice(0, max - 3) + '...';
  }

  function previewValue(val) {
    var t = typeof val;
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (t === 'function') {
      return 'function(' + (val.length || 0) + ')';
    }
    if (Array.isArray(val)) {
      return '[length: ' + val.length + ']';
    }
    if (t === 'object') {
      var keys;
      try { keys = Object.keys(val); } catch (e) { return '{...}'; }
      if (keys.length <= 3) return '{' + keys.join(', ') + '}';
      return '{keys: ' + keys.length + '}';
    }
    return truncate(String(val), 80);
  }

  function selectorFor(el) {
    var s = el.tagName ? el.tagName.toLowerCase() : '?';
    if (el.id) s += '#' + el.id;
    else if (el.className && typeof el.className === 'string') {
      var first = el.className.trim().split(/\s+/)[0];
      if (first) s += '.' + first;
    }
    return s;
  }

  function toMB(bytes) {
    return bytes ? Math.round(bytes / 1048576 * 100) / 100 : 0;
  }

  function toKB(bytes) {
    return bytes ? Math.round(bytes / 1024 * 100) / 100 : 0;
  }

  /* ------------------------------------------------------------------ */
  /*  1. Page Globals                                                   */
  /* ------------------------------------------------------------------ */
  function getGlobals() {
    var results = [];
    var keys;
    try { keys = Object.getOwnPropertyNames(window); } catch (e) { keys = []; }

    for (var k = 0; k < keys.length; k++) {
      var name = keys[k];
      if (browserGlobalsSet[name]) continue;
      if (name === 'DK') continue;
      if (/^on[a-z]/.test(name)) continue;

      var type, preview;
      try {
        var val = window[name];
        type = typeof val;
        if (val === null) type = 'null';
        preview = previewValue(val);
      } catch (e) {
        type = 'inaccessible';
        preview = '[error]';
      }
      results.push({ name: name, type: type, preview: preview });
    }
    return results;
  }

  /* ------------------------------------------------------------------ */
  /*  2. DOM Summary                                                    */
  /* ------------------------------------------------------------------ */
  function getDOMSummary() {
    var all = document.querySelectorAll('*');
    var nodeCount = all.length;

    // Max depth
    var maxDepth = 0;
    for (var d = 0; d < all.length; d++) {
      var depth = 0;
      var node = all[d];
      while (node.parentElement) { depth++; node = node.parentElement; }
      if (depth > maxDepth) maxDepth = depth;
    }

    // Tag counts
    var tagMap = {};
    for (var t = 0; t < all.length; t++) {
      var tag = all[t].tagName.toLowerCase();
      tagMap[tag] = (tagMap[tag] || 0) + 1;
    }
    var tagPairs = [];
    for (var key in tagMap) {
      if (tagMap.hasOwnProperty(key)) tagPairs.push({ tag: key, count: tagMap[key] });
    }
    tagPairs.sort(function (a, b) { return b.count - a.count; });
    var tagCounts = {};
    for (var tp = 0; tp < Math.min(10, tagPairs.length); tp++) {
      tagCounts[tagPairs[tp].tag] = tagPairs[tp].count;
    }

    // Iframes
    var iframeEls = document.querySelectorAll('iframe');
    var iframeSrcs = [];
    for (var fi = 0; fi < iframeEls.length; fi++) {
      if (iframeEls[fi].src) iframeSrcs.push(iframeEls[fi].src);
    }

    // Shadow roots
    var shadowCount = 0;
    for (var sr = 0; sr < all.length; sr++) {
      if (all[sr].shadowRoot) shadowCount++;
    }

    // Images (broken)
    var imgs = document.querySelectorAll('img');
    var brokenImgs = [];
    for (var im = 0; im < imgs.length; im++) {
      if (imgs[im].complete && imgs[im].naturalWidth === 0) {
        brokenImgs.push(imgs[im].src || imgs[im].getAttribute('data-src') || '(no src)');
      }
    }

    // Scripts
    var scriptEls = document.querySelectorAll('script[src]');
    var scriptSrcs = [];
    for (var sc = 0; sc < scriptEls.length; sc++) {
      scriptSrcs.push(scriptEls[sc].src);
    }

    // Stylesheets
    var linkEls = document.querySelectorAll('link[rel="stylesheet"]');
    var sheetHrefs = [];
    for (var lk = 0; lk < linkEls.length; lk++) {
      if (linkEls[lk].href) sheetHrefs.push(linkEls[lk].href);
    }

    // Forms
    var formEls = document.querySelectorAll('form');
    var formsList = [];
    for (var fm = 0; fm < formEls.length; fm++) {
      formsList.push({
        action: formEls[fm].action || '(none)',
        method: (formEls[fm].method || 'GET').toUpperCase()
      });
    }

    // Data attributes
    var dataAttrCount = 0;
    for (var da = 0; da < all.length; da++) {
      var attrs = all[da].attributes;
      for (var ai = 0; ai < attrs.length; ai++) {
        if (attrs[ai].name.indexOf('data-') === 0) { dataAttrCount++; break; }
      }
    }

    return {
      nodeCount: nodeCount,
      depth: maxDepth,
      tagCounts: tagCounts,
      iframes: { count: iframeEls.length, srcs: iframeSrcs },
      shadowRoots: shadowCount,
      images: { count: imgs.length, broken: brokenImgs },
      scripts: { count: scriptEls.length, srcs: scriptSrcs },
      stylesheets: { count: linkEls.length, hrefs: sheetHrefs },
      forms: { count: formEls.length, list: formsList },
      dataAttributes: dataAttrCount
    };
  }

  /* ------------------------------------------------------------------ */
  /*  3. Event Listeners                                                */
  /* ------------------------------------------------------------------ */
  var COMMON_EVENTS = [
    'click', 'dblclick', 'mousedown', 'mouseup', 'mouseover', 'mouseout',
    'keydown', 'keyup', 'keypress', 'focus', 'blur', 'change', 'input',
    'submit', 'reset', 'scroll', 'resize', 'touchstart', 'touchend',
    'touchmove', 'pointerdown', 'pointerup'
  ];

  function getEventListeners() {
    var results = [];
    var interactive = document.querySelectorAll(
      'button, a, input, select, textarea, form, [role="button"], [tabindex]'
    );
    var hasNative = typeof window.getEventListeners === 'function';
    var seen = 0;

    for (var e = 0; e < interactive.length && seen < 50; e++) {
      var el = interactive[e];
      var events = [];

      if (hasNative) {
        try {
          var map = window.getEventListeners(el);
          for (var evName in map) {
            if (map.hasOwnProperty(evName)) events.push(evName);
          }
        } catch (err) { /* fall through to property check */ }
      }

      if (events.length === 0) {
        for (var c = 0; c < COMMON_EVENTS.length; c++) {
          var prop = 'on' + COMMON_EVENTS[c];
          if (typeof el[prop] === 'function') {
            events.push(COMMON_EVENTS[c]);
          }
        }
      }

      if (events.length > 0) {
        results.push({
          element: el.tagName.toLowerCase(),
          selector: selectorFor(el),
          events: events
        });
        seen++;
      }
    }
    return results;
  }

  /* ------------------------------------------------------------------ */
  /*  4. Performance                                                    */
  /* ------------------------------------------------------------------ */
  function getPerformance() {
    var result = {};

    // Memory
    if (performance.memory) {
      result.memory = {
        usedJSHeapSize: toMB(performance.memory.usedJSHeapSize),
        totalJSHeapSize: toMB(performance.memory.totalJSHeapSize),
        jsHeapSizeLimit: toMB(performance.memory.jsHeapSizeLimit),
        unit: 'MB'
      };
    } else {
      result.memory = null;
    }

    // Timing
    var nav = null;
    try {
      var entries = performance.getEntriesByType('navigation');
      if (entries && entries.length) nav = entries[0];
    } catch (e) { /* older browser */ }

    if (nav) {
      result.timing = {
        ttfb: Math.round(nav.responseStart - nav.requestStart),
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
        loadComplete: Math.round(nav.loadEventEnd - nav.startTime),
        unit: 'ms'
      };
    } else if (performance.timing) {
      var pt = performance.timing;
      result.timing = {
        ttfb: pt.responseStart - pt.requestStart,
        domContentLoaded: pt.domContentLoadedEventEnd - pt.navigationStart,
        loadComplete: pt.loadEventEnd - pt.navigationStart,
        unit: 'ms'
      };
    } else {
      result.timing = null;
    }

    // Resources
    var resources;
    try { resources = performance.getEntriesByType('resource'); } catch (e) { resources = []; }
    var byType = {};
    var totalTransfer = 0;
    for (var r = 0; r < resources.length; r++) {
      var type = resources[r].initiatorType || 'other';
      byType[type] = (byType[type] || 0) + 1;
      totalTransfer += resources[r].transferSize || 0;
    }
    result.resources = byType;
    result.resourceCount = resources.length;
    result.resourceSize = { total: toKB(totalTransfer), unit: 'KB' };

    // FPS — returns a starter function
    result.fps = function (callback) {
      var frames = 0;
      var start = performance.now();
      function tick() {
        frames++;
        if (performance.now() - start < 1000) {
          requestAnimationFrame(tick);
        } else {
          callback(frames);
        }
      }
      requestAnimationFrame(tick);
    };

    return result;
  }

  /* ------------------------------------------------------------------ */
  /*  5. Meta Info                                                      */
  /* ------------------------------------------------------------------ */
  function getMetaInfo() {
    var metas = document.querySelectorAll('meta[name], meta[property], meta[charset]');
    var metaList = [];
    for (var m = 0; m < metas.length; m++) {
      var name = metas[m].getAttribute('name') ||
                 metas[m].getAttribute('property') ||
                 (metas[m].hasAttribute('charset') ? 'charset' : '');
      var content = metas[m].getAttribute('content') ||
                    metas[m].getAttribute('charset') || '';
      if (name) metaList.push({ name: name, content: content });
    }

    var linkEls = document.querySelectorAll('link[rel]');
    var linkList = [];
    for (var l = 0; l < linkEls.length; l++) {
      linkList.push({
        rel: linkEls[l].getAttribute('rel') || '',
        href: linkEls[l].href || ''
      });
    }

    var csp = '';
    var cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (cspMeta) csp = cspMeta.getAttribute('content') || '';

    var dt = document.doctype;
    var doctypeStr = '';
    if (dt) {
      doctypeStr = '<!DOCTYPE ' + dt.name +
        (dt.publicId ? ' PUBLIC "' + dt.publicId + '"' : '') +
        (dt.systemId ? ' "' + dt.systemId + '"' : '') + '>';
    }

    return {
      title: document.title,
      url: location.href,
      charset: document.characterSet || document.charset || '',
      doctype: doctypeStr,
      metas: metaList,
      links: linkList,
      contentSecurityPolicy: csp
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */
  function explore() {
    return {
      globals: getGlobals(),
      dom: getDOMSummary(),
      eventListeners: getEventListeners(),
      performance: getPerformance(),
      meta: getMetaInfo()
    };
  }

  window.DK = window.DK || {};
  DK.pageExplorer = {
    getGlobals: getGlobals,
    getDOMSummary: getDOMSummary,
    getEventListeners: getEventListeners,
    getPerformance: getPerformance,
    getMetaInfo: getMetaInfo,
    explore: explore
  };

})();
