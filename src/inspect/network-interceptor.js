/**
 * INSPECT-003 + INSPECT-004: Network Interceptor
 * Monkey-patches XMLHttpRequest and fetch to capture all network requests.
 *
 * Captures (per entry):
 *   type:              'xhr' | 'fetch'
 *   url, method, status
 *   contentType
 *   requestHeaders     map
 *   requestBody        string (utf-8 best-effort)
 *   responseHeaders    map
 *   responseBody       string
 *   parsedJSON         (if content-type is JSON)
 *   size, timing
 *   timestamp          ISO
 *   initiator          parsed Error stack (best-effort, top frames only)
 *   initiatorRaw       full stack string
 *
 * Zero dependencies.
 */
(function () {
  'use strict';

  var MAX_ENTRIES = 500;

  function startIntercepting() {
    var log = [];
    var callbacks = [];
    var stopped = false;

    // Track every (window, originals) pair we install on so stop()
    // can fully restore. Top frame + same-origin iframes share the
    // same callback bus but each has its own XHR prototype + fetch.
    var installed = [];   // [{win, OrigXHR, origOpen, origSend, origSetReqHdr, origFetch}]
    var observer = null;  // MutationObserver for new iframes

    function addEntry(entry) {
      if (stopped) { return; }
      if (log.length >= MAX_ENTRIES) { log.shift(); }
      log.push(entry);
      for (var i = 0; i < callbacks.length; i++) {
        try { callbacks[i](entry); } catch (e) { /* swallow */ }
      }
    }

    function tryParseJSON(text, contentType) {
      if (!contentType || contentType.indexOf('json') === -1) { return undefined; }
      try { return JSON.parse(text); } catch (e) { return undefined; }
    }

    function safeStringLength(val) {
      if (val == null) { return 0; }
      if (typeof val === 'string') { return val.length; }
      try { return JSON.stringify(val).length; } catch (e) { return 0; }
    }

    // Best-effort body coercion for fetch init.body
    function coerceBody(body) {
      if (body == null) { return ''; }
      if (typeof body === 'string') { return body; }
      try {
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
          return body.toString();
        }
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          var pairs = [];
          // FormData has .entries() in modern browsers
          if (typeof body.entries === 'function') {
            var iter = body.entries();
            var step = iter.next();
            while (!step.done) {
              pairs.push(step.value[0] + '=' + String(step.value[1]).slice(0, 200));
              step = iter.next();
            }
            return '[FormData] ' + pairs.join('&');
          }
          return '[FormData]';
        }
        if (typeof Blob !== 'undefined' && body instanceof Blob) {
          return '[Blob ' + body.size + 'B type=' + (body.type || '?') + ']';
        }
        if (body instanceof ArrayBuffer || (body && body.buffer instanceof ArrayBuffer)) {
          return '[ArrayBuffer ' + (body.byteLength || (body.buffer && body.buffer.byteLength)) + 'B]';
        }
        return JSON.stringify(body);
      } catch (e) { return '[unserializable]'; }
    }

    function captureInitiator() {
      var raw = '';
      try { throw new Error('wdk-initiator'); }
      catch (e) { raw = e.stack || ''; }
      return { raw: raw, frames: parseStack(raw) };
    }

    // Strip our own frames + parse the user-script frames.
    function parseStack(stack) {
      if (!stack) { return []; }
      var lines = stack.split(/\r?\n/);
      var frames = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line === 'Error: wdk-initiator') { continue; }
        // Drop our own frames
        if (
          /captureInitiator/.test(line) ||
          /network-interceptor/.test(line) ||
          /at startIntercepting/.test(line) ||
          /at fetch \(<anonymous>/.test(line) ||
          /at OrigXHR\.prototype/.test(line) ||
          /Object\.<anonymous>.*network-interceptor/.test(line)
        ) { continue; }
        // Parse 'at fnName (file:line:col)' or 'at file:line:col'
        var m = line.match(/at\s+(?:([^\s(]+)\s+)?\(?([^():]+):(\d+):(\d+)\)?/);
        if (m) {
          frames.push({
            fn:   m[1] || '<anonymous>',
            file: m[2],
            line: parseInt(m[3], 10),
            col:  parseInt(m[4], 10)
          });
        } else if (frames.length < 8) {
          frames.push({ raw: line });
        }
        if (frames.length >= 8) { break; }
      }
      return frames;
    }

    function headersToObj(headersStr) {
      var out = {};
      if (!headersStr) { return out; }
      var lines = headersStr.split(/\r?\n/);
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line) { continue; }
        var idx = line.indexOf(':');
        if (idx === -1) { continue; }
        out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
      }
      return out;
    }

    function fetchHeadersToObj(headers) {
      var out = {};
      if (!headers) { return out; }
      // Headers object
      if (typeof headers.forEach === 'function') {
        headers.forEach(function (v, k) { out[k] = v; });
        return out;
      }
      // Plain object
      if (typeof headers === 'object') {
        var keys = Object.keys(headers);
        for (var i = 0; i < keys.length; i++) { out[keys[i]] = headers[keys[i]]; }
        return out;
      }
      // Array of pairs
      if (Array.isArray(headers)) {
        for (var j = 0; j < headers.length; j++) { out[headers[j][0]] = headers[j][1]; }
        return out;
      }
      return out;
    }

    /* -------- Per-window patch install -------- */

    // Install our XHR + fetch patches on the given window. Safe to call
    // on the top frame's window or any same-origin iframe's
    // contentWindow. Cross-origin windows throw on access; caller
    // should wrap accordingly.
    function _installPatchesOn(win) {
      if (!win) { return false; }
      // Idempotency: if we've already patched this window, skip.
      for (var k = 0; k < installed.length; k++) {
        if (installed[k].win === win) { return false; }
      }
      var entry = {
        win: win,
        OrigXHR: win.XMLHttpRequest,
        origOpen: null,
        origSend: null,
        origSetReqHdr: null,
        origFetch: win.fetch
      };
      if (entry.OrigXHR && entry.OrigXHR.prototype) {
        entry.origOpen      = entry.OrigXHR.prototype.open;
        entry.origSend      = entry.OrigXHR.prototype.send;
        entry.origSetReqHdr = entry.OrigXHR.prototype.setRequestHeader;

        entry.OrigXHR.prototype.setRequestHeader = function (name, value) {
          this._dk_reqHeaders = this._dk_reqHeaders || {};
          this._dk_reqHeaders[name] = value;
          return entry.origSetReqHdr.apply(this, arguments);
        };

        entry.OrigXHR.prototype.open = function (method, url) {
          this._dk_method = method;
          this._dk_url = url;
          this._dk_startTime = Date.now();
          this._dk_initiator = captureInitiator();
          return entry.origOpen.apply(this, arguments);
        };

        entry.OrigXHR.prototype.send = function (body) {
          var xhr = this;
          xhr._dk_reqBody = coerceBody(body);
          var onDone = function () {
            var contentType = '';
            try { contentType = xhr.getResponseHeader('content-type') || ''; } catch (e) { /* cors */ }
            var responseBody = '';
            try { responseBody = xhr.responseText || ''; } catch (e) { /* arraybuffer */ }
            var respHeaders = {};
            try { respHeaders = headersToObj(xhr.getAllResponseHeaders()); } catch (e) { /* cors */ }
            var rec = {
              type: 'xhr',
              url: xhr._dk_url,
              method: (xhr._dk_method || 'GET').toUpperCase(),
              status: xhr.status,
              contentType: contentType,
              size: safeStringLength(responseBody),
              timing: Date.now() - (xhr._dk_startTime || Date.now()),
              requestHeaders: xhr._dk_reqHeaders || {},
              requestBody: xhr._dk_reqBody || '',
              responseHeaders: respHeaders,
              responseBody: responseBody,
              parsedJSON: tryParseJSON(responseBody, contentType),
              timestamp: new Date().toISOString(),
              initiator: xhr._dk_initiator ? xhr._dk_initiator.frames : [],
              initiatorRaw: xhr._dk_initiator ? xhr._dk_initiator.raw : '',
              frame: win === window ? 'top' : 'iframe'
            };
            rec.duration = rec.timing;
            addEntry(rec);
          };
          this.addEventListener('loadend', onDone);
          return entry.origSend.apply(this, arguments);
        };
      }

      if (typeof entry.origFetch === 'function') {
        win.fetch = function () {
          var args = arguments;
          var url = '';
          var method = 'GET';
          var reqHeaders = {};
          var reqBody = '';
          var initiator = captureInitiator();

          if (typeof args[0] === 'string') {
            url = args[0];
          } else if (args[0] && typeof args[0].url === 'string') {
            url = args[0].url;
            method = args[0].method || 'GET';
            if (args[0].headers) { reqHeaders = fetchHeadersToObj(args[0].headers); }
          }
          if (args[1]) {
            if (args[1].method) { method = args[1].method; }
            if (args[1].headers) {
              var initH = fetchHeadersToObj(args[1].headers);
              var ks = Object.keys(initH);
              for (var i = 0; i < ks.length; i++) { reqHeaders[ks[i]] = initH[ks[i]]; }
            }
            if (args[1].body != null) { reqBody = coerceBody(args[1].body); }
          }

          var startTime = Date.now();

          return entry.origFetch.apply(win, args).then(function (response) {
            var clone = response.clone();
            clone.text().then(function (body) {
              var contentType = response.headers.get('content-type') || '';
              var respHeaders = fetchHeadersToObj(response.headers);
              var rec = {
                type: 'fetch',
                url: url,
                method: method.toUpperCase(),
                status: response.status,
                contentType: contentType,
                size: body.length,
                timing: Date.now() - startTime,
                requestHeaders: reqHeaders,
                requestBody: reqBody,
                responseHeaders: respHeaders,
                responseBody: body,
                parsedJSON: tryParseJSON(body, contentType),
                timestamp: new Date().toISOString(),
                initiator: initiator.frames,
                initiatorRaw: initiator.raw,
                frame: win === window ? 'top' : 'iframe'
              };
              rec.duration = rec.timing;
              addEntry(rec);
            }).catch(function () { /* body read failed, skip */ });
            return response;
          });
        };
      }

      installed.push(entry);
      return true;
    }

    // Walk the current document for same-origin iframes and install on
    // each contentWindow. Also install a load listener so a re-navigation
    // within the iframe re-patches the (newly loaded) window.
    function _walkIframesAndInstall() {
      var frames = document.querySelectorAll('iframe');
      for (var i = 0; i < frames.length; i++) {
        _tryInstallIframe(frames[i]);
      }
    }

    function _tryInstallIframe(iframeEl) {
      // contentWindow access throws on cross-origin — swallow.
      try {
        var win = iframeEl.contentWindow;
        if (!win) { return; }
        // Quick same-origin probe; cross-origin throws.
        var _probe = win.document;
        _installPatchesOn(win);
      } catch (e) {
        // Cross-origin: silently skip. We tag in the network-pane UI.
        return;
      }
      // Re-patch on navigation within the iframe
      try {
        iframeEl.addEventListener('load', function () {
          try {
            var w = iframeEl.contentWindow;
            if (w) { _installPatchesOn(w); }
          } catch (e) { /* cross-origin */ }
        }, false);
      } catch (e) { /* swallow */ }
    }

    // Install on top frame + walk existing iframes + watch for new ones
    _installPatchesOn(window);
    _walkIframesAndInstall();

    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(function (mutations) {
        for (var m = 0; m < mutations.length; m++) {
          var added = mutations[m].addedNodes;
          for (var n = 0; n < added.length; n++) {
            var node = added[n];
            if (!node || node.nodeType !== 1) { continue; }
            if (node.tagName === 'IFRAME') { _tryInstallIframe(node); }
            // Iframes can be nested in newly added subtrees
            if (typeof node.querySelectorAll === 'function') {
              var inner = node.querySelectorAll('iframe');
              for (var j = 0; j < inner.length; j++) { _tryInstallIframe(inner[j]); }
            }
          }
        }
      });
      try {
        observer.observe(document, { childList: true, subtree: true });
      } catch (e) { /* swallow */ }
    }

    /* -------- Public API -------- */

    function getLog()  { return log.slice(); }
    function clear()   { log = []; }
    function stop() {
      stopped = true;
      // Restore every patched window in reverse install order
      for (var i = installed.length - 1; i >= 0; i--) {
        var rec = installed[i];
        try {
          if (rec.OrigXHR && rec.OrigXHR.prototype) {
            if (rec.origOpen)      { rec.OrigXHR.prototype.open = rec.origOpen; }
            if (rec.origSend)      { rec.OrigXHR.prototype.send = rec.origSend; }
            if (rec.origSetReqHdr) { rec.OrigXHR.prototype.setRequestHeader = rec.origSetReqHdr; }
          }
          if (rec.origFetch) { rec.win.fetch = rec.origFetch; }
        } catch (e) { /* swallow */ }
      }
      installed = [];
      if (observer) { try { observer.disconnect(); } catch (e) { /* swallow */ } observer = null; }
    }
    function onRequest(callback) {
      if (typeof callback === 'function') { callbacks.push(callback); }
    }
    function getInstalledFrames() {
      var out = [];
      for (var i = 0; i < installed.length; i++) {
        out.push(installed[i].win === window ? 'top' : 'iframe');
      }
      return out;
    }

    return {
      getLog: getLog,
      clear: clear,
      stop: stop,
      onRequest: onRequest,
      getInstalledFrames: getInstalledFrames,
      _internal: {
        parseStack: parseStack,
        coerceBody: coerceBody,
        headersToObj: headersToObj,
        fetchHeadersToObj: fetchHeadersToObj
      }
    };
  }

  window.WDK = window.WDK || {};

  // Singleton wrapper: repeat callers (the Debug panel, an operator script,
  // the auto-start below) all share ONE live interceptor + ONE log, so a
  // request captured by any consumer is visible to all. Previously each call
  // returned a fresh instance that re-patched window.fetch over the last one,
  // so the panel and a script would each see only their own captures and the
  // panel's table looked empty if the page fired calls before its tab opened.
  // Pass { fresh: true } to force a brand-new isolated interceptor.
  var _singleton = null;
  function startInterceptingShared(opts) {
    if (opts && opts.fresh) { return startIntercepting(); }
    if (_singleton) { return _singleton; }
    _singleton = startIntercepting();
    return _singleton;
  }
  window.WDK.startIntercepting = startInterceptingShared;

  // Auto-start capture as soon as the snippet loads (browser context only),
  // so requests the page fires BEFORE the operator opens the Network tab are
  // still captured. No-op under Node/tests. Cheap: idempotent via singleton.
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    try { startInterceptingShared(); } catch (e) { /* swallow */ }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { startIntercepting: startIntercepting };
  }
})();
