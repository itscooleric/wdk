/**
 * WDK Preflight Scanner — file sanitization preflight for restricted environments.
 * Scans files for risky content patterns (base64 blobs, script tags, binary bytes,
 * formula injection, high entropy, etc.) before transfer.
 * Supports scan-only and scan-and-convert modes with manifest generation.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

/* global DK_SHELL_THEME, crypto */

// ---------------------------------------------------------------------------
// Theme (uses shell theme if available, otherwise standalone)
// ---------------------------------------------------------------------------

var DK_SCAN_THEME = (typeof DK_SHELL_THEME !== 'undefined') ? DK_SHELL_THEME : {
  bg: '#0a0a1a',
  bgLight: '#12122a',
  bgPanel: '#0d0d20',
  bgHover: '#1a1a3a',
  bgActive: '#1e1e40',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  yellow: '#f5e642',
  text: '#e0e0f0',
  textDim: '#8888aa',
  textMuted: '#555577',
  border: '#2a2a4a',
  borderBright: '#3a3a6a',
  shadow: 'rgba(0, 229, 255, 0.12)',
  shadowPink: 'rgba(255, 41, 117, 0.12)'
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

var DK_SCAN_VERSION = '1.0.0';

var DK_SCAN_ACCEPTED_EXTENSIONS = [
  'txt', 'md', 'csv', 'json', 'js', 'html', 'xml',
  'ps1', 'py', 'sh', 'bat', 'cmd',
  'yml', 'yaml', 'ini', 'cfg', 'conf', 'log', 'tsv'
];

var DK_SCAN_MACRO_EXTENSIONS = [
  'xlsm', 'docm', 'pptm', 'hta', 'vbs', 'wsf', 'scr', 'cmd', 'bat', 'ps1'
];

var DK_SCAN_SEVERITY = {
  high: { label: 'HIGH', color: '#ff2975', bg: 'rgba(255, 41, 117, 0.15)' },
  medium: { label: 'MED', color: '#f5e642', bg: 'rgba(245, 230, 66, 0.12)' },
  low: { label: 'LOW', color: '#00e5ff', bg: 'rgba(0, 229, 255, 0.10)' }
};

var DK_SCAN_CHECK_SEVERITY = {
  base64_blob: 'medium',
  data_uri: 'medium',
  binary_bytes: 'high',
  long_line: 'low',
  script_tag: 'high',
  macro_ext: 'high',
  large_file: 'low',
  formula_injection: 'medium',
  high_entropy: 'medium'
};

var DK_SCAN_SIZE_LIMIT = 10 * 1024 * 1024; // 10 MB

// ---------------------------------------------------------------------------
// Utility functions
// ---------------------------------------------------------------------------

/**
 * Get file extension from a filename.
 * @param {string} name
 * @returns {string} lowercase extension without dot
 */
function dkScanGetExt(name) {
  var parts = (name || '').split('.');
  if (parts.length < 2) return '';
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Format bytes to human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function dkScanFormatBytes(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = 0;
  var val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return (i === 0 ? val : val.toFixed(1)) + ' ' + units[i];
}

/**
 * Compute SHA-256 hash of an ArrayBuffer using crypto.subtle.
 * Returns hex string or null if unavailable.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<string|null>}
 */
function dkScanHash(buffer) {
  if (typeof crypto === 'undefined' || !crypto.subtle || !crypto.subtle.digest) {
    return Promise.resolve(null);
  }
  return crypto.subtle.digest('SHA-256', buffer).then(function (hashBuf) {
    var arr = new Uint8Array(hashBuf);
    var hex = '';
    for (var i = 0; i < arr.length; i++) {
      var h = arr[i].toString(16);
      hex += (h.length === 1 ? '0' : '') + h;
    }
    return hex;
  });
}

/**
 * Compute Shannon entropy of a string.
 * @param {string} str
 * @returns {number}
 */
function dkScanEntropy(str) {
  if (!str || str.length === 0) return 0;
  var freq = {};
  var len = str.length;
  for (var i = 0; i < len; i++) {
    var ch = str[i];
    freq[ch] = (freq[ch] || 0) + 1;
  }
  var entropy = 0;
  var keys = Object.keys(freq);
  for (var k = 0; k < keys.length; k++) {
    var p = freq[keys[k]] / len;
    if (p > 0) {
      entropy -= p * (Math.log(p) / Math.LN2);
    }
  }
  return entropy;
}

/**
 * Escape HTML special characters.
 * @param {string} str
 * @returns {string}
 */
function dkScanEscapeHTML(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Escape a CSV field value.
 * @param {string} val
 * @returns {string}
 */
function dkScanCSVField(val) {
  var s = String(val == null ? '' : val);
  if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/**
 * Build a CSV string from headers and rows.
 * @param {string[]} headers
 * @param {Array<string[]>} rows
 * @returns {string}
 */
function dkScanBuildCSV(headers, rows) {
  var lines = [headers.map(dkScanCSVField).join(',')];
  for (var i = 0; i < rows.length; i++) {
    lines.push(rows[i].map(dkScanCSVField).join(','));
  }
  return lines.join('\n');
}

/**
 * Read a File object as text.
 * @param {File} file
 * @returns {Promise<string>}
 */
function dkScanReadText(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsText(file);
  });
}

/**
 * Read a File object as ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
function dkScanReadBuffer(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsArrayBuffer(file);
  });
}

// ---------------------------------------------------------------------------
// Scanner checks
// ---------------------------------------------------------------------------

/**
 * Run all applicable checks on file content.
 * @param {string} text - file content as text
 * @param {string} name - filename
 * @param {number} size - file size in bytes
 * @param {Uint8Array} bytes - raw bytes
 * @returns {Array<{check: string, severity: string, line: number|null, detail: string}>}
 */
function dkScanCheckContent(text, name, size, bytes) {
  var warnings = [];
  var ext = dkScanGetExt(name);

  // large_file
  if (size > DK_SCAN_SIZE_LIMIT) {
    warnings.push({
      check: 'large_file',
      severity: DK_SCAN_CHECK_SEVERITY.large_file,
      line: null,
      detail: 'File size ' + dkScanFormatBytes(size) + ' exceeds 10 MB limit'
    });
  }

  // macro_ext
  if (DK_SCAN_MACRO_EXTENSIONS.indexOf(ext) >= 0) {
    warnings.push({
      check: 'macro_ext',
      severity: DK_SCAN_CHECK_SEVERITY.macro_ext,
      line: null,
      detail: 'Macro-capable extension: .' + ext
    });
  }

  // binary_bytes — count non-printable bytes
  if (bytes && bytes.length > 0) {
    var nonPrintable = 0;
    for (var b = 0; b < bytes.length; b++) {
      var v = bytes[b];
      if (v !== 0x09 && v !== 0x0A && v !== 0x0D && !(v >= 0x20 && v <= 0x7E)) {
        nonPrintable++;
      }
    }
    var ratio = nonPrintable / bytes.length;
    if (ratio > 0.01) {
      warnings.push({
        check: 'binary_bytes',
        severity: DK_SCAN_CHECK_SEVERITY.binary_bytes,
        line: null,
        detail: (ratio * 100).toFixed(1) + '% non-printable bytes (' + nonPrintable + '/' + bytes.length + ')'
      });
    }
  }

  // Line-by-line checks
  var lines = text.split('\n');
  var isCSV = (ext === 'csv' || ext === 'tsv');
  var base64Re = /[A-Za-z0-9+\/=]{256,}/;
  var dataUriRe = /data:[a-zA-Z0-9\/+.-]+;/i;
  var scriptTagRe = /<script|<iframe|<object|<embed|<applet|javascript:|on[a-z]+\s*=/i;
  var formulaRe = /^[\t\r]?[=+\-@]/;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var lineNum = i + 1;

    // long_line
    if (line.length > 10000) {
      warnings.push({
        check: 'long_line',
        severity: DK_SCAN_CHECK_SEVERITY.long_line,
        line: lineNum,
        detail: 'Line length: ' + line.length + ' chars'
      });
    }

    // base64_blob
    var b64Match = base64Re.exec(line);
    if (b64Match) {
      warnings.push({
        check: 'base64_blob',
        severity: DK_SCAN_CHECK_SEVERITY.base64_blob,
        line: lineNum,
        detail: b64Match[0].length + '-char base64 string'
      });
    }

    // data_uri
    if (dataUriRe.test(line)) {
      warnings.push({
        check: 'data_uri',
        severity: DK_SCAN_CHECK_SEVERITY.data_uri,
        line: lineNum,
        detail: 'data: URI pattern detected'
      });
    }

    // script_tag
    var scriptMatch = scriptTagRe.exec(line);
    if (scriptMatch) {
      warnings.push({
        check: 'script_tag',
        severity: DK_SCAN_CHECK_SEVERITY.script_tag,
        line: lineNum,
        detail: 'Script/injection pattern: ' + scriptMatch[0].substring(0, 40)
      });
    }

    // formula_injection (CSV/TSV only)
    if (isCSV) {
      var cells = dkScanSplitCSVLine(line, ext === 'tsv' ? '\t' : ',');
      for (var ci = 0; ci < cells.length; ci++) {
        var cell = cells[ci];
        if (cell.length > 0 && formulaRe.test(cell)) {
          warnings.push({
            check: 'formula_injection',
            severity: DK_SCAN_CHECK_SEVERITY.formula_injection,
            line: lineNum,
            detail: 'Cell starts with ' + JSON.stringify(cell.charAt(0))
          });
          break; // one warning per line is enough
        }
      }
    }

    // high_entropy — skip very short lines
    if (line.length >= 16) {
      var ent = dkScanEntropy(line);
      if (ent > 6.0) {
        warnings.push({
          check: 'high_entropy',
          severity: DK_SCAN_CHECK_SEVERITY.high_entropy,
          line: lineNum,
          detail: 'Shannon entropy ' + ent.toFixed(2) + ' (threshold 6.0)'
        });
      }
    }
  }

  return warnings;
}

/**
 * Naive CSV line splitter (handles quoted fields).
 * @param {string} line
 * @param {string} delim
 * @returns {string[]}
 */
function dkScanSplitCSVLine(line, delim) {
  var fields = [];
  var current = '';
  var inQuotes = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delim) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

// ---------------------------------------------------------------------------
// File scanning — main entry point
// ---------------------------------------------------------------------------

/**
 * Scan a single file and produce a result object.
 * @param {File} file
 * @returns {Promise<object>} result object
 */
function dkScanFile(file) {
  var ext = dkScanGetExt(file.name);

  return dkScanReadBuffer(file).then(function (buffer) {
    var bytes = new Uint8Array(buffer);
    var text = new TextDecoder().decode(bytes);

    return dkScanHash(buffer).then(function (hash) {
      var warnings = dkScanCheckContent(text, file.name, file.size, bytes);

      return {
        name: file.name,
        size: file.size,
        type: ext || 'unknown',
        warnings: warnings,
        clean: warnings.length === 0,
        hash: hash,
        _text: text // internal — used for conversion
      };
    });
  });
}

/**
 * Scan multiple files.
 * @param {FileList|File[]} files
 * @returns {Promise<object[]>} array of result objects
 */
function dkScanFiles(files) {
  var promises = [];
  for (var i = 0; i < files.length; i++) {
    promises.push(dkScanFile(files[i]));
  }
  return Promise.all(promises);
}

// ---------------------------------------------------------------------------
// Conversion rules
// ---------------------------------------------------------------------------

/**
 * Get the conversion output extension for a given input extension.
 * @param {string} ext
 * @returns {string}
 */
function dkScanConvertExt(ext) {
  switch (ext) {
    case 'js': return 'txt';
    case 'csv': return 'html';
    case 'json': return 'txt';
    case 'md': return 'html';
    case 'html': return 'txt';
    default: return 'txt';
  }
}

/**
 * Get the output filename after conversion.
 * @param {string} name
 * @returns {string}
 */
function dkScanConvertName(name) {
  var ext = dkScanGetExt(name);
  var base = name.substring(0, name.length - ext.length - 1);
  var outExt = dkScanConvertExt(ext);
  return base + '.' + outExt;
}

/**
 * Convert file content according to type rules.
 * @param {string} text - original content
 * @param {string} ext - file extension
 * @param {string} name - original filename
 * @returns {string} converted content
 */
function dkScanConvert(text, ext, name) {
  switch (ext) {
    case 'js':
      return text; // just rename to .txt

    case 'csv':
      return dkScanCSVToHTML(text, name);

    case 'json':
      return dkScanPrettyJSON(text);

    case 'md':
      return dkScanMarkdownToHTML(text, name);

    case 'html':
      return dkScanStripHTML(text);

    default:
      return text; // as-is, renamed to .txt
  }
}

/**
 * Convert CSV text to an HTML table.
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
function dkScanCSVToHTML(text, name) {
  var lines = text.split('\n');
  var html = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<title>' + dkScanEscapeHTML(name) + '</title>',
    '<style>body{font-family:monospace;background:#0a0a1a;color:#e0e0f0;padding:16px}',
    'table{border-collapse:collapse;width:100%}',
    'th,td{border:1px solid #2a2a4a;padding:4px 8px;text-align:left;font-size:12px}',
    'th{background:#12122a;color:#00e5ff}',
    'tr:nth-child(even){background:#0d0d20}',
    '</style></head><body>',
    '<h3>' + dkScanEscapeHTML(name) + '</h3>',
    '<table>'];

  for (var i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '') continue;
    var cells = dkScanSplitCSVLine(lines[i], ',');
    var tag = (i === 0) ? 'th' : 'td';
    html.push('<tr>');
    for (var c = 0; c < cells.length; c++) {
      html.push('<' + tag + '>' + dkScanEscapeHTML(cells[c]) + '</' + tag + '>');
    }
    html.push('</tr>');
  }

  html.push('</table></body></html>');
  return html.join('\n');
}

/**
 * Pretty-print JSON text.
 * @param {string} text
 * @returns {string}
 */
function dkScanPrettyJSON(text) {
  try {
    var parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch (e) {
    return text; // return as-is if not valid JSON
  }
}

/**
 * Basic Markdown to HTML conversion.
 * Handles: headers, bold, italic, code blocks, inline code, lists, links stripped to text.
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
function dkScanMarkdownToHTML(text, name) {
  var lines = text.split('\n');
  var html = ['<!DOCTYPE html><html><head><meta charset="utf-8">',
    '<title>' + dkScanEscapeHTML(name) + '</title>',
    '<style>body{font-family:monospace;background:#0a0a1a;color:#e0e0f0;padding:16px;line-height:1.6}',
    'h1,h2,h3,h4,h5,h6{color:#00e5ff;margin:16px 0 8px}',
    'code{background:#12122a;padding:2px 4px;border-radius:3px;color:#b967ff}',
    'pre{background:#12122a;padding:12px;border-radius:4px;overflow-x:auto;border:1px solid #2a2a4a}',
    'pre code{padding:0;background:none}',
    'ul,ol{padding-left:24px}',
    'li{margin:4px 0}',
    'strong{color:#ff2975}',
    '</style></head><body>'];

  var inCodeBlock = false;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];

    // Code blocks
    if (line.indexOf('```') === 0) {
      if (inCodeBlock) {
        html.push('</code></pre>');
        inCodeBlock = false;
      } else {
        html.push('<pre><code>');
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      html.push(dkScanEscapeHTML(line));
      continue;
    }

    // Headers
    var headerMatch = line.match(/^(#{1,6})\s+(.*)/);
    if (headerMatch) {
      var level = headerMatch[1].length;
      html.push('<h' + level + '>' + dkScanInlineMarkdown(headerMatch[2]) + '</h' + level + '>');
      continue;
    }

    // Unordered lists
    if (/^\s*[-*+]\s+/.test(line)) {
      html.push('<li>' + dkScanInlineMarkdown(line.replace(/^\s*[-*+]\s+/, '')) + '</li>');
      continue;
    }

    // Ordered lists
    if (/^\s*\d+\.\s+/.test(line)) {
      html.push('<li>' + dkScanInlineMarkdown(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      html.push('<br>');
      continue;
    }

    // Paragraph
    html.push('<p>' + dkScanInlineMarkdown(line) + '</p>');
  }

  if (inCodeBlock) html.push('</code></pre>');

  html.push('</body></html>');
  return html.join('\n');
}

/**
 * Process inline markdown elements.
 * @param {string} text
 * @returns {string}
 */
function dkScanInlineMarkdown(text) {
  var s = dkScanEscapeHTML(text);
  // Inline code
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  // Italic
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/_([^_]+)_/g, '<em>$1</em>');
  // Links — strip to text
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  return s;
}

/**
 * Strip all HTML tags from text.
 * @param {string} text
 * @returns {string}
 */
function dkScanStripHTML(text) {
  // Remove script/style content entirely
  var s = text.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove all tags
  s = s.replace(/<[^>]+>/g, '');
  // Decode common entities
  s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');
  // Collapse whitespace
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ---------------------------------------------------------------------------
// Manifest generation
// ---------------------------------------------------------------------------

/**
 * Generate manifest.csv content from scan results.
 * @param {object[]} results - array of scan result objects
 * @param {boolean} converted - whether files were converted
 * @returns {string}
 */
function dkScanManifestCSV(results, converted) {
  var headers = ['original_name', 'output_name', 'size_bytes', 'sha256',
    'conversion_type', 'warning_count', 'warnings_summary'];
  var rows = [];

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var ext = dkScanGetExt(r.name);
    var outName = converted ? dkScanConvertName(r.name) : r.name;
    var convType = converted ? (ext + ' -> ' + dkScanConvertExt(ext)) : 'none';
    var warnSummary = r.warnings.map(function (w) {
      return w.check + '(' + w.severity + ')';
    }).join('; ');

    rows.push([
      r.name,
      outName,
      String(r.size),
      r.hash || 'unavailable',
      convType,
      String(r.warnings.length),
      warnSummary || 'clean'
    ]);
  }

  return dkScanBuildCSV(headers, rows);
}

/**
 * Generate warnings.csv content from scan results.
 * @param {object[]} results
 * @returns {string}
 */
function dkScanWarningsCSV(results) {
  var headers = ['filename', 'line', 'check', 'severity', 'detail'];
  var rows = [];

  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    for (var w = 0; w < r.warnings.length; w++) {
      var warn = r.warnings[w];
      rows.push([
        r.name,
        warn.line != null ? String(warn.line) : '',
        warn.check,
        warn.severity,
        warn.detail
      ]);
    }
  }

  return dkScanBuildCSV(headers, rows);
}

