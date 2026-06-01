/**
 * WDK request-replay — convert a captured network entry into a
 * one-line bookmarklet, fetch() snippet, or curl command, and re-run
 * the request with optional edits to URL, method, headers, body.
 *
 * Inputs come from network-interceptor.js entries.
 *
 * Public:
 *   toBookmarklet(entry, opts)   -> "javascript:..."  string
 *   toFetchSnippet(entry, opts)  -> "fetch('...', {...})"  string
 *   toCurl(entry, opts)          -> "curl '...' -X ..."  string
 *   reRun(entry, edits)          -> Promise<{status, body, headers, parsedJSON, timing}>
 *   applyEdits(entry, edits)     -> merged entry (pure helper)
 *   safeHeaders(entry)           -> headers map with credential/host
 *                                   keys stripped (used by curl/fetch
 *                                   snippets to avoid leaking creds
 *                                   when you copy and paste).
 *
 * Headers we drop by default in the safe snippets:
 *   cookie, authorization, x-csrf-token, x-xsrf-token, host, content-length,
 *   accept-encoding, connection, origin, referer
 *
 * The bookmarklet uses credentials: 'include' so the browser sends
 * cookies/auth automatically when the user runs it on the same
 * origin — that's the whole point. The fetch/curl snippets are for
 * sharing/scripting and intentionally redact creds.
 */
