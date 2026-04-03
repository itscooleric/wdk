/**
 * INSPECT-005: Storage Viewer
 * Reads cookies, localStorage, and sessionStorage as DataFrame-compatible output.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */
(function () {
  'use strict';

  /**
   * Parse document.cookie into key-value pairs.
   * @returns {Array<{ key: string, value: string }>}
   */
  function parseCookies() {
    var pairs = [];
    var raw = document.cookie;
    if (!raw) return pairs;
    var parts = raw.split(';');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (!part) continue;
      var eqIdx = part.indexOf('=');
      if (eqIdx === -1) {
        pairs.push({ key: part, value: '' });
      } else {
        pairs.push({
          key: part.substring(0, eqIdx).trim(),
          value: part.substring(eqIdx + 1).trim()
        });
      }
    }
    return pairs;
  }

  /**
   * Read all entries from a Storage object (localStorage or sessionStorage).
   * @param {Storage} storage
   * @returns {Array<{ key: string, value: string }>}
   */
  function readStorage(storage) {
    var pairs = [];
    try {
      for (var i = 0; i < storage.length; i++) {
        var key = storage.key(i);
        pairs.push({ key: key, value: storage.getItem(key) || '' });
      }
    } catch (e) {
      // Storage access may be blocked (SecurityError in cross-origin iframes, etc.)
    }
    return pairs;
  }

  /**
   * Capture all browser storage as a DataFrame.
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function captureStorage() {
    var rows = [];

    // Cookies
    var cookies = parseCookies();
    for (var c = 0; c < cookies.length; c++) {
      rows.push(['cookie', cookies[c].key, cookies[c].value]);
    }

    // localStorage
    var local = readStorage(window.localStorage);
    for (var l = 0; l < local.length; l++) {
      rows.push(['localStorage', local[l].key, local[l].value]);
    }

    // sessionStorage
    var session = readStorage(window.sessionStorage);
    for (var s = 0; s < session.length; s++) {
      rows.push(['sessionStorage', session[s].key, session[s].value]);
    }

    return {
      headers: ['source', 'key', 'value'],
      rows: rows
    };
  }

  // Expose globally
  window.DataKit = window.DataKit || {};
  window.DataKit.captureStorage = captureStorage;
})();