// ---------------------------------------------------------------------------
// Scan report (self-contained HTML)
// ---------------------------------------------------------------------------

/**
 * Generate a self-contained HTML scan report.
 * @param {object[]} results
 * @param {boolean} converted
 * @returns {string}
 */
function dkScanReportHTML(results, converted) {
  var now = new Date().toISOString();
  var totalSize = 0;
  var totalWarnings = 0;
  var cleanCount = 0;
  var flaggedCount = 0;

  for (var i = 0; i < results.length; i++) {
    totalSize += results[i].size;
    totalWarnings += results[i].warnings.length;
    if (results[i].clean) { cleanCount++; } else { flaggedCount++; }
  }

  var T = DK_SCAN_THEME;
  var html = [];

  html.push('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">');
  html.push('<title>WDK Preflight Scan Report</title>');
  html.push('<style>');
  html.push('* { box-sizing: border-box; margin: 0; padding: 0; }');
  html.push('body { font-family: "SF Mono", "Fira Code", "Consolas", monospace; font-size: 13px;');
  html.push('  background: ' + T.bg + '; color: ' + T.text + '; padding: 24px; line-height: 1.5; }');
  html.push('h1 { font-size: 18px; color: ' + T.cyan + '; margin-bottom: 4px; }');
  html.push('h2 { font-size: 14px; color: ' + T.purple + '; margin: 20px 0 8px; }');
  html.push('.meta { font-size: 11px; color: ' + T.textDim + '; margin-bottom: 16px; }');
  html.push('.summary { display: flex; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }');
  html.push('.stat { background: ' + T.bgLight + '; border: 1px solid ' + T.border + ';');
  html.push('  border-radius: 6px; padding: 10px 16px; min-width: 120px; }');
  html.push('.stat-val { font-size: 20px; font-weight: 700; color: ' + T.cyan + '; }');
  html.push('.stat-label { font-size: 10px; color: ' + T.textDim + '; text-transform: uppercase; letter-spacing: 1px; }');
  html.push('.file-card { background: ' + T.bgPanel + '; border: 1px solid ' + T.border + ';');
  html.push('  border-radius: 6px; margin-bottom: 10px; overflow: hidden; }');
  html.push('.file-header { display: flex; align-items: center; gap: 10px; padding: 8px 12px;');
  html.push('  cursor: pointer; user-select: none; }');
  html.push('.file-header:hover { background: ' + T.bgHover + '; }');
  html.push('.file-name { flex: 1; font-weight: 600; }');
  html.push('.badge { display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 10px;');
  html.push('  font-weight: 700; letter-spacing: 0.5px; }');
  html.push('.badge-high { background: ' + DK_SCAN_SEVERITY.high.bg + '; color: ' + DK_SCAN_SEVERITY.high.color + '; }');
  html.push('.badge-medium { background: ' + DK_SCAN_SEVERITY.medium.bg + '; color: ' + DK_SCAN_SEVERITY.medium.color + '; }');
  html.push('.badge-low { background: ' + DK_SCAN_SEVERITY.low.bg + '; color: ' + DK_SCAN_SEVERITY.low.color + '; }');
  html.push('.badge-clean { background: rgba(0, 200, 83, 0.12); color: #00c853; }');
  html.push('.warnings-table { width: 100%; border-collapse: collapse; }');
  html.push('.warnings-table th, .warnings-table td { padding: 4px 8px; text-align: left;');
  html.push('  border-top: 1px solid ' + T.border + '; font-size: 11px; }');
  html.push('.warnings-table th { background: ' + T.bgLight + '; color: ' + T.textDim + '; }');
  html.push('.detail-body { display: none; }');
  html.push('.detail-body.open { display: block; }');
  html.push('</style></head><body>');

  html.push('<h1>WDK Preflight Scan Report</h1>');
  html.push('<div class="meta">Generated: ' + now + ' | Mode: ' + (converted ? 'Scan & Convert' : 'Scan Only') + '</div>');

  // Summary stats
  html.push('<div class="summary">');
  html.push('<div class="stat"><div class="stat-val">' + results.length + '</div><div class="stat-label">Files Scanned</div></div>');
  html.push('<div class="stat"><div class="stat-val">' + dkScanFormatBytes(totalSize) + '</div><div class="stat-label">Total Size</div></div>');
  html.push('<div class="stat"><div class="stat-val" style="color:#00c853">' + cleanCount + '</div><div class="stat-label">Clean</div></div>');
  html.push('<div class="stat"><div class="stat-val" style="color:' + T.pink + '">' + flaggedCount + '</div><div class="stat-label">Flagged</div></div>');
  html.push('<div class="stat"><div class="stat-val" style="color:' + T.yellow + '">' + totalWarnings + '</div><div class="stat-label">Warnings</div></div>');
  html.push('</div>');

  // Per-file results
  html.push('<h2>File Results</h2>');

  for (var f = 0; f < results.length; f++) {
    var res = results[f];
    var maxSev = dkScanMaxSeverity(res.warnings);
    var badgeClass = res.clean ? 'badge-clean' : ('badge-' + maxSev);
    var badgeText = res.clean ? 'CLEAN' : DK_SCAN_SEVERITY[maxSev].label;
    var cardId = 'scan-card-' + f;

    html.push('<div class="file-card">');
    html.push('<div class="file-header" onclick="var el=document.getElementById(\'' + cardId + '\');el.classList.toggle(\'open\')">');
    html.push('<span class="file-name">' + dkScanEscapeHTML(res.name) + '</span>');
    html.push('<span style="color:' + T.textDim + '">' + dkScanFormatBytes(res.size) + '</span>');
    html.push('<span class="badge ' + badgeClass + '">' + badgeText + '</span>');
    html.push('<span style="color:' + T.textDim + '">' + res.warnings.length + ' warning' + (res.warnings.length !== 1 ? 's' : '') + '</span>');
    html.push('</div>');

    html.push('<div id="' + cardId + '" class="detail-body">');
    if (res.warnings.length > 0) {
      html.push('<table class="warnings-table">');
      html.push('<tr><th>Check</th><th>Severity</th><th>Line</th><th>Detail</th></tr>');
      for (var wi = 0; wi < res.warnings.length; wi++) {
        var w = res.warnings[wi];
        var sevObj = DK_SCAN_SEVERITY[w.severity] || DK_SCAN_SEVERITY.medium;
        html.push('<tr>');
        html.push('<td>' + dkScanEscapeHTML(w.check) + '</td>');
        html.push('<td><span class="badge badge-' + w.severity + '">' + sevObj.label + '</span></td>');
        html.push('<td>' + (w.line != null ? w.line : '-') + '</td>');
        html.push('<td>' + dkScanEscapeHTML(w.detail) + '</td>');
        html.push('</tr>');
      }
      html.push('</table>');
    } else {
      html.push('<div style="padding:8px 12px;color:#00c853;font-size:11px">No issues detected.</div>');
    }
    html.push('</div></div>');
  }

  html.push('<div class="meta" style="margin-top:24px">WDK Preflight Scanner v' + DK_SCAN_VERSION + '</div>');
  html.push('</body></html>');

  return html.join('\n');
}