(function () {
  'use strict';

  var DROP_HEADERS = {
    'cookie': 1, 'authorization': 1,
    'x-csrf-token': 1, 'x-xsrf-token': 1,
    'host': 1, 'content-length': 1,
    'accept-encoding': 1, 'connection': 1,
    'origin': 1, 'referer': 1
  };

  function safeHeaders(entry) {
    var src = (entry && entry.requestHeaders) || {};
    var out = {};
    var keys = Object.keys(src);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (DROP_HEADERS[k.toLowerCase()]) { continue; }
      out[k] = src[k];
    }
    return out;
  }

  function fileNameFromUrl(url) {
    if (!url) { return 'response'; }
    try {
      var u = url.split('?')[0].split('#')[0];
      var parts = u.split('/').filter(Boolean);
      var last = parts[parts.length - 1] || 'response';
      // Strip non-name chars
      last = last.replace(/[^A-Za-z0-9._-]/g, '_');
      return last || 'response';
    } catch (e) { return 'response'; }
  }

  // Decide a default download extension from content-type
  function extFromCT(ct) {
    ct = (ct || '').toLowerCase();
    if (ct.indexOf('json') !== -1) { return '.json'; }
    if (ct.indexOf('xlsx') !== -1 || ct.indexOf('spreadsheetml') !== -1) { return '.xlsx'; }
    if (ct.indexOf('csv') !== -1)  { return '.csv';  }
    if (ct.indexOf('pdf') !== -1)  { return '.pdf';  }
    if (ct.indexOf('html') !== -1) { return '.html'; }
    if (ct.indexOf('xml') !== -1)  { return '.xml';  }
    if (ct.indexOf('text') !== -1) { return '.txt';  }
    return '';
  }

  function ensureExt(name, ext) {
    if (!ext) { return name; }
    if (name.indexOf('.') === -1) { return name + ext; }
    return name;
  }

  function jsString(s) {
    return "'" + String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r') + "'";
  }

  function shellQuote(s) {
    var v = String(s == null ? '' : s);
    // Double-quote and escape backticks/dollars/quotes/backslashes
    return '"' + v
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/`/g, '\\`') + '"';
  }

  /* ------------------------------------------------------------------ */
  /*  toBookmarklet                                                      */
  /* ------------------------------------------------------------------ */

  // Emits a self-contained bookmarklet that, when run on the same
  // origin, re-fires the captured request with credentials and
  // auto-downloads the response as a file.
  function toBookmarklet(entry, opts) {
    if (!entry) { return ''; }
    opts = opts || {};
    var includeBody = entry.method !== 'GET' && entry.method !== 'HEAD' && entry.requestBody;
    var fname = ensureExt(opts.filename || fileNameFromUrl(entry.url), extFromCT(entry.contentType));
    // Build init object as JSON string (safe through encodeURIComponent)
    var init = { method: entry.method || 'GET', credentials: 'include' };
    var safe = safeHeaders(entry);
    if (Object.keys(safe).length) { init.headers = safe; }
    if (includeBody) { init.body = entry.requestBody; }

    var initJSON = JSON.stringify(init);
    var url = entry.url;

    // Single-line javascript: void(...) wrapper that:
    //   1. fires fetch
    //   2. resolves to .blob()
    //   3. creates an <a download> and clicks it
    var src = (
      'void(fetch(' + jsString(url) + ',' + initJSON + ')' +
      '.then(function(r){return r.blob();})' +
      '.then(function(b){' +
        'var a=document.createElement("a");' +
        'a.href=URL.createObjectURL(b);' +
        'a.download=' + jsString(fname) + ';' +
        'document.body.appendChild(a);a.click();' +
        'setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);' +
      '})' +
      '.catch(function(e){alert("WDK replay failed: "+e.message);})' +
      ')'
    );

    return 'javascript:' + encodeURIComponent(src);
  }

  /* ------------------------------------------------------------------ */
  /*  toFetchSnippet                                                     */
  /* ------------------------------------------------------------------ */

  // Pretty-printed fetch() call suitable for pasting into a console
  // or a script. Credentials stripped.
  function toFetchSnippet(entry, opts) {
    if (!entry) { return ''; }
    opts = opts || {};
    var init = { method: entry.method || 'GET', credentials: 'include' };
    var safe = safeHeaders(entry);
    if (Object.keys(safe).length) { init.headers = safe; }
    if (entry.requestBody && entry.method !== 'GET' && entry.method !== 'HEAD') {
      init.body = entry.requestBody;
    }
    return 'fetch(' + jsString(entry.url) + ', ' +
      JSON.stringify(init, null, 2) + ')';
  }

  /* ------------------------------------------------------------------ */
  /*  toCurl                                                             */
  /* ------------------------------------------------------------------ */

  function toCurl(entry, opts) {
    if (!entry) { return ''; }
    opts = opts || {};
    var parts = ['curl', shellQuote(entry.url)];
    if (entry.method && entry.method !== 'GET') {
      parts.push('-X', entry.method);
    }
    var safe = safeHeaders(entry);
    var keys = Object.keys(safe);
    for (var i = 0; i < keys.length; i++) {
      parts.push('-H', shellQuote(keys[i] + ': ' + safe[keys[i]]));
    }
    if (entry.requestBody && entry.method !== 'GET' && entry.method !== 'HEAD') {
      parts.push('--data', shellQuote(entry.requestBody));
    }
    if (opts.compressed !== false) { parts.push('--compressed'); }
    return parts.join(' ');
  }

  /* ------------------------------------------------------------------ */
  /*  applyEdits + reRun                                                 */
  /* ------------------------------------------------------------------ */

  // Pure helper: produce a new entry with edits merged in. Used to
  // preview the request before re-running.
  function applyEdits(entry, edits) {
    var merged = {};
    var keys = Object.keys(entry || {});
    for (var i = 0; i < keys.length; i++) { merged[keys[i]] = entry[keys[i]]; }
    if (!edits) { return merged; }
    if (edits.url != null)         { merged.url = edits.url; }
    if (edits.method != null)      { merged.method = edits.method; }
    if (edits.requestBody != null) { merged.requestBody = edits.requestBody; }
    if (edits.requestHeaders) {
      // Replace if explicit, merge if .headersPatch is set
      if (edits.replaceHeaders) {
        merged.requestHeaders = edits.requestHeaders;
      } else {
        var h = {};
        var orig = entry.requestHeaders || {};
        var ok = Object.keys(orig);
        for (var j = 0; j < ok.length; j++) { h[ok[j]] = orig[ok[j]]; }
        var ek = Object.keys(edits.requestHeaders);
        for (var k = 0; k < ek.length; k++) { h[ek[k]] = edits.requestHeaders[ek[k]]; }
        merged.requestHeaders = h;
      }
    }
    return merged;
  }

  // Re-fires the request through the live fetch (note: this gets
  // re-captured by the interceptor too — caller can ignore that).
  // Returns a promise resolving to {status, body, headers, parsedJSON, timing}.
  function reRun(entry, edits) {
    var e = applyEdits(entry, edits);
    if (!e || !e.url) {
      return Promise.reject(new Error('reRun: entry has no url'));
    }
    var init = { method: e.method || 'GET', credentials: 'include' };
    if (e.requestHeaders && Object.keys(e.requestHeaders).length) {
      init.headers = e.requestHeaders;
    }
    if (e.requestBody && e.method !== 'GET' && e.method !== 'HEAD') {
      init.body = e.requestBody;
    }
    var t0 = Date.now();
    return fetch(e.url, init).then(function (resp) {
      return resp.text().then(function (body) {
        var ct = (resp.headers && resp.headers.get && resp.headers.get('content-type')) || '';
        var headers = {};
        if (resp.headers && typeof resp.headers.forEach === 'function') {
          resp.headers.forEach(function (v, k) { headers[k] = v; });
        }
        var parsedJSON;
        if (ct.indexOf('json') !== -1) {
          try { parsedJSON = JSON.parse(body); } catch (_) { /* not json */ }
        }
        return {
          status: resp.status,
          body: body,
          headers: headers,
          parsedJSON: parsedJSON,
          timing: Date.now() - t0,
          contentType: ct
        };
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  if (typeof window !== 'undefined') {
    window.WDK = window.WDK || {};
    window.WDK.requestReplay = {
      toBookmarklet:  toBookmarklet,
      toFetchSnippet: toFetchSnippet,
      toCurl:         toCurl,
      reRun:          reRun,
      applyEdits:     applyEdits,
      safeHeaders:    safeHeaders
    };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      toBookmarklet:  toBookmarklet,
      toFetchSnippet: toFetchSnippet,
      toCurl:         toCurl,
      reRun:          reRun,
      applyEdits:     applyEdits,
      safeHeaders:    safeHeaders,
      _internal: {
        DROP_HEADERS: DROP_HEADERS,
        fileNameFromUrl: fileNameFromUrl,
        extFromCT: extFromCT,
        jsString: jsString,
        shellQuote: shellQuote
      }
    };
  }
})();
