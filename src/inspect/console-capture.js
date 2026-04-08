/**
 * INSPECT-006: Console Capture
 * Monkey-patches console.log/warn/error/info to capture messages.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */
(function () {
  'use strict';

  /**
   * Stringify a single argument for storage.
   * @param {*} arg
   * @returns {string}
   */
  function stringify(arg) {
    if (arg === undefined) return 'undefined';
    if (arg === null) return 'null';
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message || String(arg);
    try { return JSON.stringify(arg); } catch (e) { return String(arg); }
  }

  /**
   * Start capturing console output.
   * @returns {{ getLog: function, clear: function, stop: function }}
   */
  function startCapture() {
    var log = [];
    var stopped = false;
    var levels = ['log', 'warn', 'error', 'info'];
    var originals = {};

    for (var i = 0; i < levels.length; i++) {
      (function (level) {
        originals[level] = console[level];

        console[level] = function () {
          // Always forward to the original
          originals[level].apply(console, arguments);

          if (stopped) return;

          var args = [];
          for (var a = 0; a < arguments.length; a++) {
            args.push(stringify(arguments[a]));
          }

          log.push({
            level: level,
            message: args.join(' '),
            args: args,
            timestamp: new Date().toISOString()
          });
        };
      })(levels[i]);
    }

    function getLog() {
      return log.slice();
    }

    function clear() {
      log = [];
    }

    function stop() {
      stopped = true;
      for (var j = 0; j < levels.length; j++) {
        var lvl = levels[j];
        if (originals[lvl]) {
          console[lvl] = originals[lvl];
        }
      }
    }

    return {
      getLog: getLog,
      clear: clear,
      stop: stop
    };
  }

  // Expose globally
  window.WDK = window.WDK || {};
  window.WDK.startCapture = startCapture;
})();