/**
 * Get the highest severity from a list of warnings.
 * @param {object[]} warnings
 * @returns {string}
 */
function dkScanMaxSeverity(warnings) {
  var order = { high: 3, medium: 2, low: 1 };
  var max = 0;
  var maxSev = 'low';
  for (var i = 0; i < warnings.length; i++) {
    var s = order[warnings[i].severity] || 0;
    if (s > max) {
      max = s;
      maxSev = warnings[i].severity;
    }
  }
  return maxSev;
}

// ---------------------------------------------------------------------------
// ZIP builder (store-only, no compression — zero dependencies)
// ---------------------------------------------------------------------------

/**
 * Create a ZIP file from a map of filename -> content.
 * Uses stored (uncompressed) entries only to avoid needing a deflate implementation.
 * @param {object} entries - { filename: string_or_Uint8Array, ... }
 * @returns {Uint8Array}
 */
function dkScanBuildZip(entries) {
  var files = Object.keys(entries);
  var localHeaders = [];
  var centralHeaders = [];
  var dataBlobs = [];
  var offset = 0;

  for (var i = 0; i < files.length; i++) {
    var name = files[i];
    var content = entries[name];
    var data;

    if (typeof content === 'string') {
      data = dkScanStringToBytes(content);
    } else {
      data = content;
    }

    var nameBytes = dkScanStringToBytes(name);
    var crc = dkScanCRC32(data);

    // Local file header (30 bytes + name + data)
    var localHeader = new Uint8Array(30 + nameBytes.length);
    var lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034B50, true);   // signature
    lv.setUint16(4, 20, true);             // version needed
    lv.setUint16(6, 0, true);              // general purpose flags
    lv.setUint16(8, 0, true);              // compression: stored
    lv.setUint16(10, 0, true);             // mod time
    lv.setUint16(12, 0, true);             // mod date
    lv.setUint32(14, crc, true);           // CRC-32
    lv.setUint32(18, data.length, true);   // compressed size
    lv.setUint32(22, data.length, true);   // uncompressed size
    lv.setUint16(26, nameBytes.length, true); // name length
    lv.setUint16(28, 0, true);             // extra field length
    localHeader.set(nameBytes, 30);

    localHeaders.push(localHeader);
    dataBlobs.push(data);

    // Central directory entry (46 bytes + name)
    var centralEntry = new Uint8Array(46 + nameBytes.length);
    var cv = new DataView(centralEntry.buffer);
    cv.setUint32(0, 0x02014B50, true);    // signature
    cv.setUint16(4, 20, true);             // version made by
    cv.setUint16(6, 20, true);             // version needed
    cv.setUint16(8, 0, true);              // flags
    cv.setUint16(10, 0, true);             // compression: stored
    cv.setUint16(12, 0, true);             // mod time
    cv.setUint16(14, 0, true);             // mod date
    cv.setUint32(16, crc, true);           // CRC-32
    cv.setUint32(20, data.length, true);   // compressed size
    cv.setUint32(24, data.length, true);   // uncompressed size
    cv.setUint16(28, nameBytes.length, true); // name length
    cv.setUint16(30, 0, true);             // extra field length
    cv.setUint16(32, 0, true);             // comment length
    cv.setUint16(34, 0, true);             // disk number start
    cv.setUint16(36, 0, true);             // internal file attributes
    cv.setUint32(38, 0, true);             // external file attributes
    cv.setUint32(42, offset, true);        // relative offset of local header
    centralEntry.set(nameBytes, 46);

    centralHeaders.push(centralEntry);

    offset += localHeader.length + data.length;
  }

  // End of central directory record (22 bytes)
  var centralDirOffset = offset;
  var centralDirSize = 0;
  for (var c = 0; c < centralHeaders.length; c++) {
    centralDirSize += centralHeaders[c].length;
  }

  var eocd = new Uint8Array(22);
  var ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054B50, true);              // signature
  ev.setUint16(4, 0, true);                        // disk number
  ev.setUint16(6, 0, true);                        // disk with central dir
  ev.setUint16(8, files.length, true);              // entries on this disk
  ev.setUint16(10, files.length, true);             // total entries
  ev.setUint32(12, centralDirSize, true);           // central dir size
  ev.setUint32(16, centralDirOffset, true);         // central dir offset
  ev.setUint16(20, 0, true);                        // comment length

  // Combine all parts
  var totalSize = offset + centralDirSize + 22;
  var zip = new Uint8Array(totalSize);
  var pos = 0;

  for (var li = 0; li < localHeaders.length; li++) {
    zip.set(localHeaders[li], pos);
    pos += localHeaders[li].length;
    zip.set(dataBlobs[li], pos);
    pos += dataBlobs[li].length;
  }
  for (var ci = 0; ci < centralHeaders.length; ci++) {
    zip.set(centralHeaders[ci], pos);
    pos += centralHeaders[ci].length;
  }
  zip.set(eocd, pos);

  return zip;
}

