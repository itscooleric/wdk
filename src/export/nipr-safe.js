/** WDK NIPR-Safe Export — clean output for cross-domain transfer (NIPR->SIPR). */
(function () {
  'use strict';
  var root = (typeof window !== 'undefined') ? window : {};
  var DK = root.DK = root.DK || {};
  var SAFE_FORMATS = ['csv', 'json', 'xml', 'text'];
  var UNSAFE_PATTERNS = {
    base64: /[A-Za-z0-9+\/]{64,}={0,2}/g,
    dataUri: /data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+\/=]+/gi,
    internalIp: /\b(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g,
    scriptTag: /<script[\s>][\s\S]*?<\/script>/gi,
    execContent: /<(script|iframe|object|embed|applet)[\s>]/gi
  };
  function getClassification(opts) {
    opts = opts || {};
    if (opts.classification) { return opts.classification; }
    if (DK.classification && typeof DK.classification.getLevel === 'function') {
      return DK.classification.getLevel();
    }
    return 'UNCLASSIFIED';
  }
  function sanitize(value) {
    if (typeof value !== 'string') { return String(value); }
    var s = value;
    s = s.replace(UNSAFE_PATTERNS.dataUri, '[REDACTED:datauri]');
    s = s.replace(UNSAFE_PATTERNS.base64, '[REDACTED:base64]');
    s = s.replace(UNSAFE_PATTERNS.internalIp, '[REDACTED:internal-ip]');
    s = s.replace(UNSAFE_PATTERNS.scriptTag, '');
    s = s.replace(UNSAFE_PATTERNS.execContent, '');
    return s;
  }
  function validate(data) {
    var warnings = [];
    var raw = typeof data === 'string' ? data : JSON.stringify(data);
    var checks = [
      ['base64', '_content', 'Contains base64 encoded data', 'high'],
      ['dataUri', '_content', 'Contains data URI', 'high'],
      ['internalIp', '_content', 'Contains internal/private IP address', 'medium'],
      ['execContent', '_content', 'Contains executable content', 'high']
    ];
    for (var i = 0; i < checks.length; i++) {
      var pat = UNSAFE_PATTERNS[checks[i][0]];
      if (pat.test(raw)) {
        warnings.push({ field: checks[i][1], issue: checks[i][2], severity: checks[i][3] });
      }
      pat.lastIndex = 0;
    }
    if (!/UNCLASSIFIED|CUI|CONFIDENTIAL|SECRET|TOP SECRET/.test(raw)) {
      warnings.push({ field: '_banner', issue: 'Missing classification banner', severity: 'high' });
    }
    return { safe: warnings.length === 0, warnings: warnings };
  }
  function escapeCSV(val) {
    var s = String(val);
    return (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1)
      ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function escapeXML(val) {
    return String(val).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function sanitizeDeep(obj) {
    if (typeof obj === 'string') { return sanitize(obj); }
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) { arr.push(sanitizeDeep(obj[i])); }
      return arr;
    }
    if (obj && typeof obj === 'object') {
      var out = {};
      for (var k in obj) {
        if (obj.hasOwnProperty(k)) { out[k] = sanitizeDeep(obj[k]); }
      }
      return out;
    }
    return obj;
  }
  function exportData(data, format, options) {
    var opts = options || {};
    var clf = getClassification(opts);
    var clean = sanitizeDeep(data);
    var content, contentType, ext;
    if (SAFE_FORMATS.indexOf(format) === -1) {
      throw new Error('Unsupported format: ' + format + '. Safe formats: ' + SAFE_FORMATS.join(', '));
    }
    if (format === 'json') {
      content = JSON.stringify({ classification: clf, exportedAt: new Date().toISOString(), data: clean }, null, 2);
      contentType = 'application/json'; ext = 'json';
    } else if (format === 'csv') {
      var lines = [clf];
      if (Array.isArray(clean) && clean.length > 0 && typeof clean[0] === 'object') {
        var keys = Object.keys(clean[0]);
        lines.push(keys.map(escapeCSV).join(','));
        for (var r = 0; r < clean.length; r++) {
          var row = [];
          for (var c = 0; c < keys.length; c++) { row.push(escapeCSV(clean[r][keys[c]] || '')); }
          lines.push(row.join(','));
        }
      } else { lines.push(String(clean)); }
      lines.push(clf);
      content = lines.join('\n'); contentType = 'text/csv'; ext = 'csv';
    } else if (format === 'xml') {
      var xl = ['<?xml version="1.0" encoding="UTF-8"?>', '<data classification="' + escapeXML(clf) + '">'];
      var items = Array.isArray(clean) ? clean : [clean];
      for (var xi = 0; xi < items.length; xi++) {
        xl.push('  <row>');
        if (typeof items[xi] === 'object' && items[xi] !== null) {
          for (var xk in items[xi]) {
            if (items[xi].hasOwnProperty(xk)) { xl.push('    <' + xk + '>' + escapeXML(items[xi][xk]) + '</' + xk + '>'); }
          }
        } else { xl.push('    <value>' + escapeXML(items[xi]) + '</value>'); }
        xl.push('  </row>');
      }
      xl.push('</data>');
      content = xl.join('\n'); contentType = 'application/xml'; ext = 'xml';
    } else {
      content = clf + '\n\n' + (typeof clean === 'string' ? clean : JSON.stringify(clean, null, 2)) + '\n\n' + clf;
      contentType = 'text/plain'; ext = 'txt';
    }
    var filename = (opts.filename || 'export-' + Date.now()) + '.' + ext;
    return { content: content, contentType: contentType, filename: filename, validation: validate(content) };
  }
  function exportCSV(headers, rows, options) {
    var data = [];
    for (var i = 0; i < rows.length; i++) {
      var obj = {};
      for (var h = 0; h < headers.length; h++) {
        obj[headers[h]] = (rows[i] && rows[i][h] !== undefined) ? rows[i][h] : '';
      }
      data.push(obj);
    }
    return exportData(data, 'csv', options);
  }
  DK.niprSafe = {
    SAFE_FORMATS: SAFE_FORMATS,
    UNSAFE_PATTERNS: UNSAFE_PATTERNS,
    validate: validate,
    export: exportData,
    exportCSV: exportCSV,
    exportJSON: function (obj, opts) { return exportData(obj, 'json', opts); },
    exportXML: function (obj, opts) { return exportData(obj, 'xml', opts); },
    sanitize: sanitize
  };
})();
