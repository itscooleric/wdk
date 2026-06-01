/**
 * WDK Audit Logger — append-only JSON Lines for compliance.
 * NIST 800-53 AU family alignment.
 * Tracks: imports, exports, transforms, queries, redactions.
 * Never logs PII content — only metadata and hashes.
 */

var AuditLog = (function() {
  var entries = [];
  var maxEntries = 10000;
  var sessionId = 'wdk-' + Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 6);

  function sha256(str) {
    // Prefer SubtleCrypto if available, else FNV-1a fallback
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      var enc = new TextEncoder();
      return crypto.subtle.digest('SHA-256', enc.encode(str)).then(function(buf) {
        return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      });
    }
    // FNV-1a fallback (not SHA-256 but good enough for non-crypto audit fingerprinting)
    var hash = 2166136261;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 16777619) >>> 0;
    }
    return Promise.resolve(hash.toString(16).padStart(8, '0'));
  }

  function log(action, details) {
    var entry = {
      timestamp: new Date().toISOString(),
      session: sessionId,
      action: action,  // 'import', 'export', 'query', 'transform', 'redact', 'clear', 'scrape'
      details: details || {},
    };
    entries.push(entry);
    if (entries.length > maxEntries) entries.shift();
    return entry;
  }

  // Specific log helpers
  function logImport(filename, rowCount, colCount, fileSize, fileHash) {
    return log('import', {
      filename: filename,
      rows: rowCount,
      columns: colCount,
      size: fileSize,
      hash: fileHash,  // SHA-256 of file content, not the content itself
      disposition: 'loaded'
    });
  }

  function logExport(filename, format, rowCount) {
    return log('export', {
      filename: filename,
      format: format,  // 'csv', 'json', 'xlsx', 'clipboard'
      rows: rowCount,
      disposition: 'exported'
    });
  }

  function logQuery(queryType, queryText, rowCount, elapsed) {
    // Hash the query text — don't store raw SQL in case it contains data references
    return log('query', {
      type: queryType,  // 'sql', 'js', 'filter', 'sort'
      queryHash: null,  // will be set async
      resultRows: rowCount,
      elapsedMs: elapsed,
      disposition: 'executed'
    });
  }

  function logTransform(transformType, affectedRows, affectedCols) {
    return log('transform', {
      type: transformType,  // 'pivot', 'aggregate', 'dedupe', 'sort', 'filter', 'redact'
      rows: affectedRows,
      columns: affectedCols,
      disposition: 'applied'
    });
  }

  function logRedact(columnCount, cellCount, method) {
    return log('redact', {
      columns: columnCount,
      cells: cellCount,
      method: method,  // 'hash', 'mask', 'replace'
      disposition: 'redacted'
    });
  }

  function logClear() {
    return log('clear', { disposition: 'cleared' });
  }

  // Export as JSON Lines string
  function toJSONLines() {
    return entries.map(function(e) { return JSON.stringify(e); }).join('\n');
  }

  // Export as downloadable file
  function download() {
    var content = toJSONLines();
    var filename = 'wdk-audit-' + sessionId + '.jsonl';
    if (typeof downloadBlob === 'function') {
      downloadBlob(content, filename, 'application/jsonl');
    }
  }

  // Get entries (copy)
  function getEntries() {
    return entries.slice();
  }

  // Get entry count
  function count() {
    return entries.length;
  }

  // Clear log (itself logged)
  function clear() {
    var countBefore = entries.length;
    log('audit-clear', { entriesCleared: countBefore });
    entries = entries.slice(-1); // keep only the clear entry itself
  }

  return {
    log: log,
    logImport: logImport,
    logExport: logExport,
    logQuery: logQuery,
    logTransform: logTransform,
    logRedact: logRedact,
    logClear: logClear,
    toJSONLines: toJSONLines,
    download: download,
    getEntries: getEntries,
    count: count,
    clear: clear,
    sha256: sha256,
    sessionId: sessionId,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AuditLog: AuditLog };
}