/**
 * Encode string to UTF-8 bytes.
 * @param {string} str
 * @returns {Uint8Array}
 */
function dkScanStringToBytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str);
  }
  // Fallback for old environments
  var arr = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) {
      arr.push(code);
    } else if (code < 0x800) {
      arr.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else {
      arr.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    }
  }
  return new Uint8Array(arr);
}

/**
 * CRC-32 computation for ZIP.
 * @param {Uint8Array} data
 * @returns {number}
 */
var dkScanCRC32Table = null;

function dkScanCRC32(data) {
  if (!dkScanCRC32Table) {
    dkScanCRC32Table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      dkScanCRC32Table[n] = c;
    }
  }

  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) {
    crc = dkScanCRC32Table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ---------------------------------------------------------------------------
// Download helper
// ---------------------------------------------------------------------------

/**
 * Trigger a browser download for a Blob.
 * @param {Blob} blob
 * @param {string} filename
 */
function dkScanDownloadBlob(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

// ---------------------------------------------------------------------------
// Package results for download
// ---------------------------------------------------------------------------

/**
 * Build and download the results ZIP.
 * @param {object[]} results - scan results
 * @param {boolean} converted - whether scan+convert mode was used
 */
function dkScanDownloadResults(results, converted) {
  var zipEntries = {};

  // Add manifest and warnings CSVs
  zipEntries['manifest.csv'] = dkScanManifestCSV(results, converted);
  zipEntries['warnings.csv'] = dkScanWarningsCSV(results);
  zipEntries['scan-report.html'] = dkScanReportHTML(results, converted);

  // Add converted (or original) files
  for (var i = 0; i < results.length; i++) {
    var r = results[i];
    var text = r._text || '';
    var ext = dkScanGetExt(r.name);

    if (converted) {
      var outName = dkScanConvertName(r.name);
      var outContent = dkScanConvert(text, ext, r.name);
      zipEntries['files/' + outName] = outContent;
    } else {
      zipEntries['files/' + r.name] = text;
    }
  }

  var zipBytes = dkScanBuildZip(zipEntries);
  var blob = new Blob([zipBytes], { type: 'application/zip' });
  var timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  dkScanDownloadBlob(blob, 'preflight-scan-' + timestamp + '.zip');
}

// ---------------------------------------------------------------------------
// UI Panel
// ---------------------------------------------------------------------------

/**
 * Inject scanner panel styles.
 */
function dkScanInjectStyles() {
  if (document.getElementById('dk-scan-styles')) return;
  var T = DK_SCAN_THEME;
  var style = document.createElement('style');
  style.id = 'dk-scan-styles';
  style.textContent = [
    '.dk-scan-panel {',
    '  background: ' + T.bgPanel + ';',
    '  border: 1px solid ' + T.border + ';',
    '  border-radius: 8px;',
    '  padding: 16px;',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 13px;',
    '  color: ' + T.text + ';',
    '  max-width: 1000px;',
    '  margin: 0 auto;',
    '}',

    '.dk-scan-title {',
    '  font-size: 16px;',
    '  font-weight: 700;',
    '  color: ' + T.cyan + ';',
    '  margin-bottom: 12px;',
    '}',

    /* Drop zone */
    '.dk-scan-dropzone {',
    '  border: 2px dashed ' + T.border + ';',
    '  border-radius: 8px;',
    '  padding: 28px 16px;',
    '  text-align: center;',
    '  cursor: pointer;',
    '  transition: border-color 0.2s, background 0.2s;',
    '  background: ' + T.bg + ';',
    '  margin-bottom: 12px;',
    '}',
    '.dk-scan-dropzone.dk-dragover {',
    '  border-color: ' + T.cyan + ';',
    '  background: rgba(0, 229, 255, 0.04);',
    '  box-shadow: inset 0 0 20px ' + T.shadow + ';',
    '}',
    '.dk-scan-dropzone-icon {',
    '  font-size: 28px;',
    '  color: ' + T.purple + ';',
    '  margin-bottom: 6px;',
    '}',
    '.dk-scan-dropzone-label {',
    '  font-size: 13px;',
    '  color: ' + T.text + ';',
    '  margin-bottom: 4px;',
    '}',
    '.dk-scan-dropzone-hint {',
    '  font-size: 11px;',
    '  color: ' + T.textDim + ';',
    '}',

    /* File list */
    '.dk-scan-filelist {',
    '  margin-bottom: 12px;',
    '  max-height: 120px;',
    '  overflow-y: auto;',
    '  font-size: 11px;',
    '  color: ' + T.textDim + ';',
    '}',
    '.dk-scan-filelist-item {',
    '  display: flex;',
    '  justify-content: space-between;',
    '  padding: 2px 8px;',
    '  border-bottom: 1px solid ' + T.border + ';',
    '}',
    '.dk-scan-filelist-name { color: ' + T.text + '; }',
    '.dk-scan-filelist-size { color: ' + T.textDim + '; }',
    '.dk-scan-filelist-remove {',
    '  color: ' + T.pink + ';',
    '  cursor: pointer;',
    '  margin-left: 8px;',
    '}',

    /* Buttons */
    '.dk-scan-actions {',
    '  display: flex;',
    '  gap: 8px;',
    '  margin-bottom: 16px;',
    '  flex-wrap: wrap;',
    '}',
    '.dk-scan-btn {',
    '  display: inline-flex;',
    '  align-items: center;',
    '  gap: 6px;',
    '  padding: 6px 14px;',
    '  border: 1px solid ' + T.border + ';',
    '  border-radius: 4px;',
    '  background: ' + T.bgHover + ';',
    '  color: ' + T.text + ';',
    '  cursor: pointer;',
    '  font-family: inherit;',
    '  font-size: 12px;',
    '  transition: background 0.12s, border-color 0.12s, color 0.12s;',
    '}',
    '.dk-scan-btn:hover {',
    '  background: ' + T.bgActive + ';',
    '  border-color: ' + T.borderBright + ';',
    '  color: ' + T.cyan + ';',
    '}',
    '.dk-scan-btn:disabled {',
    '  opacity: 0.35;',
    '  cursor: not-allowed;',
    '}',
    '.dk-scan-btn-primary {',
    '  background: rgba(0, 229, 255, 0.12);',
    '  border-color: ' + T.cyan + ';',
    '  color: ' + T.cyan + ';',
    '}',
    '.dk-scan-btn-primary:hover {',
    '  background: rgba(0, 229, 255, 0.22);',
    '}',
    '.dk-scan-btn-convert {',
    '  background: rgba(185, 103, 255, 0.12);',
    '  border-color: ' + T.purple + ';',
    '  color: ' + T.purple + ';',
    '}',
    '.dk-scan-btn-convert:hover {',
    '  background: rgba(185, 103, 255, 0.22);',
    '}',

    /* Summary bar */
    '.dk-scan-summary {',
    '  display: flex;',
    '  gap: 16px;',
    '  padding: 8px 12px;',
    '  background: ' + T.bgLight + ';',
    '  border: 1px solid ' + T.border + ';',
    '  border-radius: 6px;',
    '  margin-bottom: 12px;',
    '  flex-wrap: wrap;',
    '}',
    '.dk-scan-summary-stat {',
    '  font-size: 12px;',
    '}',
    '.dk-scan-summary-val {',
    '  font-weight: 700;',
    '  margin-right: 4px;',
    '}',
    '.dk-scan-summary-label {',
    '  color: ' + T.textDim + ';',
    '  font-size: 10px;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.5px;',
    '}',

    /* Results table */
    '.dk-scan-results-table {',
    '  width: 100%;',
    '  border-collapse: collapse;',
    '  margin-bottom: 12px;',
    '}',
    '.dk-scan-results-table th {',
    '  text-align: left;',
    '  padding: 6px 8px;',
    '  font-size: 10px;',
    '  text-transform: uppercase;',
    '  letter-spacing: 0.5px;',
    '  color: ' + T.textDim + ';',
    '  border-bottom: 1px solid ' + T.borderBright + ';',
    '  background: ' + T.bgLight + ';',
    '}',
    '.dk-scan-results-table td {',
    '  padding: 5px 8px;',
    '  font-size: 12px;',
    '  border-bottom: 1px solid ' + T.border + ';',
    '}',
    '.dk-scan-results-table tr:hover td {',
    '  background: ' + T.bgHover + ';',
    '}',
    '.dk-scan-result-row { cursor: pointer; }',

    /* Severity badges */
    '.dk-scan-badge {',
    '  display: inline-block;',
    '  padding: 1px 6px;',
    '  border-radius: 3px;',
    '  font-size: 10px;',
    '  font-weight: 700;',
    '  letter-spacing: 0.5px;',
    '}',
    '.dk-scan-badge-high { background: ' + DK_SCAN_SEVERITY.high.bg + '; color: ' + DK_SCAN_SEVERITY.high.color + '; }',
    '.dk-scan-badge-medium { background: ' + DK_SCAN_SEVERITY.medium.bg + '; color: ' + DK_SCAN_SEVERITY.medium.color + '; }',
    '.dk-scan-badge-low { background: ' + DK_SCAN_SEVERITY.low.bg + '; color: ' + DK_SCAN_SEVERITY.low.color + '; }',
    '.dk-scan-badge-clean { background: rgba(0, 200, 83, 0.12); color: #00c853; }',

    /* Detail row */
    '.dk-scan-detail {',
    '  display: none;',
    '}',
    '.dk-scan-detail.dk-open {',
    '  display: table-row;',
    '}',
    '.dk-scan-detail td {',
    '  padding: 0;',
    '}',
    '.dk-scan-detail-inner {',
    '  padding: 8px 12px 8px 24px;',
    '  background: ' + T.bg + ';',
    '  border-left: 3px solid ' + T.borderBright + ';',
    '}',
    '.dk-scan-detail-warn {',
    '  display: flex;',
    '  gap: 12px;',
    '  padding: 3px 0;',
    '  font-size: 11px;',
    '  color: ' + T.textDim + ';',
    '}',
    '.dk-scan-detail-check { color: ' + T.text + '; min-width: 130px; }',
    '.dk-scan-detail-line { min-width: 50px; color: ' + T.textMuted + '; }',
    '.dk-scan-detail-text { flex: 1; }',

    /* Progress */
    '.dk-scan-progress {',
    '  height: 3px;',
    '  background: ' + T.border + ';',
    '  border-radius: 2px;',
    '  margin-bottom: 12px;',
    '  overflow: hidden;',
    '}',
    '.dk-scan-progress-bar {',
    '  height: 100%;',
    '  background: linear-gradient(90deg, ' + T.cyan + ', ' + T.purple + ');',
    '  border-radius: 2px;',
    '  transition: width 0.2s;',
    '  width: 0%;',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Create the scanner panel and attach to a container element.
 * @param {HTMLElement} container - DOM element to mount panel into
 * @returns {object} panel controller with .destroy() method
 */
function createScannerPanel(container) {
  dkScanInjectStyles();

  var state = {
    files: [],       // File objects
    results: null,   // scan results array
    converted: false
  };

  // Build DOM
  var panel = document.createElement('div');
  panel.className = 'dk-scan-panel';

  var title = document.createElement('div');
  title.className = 'dk-scan-title';
  title.textContent = 'Preflight Scanner';
  panel.appendChild(title);

  // Drop zone
  var dropzone = document.createElement('div');
  dropzone.className = 'dk-scan-dropzone';
  dropzone.innerHTML = '<div class="dk-scan-dropzone-icon">&#x1F50D;</div>' +
    '<div class="dk-scan-dropzone-label">Drop files here or click to browse</div>' +
    '<div class="dk-scan-dropzone-hint">Accepts: ' + DK_SCAN_ACCEPTED_EXTENSIONS.join(', ') + '</div>';

  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  fileInput.accept = DK_SCAN_ACCEPTED_EXTENSIONS.map(function (e) { return '.' + e; }).join(',');

  dropzone.appendChild(fileInput);
  panel.appendChild(dropzone);

  // File list
  var fileList = document.createElement('div');
  fileList.className = 'dk-scan-filelist';
  panel.appendChild(fileList);

  // Actions
  var actions = document.createElement('div');
  actions.className = 'dk-scan-actions';

  var scanBtn = document.createElement('button');
  scanBtn.className = 'dk-scan-btn dk-scan-btn-primary';
  scanBtn.textContent = 'Scan';
  scanBtn.disabled = true;

  var scanConvertBtn = document.createElement('button');
  scanConvertBtn.className = 'dk-scan-btn dk-scan-btn-convert';
  scanConvertBtn.textContent = 'Scan & Convert';
  scanConvertBtn.disabled = true;

  var downloadBtn = document.createElement('button');
  downloadBtn.className = 'dk-scan-btn';
  downloadBtn.textContent = 'Download Results';
  downloadBtn.disabled = true;
  downloadBtn.style.display = 'none';

  var clearBtn = document.createElement('button');
  clearBtn.className = 'dk-scan-btn';
  clearBtn.textContent = 'Clear';

  actions.appendChild(scanBtn);
  actions.appendChild(scanConvertBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(clearBtn);
  panel.appendChild(actions);

  // Progress bar
  var progressWrap = document.createElement('div');
  progressWrap.className = 'dk-scan-progress';
  progressWrap.style.display = 'none';
  var progressBar = document.createElement('div');
  progressBar.className = 'dk-scan-progress-bar';
  progressWrap.appendChild(progressBar);
  panel.appendChild(progressWrap);

  // Summary bar
  var summaryBar = document.createElement('div');
  summaryBar.className = 'dk-scan-summary';
  summaryBar.style.display = 'none';
  panel.appendChild(summaryBar);

  // Results area
  var resultsArea = document.createElement('div');
  panel.appendChild(resultsArea);

  container.appendChild(panel);

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  function addFiles(newFiles) {
    for (var i = 0; i < newFiles.length; i++) {
      var f = newFiles[i];
      var ext = dkScanGetExt(f.name);
      // Accept files with recognized extensions, or any extension (scan will flag macro exts)
      var isDuplicate = false;
      for (var j = 0; j < state.files.length; j++) {
        if (state.files[j].name === f.name && state.files[j].size === f.size) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        state.files.push(f);
      }
    }
    renderFileList();
    updateButtons();
  }

  function removeFile(index) {
    state.files.splice(index, 1);
    renderFileList();
    updateButtons();
  }

  function renderFileList() {
    fileList.innerHTML = '';
    for (var i = 0; i < state.files.length; i++) {
      var item = document.createElement('div');
      item.className = 'dk-scan-filelist-item';

      var nameSpan = document.createElement('span');
      nameSpan.className = 'dk-scan-filelist-name';
      nameSpan.textContent = state.files[i].name;

      var sizeSpan = document.createElement('span');
      sizeSpan.className = 'dk-scan-filelist-size';
      sizeSpan.textContent = dkScanFormatBytes(state.files[i].size);

      var removeSpan = document.createElement('span');
      removeSpan.className = 'dk-scan-filelist-remove';
      removeSpan.textContent = '\u00d7';
      removeSpan.setAttribute('data-index', String(i));
      removeSpan.addEventListener('click', function (e) {
        var idx = parseInt(e.target.getAttribute('data-index'), 10);
        removeFile(idx);
      });

      item.appendChild(nameSpan);
      item.appendChild(sizeSpan);
      item.appendChild(removeSpan);
      fileList.appendChild(item);
    }
  }

  function updateButtons() {
    var hasFiles = state.files.length > 0;
    scanBtn.disabled = !hasFiles;
    scanConvertBtn.disabled = !hasFiles;
    downloadBtn.style.display = state.results ? 'inline-flex' : 'none';
    downloadBtn.disabled = !state.results;
  }

  function runScan(convert) {
    state.converted = convert;
    state.results = null;
    resultsArea.innerHTML = '';
    summaryBar.style.display = 'none';
    progressWrap.style.display = 'block';
    progressBar.style.width = '0%';
    scanBtn.disabled = true;
    scanConvertBtn.disabled = true;

    var total = state.files.length;
    var completed = 0;
    var results = [];

    function scanNext() {
      if (completed >= total) {
        state.results = results;
        progressBar.style.width = '100%';
        setTimeout(function () {
          progressWrap.style.display = 'none';
          renderResults(results);
          updateButtons();
        }, 200);
        return;
      }

      dkScanFile(state.files[completed]).then(function (result) {
        results.push(result);
        completed++;
        progressBar.style.width = Math.round((completed / total) * 100) + '%';
        scanNext();
      });
    }

    scanNext();
  }

  function renderResults(results) {
    // Summary
    var totalWarnings = 0;
    var cleanCount = 0;
    var flaggedCount = 0;

    for (var i = 0; i < results.length; i++) {
      totalWarnings += results[i].warnings.length;
      if (results[i].clean) { cleanCount++; } else { flaggedCount++; }
    }

    summaryBar.style.display = 'flex';
    summaryBar.innerHTML = [
      '<div class="dk-scan-summary-stat"><span class="dk-scan-summary-val">' + results.length + '</span><span class="dk-scan-summary-label">scanned</span></div>',
      '<div class="dk-scan-summary-stat"><span class="dk-scan-summary-val" style="color:#00c853">' + cleanCount + '</span><span class="dk-scan-summary-label">clean</span></div>',
      '<div class="dk-scan-summary-stat"><span class="dk-scan-summary-val" style="color:' + DK_SCAN_THEME.pink + '">' + flaggedCount + '</span><span class="dk-scan-summary-label">flagged</span></div>',
      '<div class="dk-scan-summary-stat"><span class="dk-scan-summary-val" style="color:' + DK_SCAN_THEME.yellow + '">' + totalWarnings + '</span><span class="dk-scan-summary-label">warnings</span></div>'
    ].join('');

    // Results table
    var table = document.createElement('table');
    table.className = 'dk-scan-results-table';

    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>File</th><th>Size</th><th>Warnings</th><th>Severity</th><th>Status</th></tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');

    for (var r = 0; r < results.length; r++) {
      var res = results[r];
      var maxSev = dkScanMaxSeverity(res.warnings);

      // Main row
      var tr = document.createElement('tr');
      tr.className = 'dk-scan-result-row';
      tr.setAttribute('data-index', String(r));

      var badgeClass = res.clean ? 'dk-scan-badge-clean' : ('dk-scan-badge-' + maxSev);
      var badgeText = res.clean ? 'CLEAN' : DK_SCAN_SEVERITY[maxSev].label;
      var statusClass = res.clean ? 'dk-scan-badge-clean' : 'dk-scan-badge-high';
      var statusText = res.clean ? 'Clean' : 'Flagged';

      tr.innerHTML = [
        '<td>' + dkScanEscapeHTML(res.name) + '</td>',
        '<td>' + dkScanFormatBytes(res.size) + '</td>',
        '<td>' + res.warnings.length + '</td>',
        '<td><span class="dk-scan-badge ' + badgeClass + '">' + badgeText + '</span></td>',
        '<td><span class="dk-scan-badge ' + statusClass + '">' + statusText + '</span></td>'
      ].join('');

      tbody.appendChild(tr);

      // Detail row
      var detailTr = document.createElement('tr');
      detailTr.className = 'dk-scan-detail';
      detailTr.id = 'dk-scan-detail-' + r;

      var detailTd = document.createElement('td');
      detailTd.colSpan = 5;

      var detailInner = document.createElement('div');
      detailInner.className = 'dk-scan-detail-inner';

      if (res.warnings.length === 0) {
        detailInner.innerHTML = '<div style="color:#00c853;font-size:11px">No issues detected. File is clean.</div>';
      } else {
        for (var w = 0; w < res.warnings.length; w++) {
          var warn = res.warnings[w];
          var sevInfo = DK_SCAN_SEVERITY[warn.severity] || DK_SCAN_SEVERITY.medium;
          var warnDiv = document.createElement('div');
          warnDiv.className = 'dk-scan-detail-warn';
          warnDiv.innerHTML = [
            '<span class="dk-scan-detail-check"><span class="dk-scan-badge dk-scan-badge-' + warn.severity + '">' + sevInfo.label + '</span> ' + dkScanEscapeHTML(warn.check) + '</span>',
            '<span class="dk-scan-detail-line">' + (warn.line != null ? 'L' + warn.line : '-') + '</span>',
            '<span class="dk-scan-detail-text">' + dkScanEscapeHTML(warn.detail) + '</span>'
          ].join('');
          detailInner.appendChild(warnDiv);
        }
      }

      if (res.hash) {
        var hashDiv = document.createElement('div');
        hashDiv.style.cssText = 'margin-top:6px;font-size:10px;color:' + DK_SCAN_THEME.textMuted;
        hashDiv.textContent = 'SHA-256: ' + res.hash;
        detailInner.appendChild(hashDiv);
      }

      detailTd.appendChild(detailInner);
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);

      // Toggle handler
      (function (rowIndex) {
        tr.addEventListener('click', function () {
          var detail = document.getElementById('dk-scan-detail-' + rowIndex);
          if (detail) {
            detail.classList.toggle('dk-open');
          }
        });
      })(r);
    }

    table.appendChild(tbody);
    resultsArea.innerHTML = '';
    resultsArea.appendChild(table);
  }

  function clearAll() {
    state.files = [];
    state.results = null;
    state.converted = false;
    fileList.innerHTML = '';
    resultsArea.innerHTML = '';
    summaryBar.style.display = 'none';
    progressWrap.style.display = 'none';
    updateButtons();
  }

  // Dropzone events
  dropzone.addEventListener('click', function (e) {
    if (e.target === fileInput) return;
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length > 0) {
      addFiles(fileInput.files);
    }
    fileInput.value = '';
  });

  dropzone.addEventListener('dragover', function (e) {
    e.preventDefault();
    dropzone.classList.add('dk-dragover');
  });

  dropzone.addEventListener('dragleave', function () {
    dropzone.classList.remove('dk-dragover');
  });

  dropzone.addEventListener('drop', function (e) {
    e.preventDefault();
    dropzone.classList.remove('dk-dragover');
    if (e.dataTransfer && e.dataTransfer.files) {
      addFiles(e.dataTransfer.files);
    }
  });

  // Button events
  scanBtn.addEventListener('click', function () { runScan(false); });
  scanConvertBtn.addEventListener('click', function () { runScan(true); });
  downloadBtn.addEventListener('click', function () {
    if (state.results) {
      dkScanDownloadResults(state.results, state.converted);
    }
  });
  clearBtn.addEventListener('click', clearAll);

  return {
    destroy: function () {
      if (panel.parentNode) {
        panel.parentNode.removeChild(panel);
      }
    },
    getResults: function () { return state.results; },
    getFiles: function () { return state.files; }
  };
}

// ---------------------------------------------------------------------------
// Node.js module exports
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    dkScanCheckContent: dkScanCheckContent,
    dkScanFile: dkScanFile,
    dkScanFiles: dkScanFiles,
    dkScanConvert: dkScanConvert,
    dkScanConvertName: dkScanConvertName,
    dkScanManifestCSV: dkScanManifestCSV,
    dkScanWarningsCSV: dkScanWarningsCSV,
    dkScanReportHTML: dkScanReportHTML,
    dkScanBuildZip: dkScanBuildZip,
    dkScanDownloadResults: dkScanDownloadResults,
    dkScanEntropy: dkScanEntropy,
    dkScanHash: dkScanHash,
    dkScanGetExt: dkScanGetExt,
    dkScanFormatBytes: dkScanFormatBytes,
    dkScanEscapeHTML: dkScanEscapeHTML,
    dkScanStripHTML: dkScanStripHTML,
    dkScanMarkdownToHTML: dkScanMarkdownToHTML,
    dkScanCSVToHTML: dkScanCSVToHTML,
    dkScanCRC32: dkScanCRC32,
    dkScanMaxSeverity: dkScanMaxSeverity,
    createScannerPanel: createScannerPanel,
    DK_SCAN_THEME: DK_SCAN_THEME,
    DK_SCAN_VERSION: DK_SCAN_VERSION,
    DK_SCAN_ACCEPTED_EXTENSIONS: DK_SCAN_ACCEPTED_EXTENSIONS,
    DK_SCAN_MACRO_EXTENSIONS: DK_SCAN_MACRO_EXTENSIONS,
    DK_SCAN_CHECK_SEVERITY: DK_SCAN_CHECK_SEVERITY
  };
}
