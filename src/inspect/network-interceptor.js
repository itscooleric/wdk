/**
 * INSPECT-003 + INSPECT-004: Network Interceptor
 * Monkey-patches XMLHttpRequest and fetch to capture all network requests.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */
(function () {
  'use strict';

  var MAX_ENTRIES = 500;

  /**
   * Start intercepting network requests.
   * @returns {{ getLog: function, clear: function, stop: function, onRequest: function }}
   */
  function startIntercepting() {
    var log = [];
    var callbacks = [];
    var stopped = false;

    // --- Originals ---
    var OrigXHR = window.XMLHttpRequest;
    var origOpen = OrigXHR.prototype.open;
    var origSend = OrigXHR.prototype.send;
    var origFetch = window.fetch;

    function addEntry(entry) {
      if (stopped) return;
      if (log.length >= MAX_ENTRIES) {
        log.shift();
      }
      log.push(entry);
      for (var i = 0; i < callbacks.length; i++) {
        try { callbacks[i](entry); } catch (e) { /* swallow */ }
      }
    }

    function tryParseJSON(text, contentType) {
      if (!contentType || contentType.indexOf('json') === -1) return undefined;
      try { return JSON.parse(text); } catch (e) { return undefined; }
    }

    function safeStringLength(val) {
      if (val == null) return 0;
      if (typeof val === 'string') return val.length;
      try { return JSON.stringify(val).length; } catch (e) { return 0; }
    }

    // --- XHR patch ---
    OrigXHR.prototype.open = function (method, url) {
      this._dk_method = method;
      this._dk_url = url;
      this._dk_startTime = Date.now();
      return origOpen.apply(this, arguments);
    };

    OrigXHR.prototype.send = function () {
      var xhr = this;
      var onDone = function () {
        var contentType = '';
        try { contentType = xhr.getResponseHeader('content-type') || ''; } catch (e) { /* cors */ }
        var responseBody = '';
        try { responseBody = xhr.responseText || ''; } catch (e) { /* arraybuffer */ }
        var entry = {
          type: 'xhr',
          url: xhr._dk_url,
          method: (xhr._dk_method || 'GET').toUpperCase(),
          status: xhr.status,
          contentType: contentType,
          size: safeStringLength(responseBody),
          timing: Date.now() - (xhr._dk_startTime || Date.now()),
          responseBody: responseBody,
          parsedJSON: tryParseJSON(responseBody, contentType),
          timestamp: new Date().toISOString()
        };
        addEntry(entry);
      };
      this.addEventListener('loadend', onDone);
      return origSend.apply(this, arguments);
    };

    // --- Fetch patch ---
    window.fetch = function () {
      var args = arguments;
      var url = '';
      var method = 'GET';

      if (typeof args[0] === 'string') {
        url = args[0];
      } else if (args[0] && typeof args[0].url === 'string') {
        url = args[0].url;
        method = args[0].method || 'GET';
      }
      if (args[1] && args[1].method) {
        method = args[1].method;
      }

      var startTime = Date.now();

      return origFetch.apply(window, args).then(function (response) {
        // Clone so the original consumer can still read the body
        var clone = response.clone();
        clone.text().then(function (body) {
          var contentType = response.headers.get('content-type') || '';
          var entry = {
            type: 'fetch',
            url: url,
            method: method.toUpperCase(),
            status: response.status,
            contentType: contentType,
            size: body.length,
            timing: Date.now() - startTime,
            responseBody: body,
            parsedJSON: tryParseJSON(body, contentType),
            timestamp: new Date().toISOString()
          };
          addEntry(entry);
        }).catch(function () { /* body read failed, skip */ });
        return response;
      });
    };

    // --- Public API ---
    function getLog() {
      return log.slice();
    }

    function clear() {
      log = [];
    }

    function stop() {
      stopped = true;
      OrigXHR.prototype.open = origOpen;
      OrigXHR.prototype.send = origSend;
      window.fetch = origFetch;
    }

    function onRequest(callback) {
      if (typeof callback === 'function') {
        callbacks.push(callback);
      }
    }

    return {
      getLog: getLog,
      clear: clear,
      stop: stop,
      onRequest: onRequest
    };
  }

  // Expose globally
  window.DataKit = window.DataKit || {};
  window.DataKit.startIntercepting = startIntercepting;
})();
