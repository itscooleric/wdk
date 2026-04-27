(function () {
"use strict";

// --- parsers/csv.js ---

/**
 * Lightweight CSV parser (RFC 4180 compliant).
 * Zero dependencies. Handles quoted fields, embedded newlines, BOM.
 */

function parseCSV(text, options) {
  var delimiter = (options && options.delimiter) || ',';
  var hasHeader = options && options.hasHeader !== undefined ? options.hasHeader : true;

  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Strip trailing newlines
  text = text.replace(/[\r\n]+$/, '');

  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;
  var len = text.length;

  while (i < len) {
    var ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      if (i < len && text[i] === '\n') i++;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += ch;
      i++;
    }
  }

  // Push last field/row
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (hasHeader && rows.length > 0) {
    return { headers: rows[0], rows: rows.slice(1) };
  }
  return { headers: [], rows: rows };
}

function parseCSVStreaming(file, options) {
  var chunkSize = (options && options.chunkSize) || (2 * 1024 * 1024);
  var delimiter = (options && options.delimiter) || ',';
  var hasHeader = options && options.hasHeader !== undefined ? options.hasHeader : true;
  var onChunk = (options && options.onChunk) || function () {};

  var fileSize = file.size;
  var offset = 0;
  var headers = null;
  var totalRows = 0;

  // State machine state persisted across chunks
  var inQuotes = false;
  var field = '';
  var row = [];
  var isFirstChunk = true;

  function parseChunkText(text, isLast) {
    var rows = [];
    var i = 0;
    var len = text.length;

    // Strip BOM on first chunk
    if (isFirstChunk && text.charCodeAt(0) === 0xFEFF) {
      i = 1;
    }
    isFirstChunk = false;

    while (i < len) {
      var ch = text[i];

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < len && text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            inQuotes = false;
            i++;
          }
        } else {
          field += ch;
          i++;
        }
      } else if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === delimiter) {
        row.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
        if (i < len && text[i] === '\n') i++;
      } else if (ch === '\n') {
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
        i++;
      } else {
        field += ch;
        i++;
      }
    }

    // On last chunk, flush remaining field/row
    if (isLast && !inQuotes) {
      if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    }

    return rows;
  }

  function readNextChunk(resolve, reject) {
    if (offset >= fileSize) {
      resolve({ headers: headers || [], totalRows: totalRows });
      return;
    }

    var end = Math.min(offset + chunkSize, fileSize);
    var blob = file.slice(offset, end);
    var isLast = (end >= fileSize);
    var reader = new FileReader();

    reader.onerror = function () { reject(reader.error); };
    reader.onload = function () {
      var text = reader.result;
      var rows = parseChunkText(text, isLast);

      // Extract headers from first batch of rows
      if (headers === null && rows.length > 0 && hasHeader) {
        headers = rows.shift();
      }

      totalRows += rows.length;
      var progress = Math.min(end / fileSize, 1);
      onChunk(rows, progress);

      offset = end;
      readNextChunk(resolve, reject);
    };

    reader.readAsText(blob);
  }

  return new Promise(function (resolve, reject) {
    readNextChunk(resolve, reject);
  });
}

function parseCSVFile(file) {
  // Use streaming for files >50MB
  if (file && file.size && file.size > 50 * 1024 * 1024) {
    var allRows = [];
    return parseCSVStreaming(file, {
      onChunk: function (rows) {
        for (var i = 0; i < rows.length; i++) {
          allRows.push(rows[i]);
        }
      }
    }).then(function (result) {
      return { headers: result.headers, rows: allRows };
    });
  }
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(parseCSV(reader.result)); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsText(file);
  });
}

// --- parsers/json.js ---

/**
 * WDK JSON Parser
 * Zero-dependency JSON parsing with error recovery.
 */

/**
 * Strip trailing commas from JSON text before parsing.
 * Handles commas before ] and } with optional whitespace.
 */
function stripTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Convert single-quoted strings to double-quoted strings.
 * Handles escaped single quotes inside strings and avoids
 * converting single quotes that appear inside double-quoted strings.
 */
function convertSingleQuotes(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // skip double-quoted string entirely
      result += ch;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') { result += text[i++]; }
        result += text[i++];
      }
      if (i < text.length) result += text[i++]; // closing "
    } else if (ch === "'") {
      // convert single-quoted string to double-quoted
      result += '"';
      i++;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && text[i + 1] === "'") {
          result += "'";
          i += 2;
        } else if (text[i] === '"') {
          result += '\\"';
          i++;
        } else {
          result += text[i++];
        }
      }
      result += '"';
      if (i < text.length) i++; // closing '
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

/**
 * Build a descriptive error message for JSON parse failures.
 */
function describeParseError(text, err) {
  const posMatch = err.message.match(/position\s+(\d+)/i);
  const pos = posMatch ? parseInt(posMatch[1], 10) : null;

  if (pos !== null) {
    const before = text.slice(0, pos);
    const line = (before.match(/\n/g) || []).length + 1;
    const col = pos - before.lastIndexOf('\n');
    const snippet = text.slice(Math.max(0, pos - 20), pos + 20);
    return `JSON parse error at line ${line}, column ${col}: ${err.message}\n  near: ...${snippet}...`;
  }

  // Check for truncated JSON
  const trimmed = text.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (last !== '}' && last !== ']' && last !== '"' && last !== 'e' && last !== 'l') {
    return `JSON appears truncated (ends at position ${trimmed.length}): ${err.message}`;
  }

  return `JSON parse error: ${err.message}`;
}

/**
 * Detect if parsed data is an array of objects and extract tabular form.
 */
function extractTabular(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (typeof data[0] !== 'object' || data[0] === null || Array.isArray(data[0])) return null;

  const headerSet = new Set();
  for (const row of data) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
    for (const key of Object.keys(row)) headerSet.add(key);
  }

  const headers = Array.from(headerSet);
  const rows = data.map(obj => headers.map(h => obj[h] !== undefined ? obj[h] : null));
  return { headers, rows };
}

/**
 * Parse a JSON string with error recovery.
 * Handles trailing commas, single quotes, and provides descriptive errors.
 *
 * @param {string} text - Raw JSON text
 * @returns {{ data: any, tabular: { headers: string[], rows: any[][] } | null }}
 */
function parseJSON(text) {
  if (typeof text !== 'string') {
    throw new Error('parseJSON expects a string argument');
  }

  let cleaned = text.trim();
  let data;

  // Try raw parse first
  try {
    data = JSON.parse(cleaned);
  } catch (firstErr) {
    // Apply recovery: trailing commas + single quotes
    cleaned = stripTrailingCommas(cleaned);
    cleaned = convertSingleQuotes(cleaned);
    try {
      data = JSON.parse(cleaned);
    } catch (secondErr) {
      throw new Error(describeParseError(text.trim(), secondErr));
    }
  }

  return {
    data,
    tabular: extractTabular(data),
  };
}

/**
 * Parse a JSON File object via FileReader.
 *
 * @param {File} file - File object to read
 * @returns {Promise<{ data: any, tabular: { headers: string[], rows: any[][] } | null }>}
 */
function parseJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseJSON(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}

// --- parsers/zip.js ---

/**
 * Minimal ZIP reader for WDK.
 * Reads ZIP local file headers and extracts entries using the DecompressionStream API.
 * Zero dependencies. Works in modern browsers.
 *
 * Supports:
 *   - Stored files (compression method 0)
 *   - Deflate-compressed files (compression method 8) via DecompressionStream('deflate-raw')
 *
 * Does NOT support: encrypted ZIPs, ZIP64, data descriptors with unknown sizes.
 *
 * @param {ArrayBuffer} arrayBuffer - ZIP file bytes
 * @returns {Promise<Map<string, Uint8Array>>} Map of filename -> decompressed bytes
 */
async function unzip(arrayBuffer) {
  var bytes = new Uint8Array(arrayBuffer);
  var view = new DataView(arrayBuffer);
  var entries = new Map();

  // Walk local file headers starting at offset 0.
  // Local file header signature: 0x04034B50 (little-endian: 50 4B 03 04)
  var offset = 0;

  while (offset + 30 <= bytes.length) {
    var sig = view.getUint32(offset, true);

    // Local file header: PK\x03\x04
    if (sig !== 0x04034B50) {
      // Could be central directory (0x02014B50) or EOCD (0x06054B50) — stop walking.
      break;
    }

    var compression  = view.getUint16(offset + 8,  true);
    var compSize     = view.getUint32(offset + 18, true);
    var uncompSize   = view.getUint32(offset + 22, true);
    var nameLen      = view.getUint16(offset + 26, true);
    var extraLen     = view.getUint16(offset + 28, true);

    var nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen);
    var filename  = new TextDecoder().decode(nameBytes);

    var dataStart = offset + 30 + nameLen + extraLen;
    var compData  = bytes.subarray(dataStart, dataStart + compSize);

    var decompressed;

    if (compression === 0) {
      // Stored — no compression, copy as-is
      decompressed = compData.slice();
    } else if (compression === 8) {
      // Deflate-raw — use DecompressionStream
      decompressed = await _inflateRaw(compData, uncompSize);
    } else {
      throw new Error('ZIP: unsupported compression method ' + compression + ' in "' + filename + '"');
    }

    entries.set(filename, decompressed);

    offset = dataStart + compSize;
  }

  if (entries.size === 0) {
    throw new Error('ZIP: no entries found — is this a valid ZIP file?');
  }

  return entries;
}

/**
 * Decompress raw deflate data using the browser's DecompressionStream API.
 *
 * @param {Uint8Array} data - Compressed bytes
 * @param {number} [expectedSize] - Expected decompressed size (used to pre-allocate)
 * @returns {Promise<Uint8Array>}
 */
async function _inflateRaw(data, expectedSize) {
  var ds = new DecompressionStream('deflate-raw');
  var writer = ds.writable.getWriter();
  var reader = ds.readable.getReader();

  // Write compressed data then close
  writer.write(data);
  writer.close();

  // Collect output chunks
  var chunks = [];
  var totalLen = 0;

  while (true) {
    var result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    totalLen += result.value.length;
  }

  // Merge into a single Uint8Array
  var out = new Uint8Array(totalLen);
  var pos = 0;
  for (var i = 0; i < chunks.length; i++) {
    out.set(chunks[i], pos);
    pos += chunks[i].length;
  }

  return out;
}

// --- parsers/xlsx.js ---

/**
 * WDK XLSX Parser
 * Reads .xlsx files (OOXML ZIP archives) and returns DataFrame-compatible objects.
 * Zero external dependencies. Works in modern browsers via DecompressionStream API.
 *
 * Supports:
 *   - Shared string table (xl/sharedStrings.xml)
 *   - Single and multi-sheet workbooks
 *   - Inline strings, numeric cells, boolean cells, formula cells
 *   - Excel date serial number conversion (with the 1900 leap year bug)
 *   - Sheet selection by index (0-based) or name
 *
 * Does NOT support: rich text runs inside <si> (text content only), pivot tables, charts.
 */

/* global unzip */

// In browser IIFE builds, unzip is a global from zip.js.
// In Node.js CJS environments (tests), require it directly.
var _unzip = (typeof unzip !== 'undefined') ? unzip : (
  (typeof module !== 'undefined' && module.exports) ? require('./zip.js').unzip : null
);

// ---------------------------------------------------------------------------
// Date serial conversion
// ---------------------------------------------------------------------------

/**
 * Convert an Excel date serial number to a JavaScript Date.
 *
 * Excel's epoch starts at 1900-01-01 = serial 1, but Excel (following Lotus 1-2-3)
 * incorrectly treats 1900 as a leap year — serial 60 would be 1900-02-29 (doesn't
 * exist). We compensate by subtracting 1 for all serials > 60.
 *
 * @param {number} serial - Excel date serial number (integer part = date, fraction = time)
 * @returns {Date}
 */
function excelSerialToDate(serial) {
  // Excel epoch: January 0, 1900 = December 31, 1899
  // JS Date epoch: January 1, 1970 (Unix timestamp 0)

  // Integers: number of days since the Excel epoch
  // Fractional part: time of day (0.5 = noon)

  var days = Math.floor(serial);
  var timeFraction = serial - days;

  // Adjust for the Lotus/Excel 1900 leap year bug:
  // Serial 60 was assigned to the phantom day 1900-02-29.
  // Any serial >= 61 is off by 1 compared to real dates.
  var dayAdj = (days > 60) ? days - 1 : days;

  // Excel day 1 = 1900-01-01; JS Date for 1900-01-01 in UTC:
  // new Date(Date.UTC(1900, 0, 1)) = -2208988800000 ms
  var EXCEL_EPOCH_MS = Date.UTC(1900, 0, 1); // Jan 1, 1900 00:00:00 UTC

  // (dayAdj - 1) because Excel serial 1 = day 1 = 1900-01-01 (add 0 extra days)
  var ms = EXCEL_EPOCH_MS + (dayAdj - 1) * 86400000 + Math.round(timeFraction * 86400000);

  return new Date(ms);
}

// ---------------------------------------------------------------------------
// Minimal XML parser (no DOM, no regex-heavy approach)
// ---------------------------------------------------------------------------

/**
 * Extract text content from all matching tags.
 * Returns an array of {tag, attrs, text} objects for every occurrence of <tagName ...>.
 *
 * This is a simple streaming approach — not a full XML parser, but sufficient for
 * well-formed OOXML where we know the structure.
 *
 * @param {string} xml
 * @param {string} tagName
 * @returns {Array<{attrs: string, text: string}>}
 */
function findTags(xml, tagName) {
  var results = [];
  var openRe  = new RegExp('<' + tagName + '(\\s[^>]*)?>', 'g');
  var closeTag = '</' + tagName + '>';

  var m;
  while ((m = openRe.exec(xml)) !== null) {
    var attrs    = m[1] || '';
    var start    = openRe.lastIndex;
    var closeIdx = xml.indexOf(closeTag, start);
    if (closeIdx === -1) {
      // Self-closing or no close — treat as empty
      results.push({ attrs: attrs, text: '' });
    } else {
      results.push({ attrs: attrs, text: xml.slice(start, closeIdx) });
    }
  }
  return results;
}

/**
 * Get the value of a named attribute from an attribute string.
 * e.g. attrVal(' r="A1" t="s"', 'r') => 'A1'
 *
 * @param {string} attrs
 * @param {string} name
 * @returns {string|null}
 */
function attrVal(attrs, name) {
  var re = new RegExp('\\b' + name + '="([^"]*)"');
  var m = re.exec(attrs);
  return m ? m[1] : null;
}

/**
 * Strip all XML tags from a string, returning plain text.
 * Handles &amp; &lt; &gt; &quot; &apos; entities.
 *
 * @param {string} s
 * @returns {string}
 */
function stripTags(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

// ---------------------------------------------------------------------------
// XLSX sub-parsers
// ---------------------------------------------------------------------------

/**
 * Parse xl/sharedStrings.xml and return the shared string array.
 * Each <si> element contains one shared string.
 * We concatenate all <t> text nodes inside it (handles rich text runs).
 *
 * @param {string} xml
 * @returns {string[]}
 */
function parseSharedStrings(xml) {
  var strings = [];
  var siTags = findTags(xml, 'si');
  for (var i = 0; i < siTags.length; i++) {
    var inner = siTags[i].text;
    // Collect all <t> content (may be multiple runs for rich text)
    var tTags = findTags(inner, 't');
    var text = '';
    if (tTags.length > 0) {
      for (var j = 0; j < tTags.length; j++) {
        text += stripTags(tTags[j].text);
      }
    } else {
      // Fallback: strip all tags from the <si> content
      text = stripTags(inner);
    }
    strings.push(text);
  }
  return strings;
}

/**
 * Parse xl/workbook.xml and return the list of sheets.
 * Each entry: { name, sheetId, rId }
 *
 * @param {string} xml
 * @returns {Array<{name: string, sheetId: string, rId: string}>}
 */
function parseWorkbook(xml) {
  var sheets = [];
  var sheetTags = findTags(xml, 'sheet');
  for (var i = 0; i < sheetTags.length; i++) {
    var attrs = sheetTags[i].attrs;
    sheets.push({
      name:    attrVal(attrs, 'name')    || ('Sheet' + (i + 1)),
      sheetId: attrVal(attrs, 'sheetId') || String(i + 1),
      rId:     attrVal(attrs, 'r:id')    || attrVal(attrs, 'id') || '',
    });
  }
  return sheets;
}

/**
 * Parse xl/_rels/workbook.xml.rels to resolve rId -> target path.
 *
 * @param {string} xml
 * @returns {Map<string, string>} rId -> relative target path
 */
function parseWorkbookRels(xml) {
  var map = new Map();
  var relTags = findTags(xml, 'Relationship');
  for (var i = 0; i < relTags.length; i++) {
    var attrs = relTags[i].attrs;
    var id     = attrVal(attrs, 'Id');
    var target = attrVal(attrs, 'Target');
    if (id && target) {
      // Target is relative to xl/ — normalize to the zip path
      var path = target.startsWith('/') ? target.slice(1) : 'xl/' + target;
      map.set(id, path);
    }
  }
  return map;
}

/**
 * Convert a column letter reference (A, B, ..., Z, AA, AB, ...) to a 0-based index.
 * e.g. 'A' -> 0, 'Z' -> 25, 'AA' -> 26
 *
 * @param {string} col - Column letters (uppercase)
 * @returns {number}
 */
function colLetterToIndex(col) {
  var n = 0;
  for (var i = 0; i < col.length; i++) {
    n = n * 26 + (col.charCodeAt(i) - 64); // 'A'=65, so 65-64=1
  }
  return n - 1; // 0-based
}

/**
 * Parse a cell reference like "A1", "BC42" into { col: number, row: number } (0-based).
 *
 * @param {string} ref - e.g. "A1"
 * @returns {{ col: number, row: number }}
 */
function parseCellRef(ref) {
  var m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return { col: 0, row: 0 };
  return {
    col: colLetterToIndex(m[1]),
    row: parseInt(m[2], 10) - 1, // 0-based
  };
}

/**
 * Determine whether a cell's number format represents a date.
 * We check common built-in Excel date format IDs and any custom format
 * whose format string contains date/time codes.
 *
 * Built-in date format IDs: 14-17 (date), 18-21 (date+time), 22 (date+time),
 * 45-47 (time), 49 (text — NOT date).
 *
 * @param {number} numFmtId
 * @param {Map<number, string>} numFmts - Custom number formats from styles.xml
 * @returns {boolean}
 */
function isDateFormat(numFmtId, numFmts) {
  // Built-in Excel date/time format IDs
  if ((numFmtId >= 14 && numFmtId <= 17) ||
      (numFmtId >= 18 && numFmtId <= 22) ||
      (numFmtId >= 45 && numFmtId <= 47)) {
    return true;
  }
  // Custom format: look for date tokens (y, m, d, h, s) not inside quoted strings
  if (numFmts && numFmts.has(numFmtId)) {
    var fmt = numFmts.get(numFmtId);
    // Strip quoted strings and check for date/time codes
    var stripped = fmt.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    if (/[yYmMdDhHsS]/.test(stripped)) return true;
  }
  return false;
}

/**
 * Parse xl/styles.xml to extract:
 *   - cellXfs: array of xf format indices (indexed by xf/@numFmtId)
 *   - numFmts: Map<numFmtId, formatCode> for custom formats
 *
 * @param {string} xml
 * @returns {{ cellXfs: number[], numFmts: Map<number, string> }}
 */
function parseStyles(xml) {
  // Extract custom numFmts
  var numFmts = new Map();
  var numFmtTags = findTags(xml, 'numFmt');
  for (var i = 0; i < numFmtTags.length; i++) {
    var attrs = numFmtTags[i].attrs;
    var id = parseInt(attrVal(attrs, 'numFmtId') || '0', 10);
    var code = attrVal(attrs, 'formatCode') || '';
    numFmts.set(id, code);
  }

  // Extract cellXfs — each <xf> has a numFmtId
  var cellXfs = [];

  // Find the <cellXfs> section
  var cellXfsMatch = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
  if (cellXfsMatch) {
    var xfSection = cellXfsMatch[1];
    var xfTags = findTags(xfSection, 'xf');
    for (var j = 0; j < xfTags.length; j++) {
      var xfAttrs = xfTags[j].attrs;
      cellXfs.push(parseInt(attrVal(xfAttrs, 'numFmtId') || '0', 10));
    }
  }

  return { cellXfs: cellXfs, numFmts: numFmts };
}

/**
 * Parse a single worksheet XML (xl/worksheets/sheet*.xml) into a 2D array of values.
 *
 * Cell types (t attribute):
 *   s  = shared string index
 *   str = formula result string / inline string
 *   inlineStr = inline string (uses <is><t>)
 *   b  = boolean (0/1)
 *   e  = error (#VALUE!, etc.)
 *   (none) = number
 *
 * @param {string} xml - Worksheet XML text
 * @param {string[]} sharedStrings - Shared string table
 * @param {number[]} cellXfs - Cell format index array from styles
 * @param {Map<number, string>} numFmts - Custom number formats from styles
 * @returns {string[][]} 2D array (rows of cell values as strings or Date objects)
 */
function parseSheet(xml, sharedStrings, cellXfs, numFmts) {
  // Collect all rows
  var grid = []; // grid[rowIdx][colIdx] = value

  var rowTags = findTags(xml, 'row');

  for (var r = 0; r < rowTags.length; r++) {
    var rowAttrs = rowTags[r].attrs;
    var rowR = parseInt(attrVal(rowAttrs, 'r') || '0', 10);
    var rowIdx = (rowR > 0) ? rowR - 1 : r; // 0-based

    // Ensure grid has this row
    while (grid.length <= rowIdx) grid.push([]);

    var cTags = findTags(rowTags[r].text, 'c');

    for (var c = 0; c < cTags.length; c++) {
      var cAttrs  = cTags[c].text; // inner XML of <c> — we need to re-parse with attrs
      // findTags gives us .attrs (attribute string) and .text (inner XML)
      var cellAttrs = cTags[c].attrs;
      var cellInner = cTags[c].text;

      var cellRef = attrVal(cellAttrs, 'r');
      var cellType = attrVal(cellAttrs, 't') || ''; // s, str, b, e, inlineStr, or empty (number)
      var cellStyle = parseInt(attrVal(cellAttrs, 's') || '-1', 10);

      // Determine column position from ref attribute, fallback to loop index
      var colIdx = c;
      if (cellRef) {
        colIdx = parseCellRef(cellRef).col;
      }

      // Extract value
      var vTags  = findTags(cellInner, 'v');
      var rawVal = (vTags.length > 0) ? stripTags(vTags[0].text) : '';

      var value;

      if (cellType === 's') {
        // Shared string
        var ssIdx = parseInt(rawVal, 10);
        value = (sharedStrings && ssIdx < sharedStrings.length) ? sharedStrings[ssIdx] : rawVal;
      } else if (cellType === 'str') {
        // Formula string result
        value = rawVal;
      } else if (cellType === 'inlineStr') {
        // Inline string — read <is><t>
        var isTags = findTags(cellInner, 'is');
        if (isTags.length > 0) {
          var tInner = findTags(isTags[0].text, 't');
          value = tInner.length > 0 ? stripTags(tInner[0].text) : '';
        } else {
          value = rawVal;
        }
      } else if (cellType === 'b') {
        // Boolean
        value = rawVal === '1' ? true : false;
      } else if (cellType === 'e') {
        // Error
        value = rawVal; // '#VALUE!', '#REF!', etc.
      } else {
        // Number (possibly date)
        if (rawVal === '') {
          value = '';
        } else {
          var num = parseFloat(rawVal);
          // Check if this cell uses a date/time number format
          var numFmtId = (cellStyle >= 0 && cellXfs && cellStyle < cellXfs.length)
            ? cellXfs[cellStyle]
            : -1;
          if (numFmtId >= 0 && isDateFormat(numFmtId, numFmts)) {
            value = excelSerialToDate(num);
          } else {
            value = num;
          }
        }
      }

      // Ensure the row array is wide enough
      var row = grid[rowIdx];
      while (row.length <= colIdx) row.push('');
      row[colIdx] = value;
    }
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Main parseXLSX function
// ---------------------------------------------------------------------------

/**
 * Parse an .xlsx file from an ArrayBuffer.
 *
 * Returns an object compatible with the DataFrame constructor:
 *   { headers: string[], rows: any[][] }
 *
 * Also exposes all sheets via result.sheets (array of { name, headers, rows }).
 *
 * @param {ArrayBuffer} arrayBuffer - Raw .xlsx file bytes
 * @param {object} [options]
 * @param {number|string} [options.sheet=0] - Sheet index (0-based) or sheet name
 * @param {number} [options.headerRow=0] - Which row to use as headers (0-based)
 * @returns {Promise<{ headers: string[], rows: any[][], sheets: Array<{name, headers, rows}> }>}
 */
async function parseXLSX(arrayBuffer, options) {
  var sheetSelector = (options && options.sheet !== undefined) ? options.sheet : 0;
  var headerRowIdx  = (options && options.headerRow !== undefined) ? options.headerRow : 0;

  // 1. Unzip the XLSX file
  var zipEntries = await _unzip(arrayBuffer);

  // 2. Decode helper: Uint8Array -> string (UTF-8)
  function decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  // 3. Parse workbook to get sheet list
  var workbookXml = '';
  if (zipEntries.has('xl/workbook.xml')) {
    workbookXml = decode(zipEntries.get('xl/workbook.xml'));
  } else {
    throw new Error('XLSX: xl/workbook.xml not found');
  }
  var sheetList = parseWorkbook(workbookXml);

  if (sheetList.length === 0) {
    throw new Error('XLSX: no sheets found in workbook');
  }

  // 4. Parse workbook relationships to map rId -> sheet path
  var relsXml = '';
  var relsKey = 'xl/_rels/workbook.xml.rels';
  if (zipEntries.has(relsKey)) {
    relsXml = decode(zipEntries.get(relsKey));
  }
  var relsMap = relsXml ? parseWorkbookRels(relsXml) : new Map();

  // 5. Parse shared strings (optional — some xlsx files have none)
  var sharedStrings = [];
  if (zipEntries.has('xl/sharedStrings.xml')) {
    sharedStrings = parseSharedStrings(decode(zipEntries.get('xl/sharedStrings.xml')));
  }

  // 6. Parse styles (optional)
  var cellXfs = [];
  var numFmts = new Map();
  if (zipEntries.has('xl/styles.xml')) {
    var stylesResult = parseStyles(decode(zipEntries.get('xl/styles.xml')));
    cellXfs = stylesResult.cellXfs;
    numFmts = stylesResult.numFmts;
  }

  // 7. Parse all sheets
  var allSheets = [];

  for (var i = 0; i < sheetList.length; i++) {
    var sheetMeta = sheetList[i];

    // Resolve path: try rId -> rels, then fall back to index-based path
    var sheetPath = null;
    if (sheetMeta.rId && relsMap.has(sheetMeta.rId)) {
      sheetPath = relsMap.get(sheetMeta.rId);
    }
    // Normalize: rels targets like 'worksheets/sheet1.xml' become 'xl/worksheets/sheet1.xml'
    if (!sheetPath) {
      sheetPath = 'xl/worksheets/sheet' + sheetMeta.sheetId + '.xml';
    }

    if (!zipEntries.has(sheetPath)) {
      // Try alternate common path
      var altPath = 'xl/worksheets/sheet' + (i + 1) + '.xml';
      if (zipEntries.has(altPath)) {
        sheetPath = altPath;
      } else {
        // Skip sheets we can't find
        allSheets.push({ name: sheetMeta.name, headers: [], rows: [] });
        continue;
      }
    }

    var sheetXml = decode(zipEntries.get(sheetPath));
    var grid = parseSheet(sheetXml, sharedStrings, cellXfs, numFmts);

    // Extract headers and data rows
    var headers = [];
    var dataRows = [];

    if (grid.length === 0) {
      allSheets.push({ name: sheetMeta.name, headers: [], rows: [] });
      continue;
    }

    // Determine max columns across all rows
    var maxCols = 0;
    for (var r = 0; r < grid.length; r++) {
      if (grid[r].length > maxCols) maxCols = grid[r].length;
    }

    // Pad all rows to maxCols
    for (var r2 = 0; r2 < grid.length; r2++) {
      while (grid[r2].length < maxCols) grid[r2].push('');
    }

    if (headerRowIdx < grid.length) {
      headers = grid[headerRowIdx].map(function (v) {
        return v === null || v === undefined ? '' : String(v);
      });
      dataRows = grid.slice(headerRowIdx + 1);
    } else {
      // headerRow beyond data — no headers
      headers = [];
      dataRows = grid;
    }

    allSheets.push({ name: sheetMeta.name, headers: headers, rows: dataRows });
  }

  // 8. Select the requested sheet
  var selected;
  if (typeof sheetSelector === 'number') {
    if (sheetSelector < 0 || sheetSelector >= allSheets.length) {
      throw new Error('XLSX: sheet index ' + sheetSelector + ' out of range (workbook has ' + allSheets.length + ' sheet(s))');
    }
    selected = allSheets[sheetSelector];
  } else {
    // Select by name
    selected = null;
    for (var k = 0; k < allSheets.length; k++) {
      if (allSheets[k].name === sheetSelector) {
        selected = allSheets[k];
        break;
      }
    }
    if (!selected) {
      throw new Error('XLSX: sheet "' + sheetSelector + '" not found');
    }
  }

  return {
    headers: selected.headers,
    rows:    selected.rows,
    sheets:  allSheets,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    parseXLSX:          parseXLSX,
    excelSerialToDate:  excelSerialToDate,
    parseSharedStrings: parseSharedStrings,
    parseWorkbook:      parseWorkbook,
    parseSheet:         parseSheet,
    parseStyles:        parseStyles,
    colLetterToIndex:   colLetterToIndex,
    parseCellRef:       parseCellRef,
    isDateFormat:       isDateFormat,
  };
}

// --- transforms/data-model.js ---

class DataFrame {
  constructor(headers = [], rows = []) {
    this._headers = [...headers];
    this._rows = rows.map(r => [...r]);
  }

  get rowCount() { return this._rows.length; }
  get columnCount() { return this._headers.length; }

  // --- Column operations ---

  addColumn(name, defaultVal = '') {
    this._headers.push(name);
    for (const row of this._rows) {
      row.push(defaultVal);
    }
  }

  removeColumn(name) {
    const idx = this._headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found`);
    this._headers.splice(idx, 1);
    for (const row of this._rows) {
      row.splice(idx, 1);
    }
  }

  renameColumn(oldName, newName) {
    const idx = this._headers.indexOf(oldName);
    if (idx === -1) throw new Error(`Column "${oldName}" not found`);
    this._headers[idx] = newName;
  }

  reorderColumns(newOrder) {
    const indices = newOrder.map(name => {
      const idx = this._headers.indexOf(name);
      if (idx === -1) throw new Error(`Column "${name}" not found`);
      return idx;
    });
    this._headers = indices.map(i => this._headers[i]);
    this._rows = this._rows.map(row => indices.map(i => row[i]));
  }

  getColumn(name) {
    const idx = this._headers.indexOf(name);
    if (idx === -1) throw new Error(`Column "${name}" not found`);
    return this._rows.map(row => row[idx]);
  }

  // --- Row operations ---

  addRow(values) {
    const row = [...values];
    while (row.length < this._headers.length) row.push('');
    this._rows.push(row.slice(0, this._headers.length));
  }

  removeRow(index) {
    if (index < 0 || index >= this._rows.length) throw new RangeError(`Row index ${index} out of bounds`);
    this._rows.splice(index, 1);
  }

  getRow(index) {
    if (index < 0 || index >= this._rows.length) throw new RangeError(`Row index ${index} out of bounds`);
    return [...this._rows[index]];
  }

  filterRows(predicate) {
    const table = new DataFrame(this._headers);
    table._rows = this._rows.filter((row, i) => predicate(row, i));
    return table;
  }

  sortRows(columnName, ascending = true) {
    const idx = this._headers.indexOf(columnName);
    if (idx === -1) throw new Error(`Column "${columnName}" not found`);
    const sorted = [...this._rows].sort((a, b) => {
      if (a[idx] < b[idx]) return ascending ? -1 : 1;
      if (a[idx] > b[idx]) return ascending ? 1 : -1;
      return 0;
    });
    const table = new DataFrame(this._headers);
    table._rows = sorted;
    return table;
  }

  // --- Deduplication ---

  /**
   * Remove duplicate rows. If keyCols provided, dedupes by those columns only
   * (keeps first occurrence). Otherwise dedupes by all columns.
   * @param {string[]} [keyCols] - Column names to dedupe by
   * @returns {DataFrame}
   */
  dedupe(keyCols) {
    var indices = keyCols
      ? keyCols.map(name => {
          var idx = this._headers.indexOf(name);
          if (idx === -1) throw new Error('Column "' + name + '" not found');
          return idx;
        })
      : this._headers.map((_, i) => i);
    var seen = new Set();
    var table = new DataFrame(this._headers);
    table._rows = this._rows.filter(row => {
      var key = indices.map(i => String(row[i])).join('\x00');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return table;
  }

  // --- Utilities ---

  clone() {
    return new DataFrame(this._headers, this._rows);
  }

  toObjects() {
    return this._rows.map(row => {
      const obj = {};
      this._headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  }
}

// --- transforms/pipeline.js ---

/**
 * Transform pipeline with undo/redo history.
 * Zero external dependencies.
 */

const MAX_HISTORY = 50;

function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(deepClone);
  if (obj instanceof Date) return new Date(obj.getTime());
  const clone = {};
  for (const key of Object.keys(obj)) {
    clone[key] = deepClone(obj[key]);
  }
  return clone;
}

class Pipeline {
  /**
   * @param {object} initialData - The initial DataFrame
   */
  constructor(initialData) {
    this._original = deepClone(initialData);
    this._current = deepClone(initialData);
    this._undoStack = []; // { description, timestamp, state }
    this._redoStack = [];
  }

  /**
   * Apply a transform function to the current state.
   * @param {function} transformFn - Receives current DataFrame, returns new DataFrame
   * @param {string} description - Human-readable description of the transform
   * @returns {object} The new current state
   */
  apply(transformFn, description) {
    // Save current state to undo stack before transforming
    this._undoStack.push({
      description,
      timestamp: new Date().toISOString(),
      state: deepClone(this._current),
    });

    // Enforce max history — drop oldest entries
    while (this._undoStack.length > MAX_HISTORY) {
      this._undoStack.shift();
    }

    // Clear redo stack on new apply (standard undo/redo behavior)
    this._redoStack = [];

    this._current = transformFn(deepClone(this._current));
    return deepClone(this._current);
  }

  /**
   * Revert to previous state.
   * @returns {object|null} The restored state, or null if nothing to undo
   */
  undo() {
    if (!this.canUndo()) return null;

    const entry = this._undoStack.pop();
    this._redoStack.push({
      description: entry.description,
      timestamp: entry.timestamp,
      state: deepClone(this._current),
    });

    this._current = deepClone(entry.state);
    return deepClone(this._current);
  }

  /**
   * Re-apply a previously undone transform.
   * @returns {object|null} The restored state, or null if nothing to redo
   */
  redo() {
    if (!this.canRedo()) return null;

    const entry = this._redoStack.pop();
    this._undoStack.push({
      description: entry.description,
      timestamp: entry.timestamp,
      state: deepClone(this._current),
    });

    this._current = deepClone(entry.state);
    return deepClone(this._current);
  }

  /**
   * Preview a transform without modifying state.
   * @param {function} transformFn - Transform to preview
   * @returns {object} Deep clone with the transform applied
   */
  preview(transformFn) {
    return transformFn(deepClone(this._current));
  }

  /**
   * Get the history of applied transforms.
   * @returns {Array<{description: string, timestamp: string}>}
   */
  history() {
    return this._undoStack.map(({ description, timestamp }) => ({
      description,
      timestamp,
    }));
  }

  /** @returns {boolean} */
  canUndo() {
    return this._undoStack.length > 0;
  }

  /** @returns {boolean} */
  canRedo() {
    return this._redoStack.length > 0;
  }

  /**
   * Clear all history and restore to original state.
   */
  reset() {
    this._current = deepClone(this._original);
    this._undoStack = [];
    this._redoStack = [];
  }

  /** Get current state (deep clone). */
  get current() {
    return deepClone(this._current);
  }
}

// --- transforms/redact.js ---

// Data redaction transforms — zero external dependencies
// All functions mutate in-place and return the table for chaining.

function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++)
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

function blankColumn(table, columnName) {
  for (const row of table) row[columnName] = '';
  return table;
}

function replaceColumn(table, columnName, placeholder) {
  for (const row of table) row[columnName] = placeholder;
  return table;
}

function regexRedact(table, columnName, pattern, replacement) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  for (const row of table) {
    if (row[columnName] != null) {
      row[columnName] = String(row[columnName]).replace(re, replacement);
    }
  }
  return table;
}

async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashColumn(table, columnName, method) {
  if (method === 'fast') {
    for (const row of table) {
      if (row[columnName] != null) row[columnName] = djb2(String(row[columnName]));
    }
    return table;
  }

  if (method === 'sha256') {
    for (const row of table) {
      if (row[columnName] != null) row[columnName] = await sha256(String(row[columnName]));
    }
    return table;
  }

  // Auto-detect: try SHA-256, fall back to djb2
  try {
    const test = await sha256('probe');
    if (test) {
      for (const row of table) {
        if (row[columnName] != null) row[columnName] = await sha256(String(row[columnName]));
      }
      return table;
    }
  } catch (_) {
    // SHA-256 unavailable (e.g. insecure context) — fall back
  }

  for (const row of table) {
    if (row[columnName] != null) row[columnName] = djb2(String(row[columnName]));
  }
  return table;
}

// --- transforms/pivot.js ---

/**
 * WDK pivot / aggregation engine.
 * Provides groupBy, aggregate, and pivot table operations on DataFrames.
 * Zero dependencies.
 */

/**
 * Group rows by one or more columns.
 * @param {object} df - DataFrame with _headers and _rows
 * @param {string[]} groupCols - Column names to group by
 * @returns {Map<string, any[][]>} Map of group key → array of rows
 */
function groupBy(df, groupCols) {
  var indices = groupCols.map(function (name) {
    var idx = df._headers.indexOf(name);
    if (idx === -1) throw new Error('Column "' + name + '" not found');
    return idx;
  });

  var groups = new Map();
  for (var i = 0; i < df._rows.length; i++) {
    var row = df._rows[i];
    var key = indices.map(function (idx) { return String(row[idx]); }).join('\x00');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/**
 * Parse a numeric value from a cell, returning NaN for non-numeric.
 */
function toNum(val) {
  if (val === null || val === undefined) return NaN;
  if (typeof val === 'string') { val = val.trim(); if (val === '') return NaN; }
  var n = Number(val);
  return n;
}

/**
 * Built-in aggregation functions.
 */
var AGG_FUNCS = {
  count: function (vals) { return vals.length; },
  sum: function (vals) {
    var s = 0, c = 0;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n)) { s += n; c++; }
    }
    return c > 0 ? s : 0;
  },
  avg: function (vals) {
    var s = 0, c = 0;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n)) { s += n; c++; }
    }
    return c > 0 ? (s / c) : 0;
  },
  min: function (vals) {
    var m = Infinity;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n) && n < m) m = n;
    }
    return m === Infinity ? '' : m;
  },
  max: function (vals) {
    var m = -Infinity;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n) && n > m) m = n;
    }
    return m === -Infinity ? '' : m;
  },
  distinct: function (vals) {
    var seen = new Set();
    for (var i = 0; i < vals.length; i++) seen.add(String(vals[i]));
    return seen.size;
  },
  first: function (vals) { return vals.length > 0 ? vals[0] : ''; },
  last: function (vals) { return vals.length > 0 ? vals[vals.length - 1] : ''; },
  concat: function (vals) {
    var seen = new Set();
    var result = [];
    for (var i = 0; i < vals.length; i++) {
      var s = String(vals[i]);
      if (!seen.has(s)) { seen.add(s); result.push(s); }
    }
    return result.join(', ');
  }
};

/**
 * Aggregate a DataFrame by grouping columns with specified aggregations.
 *
 * @param {object} df - DataFrame with _headers and _rows
 * @param {string[]} groupCols - Columns to group by
 * @param {Array<{column: string, func: string, alias?: string}>} aggs - Aggregations to apply
 * @returns {{headers: string[], rows: any[][]}}
 */
function aggregate(df, groupCols, aggs) {
  var groups = groupBy(df, groupCols);
  var groupIndices = groupCols.map(function (name) { return df._headers.indexOf(name); });
  var aggSpecs = aggs.map(function (a) {
    var idx = df._headers.indexOf(a.column);
    if (idx === -1 && a.func !== 'count') throw new Error('Column "' + a.column + '" not found');
    var fn = AGG_FUNCS[a.func];
    if (!fn) throw new Error('Unknown aggregation: ' + a.func);
    return { idx: idx, fn: fn, alias: a.alias || (a.column + '_' + a.func) };
  });

  var headers = groupCols.concat(aggSpecs.map(function (s) { return s.alias; }));
  var rows = [];

  groups.forEach(function (groupRows, key) {
    var row = key.split('\x00');
    for (var a = 0; a < aggSpecs.length; a++) {
      var spec = aggSpecs[a];
      var vals;
      if (spec.idx === -1) {
        vals = groupRows; // count uses row array directly
      } else {
        vals = groupRows.map(function (r) { return r[spec.idx]; });
      }
      row.push(spec.fn(vals));
    }
    rows.push(row);
  });

  return { headers: headers, rows: rows };
}

/**
 * Pivot table: group by row columns, spread a pivot column's values across new columns,
 * and fill cells with an aggregation of a value column.
 *
 * @param {object} df - DataFrame with _headers and _rows
 * @param {string[]} rowCols - Row grouping columns (left side)
 * @param {string} pivotCol - Column whose distinct values become new columns
 * @param {string} valueCol - Column to aggregate in each cell
 * @param {string} aggFunc - Aggregation function name (sum, count, avg, etc.)
 * @returns {{headers: string[], rows: any[][]}}
 */
function pivot(df, rowCols, pivotCol, valueCol, aggFunc) {
  var pivotIdx = df._headers.indexOf(pivotCol);
  if (pivotIdx === -1) throw new Error('Pivot column "' + pivotCol + '" not found');
  var valueIdx = df._headers.indexOf(valueCol);
  if (valueIdx === -1) throw new Error('Value column "' + valueCol + '" not found');
  var fn = AGG_FUNCS[aggFunc];
  if (!fn) throw new Error('Unknown aggregation: ' + aggFunc);

  var rowIndices = rowCols.map(function (name) {
    var idx = df._headers.indexOf(name);
    if (idx === -1) throw new Error('Column "' + name + '" not found');
    return idx;
  });

  // Collect distinct pivot values in order of appearance
  var pivotValues = [];
  var pivotSet = new Set();
  for (var i = 0; i < df._rows.length; i++) {
    var pv = String(df._rows[i][pivotIdx]);
    if (!pivotSet.has(pv)) { pivotSet.add(pv); pivotValues.push(pv); }
  }

  // Group by rowCols + pivotCol
  var buckets = new Map();
  for (var i = 0; i < df._rows.length; i++) {
    var row = df._rows[i];
    var rowKey = rowIndices.map(function (idx) { return String(row[idx]); }).join('\x00');
    var pv = String(row[pivotIdx]);
    var bKey = rowKey + '\x01' + pv;
    if (!buckets.has(bKey)) buckets.set(bKey, { rowKey: rowKey, rowVals: rowIndices.map(function (idx) { return row[idx]; }), vals: [] });
    buckets.get(bKey).vals.push(row[valueIdx]);
  }

  // Build output: rowCols + one column per pivot value
  var headers = rowCols.concat(pivotValues);
  var rowMap = new Map();

  buckets.forEach(function (bucket) {
    if (!rowMap.has(bucket.rowKey)) {
      var outRow = bucket.rowVals.slice();
      for (var p = 0; p < pivotValues.length; p++) outRow.push('');
      rowMap.set(bucket.rowKey, outRow);
    }
  });

  buckets.forEach(function (bucket, bKey) {
    var parts = bKey.split('\x01');
    var rowKey = parts[0];
    var pv = parts[1];
    var colIdx = rowCols.length + pivotValues.indexOf(pv);
    var outRow = rowMap.get(rowKey);
    outRow[colIdx] = fn(bucket.vals);
  });

  var rows = [];
  rowMap.forEach(function (row) { rows.push(row); });

  return { headers: headers, rows: rows };
}

// --- transforms/pii-scanner.js ---

/**
 * WDK PII Scanner — two-pass regex-based PII detection.
 * Pass 1 (gate): fast regex scan for candidate matches.
 * Pass 2 (validate): Luhn checksum, SSN area validation, context scoring.
 * Consumes pii-patterns.json (shared with PowerShell scanner).
 * Zero dependencies.
 */

/* global DK_PII_PATTERNS */

// Inline patterns if not loaded externally
var DK_PII_PATTERNS = (typeof DK_PII_PATTERNS !== 'undefined') ? DK_PII_PATTERNS : null;

/**
 * Load patterns from JSON object.
 * @param {object} patternsJson - parsed pii-patterns.json
 */
function loadPIIPatterns(patternsJson) {
  DK_PII_PATTERNS = patternsJson.patterns.map(function (p) {
    return {
      name: p.name,
      entity_type: p.entity_type,
      severity: p.severity,
      regex: new RegExp(p.regex, 'gi'),
      score: p.score,
      context_words: p.context_words || [],
      context_score_boost: p.context_score_boost || 0,
      validation: p.validation,
      description: p.description
    };
  });
}

/**
 * Luhn checksum validator for credit card numbers.
 * @param {string} num - digits string (may include dashes/spaces)
 * @returns {boolean}
 */
function validateLuhn(num) {
  var digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  var sum = 0;
  var alt = false;
  for (var i = digits.length - 1; i >= 0; i--) {
    var d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return (sum % 10) === 0;
}

/**
 * SSN area number validation.
 * Rejects known invalid patterns: 000, 666, 900-999 area; 00 group; 0000 serial.
 * @param {string} ssn - SSN string (may include dashes/spaces)
 * @returns {boolean}
 */
function validateSSN(ssn) {
  var digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  var area = parseInt(digits.substring(0, 3), 10);
  var group = parseInt(digits.substring(3, 5), 10);
  var serial = parseInt(digits.substring(5, 9), 10);
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;
  // Reject obvious patterns (all same digit)
  if (/^(\d)\1{8}$/.test(digits)) return false;
  return true;
}

/**
 * Check for context words near a match to boost confidence.
 * @param {string} text - full text of the row/line
 * @param {string[]} contextWords - words to search for
 * @returns {boolean}
 */
function hasContextMatch(text, contextWords) {
  if (!contextWords || contextWords.length === 0) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < contextWords.length; i++) {
    if (lower.indexOf(contextWords[i]) >= 0) return true;
  }
  return false;
}

/**
 * Scan a DataFrame for PII.
 * Two-pass approach: fast regex gate, then validation + context scoring.
 *
 * @param {object} df - { _headers: string[], _rows: any[][] }
 * @param {object} [options]
 * @param {number} [options.minScore=0.5] - minimum confidence score to report
 * @param {string[]} [options.severities] - filter by severity (HIGH, MEDIUM, LOW, CRITICAL)
 * @returns {{ findings: object[], summary: object }}
 */
function scanPII(df, options) {
  if (!DK_PII_PATTERNS) throw new Error('PII patterns not loaded. Call loadPIIPatterns() first.');

  var opts = options || {};
  var minScore = opts.minScore != null ? opts.minScore : 0.5;
  var severityFilter = opts.severities || null;

  var findings = [];
  var summary = {};
  var headers = df._headers;
  var rows = df._rows;

  // Initialize summary counters
  DK_PII_PATTERNS.forEach(function (p) {
    summary[p.name] = { count: 0, severity: p.severity, entity_type: p.entity_type };
  });

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    for (var c = 0; c < headers.length; c++) {
      var cellVal = row[c];
      if (cellVal == null || cellVal === '') continue;
      var cellStr = String(cellVal);

      // Pass 1: fast regex gate
      for (var p = 0; p < DK_PII_PATTERNS.length; p++) {
        var pattern = DK_PII_PATTERNS[p];

        // Severity filter
        if (severityFilter && severityFilter.indexOf(pattern.severity) < 0) continue;

        // Reset regex state (global flag)
        pattern.regex.lastIndex = 0;
        var match = pattern.regex.exec(cellStr);
        if (!match) continue;

        // Pass 2: validation
        var score = pattern.score;
        var valid = true;

        if (pattern.validation === 'luhn') {
          valid = validateLuhn(match[0]);
          if (!valid) continue;
          score += 0.15; // validated CC gets score boost
        } else if (pattern.validation === 'ssn_area_check') {
          valid = validateSSN(match[0]);
          if (!valid) continue;
          score += 0.10;
        }

        // Context scoring — check entire row text for context words
        var rowText = row.join(' ');
        if (hasContextMatch(rowText, pattern.context_words)) {
          score += pattern.context_score_boost;
        }

        // Apply minimum score filter
        score = Math.min(1.0, score);
        if (score < minScore) continue;

        findings.push({
          row: r,
          column: c,
          header: headers[c],
          pattern_name: pattern.name,
          entity_type: pattern.entity_type,
          severity: pattern.severity,
          match: _redactMatch(match[0], pattern.entity_type),
          score: Math.round(score * 100) / 100,
          description: pattern.description
        });

        summary[pattern.name].count++;
      }
    }
  }

  return {
    findings: findings,
    summary: summary,
    total_findings: findings.length,
    rows_scanned: rows.length,
    columns_scanned: headers.length
  };
}

/**
 * Redact a matched value for safe display in reports.
 * Shows first 2 and last 2 chars, masks the rest.
 * @param {string} val
 * @param {string} entityType
 * @returns {string}
 */
function _redactMatch(val, entityType) {
  if (entityType === 'CLASSIFICATION' || entityType === 'EXPORT_CONTROL') {
    return val; // classification markings should be shown in full
  }
  if (val.length <= 4) return '****';
  return val.substring(0, 2) + val.substring(2, val.length - 2).replace(/[A-Za-z0-9]/g, '*') + val.substring(val.length - 2);
}

/**
 * Generate a text report from scan results.
 * @param {object} scanResult - output of scanPII()
 * @returns {string}
 */
function piiReport(scanResult) {
  var lines = [];
  lines.push('PII Scan Report');
  lines.push('===============');
  lines.push('Rows scanned: ' + scanResult.rows_scanned);
  lines.push('Columns scanned: ' + scanResult.columns_scanned);
  lines.push('Total findings: ' + scanResult.total_findings);
  lines.push('');

  // Summary by type
  lines.push('Summary:');
  var summary = scanResult.summary;
  var keys = Object.keys(summary);
  for (var i = 0; i < keys.length; i++) {
    var s = summary[keys[i]];
    if (s.count > 0) {
      lines.push('  ' + keys[i] + ': ' + s.count + ' (' + s.severity + ')');
    }
  }
  lines.push('');

  // Findings detail
  if (scanResult.findings.length > 0) {
    lines.push('Findings:');
    lines.push('Row\tColumn\tType\tSeverity\tScore\tMatch');
    for (var f = 0; f < scanResult.findings.length; f++) {
      var finding = scanResult.findings[f];
      lines.push(
        (finding.row + 1) + '\t' +
        finding.header + '\t' +
        finding.entity_type + '\t' +
        finding.severity + '\t' +
        finding.score + '\t' +
        finding.match
      );
    }
  } else {
    lines.push('No PII detected.');
  }

  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadPIIPatterns: loadPIIPatterns,
    scanPII: scanPII,
    piiReport: piiReport,
    validateLuhn: validateLuhn,
    validateSSN: validateSSN
  };
}

// --- transforms/sql-functions.js ---

/**
 * WDK SQL Functions — string, date, math, and type functions for the SQL engine.
 * Evaluates function calls in SELECT and WHERE expressions.
 * Zero dependencies.
 */

var SQL_FUNCTIONS = {
  // String functions
  upper: function (args) { return String(args[0] == null ? '' : args[0]).toUpperCase(); },
  lower: function (args) { return String(args[0] == null ? '' : args[0]).toLowerCase(); },
  trim: function (args) { return String(args[0] == null ? '' : args[0]).trim(); },
  ltrim: function (args) { return String(args[0] == null ? '' : args[0]).replace(/^\s+/, ''); },
  rtrim: function (args) { return String(args[0] == null ? '' : args[0]).replace(/\s+$/, ''); },
  length: function (args) { return args[0] == null ? 0 : String(args[0]).length; },
  len: function (args) { return SQL_FUNCTIONS.length(args); },
  substr: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var start = Math.max(0, (Number(args[1]) || 1) - 1); // SQL is 1-indexed
    var len = args[2] != null ? Number(args[2]) : undefined;
    return len != null ? s.substr(start, len) : s.substr(start);
  },
  substring: function (args) { return SQL_FUNCTIONS.substr(args); },
  replace: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var find = String(args[1] == null ? '' : args[1]);
    var rep = String(args[2] == null ? '' : args[2]);
    return s.split(find).join(rep);
  },
  concat: function (args) {
    return args.map(function (a) { return a == null ? '' : String(a); }).join('');
  },
  left: function (args) {
    return String(args[0] == null ? '' : args[0]).substring(0, Number(args[1]) || 0);
  },
  right: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var n = Number(args[1]) || 0;
    return s.substring(Math.max(0, s.length - n));
  },
  instr: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var sub = String(args[1] == null ? '' : args[1]);
    var idx = s.indexOf(sub);
    return idx >= 0 ? idx + 1 : 0; // SQL is 1-indexed, 0 = not found
  },
  reverse: function (args) {
    return String(args[0] == null ? '' : args[0]).split('').reverse().join('');
  },
  repeat: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var n = Math.max(0, Math.floor(Number(args[1]) || 0));
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  },
  lpad: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var len = Number(args[1]) || 0;
    var pad = args[2] != null ? String(args[2]) : ' ';
    while (s.length < len) s = pad + s;
    return s.substring(s.length - len);
  },
  rpad: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var len = Number(args[1]) || 0;
    var pad = args[2] != null ? String(args[2]) : ' ';
    while (s.length < len) s = s + pad;
    return s.substring(0, len);
  },

  // Date functions
  year: function (args) { var d = _parseDate(args[0]); return d ? d.getFullYear() : null; },
  month: function (args) { var d = _parseDate(args[0]); return d ? d.getMonth() + 1 : null; },
  day: function (args) { var d = _parseDate(args[0]); return d ? d.getDate() : null; },
  hour: function (args) { var d = _parseDate(args[0]); return d ? d.getHours() : null; },
  minute: function (args) { var d = _parseDate(args[0]); return d ? d.getMinutes() : null; },
  second: function (args) { var d = _parseDate(args[0]); return d ? d.getSeconds() : null; },
  now: function () { return new Date().toISOString(); },
  today: function () { return new Date().toISOString().substring(0, 10); },
  date: function (args) {
    var d = _parseDate(args[0]);
    return d ? d.toISOString().substring(0, 10) : null;
  },
  datediff: function (args) {
    // DATEDIFF(date1, date2) → days between
    var d1 = _parseDate(args[0]);
    var d2 = _parseDate(args[1]);
    if (!d1 || !d2) return null;
    return Math.round((d2 - d1) / 86400000);
  },
  dateadd: function (args) {
    // DATEADD(date, days)
    var d = _parseDate(args[0]);
    var days = Number(args[1]) || 0;
    if (!d) return null;
    var result = new Date(d.getTime() + days * 86400000);
    return result.toISOString().substring(0, 10);
  },

  // Math functions
  abs: function (args) { return Math.abs(Number(args[0]) || 0); },
  round: function (args) {
    var n = Number(args[0]) || 0;
    var decimals = Number(args[1]) || 0;
    var factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  },
  ceil: function (args) { return Math.ceil(Number(args[0]) || 0); },
  ceiling: function (args) { return SQL_FUNCTIONS.ceil(args); },
  floor: function (args) { return Math.floor(Number(args[0]) || 0); },
  sqrt: function (args) { var n = Number(args[0]); if (isNaN(n) || n < 0) return null; return Math.sqrt(n); },
  power: function (args) { return Math.pow(Number(args[0]) || 0, Number(args[1]) || 0); },
  mod: function (args) { return (Number(args[0]) || 0) % (Number(args[1]) || 1); },
  log: function (args) { var n = Number(args[0]); return n > 0 ? Math.log(n) : null; },

  // Type / null functions
  coalesce: function (args) {
    for (var i = 0; i < args.length; i++) {
      if (args[i] != null && args[i] !== '' && args[i] !== 'null' && args[i] !== 'NULL') return args[i];
    }
    return null;
  },
  ifnull: function (args) { return SQL_FUNCTIONS.coalesce(args); },
  nullif: function (args) {
    return args[0] == args[1] ? null : args[0];
  },
  cast_int: function (args) {
    var n = parseInt(args[0], 10);
    return isNaN(n) ? null : n;
  },
  cast_float: function (args) {
    var n = parseFloat(args[0]);
    return isNaN(n) ? null : n;
  },
  typeof: function (args) {
    var v = args[0];
    if (v == null || v === '' || v === 'null' || v === 'NULL') return 'null';
    if (!isNaN(Number(v))) return Number(v) === Math.floor(Number(v)) ? 'integer' : 'real';
    if (_parseDate(v)) return 'date';
    return 'text';
  },

  // Advanced string functions
  split: function(args) {
    // SPLIT(string, delimiter, index)
    // Returns the nth element (0-based) after splitting string by delimiter
    var s = String(args[0] == null ? '' : args[0]);
    var delim = String(args[1] == null ? ',' : args[1]);
    var idx = Number(args[2]) || 0;
    var parts = s.split(delim);
    return idx >= 0 && idx < parts.length ? parts[idx] : null;
  },
  regex_extract: function(args) {
    // REGEX_EXTRACT(string, pattern, group?)
    // Returns the first match (or capture group) of pattern in string
    var s = String(args[0] == null ? '' : args[0]);
    var pattern = String(args[1] == null ? '' : args[1]);
    var group = Number(args[2]) || 0;
    try {
      var m = s.match(new RegExp(pattern));
      if (!m) return null;
      return group < m.length ? m[group] : null;
    } catch(e) { return null; }
  },
  regex_replace: function(args) {
    // REGEX_REPLACE(string, pattern, replacement)
    var s = String(args[0] == null ? '' : args[0]);
    var pattern = String(args[1] == null ? '' : args[1]);
    var rep = String(args[2] == null ? '' : args[2]);
    try {
      return s.replace(new RegExp(pattern, 'g'), rep);
    } catch(e) { return s; }
  },

  // Conditional
  iif: function (args) {
    return args[0] ? args[1] : (args[2] != null ? args[2] : null);
  },
};

/** Parse a date string, returning Date or null */
function _parseDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) return val;
  var s = String(val).trim();
  // ISO format
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try MM/DD/YYYY
  var parts = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (parts) {
    d = new Date(Number(parts[3]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isNaN(d.getTime())) return d;
  }
  // Try YYYY-MM-DD
  parts = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (parts) {
    d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Evaluate a SQL function call.
 * @param {string} funcName
 * @param {any[]} args — resolved argument values
 * @returns {any}
 */
function evalSQLFunction(funcName, args) {
  var fn = SQL_FUNCTIONS[funcName.toLowerCase()];
  if (!fn) throw new Error('Unknown function: ' + funcName);
  return fn(args);
}

/**
 * Check if a token is a known SQL function name.
 * @param {string} name
 * @returns {boolean}
 */
function isSQLFunction(name) {
  return SQL_FUNCTIONS.hasOwnProperty(name.toLowerCase());
}

// --- transforms/sql.js ---

/**
 * WDK SQL engine — lightweight SQL SELECT parser + executor against DataFrames.
 * Supports: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT, aliases, *, COUNT/SUM/AVG/MIN/MAX.
 * Window functions: ROW_NUMBER, RANK, LAG, LEAD, SUM OVER, AVG OVER, COUNT OVER.
 * Zero dependencies. Not a full SQL parser — covers analyst use cases.
 */

/**
 * Execute a SQL SELECT query against a map of named DataFrames.
 * @param {string} sql - SQL query string
 * @param {object} tables - Map of table name → {_headers, _rows}
 * @returns {{headers: string[], rows: any[][]}}
 */
function execSQL(sql, tables) {
  var parsed = parseSelect(sql);
  var df = tables[parsed.from];
  if (!df) throw new Error('Table "' + parsed.from + '" not found. Available: ' + Object.keys(tables).join(', '));

  var headers, rows;

  if (parsed.joins && parsed.joins.length > 0) {
    var fromAlias = parsed.fromAlias ? parsed.fromAlias : parsed.from;
    var merged = buildJoinedResult(df, fromAlias, parsed.joins, tables);
    headers = merged.headers;
    rows = merged.rows;
  } else {
    headers = df._headers;
    rows = df._rows;
  }

  // UNPIVOT — transform columns into rows
  if (parsed.unpivot) {
    var up = parsed.unpivot;
    var unpivotIdxs = up.cols.map(function(c) {
      var idx = headers.indexOf(c);
      if (idx === -1) throw new Error('UNPIVOT: column "' + c + '" not found');
      return idx;
    });
    var keepIdxs = [];
    for (var hi = 0; hi < headers.length; hi++) {
      if (unpivotIdxs.indexOf(hi) < 0) keepIdxs.push(hi);
    }
    var newHeaders = keepIdxs.map(function(i) { return headers[i]; });
    newHeaders.push(up.nameCol);
    newHeaders.push(up.valueCol);
    var newRows = [];
    for (var ri = 0; ri < rows.length; ri++) {
      var baseRow = keepIdxs.map(function(i) { return rows[ri][i]; });
      for (var ui = 0; ui < up.cols.length; ui++) {
        var newRow = baseRow.slice();
        newRow.push(up.cols[ui]);
        newRow.push(rows[ri][unpivotIdxs[ui]]);
        newRows.push(newRow);
      }
    }
    headers = newHeaders;
    rows = newRows;
  }

  // WHERE
  if (parsed.where) {
    var whereFn = compileWhere(parsed.where, headers);
    rows = rows.filter(whereFn);
  }

  // GROUP BY
  if (parsed.groupBy.length > 0 || hasAggregates(parsed.columns)) {
    return execGrouped(parsed, headers, rows);
  }

  // Separate window columns from regular columns
  var windowCols = parsed.columns.filter(function (c) { return c.type === 'window'; });
  var regularCols = parsed.columns.filter(function (c) { return c.type !== 'window'; });

  // SELECT regular columns
  var colSpecs = resolveColumns(regularCols, headers);

  // ORDER BY (applied to source rows before projection)
  if (parsed.orderBy.length > 0) {
    rows = applyOrderBy(rows, parsed.orderBy, headers);
  }

  // Project regular columns
  var outHeaders = colSpecs.map(function (c) { return c.alias; });
  var outRows = rows.map(function (row) {
    return colSpecs.map(function (c) { return row[c.idx]; });
  });

  // Window functions — post-process on source rows, then append columns
  if (windowCols.length > 0) {
    var winResult = applyWindowFunctions(rows, headers, windowCols);
    // Append window column headers
    winResult.headers.forEach(function (h) { outHeaders.push(h); });
    // Append window column values per row
    for (var i = 0; i < outRows.length; i++) {
      winResult.columns.forEach(function (col) {
        outRows[i].push(col[i]);
      });
    }
  }

  // FILL_DOWN — post-process columns
  var fillDownCols = parsed.columns.filter(function(c) { return c.type === 'fill_down'; });
  if (fillDownCols.length > 0) {
    fillDownCols.forEach(function(fd) {
      var srcIdx = headers.indexOf(fd.col);
      if (srcIdx === -1) throw new Error('FILL_DOWN: column "' + fd.col + '" not found');
      // Add new column header and values
      outHeaders.push(fd.alias);
      var lastVal = null;
      for (var i = 0; i < outRows.length; i++) {
        var val = rows[i][srcIdx];
        if (val != null && val !== '' && val !== 'null' && val !== 'NULL') {
          lastVal = val;
        }
        outRows[i].push(lastVal);
      }
    });
  }

  // LIMIT
  if (parsed.limit !== null) {
    outRows = outRows.slice(0, parsed.limit);
  }

  return { headers: outHeaders, rows: outRows };
}

// ─── JOIN executor ─────────────────────────────────────────────────────

/**
 * Build a flat joined result from the primary DataFrame + list of join specs.
 * All headers in the result use "alias.col" notation.
 */
function buildJoinedResult(leftDf, leftAlias, joins, tables) {
  var currentHeaders = leftDf._headers.map(function (h) { return leftAlias + '.' + h; });
  var currentRows = leftDf._rows.map(function (r) { return r.slice(); });

  for (var j = 0; j < joins.length; j++) {
    var joinSpec = joins[j];
    var rightTableName = joinSpec.table;
    var rightAlias = joinSpec.alias ? joinSpec.alias : rightTableName;
    var rightDf = tables[rightTableName];
    if (!rightDf) throw new Error('JOIN: table "' + rightTableName + '" not found. Available: ' + Object.keys(tables).join(', '));

    var rightHeaders = rightDf._headers.map(function (h) { return rightAlias + '.' + h; });
    var rightRows = rightDf._rows;
    var joinType = joinSpec.type;

    var mergedHeaders = currentHeaders.concat(rightHeaders);
    var nullRight = rightHeaders.map(function () { return null; });
    var nullLeft = currentHeaders.map(function () { return null; });
    var mergedRows = [];

    if (joinType === 'cross') {
      for (var li = 0; li < currentRows.length; li++) {
        for (var ri = 0; ri < rightRows.length; ri++) {
          mergedRows.push(currentRows[li].concat(rightRows[ri]));
        }
      }
    } else {
      // Resolve ON predicate indices into the merged header space
      var onPreds = joinSpec.on.map(function (pred) {
        var lIdx = mergedHeaders.indexOf(pred.left);
        var rIdx = mergedHeaders.indexOf(pred.right);
        if (lIdx === -1) throw new Error('JOIN ON: column "' + pred.left + '" not found in joined columns');
        if (rIdx === -1) throw new Error('JOIN ON: column "' + pred.right + '" not found in joined columns');
        return { lIdx: lIdx, rIdx: rIdx };
      });

      function rowsMatch(combined) {
        for (var p = 0; p < onPreds.length; p++) {
          if (combined[onPreds[p].lIdx] !== combined[onPreds[p].rIdx]) return false;
        }
        return true;
      }

      if (joinType === 'inner') {
        for (var li = 0; li < currentRows.length; li++) {
          for (var ri = 0; ri < rightRows.length; ri++) {
            var combined = currentRows[li].concat(rightRows[ri]);
            if (rowsMatch(combined)) mergedRows.push(combined);
          }
        }
      } else if (joinType === 'left') {
        for (var li = 0; li < currentRows.length; li++) {
          var leftMatched = false;
          for (var ri = 0; ri < rightRows.length; ri++) {
            var combined = currentRows[li].concat(rightRows[ri]);
            if (rowsMatch(combined)) { mergedRows.push(combined); leftMatched = true; }
          }
          if (!leftMatched) mergedRows.push(currentRows[li].concat(nullRight));
        }
      } else if (joinType === 'right') {
        for (var ri = 0; ri < rightRows.length; ri++) {
          var rightMatched = false;
          for (var li = 0; li < currentRows.length; li++) {
            var combined = currentRows[li].concat(rightRows[ri]);
            if (rowsMatch(combined)) { mergedRows.push(combined); rightMatched = true; }
          }
          if (!rightMatched) mergedRows.push(nullLeft.concat(rightRows[ri]));
        }
      }
    }

    currentHeaders = mergedHeaders;
    currentRows = mergedRows;
  }

  return { headers: currentHeaders, rows: currentRows };
}

// ─── Parser ───────────────────────────────────────────────────────────

function parseSelect(sql) {
  var s = sql.trim().replace(/;$/, '').trim();
  var tokens = tokenize(s);
  var pos = 0;

  function peek() { return pos < tokens.length ? tokens[pos].toUpperCase() : ''; }
  function next() { return tokens[pos++]; }
  function expect(val) {
    if (peek() !== val.toUpperCase()) throw new Error('Expected ' + val + ' but got ' + (tokens[pos] || 'end'));
    return next();
  }

  expect('SELECT');

  // Columns
  var columns = [];
  do {
    if (columns.length > 0 && peek() === ',') next(); // consume comma
    columns.push(parseColumnExpr());
  } while (peek() === ',');

  expect('FROM');
  var from = next().toLowerCase();

  // Optional table alias: FROM tbl AS a  or  FROM tbl a
  var fromAlias = null;
  if (peek() === 'AS') { next(); fromAlias = next().toLowerCase(); }
  else if (peek() !== '' && ['WHERE','JOIN','INNER','LEFT','RIGHT','CROSS','GROUP','ORDER','LIMIT','UNPIVOT'].indexOf(peek()) < 0) {
    fromAlias = next().toLowerCase();
  }

  // UNPIVOT(value_col FOR name_col IN (col1, col2, ...))
  var unpivot = null;
  if (peek() === 'UNPIVOT') {
    next(); // consume UNPIVOT
    expect('(');
    var valueCol = next();
    expect('FOR');
    var nameCol = next();
    expect('IN');
    expect('(');
    var unpivotCols = [];
    do {
      if (unpivotCols.length > 0 && peek() === ',') next();
      unpivotCols.push(next());
    } while (peek() === ',');
    expect(')');
    expect(')');
    unpivot = { valueCol: valueCol, nameCol: nameCol, cols: unpivotCols };
  }

  // JOINs: [INNER|LEFT [OUTER]|RIGHT [OUTER]|CROSS] JOIN tbl [AS alias] ON left = right [AND ...]
  var joins = [];
  while (['JOIN','INNER','LEFT','RIGHT','CROSS'].indexOf(peek()) >= 0) {
    var joinType = 'inner';
    if (peek() === 'INNER') { next(); joinType = 'inner'; }
    else if (peek() === 'LEFT') { next(); joinType = 'left'; if (peek() === 'OUTER') next(); }
    else if (peek() === 'RIGHT') { next(); joinType = 'right'; if (peek() === 'OUTER') next(); }
    else if (peek() === 'CROSS') { next(); joinType = 'cross'; }
    expect('JOIN');
    var joinTable = next().toLowerCase();
    var joinAlias = null;
    if (peek() === 'AS') { next(); joinAlias = next().toLowerCase(); }
    else if (peek() !== '' && ['ON','WHERE','JOIN','INNER','LEFT','RIGHT','CROSS','GROUP','ORDER','LIMIT'].indexOf(peek()) < 0) {
      joinAlias = next().toLowerCase();
    }
    var onPreds = [];
    if (joinType !== 'cross' && peek() === 'ON') {
      next(); // consume ON
      // Parse one or more equality predicates joined by AND
      // Each predicate is: left . col = right . col  (tokenized as separate tokens)
      do {
        var lParts = [next()];
        if (peek() === '.') { next(); lParts.push(next()); }
        var leftCol = lParts.join('.').toLowerCase();
        expect('=');
        var rParts = [next()];
        if (peek() === '.') { next(); rParts.push(next()); }
        var rightCol = rParts.join('.').toLowerCase();
        onPreds.push({ left: leftCol, right: rightCol });
      } while (peek() === 'AND' && next() && true);
    }
    joins.push({ type: joinType, table: joinTable, alias: joinAlias, on: onPreds });
  }

  // WHERE
  var where = null;
  if (peek() === 'WHERE') {
    next();
    where = collectUntil(['GROUP', 'ORDER', 'LIMIT']);
  }

  // GROUP BY
  var groupBy = [];
  if (peek() === 'GROUP') {
    next(); expect('BY');
    do {
      if (groupBy.length > 0 && peek() === ',') next();
      groupBy.push(next());
    } while (peek() === ',');
  }

  // ORDER BY
  var orderBy = [];
  if (peek() === 'ORDER') {
    next(); expect('BY');
    do {
      if (orderBy.length > 0 && peek() === ',') next();
      var col = next();
      var dir = 'asc';
      if (peek() === 'ASC') { next(); dir = 'asc'; }
      else if (peek() === 'DESC') { next(); dir = 'desc'; }
      orderBy.push({ column: col, dir: dir });
    } while (peek() === ',');
  }

  // LIMIT
  var limit = null;
  if (peek() === 'LIMIT') {
    next();
    limit = parseInt(next(), 10);
  }

  return { columns: columns, from: from, fromAlias: fromAlias, unpivot: unpivot, joins: joins, where: where, groupBy: groupBy, orderBy: orderBy, limit: limit };

  function parseColumnExpr() {
    var tok = peek();

    // Check for window functions: ROW_NUMBER, RANK, LAG, LEAD, and agg OVER
    var windowFuncs = ['ROW_NUMBER', 'RANK', 'LAG', 'LEAD'];
    var aggWindowFuncs = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    var isWindowFunc = windowFuncs.indexOf(tok) >= 0;
    var isAggWindow = aggWindowFuncs.indexOf(tok) >= 0;

    if (isWindowFunc || isAggWindow) {
      var fn = next();
      expect('(');
      // Collect arguments inside parens
      var args = [];
      while (peek() !== ')') {
        if (peek() === ',') { next(); continue; }
        args.push(next());
      }
      expect(')');

      // If followed by OVER, this is a window function
      if (peek() === 'OVER') {
        next(); // consume OVER
        expect('(');

        // PARTITION BY (optional)
        var partitionBy = [];
        if (peek() === 'PARTITION') {
          next(); // PARTITION
          // peek may be BY
          if (tokens[pos] && tokens[pos].toUpperCase() === 'BY') next();
          while (peek() !== ')' && peek() !== 'ORDER' && peek() !== '') {
            if (peek() === ',') { next(); continue; }
            partitionBy.push(next());
          }
        }

        // ORDER BY (optional)
        var overOrderBy = [];
        if (peek() === 'ORDER') {
          next(); // ORDER
          if (tokens[pos] && tokens[pos].toUpperCase() === 'BY') next();
          while (peek() !== ')' && peek() !== '') {
            if (peek() === ',') { next(); continue; }
            var ocol = next();
            var odir = 'asc';
            if (peek() === 'ASC') { next(); odir = 'asc'; }
            else if (peek() === 'DESC') { next(); odir = 'desc'; }
            overOrderBy.push({ column: ocol, dir: odir });
          }
        }

        expect(')');

        var defaultAlias = fn.toLowerCase() + '_over';
        var alias = defaultAlias;
        if (peek() === 'AS') { next(); alias = next(); }

        return {
          type: 'window',
          func: fn.toLowerCase(),
          args: args,
          partitionBy: partitionBy,
          orderBy: overOrderBy,
          alias: alias
        };
      }

      // Not a window function — fall back to aggregate
      var arg = args.length > 0 ? args[0] : '*';
      var aggAlias = fn.toLowerCase() + '_' + arg.toLowerCase();
      if (peek() === 'AS') { next(); aggAlias = next(); }
      return { type: 'agg', func: fn.toLowerCase(), arg: arg, alias: aggAlias };
    }

    // FILL_DOWN(col)
    if (tok === 'FILL_DOWN') {
      next(); // consume FILL_DOWN
      expect('(');
      var fdCol = next();
      expect(')');
      var fdAlias = fdCol + '_filled';
      if (peek() === 'AS') { next(); fdAlias = next(); }
      return { type: 'fill_down', col: fdCol, alias: fdAlias };
    }

    // Star
    if (tok === '*') {
      next();
      return { type: 'star' };
    }
    // Plain column, possibly aliased (may be table.col — tokenized as ["table", ".", "col"])
    var name = next();
    if (peek() === '.') { next(); name = name + '.' + next(); }
    var alias = name;
    if (peek() === 'AS') { next(); alias = next(); }
    return { type: 'col', name: name, alias: alias };
  }

  function collectUntil(stops) {
    var parts = [];
    while (pos < tokens.length && stops.indexOf(peek()) < 0) {
      parts.push(next());
    }
    return parts.join(' ');
  }
}

function tokenize(sql) {
  var tokens = [];
  var i = 0;
  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) { i++; continue; }
    // Quoted string
    if (sql[i] === "'") {
      var j = i + 1;
      while (j < sql.length && sql[j] !== "'") j++;
      tokens.push(sql.substring(i, j + 1));
      i = j + 1;
      continue;
    }
    // Special chars (include . so table.col tokenizes as ["table",".","col"])
    if ('(),*.'.indexOf(sql[i]) >= 0) {
      tokens.push(sql[i]);
      i++;
      continue;
    }
    // Operators
    if (sql[i] === '!' && sql[i + 1] === '=') { tokens.push('!='); i += 2; continue; }
    if (sql[i] === '<' && sql[i + 1] === '=') { tokens.push('<='); i += 2; continue; }
    if (sql[i] === '>' && sql[i + 1] === '=') { tokens.push('>='); i += 2; continue; }
    if ('<>=,'.indexOf(sql[i]) >= 0) { tokens.push(sql[i]); i++; continue; }
    // Word/number
    var start = i;
    while (i < sql.length && !/[\s(),<>=!,.]/.test(sql[i]) && sql[i] !== "'") i++;
    if (i > start) tokens.push(sql.substring(start, i));
  }
  return tokens;
}

// ─── WHERE compiler ────────────────────────────────────────────────────

function compileWhere(whereStr, headers) {
  // Simple expression evaluator: col op value [AND|OR col op value ...]
  var parts = tokenize(whereStr);
  var conditions = [];
  var i = 0;
  while (i < parts.length) {
    if (parts[i].toUpperCase() === 'AND' || parts[i].toUpperCase() === 'OR') {
      conditions.push({ type: 'logic', op: parts[i].toUpperCase() });
      i++;
      continue;
    }
    var col = parts[i++];
    // Reassemble dotted column names: ["a", ".", "id"] → "a.id"
    if (parts[i] === '.') { col = col + '.' + parts[i + 1]; i += 2; }
    var op = parts[i++];
    var val = parts[i++];
    // Strip quotes from string values
    if (val && val[0] === "'" && val[val.length - 1] === "'") val = val.substring(1, val.length - 1);
    var colIdx = headers.indexOf(col);
    if (colIdx === -1) throw new Error('WHERE: column "' + col + '" not found');
    conditions.push({ type: 'cond', colIdx: colIdx, op: op, val: val });
  }

  return function (row) {
    var result = evalCond(conditions[0], row);
    for (var c = 1; c < conditions.length; c += 2) {
      var logic = conditions[c];
      var next = conditions[c + 1];
      if (logic.op === 'AND') result = result && evalCond(next, row);
      else result = result || evalCond(next, row);
    }
    return result;
  };

  function evalCond(cond, row) {
    var cellVal = row[cond.colIdx];
    var cmpVal = cond.val;
    // Try numeric comparison
    var numCell = Number(cellVal);
    var numCmp = Number(cmpVal);
    var useNum = !isNaN(numCell) && !isNaN(numCmp);
    var a = useNum ? numCell : String(cellVal);
    var b = useNum ? numCmp : cmpVal;

    switch (cond.op) {
      case '=': case '==': return a == b;
      case '!=': case '<>': return a != b;
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case 'LIKE': case 'like':
        var pattern = String(cmpVal).replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp('^' + pattern + '$', 'i').test(String(cellVal));
      default: throw new Error('Unknown operator: ' + cond.op);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function hasAggregates(columns) {
  return columns.some(function (c) { return c.type === 'agg'; });
}

function resolveColumns(columns, headers) {
  var specs = [];
  columns.forEach(function (c) {
    if (c.type === 'star') {
      headers.forEach(function (h, i) {
        specs.push({ idx: i, alias: h });
      });
    } else if (c.type === 'col') {
      var idx = headers.indexOf(c.name);
      if (idx === -1) throw new Error('Column "' + c.name + '" not found');
      specs.push({ idx: idx, alias: c.alias });
    }
  });
  return specs;
}

function applyOrderBy(rows, orderBy, headers) {
  var specs = orderBy.map(function (o) {
    var idx = headers.indexOf(o.column);
    if (idx === -1) throw new Error('ORDER BY: column "' + o.column + '" not found');
    return { idx: idx, asc: o.dir === 'asc' };
  });
  return rows.slice().sort(function (a, b) {
    for (var s = 0; s < specs.length; s++) {
      var spec = specs[s];
      var va = a[spec.idx], vb = b[spec.idx];
      var na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) { va = na; vb = nb; }
      if (va < vb) return spec.asc ? -1 : 1;
      if (va > vb) return spec.asc ? 1 : -1;
    }
    return 0;
  });
}

function execGrouped(parsed, headers, rows) {
  var groupCols = parsed.groupBy;
  var groupIndices = groupCols.map(function (name) {
    var idx = headers.indexOf(name);
    if (idx === -1) throw new Error('GROUP BY: column "' + name + '" not found');
    return idx;
  });

  // Build groups
  var groups = new Map();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = groupIndices.map(function (idx) { return String(row[idx]); }).join('\x00');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  // Build output columns
  var outHeaders = [];
  var extractors = [];

  parsed.columns.forEach(function (c) {
    if (c.type === 'col') {
      var idx = headers.indexOf(c.name);
      if (idx === -1) throw new Error('Column "' + c.name + '" not found');
      outHeaders.push(c.alias);
      extractors.push(function (groupRows) { return groupRows[0][idx]; });
    } else if (c.type === 'agg') {
      outHeaders.push(c.alias);
      var aggIdx = c.arg === '*' ? -1 : headers.indexOf(c.arg);
      if (aggIdx === -1 && c.arg !== '*') throw new Error('Column "' + c.arg + '" not found');
      var fn = c.func;
      extractors.push(function (groupRows) {
        if (fn === 'count') return groupRows.length;
        var vals = groupRows.map(function (r) { return r[aggIdx]; });
        switch (fn) {
          case 'sum': return vals.reduce(function (s, v) { var n = Number(v); return s + (isNaN(n) ? 0 : n); }, 0);
          case 'avg': var nums = vals.filter(function (v) { return !isNaN(Number(v)); }); return nums.length ? nums.reduce(function (s, v) { return s + Number(v); }, 0) / nums.length : 0;
          case 'min': return Math.min.apply(null, vals.map(Number).filter(function (n) { return !isNaN(n); }));
          case 'max': return Math.max.apply(null, vals.map(Number).filter(function (n) { return !isNaN(n); }));
          default: return groupRows.length;
        }
      });
    } else if (c.type === 'star') {
      // In grouped query, * expands to group columns only
      groupCols.forEach(function (name) {
        var idx = headers.indexOf(name);
        outHeaders.push(name);
        extractors.push(function (groupRows) { return groupRows[0][idx]; });
      });
    }
  });

  var outRows = [];
  groups.forEach(function (groupRows) {
    outRows.push(extractors.map(function (ex) { return ex(groupRows); }));
  });

  // ORDER BY
  if (parsed.orderBy.length > 0) {
    outRows = applyOrderBy(outRows, parsed.orderBy, outHeaders);
  }

  // LIMIT
  if (parsed.limit !== null) {
    outRows = outRows.slice(0, parsed.limit);
  }

  return { headers: outHeaders, rows: outRows };
}

// ─── Window Functions ─────────────────────────────────────────────────

/**
 * Apply window function expressions to a set of rows (already filtered/ordered).
 * Returns { headers: string[], columns: any[][] } where each entry in columns
 * is an array of values (one per row) for that window expression.
 *
 * @param {any[][]} rows - source rows
 * @param {string[]} headers - source column headers
 * @param {object[]} windowExprs - parsed window column specs (type === 'window')
 * @returns {{ headers: string[], columns: any[][] }}
 */
function applyWindowFunctions(rows, headers, windowExprs) {
  var outHeaders = [];
  var outColumns = [];

  windowExprs.forEach(function (expr) {
    outHeaders.push(expr.alias);

    var colIdx = expr.args.length > 0 && expr.args[0] !== '*'
      ? headers.indexOf(expr.args[0])
      : -1;
    if (colIdx === -1 && ['lag', 'lead', 'sum', 'avg'].indexOf(expr.func) >= 0 && expr.func !== 'count') {
      if (expr.args[0] && expr.args[0] !== '*') {
        throw new Error('Window function: column "' + expr.args[0] + '" not found');
      }
    }

    // Resolve partition-by and order-by column indices
    var partIdxs = expr.partitionBy.map(function (name) {
      var idx = headers.indexOf(name);
      if (idx === -1) throw new Error('PARTITION BY: column "' + name + '" not found');
      return idx;
    });
    var orderSpecs = expr.orderBy.map(function (o) {
      var idx = headers.indexOf(o.column);
      if (idx === -1) throw new Error('OVER ORDER BY: column "' + o.column + '" not found');
      return { idx: idx, asc: o.dir === 'asc' };
    });

    // Assign each row its partition key
    function partitionKey(row) {
      if (partIdxs.length === 0) return '__all__';
      return partIdxs.map(function (i) { return String(row[i]); }).join('\x00');
    }

    // Group row indices by partition key, preserving original order
    var partitions = new Map();
    for (var ri = 0; ri < rows.length; ri++) {
      var key = partitionKey(rows[ri]);
      if (!partitions.has(key)) partitions.set(key, []);
      partitions.get(key).push(ri);
    }

    // For each partition, sort indices by the OVER ORDER BY if specified
    function sortedIndices(idxList) {
      if (orderSpecs.length === 0) return idxList.slice();
      return idxList.slice().sort(function (a, b) {
        for (var s = 0; s < orderSpecs.length; s++) {
          var spec = orderSpecs[s];
          var va = rows[a][spec.idx], vb = rows[b][spec.idx];
          var na = Number(va), nb = Number(vb);
          if (!isNaN(na) && !isNaN(nb)) { va = na; vb = nb; }
          if (va < vb) return spec.asc ? -1 : 1;
          if (va > vb) return spec.asc ? 1 : -1;
        }
        return 0;
      });
    }

    // Compare two rows for ORDER BY equality (for RANK)
    function orderEqual(rowA, rowB) {
      for (var s = 0; s < orderSpecs.length; s++) {
        var spec = orderSpecs[s];
        var va = rowA[spec.idx], vb = rowB[spec.idx];
        var na = Number(va), nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) { if (na !== nb) return false; }
        else { if (String(va) !== String(vb)) return false; }
      }
      return true;
    }

    // Build result array indexed by original row position
    var values = new Array(rows.length);

    partitions.forEach(function (idxList) {
      var sorted = sortedIndices(idxList);

      switch (expr.func) {
        case 'row_number':
          sorted.forEach(function (origIdx, rank) {
            values[origIdx] = rank + 1;
          });
          break;

        case 'rank':
          var rankVal = 1;
          sorted.forEach(function (origIdx, pos) {
            if (pos === 0) {
              values[origIdx] = 1;
            } else {
              if (!orderEqual(rows[sorted[pos - 1]], rows[origIdx])) {
                rankVal = pos + 1;
              }
              values[origIdx] = rankVal;
            }
          });
          break;

        case 'lag': {
          var lagOffset = expr.args.length >= 2 ? parseInt(expr.args[1], 10) : 1;
          var lagDefault = expr.args.length >= 3 ? expr.args[2] : null;
          if (isNaN(lagOffset)) lagOffset = 1;
          sorted.forEach(function (origIdx, pos) {
            var srcPos = pos - lagOffset;
            if (srcPos >= 0) {
              values[origIdx] = rows[sorted[srcPos]][colIdx];
            } else {
              values[origIdx] = lagDefault;
            }
          });
          break;
        }

        case 'lead': {
          var leadOffset = expr.args.length >= 2 ? parseInt(expr.args[1], 10) : 1;
          var leadDefault = expr.args.length >= 3 ? expr.args[2] : null;
          if (isNaN(leadOffset)) leadOffset = 1;
          sorted.forEach(function (origIdx, pos) {
            var srcPos = pos + leadOffset;
            if (srcPos < sorted.length) {
              values[origIdx] = rows[sorted[srcPos]][colIdx];
            } else {
              values[origIdx] = leadDefault;
            }
          });
          break;
        }

        case 'sum': {
          // Running/cumulative sum when ORDER BY present; total when not
          if (orderSpecs.length > 0) {
            var runSum = 0;
            sorted.forEach(function (origIdx) {
              var v = Number(rows[origIdx][colIdx]);
              runSum += isNaN(v) ? 0 : v;
              values[origIdx] = runSum;
            });
          } else {
            var total = 0;
            sorted.forEach(function (origIdx) {
              var v = Number(rows[origIdx][colIdx]);
              total += isNaN(v) ? 0 : v;
            });
            sorted.forEach(function (origIdx) { values[origIdx] = total; });
          }
          break;
        }

        case 'avg': {
          var nums = sorted.map(function (i) { return Number(rows[i][colIdx]); }).filter(function (n) { return !isNaN(n); });
          var avgVal = nums.length ? nums.reduce(function (s, v) { return s + v; }, 0) / nums.length : 0;
          sorted.forEach(function (origIdx) { values[origIdx] = avgVal; });
          break;
        }

        case 'count': {
          var cnt = sorted.length;
          sorted.forEach(function (origIdx) { values[origIdx] = cnt; });
          break;
        }

        default:
          throw new Error('Unknown window function: ' + expr.func);
      }
    });

    outColumns.push(values);
  });

  return { headers: outHeaders, columns: outColumns };
}

// --- export/export.js ---

/**
 * WDK Export Module
 * Zero-dependency export to CSV, JSON, clipboard, and file download.
 */

/**
 * Escape a value for CSV output.
 * Wraps in quotes if the value contains the delimiter, quotes, or newlines.
 */
function escapeCSV(value, delimiter) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert a DataFrame to a CSV string.
 *
 * @param {{ headers: string[], rows: any[][] }} table
 * @param {{ delimiter?: string, includeHeaders?: boolean }} [options]
 * @returns {string}
 */
function toCSV(table, options = {}) {
  const delimiter = options.delimiter || ',';
  const includeHeaders = options.includeHeaders !== false;

  const lines = [];

  if (includeHeaders && table.headers) {
    lines.push(table.headers.map(h => escapeCSV(h, delimiter)).join(delimiter));
  }

  for (const row of table.rows) {
    lines.push(row.map(v => escapeCSV(v, delimiter)).join(delimiter));
  }

  return lines.join('\n');
}

/**
 * Convert a DataFrame to a JSON string.
 *
 * @param {{ headers: string[], rows: any[][] }} table
 * @param {{ pretty?: boolean, asArray?: boolean }} [options]
 * @returns {string}
 */
function toJSON(table, options = {}) {
  const indent = options.pretty ? 2 : undefined;

  if (options.asArray) {
    // Array of objects: [ { col: val, ... }, ... ]
    const objects = table.rows.map(row => {
      const obj = {};
      for (let i = 0; i < table.headers.length; i++) {
        obj[table.headers[i]] = i < row.length ? row[i] : null;
      }
      return obj;
    });
    return JSON.stringify(objects, null, indent);
  }

  // Default: array of arrays with headers as first element
  return JSON.stringify({ headers: table.headers, rows: table.rows }, null, indent);
}

/**
 * Trigger a file download in the browser by creating a temporary blob URL.
 *
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} [mimeType='text/plain'] - MIME type
 */
function downloadBlob(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard with fallback for older browsers.
 *
 * @param {string} text - Text to copy
 * @returns {Promise<void>}
 */
function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  // Fallback: textarea + execCommand
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) resolve();
      else reject(new Error('execCommand copy failed'));
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
}

// --- export/xlsx-writer.js ---

/**
 * WDK XLSX Writer
 * Zero-dependency Excel (.xlsx) file generator.
 * Creates valid OOXML SpreadsheetML archives using a minimal ZIP writer.
 *
 * XLSX files are ZIP archives containing XML parts:
 *   [Content_Types].xml
 *   _rels/.rels
 *   xl/workbook.xml
 *   xl/_rels/workbook.xml.rels
 *   xl/worksheets/sheet1.xml
 *   xl/styles.xml
 *   xl/sharedStrings.xml
 */

// ─── CRC-32 ────────────────────────────────────────────────────────

var CRC32_TABLE = (function () {
  var table = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ─── Mini ZIP writer (STORE, no compression) ───────────────────────

function encodeUTF8(str) {
  var arr = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.charCodeAt(i);
    if (code < 0x80) {
      arr.push(code);
    } else if (code < 0x800) {
      arr.push(0xC0 | (code >> 6));
      arr.push(0x80 | (code & 0x3F));
    } else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
      var low = str.charCodeAt(i + 1);
      var cp = ((code - 0xD800) << 10) + (low - 0xDC00) + 0x10000;
      arr.push(0xF0 | (cp >> 18));
      arr.push(0x80 | ((cp >> 12) & 0x3F));
      arr.push(0x80 | ((cp >> 6) & 0x3F));
      arr.push(0x80 | (cp & 0x3F));
      i++;
    } else {
      arr.push(0xE0 | (code >> 12));
      arr.push(0x80 | ((code >> 6) & 0x3F));
      arr.push(0x80 | (code & 0x3F));
    }
  }
  return new Uint8Array(arr);
}

function writeU16LE(buf, offset, val) {
  buf[offset] = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
}

function writeU32LE(buf, offset, val) {
  buf[offset] = val & 0xFF;
  buf[offset + 1] = (val >> 8) & 0xFF;
  buf[offset + 2] = (val >> 16) & 0xFF;
  buf[offset + 3] = (val >> 24) & 0xFF;
}

/**
 * Build a ZIP archive from an array of { name: string, data: Uint8Array } entries.
 * Uses STORE (method 0) — no compression. Simple and zero-dep.
 *
 * @param {{ name: string, data: Uint8Array }[]} files
 * @returns {Uint8Array}
 */
function buildZip(files) {
  // Pre-calculate total size
  var localHeaders = [];
  var centralEntries = [];
  var offset = 0;

  for (var i = 0; i < files.length; i++) {
    var nameBytes = encodeUTF8(files[i].name);
    var fileData = files[i].data;
    var fileCrc = crc32(fileData);

    // Local file header: 30 bytes + name + data
    var localSize = 30 + nameBytes.length + fileData.length;
    var local = new Uint8Array(localSize);

    // Signature: PK\x03\x04
    local[0] = 0x50; local[1] = 0x4B; local[2] = 0x03; local[3] = 0x04;
    // Version needed: 20
    writeU16LE(local, 4, 20);
    // General purpose bit flag: bit 11 (UTF-8 filenames)
    writeU16LE(local, 6, 0x0800);
    // Compression method: 0 (STORE)
    writeU16LE(local, 8, 0);
    // Mod time/date: 0
    writeU16LE(local, 10, 0);
    writeU16LE(local, 12, 0);
    // CRC-32
    writeU32LE(local, 14, fileCrc);
    // Compressed size
    writeU32LE(local, 18, fileData.length);
    // Uncompressed size
    writeU32LE(local, 22, fileData.length);
    // Filename length
    writeU16LE(local, 26, nameBytes.length);
    // Extra field length: 0
    writeU16LE(local, 28, 0);
    // Filename
    local.set(nameBytes, 30);
    // File data
    local.set(fileData, 30 + nameBytes.length);

    localHeaders.push(local);

    // Central directory entry: 46 bytes + name
    var central = new Uint8Array(46 + nameBytes.length);
    // Signature: PK\x01\x02
    central[0] = 0x50; central[1] = 0x4B; central[2] = 0x01; central[3] = 0x02;
    // Version made by: 20
    writeU16LE(central, 4, 20);
    // Version needed: 20
    writeU16LE(central, 6, 20);
    // General purpose bit flag: UTF-8
    writeU16LE(central, 8, 0x0800);
    // Compression method: 0
    writeU16LE(central, 10, 0);
    // Mod time/date: 0
    writeU16LE(central, 12, 0);
    writeU16LE(central, 14, 0);
    // CRC-32
    writeU32LE(central, 16, fileCrc);
    // Compressed size
    writeU32LE(central, 20, fileData.length);
    // Uncompressed size
    writeU32LE(central, 24, fileData.length);
    // Filename length
    writeU16LE(central, 28, nameBytes.length);
    // Extra field length: 0
    writeU16LE(central, 30, 0);
    // File comment length: 0
    writeU16LE(central, 32, 0);
    // Disk number start: 0
    writeU16LE(central, 34, 0);
    // Internal file attributes: 0
    writeU16LE(central, 36, 0);
    // External file attributes: 0
    writeU32LE(central, 38, 0);
    // Relative offset of local header
    writeU32LE(central, 42, offset);
    // Filename
    central.set(nameBytes, 46);

    centralEntries.push(central);
    offset += localSize;
  }

  // End of central directory record: 22 bytes
  var cdOffset = offset;
  var cdSize = 0;
  for (var j = 0; j < centralEntries.length; j++) {
    cdSize += centralEntries[j].length;
  }

  var eocd = new Uint8Array(22);
  // Signature: PK\x05\x06
  eocd[0] = 0x50; eocd[1] = 0x4B; eocd[2] = 0x05; eocd[3] = 0x06;
  // Disk number: 0
  writeU16LE(eocd, 4, 0);
  // Disk with central directory: 0
  writeU16LE(eocd, 6, 0);
  // Number of central directory entries on this disk
  writeU16LE(eocd, 8, files.length);
  // Total central directory entries
  writeU16LE(eocd, 10, files.length);
  // Size of central directory
  writeU32LE(eocd, 12, cdSize);
  // Offset of start of central directory
  writeU32LE(eocd, 16, cdOffset);
  // Comment length: 0
  writeU16LE(eocd, 20, 0);

  // Concatenate all parts
  var totalSize = offset + cdSize + 22;
  var result = new Uint8Array(totalSize);
  var pos = 0;
  for (var li = 0; li < localHeaders.length; li++) {
    result.set(localHeaders[li], pos);
    pos += localHeaders[li].length;
  }
  for (var ci = 0; ci < centralEntries.length; ci++) {
    result.set(centralEntries[ci], pos);
    pos += centralEntries[ci].length;
  }
  result.set(eocd, pos);

  return result;
}

// ─── XML helpers ────────────────────────────────────────────────────

function escapeXML(str) {
  if (str === null || str === undefined) return '';
  var s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert a zero-based column index to an Excel column letter.
 * 0 → A, 25 → Z, 26 → AA, 27 → AB, 701 → ZZ, 702 → AAA
 */
function colIndexToLetter(idx) {
  var letters = '';
  var n = idx;
  while (true) {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
    if (n < 0) break;
  }
  return letters;
}

/**
 * Detect whether a value is a Date (or date-like string).
 * Returns the Excel serial number if it is, or null if not.
 */
function dateToExcelSerial(val) {
  if (val === null || val === undefined) return null;
  var d;
  if (val instanceof Date) {
    d = val;
  } else if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
    d = new Date(val);
  } else {
    return null;
  }
  if (isNaN(d.getTime())) return null;
  // Excel epoch: 1900-01-01 is serial 1 (with Lotus 1-2-3 leap year bug)
  var epoch = new Date(1899, 11, 30);
  var diff = (d.getTime() - epoch.getTime()) / 86400000;
  return diff;
}

// ─── XLSX XML templates ─────────────────────────────────────────────

function makeContentTypes() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    '</Types>';
}

function makeRootRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
}

function makeWorkbook(sheetName) {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets>' +
    '<sheet name="' + escapeXML(sheetName) + '" sheetId="1" r:id="rId1"/>' +
    '</sheets>' +
    '</workbook>';
}

function makeWorkbookRels() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>' +
    '</Relationships>';
}

function makeStyles() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1">' +
    '<numFmt numFmtId="164" formatCode="yyyy-mm-dd"/>' +
    '</numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="2">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '</fills>' +
    '<borders count="1">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '</styleSheet>';
}

function makeSharedStrings(strings) {
  var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="' + strings.length + '" uniqueCount="' + strings.length + '">';
  for (var i = 0; i < strings.length; i++) {
    xml += '<si><t>' + escapeXML(strings[i]) + '</t></si>';
  }
  xml += '</sst>';
  return xml;
}

function makeSheet(headers, rows, sharedMap) {
  var xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>';

  // Header row (row 1, style 1 = bold)
  xml += '<row r="1">';
  for (var h = 0; h < headers.length; h++) {
    var ref = colIndexToLetter(h) + '1';
    var si = sharedMap[headers[h]];
    xml += '<c r="' + ref + '" t="s" s="1"><v>' + si + '</v></c>';
  }
  xml += '</row>';

  // Data rows (starting at row 2)
  for (var r = 0; r < rows.length; r++) {
    var rowNum = r + 2;
    var row = rows[r];
    xml += '<row r="' + rowNum + '">';
    for (var c = 0; c < headers.length; c++) {
      var cellRef = colIndexToLetter(c) + rowNum;
      var val = c < row.length ? row[c] : null;

      if (val === null || val === undefined || val === '') {
        // Skip empty cells
        continue;
      }

      // Date detection
      var serial = dateToExcelSerial(val);
      if (serial !== null) {
        xml += '<c r="' + cellRef + '" s="2"><v>' + serial + '</v></c>';
        continue;
      }

      // Boolean
      if (typeof val === 'boolean' || val === true || val === false) {
        xml += '<c r="' + cellRef + '" t="b"><v>' + (val ? 1 : 0) + '</v></c>';
        continue;
      }

      // Number
      var num = Number(val);
      if (typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(num) && isFinite(num))) {
        xml += '<c r="' + cellRef + '" t="n"><v>' + num + '</v></c>';
        continue;
      }

      // String — use shared string index
      var strVal = String(val);
      var ssIdx = sharedMap[strVal];
      if (ssIdx === undefined) {
        // Shouldn't happen if we collected strings properly, but handle gracefully
        xml += '<c r="' + cellRef + '" t="inlineStr"><is><t>' + escapeXML(strVal) + '</t></is></c>';
      } else {
        xml += '<c r="' + cellRef + '" t="s"><v>' + ssIdx + '</v></c>';
      }
    }
    xml += '</row>';
  }

  xml += '</sheetData></worksheet>';
  return xml;
}

// ─── Main export function ───────────────────────────────────────────

/**
 * Convert a table to an XLSX file as a Uint8Array.
 *
 * @param {{ headers: string[], rows: any[][] }} table
 * @param {{ sheetName?: string }} [options]
 * @returns {Uint8Array}
 */
function toXLSX(table, options) {
  var opts = options || {};
  var sheetName = opts.sheetName || 'Sheet1';
  var headers = table.headers || [];
  var rows = table.rows || [];

  // Build shared string table — collect all unique strings
  var sharedStrings = [];
  var sharedMap = {};  // string → index

  function addShared(str) {
    if (str === null || str === undefined || str === '') return;
    var s = String(str);
    if (sharedMap[s] === undefined) {
      sharedMap[s] = sharedStrings.length;
      sharedStrings.push(s);
    }
  }

  // Headers are always strings
  for (var hi = 0; hi < headers.length; hi++) {
    addShared(headers[hi]);
  }

  // Scan rows for string values
  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri];
    for (var ci = 0; ci < row.length; ci++) {
      var val = row[ci];
      if (val === null || val === undefined || val === '') continue;
      if (typeof val === 'boolean') continue;
      if (dateToExcelSerial(val) !== null) continue;
      var n = Number(val);
      if (typeof val === 'number' || (typeof val === 'string' && val !== '' && !isNaN(n) && isFinite(n))) continue;
      addShared(val);
    }
  }

  // Generate XML parts
  var contentTypes = makeContentTypes();
  var rootRels = makeRootRels();
  var workbook = makeWorkbook(sheetName);
  var workbookRels = makeWorkbookRels();
  var styles = makeStyles();
  var sharedStringsXml = makeSharedStrings(sharedStrings);
  var sheetXml = makeSheet(headers, rows, sharedMap);

  // Build ZIP
  var files = [
    { name: '[Content_Types].xml', data: encodeUTF8(contentTypes) },
    { name: '_rels/.rels', data: encodeUTF8(rootRels) },
    { name: 'xl/workbook.xml', data: encodeUTF8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeUTF8(workbookRels) },
    { name: 'xl/styles.xml', data: encodeUTF8(styles) },
    { name: 'xl/sharedStrings.xml', data: encodeUTF8(sharedStringsXml) },
    { name: 'xl/worksheets/sheet1.xml', data: encodeUTF8(sheetXml) }
  ];

  return buildZip(files);
}

/**
 * Trigger a browser download of an XLSX file.
 *
 * @param {{ headers: string[], rows: any[][] }} table
 * @param {string} [filename]
 * @param {{ sheetName?: string }} [options]
 */
function downloadXLSX(table, filename, options) {
  var bytes = toXLSX(table, options);
  var blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename || 'export.xlsx';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Module exports (stripped by build.js for browser IIFE) ─────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    toXLSX: toXLSX,
    downloadXLSX: downloadXLSX,
    colIndexToLetter: colIndexToLetter,
    escapeXML: escapeXML,
    crc32: crc32,
    buildZip: buildZip,
    encodeUTF8: encodeUTF8,
    dateToExcelSerial: dateToExcelSerial
  };
}

// --- util/detect-types.js ---

/**
 * Column type detection and profiling utilities.
 * Zero external dependencies.
 */

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,                          // 2024-01-15
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,            // 2024-01-15T10:30:00
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,                  // 1/15/2024 or 01/15/24
  /^\d{1,2}-\w{3}-\d{2,4}$/,                      // 15-Jan-2024
  /^\w{3,9}\s+\d{1,2},?\s+\d{4}$/,                // January 15, 2024
];

const BOOLEAN_VALUES = new Set([
  'true', 'false', 'yes', 'no', '1', '0', 't', 'f', 'y', 'n',
]);

function isNull(v) {
  return v === null || v === undefined || v === '' ||
    (typeof v === 'string' && v.trim().toLowerCase() === 'null');
}

function isNumeric(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed === '') return false;
  return !isNaN(Number(trimmed)) && isFinite(Number(trimmed));
}

function isDate(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed === '') return false;
  if (DATE_PATTERNS.some((p) => p.test(trimmed))) {
    const d = new Date(trimmed);
    return !isNaN(d.getTime());
  }
  return false;
}

function isBoolean(s) {
  if (typeof s !== 'string') return false;
  return BOOLEAN_VALUES.has(s.trim().toLowerCase());
}

/**
 * Detect the most likely column type from an array of string values.
 * @param {Array<string|null|undefined>} values
 * @returns {'number'|'date'|'boolean'|'string'}
 */
function detectColumnType(values) {
  const nonNull = values.filter((v) => !isNull(v));
  if (nonNull.length === 0) return 'string';

  // Check each type — require all non-null values to match
  if (nonNull.every(isNumeric)) return 'number';
  if (nonNull.every(isBoolean)) return 'boolean';
  if (nonNull.every(isDate)) return 'date';
  return 'string';
}

/**
 * Profile a column: type, null count, unique count, min, max, samples.
 * @param {Array<string|null|undefined>} values
 * @returns {{ type: string, nullCount: number, uniqueCount: number, min: *, max: *, samples: Array }}
 */
function profileColumn(values) {
  const type = detectColumnType(values);
  const nullCount = values.filter(isNull).length;
  const nonNull = values.filter((v) => !isNull(v));

  const uniqueSet = new Set(nonNull.map((v) => String(v).trim()));
  const uniqueCount = uniqueSet.size;
  const samples = [...uniqueSet].slice(0, 5);

  let min = undefined;
  let max = undefined;

  if (nonNull.length > 0) {
    if (type === 'number') {
      const nums = nonNull.map((v) => Number(v));
      min = Math.min(...nums);
      max = Math.max(...nums);
    } else if (type === 'date') {
      const dates = nonNull.map((v) => new Date(v.trim()));
      const timestamps = dates.map((d) => d.getTime());
      min = new Date(Math.min(...timestamps)).toISOString();
      max = new Date(Math.max(...timestamps)).toISOString();
    } else {
      const sorted = [...nonNull].map((v) => String(v).trim()).sort();
      min = sorted[0];
      max = sorted[sorted.length - 1];
    }
  }

  return { type, nullCount, uniqueCount, min, max, samples };
}

// --- util/audit-log.js ---

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

// --- ui/panel.js ---

/**
 * WDK floating panel UI.
 * Injects a draggable, resizable panel into any web page.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

var DK_THEME = {
  bg: '#0a0a1a',
  bgLight: '#12122a',
  bgHover: '#1a1a3a',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  text: '#e0e0f0',
  textDim: '#8888aa',
  border: '#2a2a4a',
  shadow: 'rgba(0, 229, 255, 0.15)',
};

function injectStyles() {
  if (document.getElementById('dk-panel-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-panel-styles';
  style.textContent = [
    '.dk-panel {',
    '  position: fixed; top: 60px; right: 20px;',
    '  width: 520px; height: 420px; min-width: 320px; min-height: 220px;',
    '  background: ' + DK_THEME.bg + ';',
    '  border: 1px solid ' + DK_THEME.border + ';',
    '  border-radius: 8px;',
    '  box-shadow: 0 4px 32px ' + DK_THEME.shadow + ', 0 0 1px ' + DK_THEME.cyan + ';',
    '  z-index: 999999;',
    '  display: flex; flex-direction: column;',
    '  font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;',
    '  font-size: 13px; color: ' + DK_THEME.text + ';',
    '  overflow: hidden; user-select: none;',
    '}',
    '.dk-panel.dk-hidden { display: none; }',
    '.dk-titlebar {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 6px 10px; cursor: grab;',
    '  background: linear-gradient(135deg, ' + DK_THEME.bgLight + ', ' + DK_THEME.bg + ');',
    '  border-bottom: 1px solid ' + DK_THEME.border + ';',
    '  flex-shrink: 0;',
    '}',
    '.dk-titlebar:active { cursor: grabbing; }',
    '.dk-title {',
    '  font-weight: 700; font-size: 13px; letter-spacing: 1px;',
    '  background: linear-gradient(90deg, ' + DK_THEME.cyan + ', ' + DK_THEME.purple + ');',
    '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '  background-clip: text;',
    '}',
    '.dk-titlebar-btns { display: flex; gap: 6px; }',
    '.dk-btn {',
    '  width: 22px; height: 22px; border: none; border-radius: 4px;',
    '  background: ' + DK_THEME.bgHover + '; color: ' + DK_THEME.textDim + ';',
    '  cursor: pointer; font-size: 13px; line-height: 22px; text-align: center;',
    '  padding: 0; transition: background 0.15s, color 0.15s;',
    '}',
    '.dk-btn:hover { background: ' + DK_THEME.purple + '; color: #fff; }',
    '.dk-btn-close:hover { background: ' + DK_THEME.pink + '; color: #fff; }',
    '.dk-content {',
    '  flex: 1; overflow-y: auto; overflow-x: hidden; padding: 8px;',
    '  user-select: text;',
    '}',
    '.dk-content::-webkit-scrollbar { width: 6px; }',
    '.dk-content::-webkit-scrollbar-track { background: ' + DK_THEME.bg + '; }',
    '.dk-content::-webkit-scrollbar-thumb { background: ' + DK_THEME.border + '; border-radius: 3px; }',
    '.dk-statusbar {',
    '  padding: 4px 10px; font-size: 11px; color: ' + DK_THEME.textDim + ';',
    '  border-top: 1px solid ' + DK_THEME.border + ';',
    '  background: ' + DK_THEME.bgLight + ';',
    '  flex-shrink: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '}',
    '.dk-resize-handle {',
    '  position: absolute; bottom: 0; right: 0; width: 16px; height: 16px;',
    '  cursor: nwse-resize;',
    '}',
    '.dk-resize-handle::after {',
    '  content: ""; position: absolute; bottom: 3px; right: 3px;',
    '  width: 8px; height: 8px;',
    '  border-right: 2px solid ' + DK_THEME.textDim + ';',
    '  border-bottom: 2px solid ' + DK_THEME.textDim + ';',
    '}',
    '.dk-mini-icon {',
    '  position: fixed; bottom: 16px; right: 16px;',
    '  width: 40px; height: 40px; border-radius: 50%;',
    '  background: linear-gradient(135deg, ' + DK_THEME.purple + ', ' + DK_THEME.cyan + ');',
    '  box-shadow: 0 2px 12px ' + DK_THEME.shadow + ';',
    '  z-index: 999999; cursor: pointer; display: none;',
    '  align-items: center; justify-content: center;',
    '  font-size: 18px; font-weight: 900; color: #fff;',
    '  border: none; line-height: 40px; text-align: center;',
    '}',
    '.dk-mini-icon.dk-visible { display: flex; }',
  ].join('\n');
  document.head.appendChild(style);
}

function createPanel() {
  injectStyles();

  // --- Mini icon (shown when minimized) ---
  var miniIcon = document.createElement('button');
  miniIcon.className = 'dk-mini-icon';
  miniIcon.textContent = 'D';
  miniIcon.title = 'WDK (Ctrl+Shift+D)';

  // --- Main panel ---
  var panel = document.createElement('div');
  panel.className = 'dk-panel';

  // Title bar
  var titlebar = document.createElement('div');
  titlebar.className = 'dk-titlebar';

  var title = document.createElement('span');
  title.className = 'dk-title';
  title.textContent = 'DATAKIT';

  var btns = document.createElement('div');
  btns.className = 'dk-titlebar-btns';

  var minBtn = document.createElement('button');
  minBtn.className = 'dk-btn';
  minBtn.textContent = '\u2013'; // en-dash as minimize
  minBtn.title = 'Minimize';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'dk-btn dk-btn-close';
  closeBtn.textContent = '\u00d7'; // multiplication sign as close
  closeBtn.title = 'Close';

  btns.appendChild(minBtn);
  btns.appendChild(closeBtn);
  titlebar.appendChild(title);
  titlebar.appendChild(btns);

  // Content area
  var contentArea = document.createElement('div');
  contentArea.className = 'dk-content';

  // Status bar
  var statusBar = document.createElement('div');
  statusBar.className = 'dk-statusbar';
  statusBar.textContent = 'Ready';

  // Resize handle
  var resizeHandle = document.createElement('div');
  resizeHandle.className = 'dk-resize-handle';

  panel.appendChild(titlebar);
  panel.appendChild(contentArea);
  panel.appendChild(statusBar);
  panel.appendChild(resizeHandle);

  document.body.appendChild(panel);
  document.body.appendChild(miniIcon);

  // --- Drag logic ---
  var dragState = null;

  titlebar.addEventListener('mousedown', function (e) {
    if (e.target === minBtn || e.target === closeBtn) return;
    e.preventDefault();
    var rect = panel.getBoundingClientRect();
    dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
    panel.style.right = 'auto';
    panel.style.left = rect.left + 'px';
    panel.style.top = rect.top + 'px';
  });

  document.addEventListener('mousemove', function (e) {
    if (dragState) {
      e.preventDefault();
      var dx = e.clientX - dragState.startX;
      var dy = e.clientY - dragState.startY;
      panel.style.left = (dragState.origLeft + dx) + 'px';
      panel.style.top = (dragState.origTop + dy) + 'px';
    }
    if (resizeState) {
      e.preventDefault();
      var w = Math.max(320, resizeState.origW + (e.clientX - resizeState.startX));
      var h = Math.max(220, resizeState.origH + (e.clientY - resizeState.startY));
      panel.style.width = w + 'px';
      panel.style.height = h + 'px';
    }
  });

  document.addEventListener('mouseup', function () {
    dragState = null;
    resizeState = null;
  });

  // --- Resize logic ---
  var resizeState = null;

  resizeHandle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var rect = panel.getBoundingClientRect();
    resizeState = { startX: e.clientX, startY: e.clientY, origW: rect.width, origH: rect.height };
  });

  // --- Minimize / restore ---
  var minimized = false;

  function minimize() {
    minimized = true;
    panel.classList.add('dk-hidden');
    miniIcon.classList.add('dk-visible');
  }

  function restore() {
    minimized = false;
    panel.classList.remove('dk-hidden');
    miniIcon.classList.remove('dk-visible');
  }

  minBtn.addEventListener('click', function () { minimize(); });
  miniIcon.addEventListener('click', function () { restore(); });

  // --- Close ---
  closeBtn.addEventListener('click', function () { hide(); });

  // --- Keyboard shortcut ---
  function onKeydown(e) {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      if (panel.classList.contains('dk-hidden') && !minimized) {
        show();
      } else if (minimized) {
        restore();
      } else {
        hide();
      }
    }
  }
  document.addEventListener('keydown', onKeydown);

  // --- Public API ---
  var visible = true;

  function show() {
    visible = true;
    if (minimized) {
      restore();
    } else {
      panel.classList.remove('dk-hidden');
    }
    miniIcon.classList.remove('dk-visible');
  }

  function hide() {
    visible = false;
    minimized = false;
    panel.classList.add('dk-hidden');
    miniIcon.classList.remove('dk-visible');
  }

  function destroy() {
    document.removeEventListener('keydown', onKeydown);
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    if (miniIcon.parentNode) miniIcon.parentNode.removeChild(miniIcon);
    var styleEl = document.getElementById('dk-panel-styles');
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
  }

  return {
    container: panel,
    contentArea: contentArea,
    statusBar: statusBar,
    show: show,
    hide: hide,
    destroy: destroy,
  };
}

// --- ui/table.js ---

/**
 * WDK table renderer with virtual scrolling.
 * Renders a DataFrame into a sortable, scrollable HTML table.
 * Only renders visible rows + buffer for million-row performance.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

var DK_TABLE_THEME = {
  bg: '#0a0a1a',
  bgAlt: '#0f0f24',
  bgHeader: '#12122a',
  bgHover: '#1a1a3a',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  text: '#e0e0f0',
  textDim: '#8888aa',
  border: '#2a2a4a',
};

var DK_ROW_HEIGHT = 24;
var DK_BUFFER_ROWS = 20;

/**
 * Parse a filter expression and return a predicate function.
 * Supports: >, <, >=, <=, =, != (numeric), ~ (regex), ! (NOT contains),
 * or plain substring (case-insensitive).
 */
function parseFilterExpr(expr) {
  if (!expr || expr === '') return null;

  // Regex match: ~pattern
  if (expr.charAt(0) === '~') {
    var pattern = expr.substring(1);
    try {
      var re = new RegExp(pattern, 'i');
      return function (val) {
        return re.test(val === null || val === undefined ? '' : String(val));
      };
    } catch (e) {
      return null; // invalid regex — treat as no filter
    }
  }

  // NOT contains: !text
  if (expr.charAt(0) === '!' && expr.charAt(1) !== '=') {
    var neg = expr.substring(1).toLowerCase();
    return function (val) {
      var s = val === null || val === undefined ? '' : String(val).toLowerCase();
      return s.indexOf(neg) === -1;
    };
  }

  // Numeric comparisons: >=, <=, !=, >, <, =
  var numMatch = expr.match(/^(>=|<=|!=|>|<|=)\s*(.+)$/);
  if (numMatch) {
    var op = numMatch[1];
    var num = parseFloat(numMatch[2]);
    if (!isNaN(num)) {
      return function (val) {
        var n = parseFloat(val);
        if (isNaN(n)) return false;
        switch (op) {
          case '>': return n > num;
          case '<': return n < num;
          case '>=': return n >= num;
          case '<=': return n <= num;
          case '=': return n === num;
          case '!=': return n !== num;
          default: return true;
        }
      };
    }
  }

  // Default: case-insensitive substring
  var lower = expr.toLowerCase();
  return function (val) {
    var s = val === null || val === undefined ? '' : String(val).toLowerCase();
    return s.indexOf(lower) !== -1;
  };
}

function injectTableStyles() {
  if (document.getElementById('dk-table-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-table-styles';
  style.textContent = [
    '.dk-table-wrap {',
    '  overflow-y: auto; overflow-x: auto; max-height: 100%;',
    '  scrollbar-width: thin; scrollbar-color: ' + DK_TABLE_THEME.border + ' ' + DK_TABLE_THEME.bg + ';',
    '  position: relative;',
    '}',
    '.dk-table-wrap::-webkit-scrollbar { width: 6px; height: 6px; }',
    '.dk-table-wrap::-webkit-scrollbar-track { background: ' + DK_TABLE_THEME.bg + '; }',
    '.dk-table-wrap::-webkit-scrollbar-thumb { background: ' + DK_TABLE_THEME.border + '; border-radius: 3px; }',
    '.dk-table {',
    '  width: 100%; border-collapse: collapse;',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 12px; color: ' + DK_TABLE_THEME.text + ';',
    '}',
    '.dk-table th {',
    '  position: sticky; top: 0; z-index: 2;',
    '  background: ' + DK_TABLE_THEME.bgHeader + ';',
    '  color: ' + DK_TABLE_THEME.cyan + ';',
    '  padding: 5px 8px; text-align: left;',
    '  border-bottom: 2px solid ' + DK_TABLE_THEME.border + ';',
    '  cursor: pointer; white-space: nowrap; user-select: none;',
    '  font-weight: 600; font-size: 11px; letter-spacing: 0.5px;',
    '  text-transform: uppercase;',
    '}',
    '.dk-table th:hover { color: ' + DK_TABLE_THEME.pink + '; }',
    '.dk-table th .dk-sort-arrow { font-size: 10px; margin-left: 4px; opacity: 0.7; }',
    '.dk-table td {',
    '  padding: 3px 8px; height: ' + DK_ROW_HEIGHT + 'px; box-sizing: border-box;',
    '  border-bottom: 1px solid ' + DK_TABLE_THEME.border + ';',
    '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
    '  max-width: 280px;',
    '}',
    '.dk-table tr:nth-child(even) td { background: ' + DK_TABLE_THEME.bgAlt + '; }',
    '.dk-table tr:hover td { background: ' + DK_TABLE_THEME.bgHover + '; }',
    '.dk-table td.dk-row-num {',
    '  color: ' + DK_TABLE_THEME.textDim + '; text-align: right;',
    '  width: 40px; min-width: 40px; padding-right: 10px;',
    '  border-right: 1px solid ' + DK_TABLE_THEME.border + ';',
    '}',
    '.dk-table-empty {',
    '  padding: 24px; text-align: center; color: ' + DK_TABLE_THEME.textDim + ';',
    '  font-style: italic;',
    '}',
    '.dk-vscroll-spacer { display: block; }',
    '.dk-row-count {',
    '  position: absolute; bottom: 4px; right: 12px; font-size: 10px;',
    '  color: ' + DK_TABLE_THEME.textDim + '; pointer-events: none; z-index: 3;',
    '}',
    '.dk-copy-btn {',
    '  position: absolute; top: 4px; right: 12px; z-index: 4;',
    '  background: transparent; color: ' + DK_TABLE_THEME.textDim + ';',
    '  border: 1px solid ' + DK_TABLE_THEME.border + '; border-radius: 2px;',
    '  padding: 2px 8px; font-size: 10px; cursor: pointer;',
    '  font-family: inherit; letter-spacing: 0.5px;',
    '}',
    '.dk-copy-btn:hover { color: ' + DK_TABLE_THEME.cyan + '; border-color: ' + DK_TABLE_THEME.cyan + '; }',
    '.dk-filter-row { background: #0d0d20; }',
    '.dk-filter-row th {',
    '  position: sticky; top: 28px; z-index: 2;',
    '  background: #0d0d20;',
    '  padding: 3px 4px; border-bottom: 1px solid ' + DK_TABLE_THEME.border + ';',
    '  cursor: default; text-transform: none; letter-spacing: 0;',
    '  font-weight: normal;',
    '}',
    '.dk-filter-input {',
    '  width: 100%; box-sizing: border-box;',
    '  background: #12122a; color: #e0e0f0;',
    '  border: 1px solid #2a2a4a; border-radius: 2px;',
    '  padding: 2px 4px; font-size: 11px;',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  outline: none;',
    '}',
    '.dk-filter-input::placeholder { color: #555577; }',
    '.dk-filter-input.dk-filter-active {',
    '  border-color: #00e5ff;',
    '  box-shadow: 0 0 4px rgba(0,229,255,0.3);',
    '}',
    '.dk-clear-filters {',
    '  position: absolute; top: 4px; right: 80px; z-index: 4;',
    '  background: transparent; color: ' + DK_TABLE_THEME.textDim + ';',
    '  border: 1px solid ' + DK_TABLE_THEME.border + '; border-radius: 2px;',
    '  padding: 2px 8px; font-size: 10px; cursor: pointer;',
    '  font-family: inherit; letter-spacing: 0.5px; display: none;',
    '}',
    '.dk-clear-filters:hover { color: ' + DK_TABLE_THEME.pink + '; border-color: ' + DK_TABLE_THEME.pink + '; }',
    '.dk-table td:focus-visible, .dk-table th:focus-visible {',
    '  outline: 2px solid #00e5ff;',
    '  outline-offset: 2px;',
    '}',
    '.dk-cell-null {',
    '  color: #666688; font-style: italic; opacity: 0.7;',
    '}',
    '.dk-row-selected td { background: rgba(0, 229, 255, 0.08) !important; }',
    '.dk-selection-bar {',
    '  font-size: 10px; color: ' + DK_TABLE_THEME.textDim + ';',
    '  padding: 4px 12px; display: none;',
    '}',
    '.dk-selection-bar button {',
    '  background: transparent; color: ' + DK_TABLE_THEME.textDim + ';',
    '  border: 1px solid ' + DK_TABLE_THEME.border + '; border-radius: 2px;',
    '  padding: 1px 6px; font-size: 10px; cursor: pointer;',
    '  font-family: inherit; margin-left: 8px;',
    '}',
    '.dk-selection-bar button:hover { color: ' + DK_TABLE_THEME.pink + '; border-color: ' + DK_TABLE_THEME.pink + '; }',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Render a DataFrame into a virtualized HTML table inside a container element.
 *
 * @param {HTMLElement} container - The element to render into (will be cleared)
 * @param {DataFrame} df - The DataFrame to render
 * @param {Function} [onSort] - Callback: onSort(columnName, ascending)
 * @returns {{ refresh: Function }} - Call refresh(newDataFrame) to re-render
 */
function renderTable(container, df, onSort) {
  injectTableStyles();

  var sortCol = null;
  var sortAsc = true;
  var filterState = {};   // { colName: inputValue }
  var filterInputs = {};  // { colName: HTMLInputElement } — survives re-render
  var selectedRows = new Set();  // indices into filteredRows
  var lastClickedRow = null;     // for shift-range select

  function render(dt) {
    container.innerHTML = '';

    var headers = dt._headers;
    var allRows = dt._rows;

    if (!headers || headers.length === 0) {
      var empty = document.createElement('div');
      empty.className = 'dk-table-empty';
      empty.textContent = 'No data loaded';
      container.appendChild(empty);
      return;
    }

    var totalRowCount = allRows.length;

    // --- Filtering ---
    var filteredRows = allRows;
    var activeFilterCount = 0;

    function applyFilters() {
      filteredRows = allRows;
      activeFilterCount = 0;
      for (var ci = 0; ci < headers.length; ci++) {
        var expr = filterState[headers[ci]];
        if (!expr) continue;
        var pred = parseFilterExpr(expr);
        if (!pred) continue;
        activeFilterCount++;
        var colIdx = ci;
        filteredRows = filteredRows.filter(function (row) {
          return pred(row[colIdx]);
        });
      }
      // Apply sort after filtering
      if (sortCol !== null) {
        var si = headers.indexOf(sortCol);
        if (si >= 0) {
          var asc = sortAsc;
          filteredRows = filteredRows.slice().sort(function (a, b) {
            var va = a[si], vb = b[si];
            if (va == null) va = '';
            if (vb == null) vb = '';
            var na = parseFloat(va), nb = parseFloat(vb);
            var cmp;
            if (!isNaN(na) && !isNaN(nb)) {
              cmp = na - nb;
            } else {
              cmp = String(va).localeCompare(String(vb));
            }
            return asc ? cmp : -cmp;
          });
        }
      }
    }

    applyFilters();

    var wrap = document.createElement('div');
    wrap.className = 'dk-table-wrap';
    wrap.style.maxHeight = '100%';

    var table = document.createElement('table');
    table.className = 'dk-table';
    table.setAttribute('role', 'grid');

    // Header row
    var thead = document.createElement('thead');
    var headRow = document.createElement('tr');
    headRow.setAttribute('role', 'row');

    var thNum = document.createElement('th');
    thNum.textContent = '#';
    thNum.style.cursor = 'default';
    thNum.setAttribute('role', 'columnheader');
    headRow.appendChild(thNum);

    headers.forEach(function (colName, colIdx) {
      var th = document.createElement('th');
      th.setAttribute('role', 'columnheader');
      th.setAttribute('tabindex', '0');
      if (sortCol === colName) {
        th.setAttribute('aria-sort', sortAsc ? 'ascending' : 'descending');
      } else {
        th.setAttribute('aria-sort', 'none');
      }
      var label = document.createTextNode(colName);
      th.appendChild(label);

      // Type badge tooltip
      var colType = 'str';
      if (typeof detectColumnType === 'function') {
        var sampleVals = [];
        for (var si = 0; si < Math.min(allRows.length, 100); si++) {
          sampleVals.push(allRows[si][colIdx]);
        }
        colType = detectColumnType(sampleVals);
      } else {
        var numCount = 0;
        var boolCount = 0;
        var sampleLen = Math.min(allRows.length, 100);
        for (var si = 0; si < sampleLen; si++) {
          var sv = allRows[si][colIdx];
          if (sv === null || sv === undefined || sv === '') continue;
          if (!isNaN(parseFloat(sv)) && isFinite(sv)) numCount++;
          if (sv === true || sv === false || sv === 'true' || sv === 'false') boolCount++;
        }
        if (boolCount > sampleLen * 0.5) colType = 'bool';
        else if (numCount > sampleLen * 0.5) colType = 'num';
      }
      th.title = colName + ' (type: ' + colType + ')';

      if (sortCol === colName) {
        var arrow = document.createElement('span');
        arrow.className = 'dk-sort-arrow';
        arrow.textContent = sortAsc ? '\u25b2' : '\u25bc';
        th.appendChild(arrow);
      }

      function doSort() {
        if (sortCol === colName) {
          if (!sortAsc) {
            // Third click: remove sort
            sortCol = null;
            sortAsc = true;
          } else {
            sortAsc = false;
          }
        } else {
          sortCol = colName;
          sortAsc = true;
        }
        rebuildSorted();
        if (onSort) onSort(sortCol, sortAsc);
      }

      th.addEventListener('click', doSort);
      th.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          doSort();
        }
      });

      headRow.appendChild(th);
    });

    thead.appendChild(headRow);

    // Filter row
    var filterRow = document.createElement('tr');
    filterRow.className = 'dk-filter-row';
    filterRow.setAttribute('role', 'row');

    var filterNumTh = document.createElement('th');
    filterNumTh.style.cursor = 'default';
    filterRow.appendChild(filterNumTh);

    var debounceTimer = null;

    headers.forEach(function (colName) {
      var th = document.createElement('th');
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'dk-filter-input';
      input.placeholder = 'filter...';
      input.setAttribute('aria-label', 'Filter ' + colName);

      // Restore previous filter value
      if (filterState[colName]) {
        input.value = filterState[colName];
        input.classList.add('dk-filter-active');
      }

      filterInputs[colName] = input;

      input.addEventListener('input', function () {
        var val = input.value;
        filterState[colName] = val;

        if (val) {
          input.classList.add('dk-filter-active');
        } else {
          input.classList.remove('dk-filter-active');
        }

        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          rebuildFiltered();
        }, 200);
      });

      // Stop click from propagating to sort handler
      input.addEventListener('click', function (e) { e.stopPropagation(); });

      th.appendChild(input);
      filterRow.appendChild(th);
    });

    thead.appendChild(filterRow);
    table.appendChild(thead);

    // Body — virtual scroll
    var tbody = document.createElement('tbody');
    table.appendChild(tbody);
    wrap.appendChild(table);

    // Top spacer for virtual scroll offset
    var topSpacer = document.createElement('tr');
    var topTd = document.createElement('td');
    topTd.colSpan = headers.length + 1;
    topTd.className = 'dk-vscroll-spacer';
    topTd.style.cssText = 'padding:0;border:none;height:0;';
    topSpacer.appendChild(topTd);

    // Bottom spacer
    var bottomSpacer = document.createElement('tr');
    var bottomTd = document.createElement('td');
    bottomTd.colSpan = headers.length + 1;
    bottomTd.className = 'dk-vscroll-spacer';
    bottomTd.style.cssText = 'padding:0;border:none;height:0;';
    bottomSpacer.appendChild(bottomTd);

    // Row count badge
    var badge = document.createElement('div');
    badge.className = 'dk-row-count';

    function updateBadge() {
      if (activeFilterCount > 0) {
        badge.textContent = 'Showing ' + filteredRows.length.toLocaleString() + ' of ' + totalRowCount.toLocaleString() + ' rows';
      } else {
        badge.textContent = totalRowCount.toLocaleString() + ' rows';
      }
    }

    updateBadge();

    // Clear all filters button
    var clearBtn = document.createElement('button');
    clearBtn.className = 'dk-clear-filters';
    clearBtn.textContent = 'Clear filters';
    clearBtn.style.display = activeFilterCount > 0 ? 'block' : 'none';
    clearBtn.addEventListener('click', function () {
      filterState = {};
      for (var key in filterInputs) {
        if (filterInputs.hasOwnProperty(key)) {
          filterInputs[key].value = '';
          filterInputs[key].classList.remove('dk-filter-active');
        }
      }
      rebuildFiltered();
    });

    var lastStart = -1;
    var lastEnd = -1;

    function renderVisibleRows() {
      var rows = filteredRows;
      var totalRows = rows.length;
      var scrollTop = wrap.scrollTop;
      var viewHeight = wrap.clientHeight;
      var headerHeight = thead.offsetHeight || 30;

      var start = Math.max(0, Math.floor((scrollTop - headerHeight) / DK_ROW_HEIGHT) - DK_BUFFER_ROWS);
      var visibleCount = Math.ceil(viewHeight / DK_ROW_HEIGHT) + DK_BUFFER_ROWS * 2;
      var end = Math.min(totalRows, start + visibleCount);

      if (start === lastStart && end === lastEnd) return;
      lastStart = start;
      lastEnd = end;

      // Update spacers
      topTd.style.height = (start * DK_ROW_HEIGHT) + 'px';
      bottomTd.style.height = ((totalRows - end) * DK_ROW_HEIGHT) + 'px';

      // Clear and rebuild visible rows
      tbody.innerHTML = '';
      tbody.appendChild(topSpacer);

      for (var i = start; i < end; i++) {
        var row = rows[i];
        var tr = document.createElement('tr');
        tr.setAttribute('role', 'row');

        var tdNum = document.createElement('td');
        tdNum.className = 'dk-row-num';
        tdNum.setAttribute('role', 'gridcell');
        tdNum.textContent = String(i + 1);
        tr.appendChild(tdNum);

        for (var c = 0; c < headers.length; c++) {
          var td = document.createElement('td');
          td.setAttribute('role', 'gridcell');
          td.setAttribute('tabindex', '-1');
          var val = row[c];
          if (val === null || val === undefined) {
            td.textContent = 'null';
            td.className = 'dk-cell-null';
            td.title = 'null';
          } else {
            td.textContent = String(val);
            td.title = td.textContent;
          }
          tr.appendChild(td);
        }

        if (selectedRows.has(i)) {
          tr.classList.add('dk-row-selected');
        }

        (function (rowIdx) {
          tr.addEventListener('click', function (ev) {
            if (ev.shiftKey && lastClickedRow !== null) {
              var lo = Math.min(lastClickedRow, rowIdx);
              var hi = Math.max(lastClickedRow, rowIdx);
              for (var ri = lo; ri <= hi; ri++) {
                selectedRows.add(ri);
              }
            } else {
              if (selectedRows.has(rowIdx)) {
                selectedRows.delete(rowIdx);
              } else {
                selectedRows.add(rowIdx);
              }
            }
            lastClickedRow = rowIdx;
            lastStart = -1;
            lastEnd = -1;
            renderVisibleRows();
            updateSelectionBar();
          });
        })(i);

        tbody.appendChild(tr);
      }

      tbody.appendChild(bottomSpacer);
    }

    function rebuildFiltered() {
      applyFilters();
      updateBadge();
      clearBtn.style.display = activeFilterCount > 0 ? 'block' : 'none';
      lastStart = -1;
      lastEnd = -1;
      renderVisibleRows();
    }

    function rebuildSorted() {
      applyFilters();
      updateBadge();
      lastStart = -1;
      lastEnd = -1;
      // Re-render headers to update sort arrow
      render(dt);
    }

    // Copy to clipboard button (TSV for Excel paste)
    var copyBtn = document.createElement('button');
    copyBtn.className = 'dk-copy-btn';
    copyBtn.textContent = 'Copy TSV';
    copyBtn.title = 'Copy table as tab-separated values (paste into Excel)';
    copyBtn.addEventListener('click', function () {
      var rows = filteredRows;
      var lines = [headers.join('\t')];
      for (var r = 0; r < rows.length; r++) {
        lines.push(rows[r].map(function (v) { return v == null ? '' : String(v); }).join('\t'));
      }
      var tsv = lines.join('\n');
      if (typeof copyToClipboard === 'function') {
        copyToClipboard(tsv).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy TSV'; }, 1500);
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(function () {
          copyBtn.textContent = 'Copied!';
          setTimeout(function () { copyBtn.textContent = 'Copy TSV'; }, 1500);
        });
      }
    });

    // Keyboard navigation: arrow keys move between cells
    table.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var cell = document.activeElement;
      if (!cell || (cell.tagName !== 'TD' && cell.tagName !== 'TH')) return;
      var tr = cell.parentElement;
      if (!tr) return;
      var cellIdx = Array.prototype.indexOf.call(tr.children, cell);
      e.preventDefault();
      if (e.key === 'ArrowLeft' && cellIdx > 0) {
        var prev = tr.children[cellIdx - 1];
        if (prev) { prev.setAttribute('tabindex', '0'); prev.focus(); cell.setAttribute('tabindex', '-1'); }
      } else if (e.key === 'ArrowRight' && cellIdx < tr.children.length - 1) {
        var next = tr.children[cellIdx + 1];
        if (next) { next.setAttribute('tabindex', '0'); next.focus(); cell.setAttribute('tabindex', '-1'); }
      } else if (e.key === 'ArrowUp') {
        var prevRow = tr.previousElementSibling;
        if (prevRow && prevRow.children[cellIdx]) { prevRow.children[cellIdx].setAttribute('tabindex', '0'); prevRow.children[cellIdx].focus(); cell.setAttribute('tabindex', '-1'); }
      } else if (e.key === 'ArrowDown') {
        var nextRow = tr.nextElementSibling;
        if (nextRow && nextRow.children[cellIdx]) { nextRow.children[cellIdx].setAttribute('tabindex', '0'); nextRow.children[cellIdx].focus(); cell.setAttribute('tabindex', '-1'); }
      }
    });

    // Selection summary bar
    var selectionBar = document.createElement('div');
    selectionBar.className = 'dk-selection-bar';

    function updateSelectionBar() {
      if (selectedRows.size === 0) {
        selectionBar.style.display = 'none';
        return;
      }
      selectionBar.style.display = 'block';
      var parts = [];
      parts.push(selectedRows.size + ' rows selected');

      // Compute SUM/AVG for numeric columns
      for (var ci = 0; ci < headers.length; ci++) {
        var sum = 0;
        var count = 0;
        var isNumeric = true;
        var iter = selectedRows.values();
        var next = iter.next();
        while (!next.done) {
          var rv = filteredRows[next.value];
          if (rv) {
            var nv = parseFloat(rv[ci]);
            if (isNaN(nv)) { isNumeric = false; break; }
            sum += nv;
            count++;
          }
          next = iter.next();
        }
        if (isNumeric && count > 0) {
          var avg = sum / count;
          parts.push(headers[ci] + ': SUM=' + sum.toLocaleString(undefined, { maximumFractionDigits: 4 }) + ' AVG=' + avg.toLocaleString(undefined, { maximumFractionDigits: 4 }));
        }
      }

      selectionBar.innerHTML = '';
      var textSpan = document.createElement('span');
      textSpan.textContent = parts.join(' | ');
      selectionBar.appendChild(textSpan);

      var clearSelBtn = document.createElement('button');
      clearSelBtn.textContent = 'Clear selection';
      clearSelBtn.addEventListener('click', function () {
        selectedRows.clear();
        lastClickedRow = null;
        lastStart = -1;
        lastEnd = -1;
        renderVisibleRows();
        updateSelectionBar();
      });
      selectionBar.appendChild(clearSelBtn);
    }

    container.appendChild(wrap);
    container.style.position = 'relative';
    container.appendChild(selectionBar);
    container.appendChild(badge);
    container.appendChild(clearBtn);
    container.appendChild(copyBtn);

    // Initial render
    renderVisibleRows();

    // Scroll handler with rAF throttle
    var ticking = false;
    wrap.addEventListener('scroll', function () {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(function () {
          renderVisibleRows();
          ticking = false;
        });
      }
    });
  }

  render(df);

  return {
    refresh: function (newDataFrame) {
      render(newDataFrame);
    },
    getFilterState: function () {
      return JSON.parse(JSON.stringify(filterState));
    },
  };
}

// --- ui/file-import.js ---

/**
 * WDK file import UI.
 * Drag-and-drop zone + file input for .csv, .json, .tsv files.
 * Parses files and returns DataFrame via callback.
 * Zero external dependencies.
 */

/* global parseCSV, parseJSON, parseXLSX, DataFrame */

var DK_IMPORT_THEME = {
  bg: '#0a0a1a',
  bgHover: '#12122a',
  bgActive: '#0d1a2a',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  text: '#e0e0f0',
  textDim: '#8888aa',
  border: '#2a2a4a',
  borderActive: '#00e5ff',
};

function injectImportStyles() {
  if (document.getElementById('dk-import-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-import-styles';
  style.textContent = [
    '.dk-import-zone {',
    '  border: 2px dashed ' + DK_IMPORT_THEME.border + ';',
    '  border-radius: 8px; padding: 24px 16px;',
    '  text-align: center; cursor: pointer;',
    '  transition: border-color 0.2s, background 0.2s;',
    '  background: ' + DK_IMPORT_THEME.bg + ';',
    '}',
    '.dk-import-zone.dk-dragover {',
    '  border-color: ' + DK_IMPORT_THEME.borderActive + ';',
    '  background: ' + DK_IMPORT_THEME.bgActive + ';',
    '  box-shadow: inset 0 0 20px rgba(0, 229, 255, 0.08);',
    '}',
    '.dk-import-icon {',
    '  font-size: 28px; margin-bottom: 8px;',
    '  color: ' + DK_IMPORT_THEME.purple + ';',
    '}',
    '.dk-import-label {',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 13px; color: ' + DK_IMPORT_THEME.text + ';',
    '  margin-bottom: 4px;',
    '}',
    '.dk-import-hint {',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 11px; color: ' + DK_IMPORT_THEME.textDim + ';',
    '}',
    '.dk-import-input { display: none; }',
    '.dk-import-btn {',
    '  display: inline-block; margin-top: 10px; padding: 5px 14px;',
    '  background: ' + DK_IMPORT_THEME.bgHover + ';',
    '  border: 1px solid ' + DK_IMPORT_THEME.border + ';',
    '  border-radius: 4px; color: ' + DK_IMPORT_THEME.cyan + ';',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 12px; cursor: pointer;',
    '  transition: background 0.15s, border-color 0.15s;',
    '}',
    '.dk-import-btn:hover {',
    '  background: ' + DK_IMPORT_THEME.border + ';',
    '  border-color: ' + DK_IMPORT_THEME.cyan + ';',
    '}',
    '.dk-import-error {',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 11px; color: ' + DK_IMPORT_THEME.pink + ';',
    '  margin-top: 8px; word-break: break-word;',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Detect file type from extension.
 * @param {string} filename
 * @returns {'csv'|'tsv'|'json'|null}
 */
function detectFileType(filename) {
  var ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv') return 'tsv';
  if (ext === 'json') return 'json';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

/**
 * Parse file text into a DataFrame.
 * @param {string} text - File content
 * @param {string} type - 'csv', 'tsv', or 'json'
 * @returns {DataFrame}
 */
function parseFileText(text, type) {
  if (type === 'csv' || type === 'tsv') {
    var delimiter = type === 'tsv' ? '\t' : ',';
    var result = parseCSV(text, { delimiter: delimiter, hasHeader: true });
    return new DataFrame(result.headers, result.rows);
  }

  if (type === 'json') {
    var parsed = parseJSON(text);
    if (parsed.tabular) {
      return new DataFrame(parsed.tabular.headers, parsed.tabular.rows);
    }
    // Non-tabular JSON: show as single-column table
    var data = parsed.data;
    if (Array.isArray(data)) {
      return new DataFrame(['value'], data.map(function (v) { return [JSON.stringify(v)]; }));
    }
    // Single object: key-value table
    if (typeof data === 'object' && data !== null) {
      var keys = Object.keys(data);
      return new DataFrame(['key', 'value'], keys.map(function (k) {
        return [k, JSON.stringify(data[k])];
      }));
    }
    return new DataFrame(['value'], [[JSON.stringify(data)]]);
  }

  throw new Error('Unsupported file type: ' + type);
}

/**
 * Create a file import zone with drag-and-drop + file input.
 *
 * @param {HTMLElement} container - The element to render into
 * @param {Function} onData - Callback: onData(dataTable, filename)
 * @returns {{ destroy: Function }}
 */
function createFileImport(container, onData) {
  injectImportStyles();

  var zone = document.createElement('div');
  zone.className = 'dk-import-zone';
  zone.setAttribute('role', 'button');
  zone.setAttribute('tabindex', '0');
  zone.setAttribute('aria-label', 'Drop files here or click to browse');

  var icon = document.createElement('div');
  icon.className = 'dk-import-icon';
  icon.textContent = '\u2913'; // downwards arrow to bar

  var label = document.createElement('div');
  label.className = 'dk-import-label';
  label.textContent = 'Drop a file here';

  var hint = document.createElement('div');
  hint.className = 'dk-import-hint';
  hint.textContent = '.csv \u00b7 .tsv \u00b7 .json \u00b7 .xlsx';

  var btn = document.createElement('button');
  btn.className = 'dk-import-btn';
  btn.textContent = 'Browse files';

  var fileInput = document.createElement('input');
  fileInput.className = 'dk-import-input';
  fileInput.type = 'file';
  fileInput.accept = '.csv,.tsv,.json,.xlsx';

  var errorDiv = document.createElement('div');
  errorDiv.className = 'dk-import-error';
  errorDiv.style.display = 'none';

  zone.appendChild(icon);
  zone.appendChild(label);
  zone.appendChild(hint);
  zone.appendChild(btn);
  zone.appendChild(fileInput);
  zone.appendChild(errorDiv);
  container.appendChild(zone);

  function showError(msg) {
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
  }

  function clearError() {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }

  function handleFile(file) {
    clearError();
    var type = detectFileType(file.name);
    if (!type) {
      showError('Unsupported file type. Use .csv, .tsv, .json, or .xlsx');
      return;
    }

    if (type === 'xlsx') {
      var binReader = new FileReader();
      binReader.onload = function () {
        if (typeof parseXLSX !== 'function') {
          showError('XLSX parser not available in this build');
          return;
        }
        parseXLSX(binReader.result).then(function (result) {
          var dt = new DataFrame(result.headers, result.rows);
          dt._xlsxSheets = result.sheets;
          dt._xlsxBuffer = binReader.result;
          onData(dt, file.name);
        }).catch(function (err) {
          showError('XLSX parse error: ' + err.message);
        });
      };
      binReader.onerror = function () {
        showError('Failed to read file: ' + file.name);
      };
      binReader.readAsArrayBuffer(file);
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var dt = parseFileText(reader.result, type);
        onData(dt, file.name);
      } catch (err) {
        showError('Parse error: ' + err.message);
      }
    };
    reader.onerror = function () {
      showError('Failed to read file: ' + file.name);
    };
    reader.readAsText(file);
  }

  // Drag events
  var dragCounter = 0;

  zone.addEventListener('dragenter', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    zone.classList.add('dk-dragover');
  });

  zone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      zone.classList.remove('dk-dragover');
    }
  });

  zone.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    zone.classList.remove('dk-dragover');
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  });

  // Click to browse
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    fileInput.click();
  });

  zone.addEventListener('click', function () {
    fileInput.click();
  });

  zone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
      fileInput.value = ''; // reset so same file can be re-imported
    }
  });

  return {
    destroy: function () {
      if (zone.parentNode) zone.parentNode.removeChild(zone);
      var styleEl = document.getElementById('dk-import-styles');
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    },
  };
}

// --- ui/repl.js ---

/**
 * WDK REPL / Script Panel — Chrome DevTools-style console
 * Interactive scripting against loaded data.
 * - Enter to execute, Shift+Enter for multiline
 * - Expandable/collapsible JSON tree for objects
 * - Scrollable output history
 * - Command history (up/down arrows)
 * Export: createREPL(container, getContext)
 *   getContext() => { data: object[], rows: any[][], headers: string[], meta: { rowCount, columnCount } }
 */

function createREPL(container, getContext) {
  var THEME = {
    bg: '#0a0a1a',
    inputBg: '#121228',
    border: '#2a2a4e',
    text: '#e0e0ff',
    textDim: '#8888aa',
    cyan: '#00e5ff',
    green: '#80d080',
    yellow: '#d0a040',
    red: '#e04040',
    purple: '#b967ff',
    blue: '#7090d0',
    pink: '#ff2975',
    key: '#b967ff',
    string: '#80d080',
    number: '#00e5ff',
    bool: '#ff2975',
    null_: '#8888aa',
  };

  // --- Build DOM ---
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:13px;';

  // Output area (scrollable history)
  var output = document.createElement('div');
  output.setAttribute('role', 'log');
  output.setAttribute('aria-live', 'polite');
  output.setAttribute('aria-label', 'REPL output');
  output.style.cssText = 'flex:1;overflow:auto;padding:8px;margin:0;background:' + THEME.bg + ';color:' + THEME.text + ';scrollbar-width:thin;scrollbar-color:' + THEME.border + ' ' + THEME.bg + ';';

  // Input area
  var inputRow = document.createElement('div');
  inputRow.style.cssText = 'display:flex;align-items:flex-start;border-top:1px solid ' + THEME.border + ';background:' + THEME.inputBg + ';flex-shrink:0;';

  var prompt = document.createElement('span');
  prompt.textContent = '\u276f ';
  prompt.style.cssText = 'color:' + THEME.cyan + ';padding:8px 0 8px 8px;user-select:none;line-height:20px;';

  var textarea = document.createElement('textarea');
  textarea.rows = 1;
  textarea.style.cssText = 'flex:1;background:transparent;color:' + THEME.text + ';border:none;outline:none;padding:8px 8px 8px 2px;font-family:inherit;font-size:inherit;resize:none;line-height:20px;overflow:hidden;';
  textarea.placeholder = 'Type expression... (Enter to run, Shift+Enter for newline)';
  textarea.spellcheck = false;
  textarea.setAttribute('role', 'textbox');
  textarea.setAttribute('aria-label', 'REPL input');
  textarea.setAttribute('aria-multiline', 'true');

  inputRow.appendChild(prompt);
  inputRow.appendChild(textarea);
  wrapper.appendChild(output);
  wrapper.appendChild(inputRow);
  container.appendChild(wrapper);

  // --- Command history ---
  var history = [];
  var historyIdx = -1;
  var pendingInput = '';

  // --- Auto-resize textarea ---
  function autoResize() {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }
  textarea.addEventListener('input', autoResize);

  // --- Expandable JSON tree ---

  function createTreeNode(value, key, depth, isLast) {
    depth = depth || 0;
    var maxDepth = 4;
    var el = document.createElement('div');
    el.style.cssText = 'padding-left:' + (depth * 16) + 'px;line-height:20px;white-space:pre;';

    if (value === null) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan('null', THEME.null_);
      return el;
    }

    if (value === undefined) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan('undefined', THEME.null_);
      return el;
    }

    var type = typeof value;

    if (type === 'string') {
      var display = JSON.stringify(value);
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(display, THEME.string);
      return el;
    }

    if (type === 'number') {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(String(value), THEME.number);
      return el;
    }

    if (type === 'boolean') {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(String(value), THEME.bool);
      return el;
    }

    if (type === 'function') {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan('f ' + (value.name || 'anonymous') + '()', THEME.blue);
      return el;
    }

    // Object or Array
    var isArray = Array.isArray(value);
    var keys;
    try { keys = Object.keys(value); } catch (_) { keys = []; }
    var preview = isArray
      ? 'Array(' + value.length + ')'
      : (value.constructor && value.constructor.name !== 'Object' ? value.constructor.name + ' ' : '') + '{' + keys.slice(0, 3).join(', ') + (keys.length > 3 ? ', \u2026' : '') + '}';

    if (depth >= maxDepth || keys.length === 0) {
      el.innerHTML = (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '') + colorSpan(preview, THEME.textDim);
      return el;
    }

    // Collapsible
    var toggle = document.createElement('span');
    toggle.style.cssText = 'cursor:pointer;user-select:none;';
    toggle.innerHTML = '<span style="color:' + THEME.textDim + ';font-size:10px;">\u25b6</span> '
      + (key !== undefined ? colorSpan(JSON.stringify(key), THEME.key) + ': ' : '')
      + colorSpan(preview, THEME.textDim);

    var childContainer = document.createElement('div');
    childContainer.style.display = 'none';
    var expanded = false;
    var childrenRendered = false;

    toggle.addEventListener('click', function () {
      expanded = !expanded;
      if (!childrenRendered) {
        childrenRendered = true;
        var entries = isArray ? value : keys;
        var limit = Math.min(isArray ? value.length : keys.length, 100);
        for (var i = 0; i < limit; i++) {
          var k = isArray ? i : keys[i];
          var v = value[k];
          childContainer.appendChild(createTreeNode(v, k, depth + 1, i === limit - 1));
        }
        if ((isArray ? value.length : keys.length) > limit) {
          var more = document.createElement('div');
          more.style.cssText = 'padding-left:' + ((depth + 1) * 16) + 'px;color:' + THEME.textDim + ';';
          more.textContent = '\u2026 ' + ((isArray ? value.length : keys.length) - limit) + ' more';
          childContainer.appendChild(more);
        }
      }
      childContainer.style.display = expanded ? 'block' : 'none';
      toggle.querySelector('span').textContent = expanded ? '\u25bc' : '\u25b6';
    });

    el.appendChild(toggle);
    el.appendChild(childContainer);
    return el;
  }

  function colorSpan(text, color) {
    return '<span style="color:' + color + ';">' + escapeHtml(text) + '</span>';
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // --- Output helpers ---

  function appendEntry(el) {
    output.appendChild(el);
    output.scrollTop = output.scrollHeight;
  }

  function appendInput(code) {
    var row = document.createElement('div');
    row.style.cssText = 'color:' + THEME.textDim + ';margin:4px 0 2px;';
    row.innerHTML = '<span style="color:' + THEME.cyan + ';">\u276f</span> ' + escapeHtml(code);
    appendEntry(row);
  }

  function appendText(text, color) {
    var el = document.createElement('div');
    el.style.cssText = 'color:' + (color || THEME.text) + ';line-height:20px;white-space:pre-wrap;word-wrap:break-word;margin:0 0 2px;';
    el.textContent = text;
    appendEntry(el);
  }

  function appendResult(value) {
    if (value === undefined) {
      appendText('undefined', THEME.null_);
      return;
    }
    if (value === null || typeof value !== 'object') {
      var node = createTreeNode(value);
      node.style.margin = '0 0 2px';
      appendEntry(node);
      return;
    }
    // Object/array — render expandable tree
    var node = createTreeNode(value);
    node.style.margin = '0 0 2px';
    appendEntry(node);
  }

  // --- Export helpers ---

  var lastResult = undefined;

  function showExportBar(value) {
    // Remove previous export bar if any
    var prev = output.querySelector('.dk-repl-export-bar');
    if (prev) prev.parentNode.removeChild(prev);

    if (value === null || value === undefined || typeof value !== 'object') return;

    var bar = document.createElement('div');
    bar.className = 'dk-repl-export-bar';
    bar.style.cssText = 'display:flex;gap:6px;margin:4px 0 6px;';

    function makeBtn(label, onClick) {
      var btn = document.createElement('button');
      btn.textContent = label;
      btn.style.cssText = 'background:transparent;color:' + THEME.cyan + ';border:1px solid ' + THEME.border + ';padding:2px 8px;cursor:pointer;font-family:inherit;font-size:10px;border-radius:2px;';
      btn.addEventListener('click', onClick);
      return btn;
    }

    bar.appendChild(makeBtn('Copy JSON', function () {
      var text = JSON.stringify(value, null, 2);
      copyToClipboard(text);
      this.textContent = 'Copied!';
      var self = this;
      setTimeout(function () { self.textContent = 'Copy JSON'; }, 1500);
    }));

    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object' && value[0] !== null) {
      bar.appendChild(makeBtn('Copy CSV', function () {
        var keys = Object.keys(value[0]);
        var lines = [keys.join(',')];
        for (var i = 0; i < value.length; i++) {
          var row = keys.map(function (k) {
            var v = value[i][k];
            if (v === null || v === undefined) return '';
            var s = String(v);
            if (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0) {
              return '"' + s.replace(/"/g, '""') + '"';
            }
            return s;
          });
          lines.push(row.join(','));
        }
        copyToClipboard(lines.join('\n'));
        this.textContent = 'Copied!';
        var self = this;
        setTimeout(function () { self.textContent = 'Copy CSV'; }, 1500);
      }));
    }

    appendEntry(bar);
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
  }

  // --- Console intercept ---

  function makeInterceptedConsole() {
    var original = {
      log: console.log.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      info: console.info.bind(console)
    };

    var colors = {
      log: THEME.text,
      info: THEME.blue,
      warn: THEME.yellow,
      error: THEME.red
    };

    var prefixes = {
      log: '',
      info: '\u2139 ',
      warn: '\u26a0 ',
      error: '\u2716 '
    };

    var intercepted = {};
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      intercepted[level] = function () {
        var args = Array.prototype.slice.call(arguments);
        // For single object args, render as tree
        if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null) {
          var label = document.createElement('div');
          label.style.cssText = 'color:' + colors[level] + ';line-height:20px;';
          if (prefixes[level]) label.textContent = prefixes[level];
          appendEntry(label);
          appendResult(args[0]);
        } else {
          var msg = prefixes[level] + args.map(function (a) {
            if (typeof a === 'object') {
              try { return JSON.stringify(a); } catch (_) { return String(a); }
            }
            return String(a);
          }).join(' ');
          appendText(msg, colors[level]);
        }
        original[level].apply(console, args);
      };
    });

    return { intercepted: intercepted, original: original };
  }

  // --- Script execution ---

  function runScript(code) {
    if (!code.trim()) return;

    appendInput(code);

    var ctx = getContext();
    var consoles = makeInterceptedConsole();

    // Temporarily replace console methods
    var savedConsole = {};
    ['log', 'info', 'warn', 'error'].forEach(function (level) {
      savedConsole[level] = console[level];
      console[level] = consoles.intercepted[level];
    });

    try {
      // Try auto-return: wrap as expression so bare values like `data.length` return a result
      var fn;
      try {
        fn = new Function('data', 'df', 'rows', 'headers', 'meta', 'window', 'return (' + code + ')');
      } catch (_) {
        // If that fails (e.g. multi-statement code), use the raw code
        fn = new Function('data', 'df', 'rows', 'headers', 'meta', 'window', code);
      }
      var result = fn(ctx.data, ctx.data, ctx.rows, ctx.headers, ctx.meta, window);

      if (result !== undefined) {
        appendResult(result);
        lastResult = result;
        showExportBar(result);
      }
    } catch (err) {
      appendText(err.message, THEME.red);
    } finally {
      ['log', 'info', 'warn', 'error'].forEach(function (level) {
        console[level] = savedConsole[level];
      });
    }
  }

  // --- Input handling ---

  textarea.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      var start = textarea.selectionStart;
      var end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + '  ' + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      autoResize();
      return;
    }

    // Enter (no shift) = execute
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      var code = textarea.value;
      if (!code.trim()) return;
      history.push(code);
      historyIdx = history.length;
      pendingInput = '';
      textarea.value = '';
      autoResize();
      runScript(code);
      return;
    }

    // Up arrow at start = history back
    if (e.key === 'ArrowUp' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
      e.preventDefault();
      if (historyIdx === history.length) {
        pendingInput = textarea.value;
      }
      if (historyIdx > 0) {
        historyIdx--;
        textarea.value = history[historyIdx];
        autoResize();
      }
      return;
    }

    // Down arrow at end = history forward
    if (e.key === 'ArrowDown' && textarea.selectionStart === textarea.value.length) {
      e.preventDefault();
      if (historyIdx < history.length) {
        historyIdx++;
        textarea.value = historyIdx === history.length ? pendingInput : history[historyIdx];
        autoResize();
      }
      return;
    }

    // Ctrl/Cmd+L = clear output
    if ((e.ctrlKey || e.metaKey) && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault();
      output.innerHTML = '';
      return;
    }
  });

  // --- Public API ---

  return {
    run: function () { runScript(textarea.value); },
    getTextarea: function () { return textarea; },
    getOutput: function () { return output; },
    clear: function () { output.innerHTML = ''; },
    setScript: function (code) { textarea.value = code; autoResize(); }
  };
}

// --- ui/pivot-panel.js ---

/**
 * WDK Pivot Table Panel.
 * Provides a UI for groupBy, aggregate, and pivot operations.
 * Renders config controls and result table inline.
 */

/* global aggregate, pivot, renderTable, DataFrame */

var DK_PIVOT_THEME = {
  bg: '#0d0d22',
  border: '#2a2a4e',
  cyan: '#00e5ff',
  pink: '#ff2975',
  text: '#e0e0f0',
  textDim: '#8888aa',
  inputBg: '#121228',
};

function createPivotPanel(container, getDataFrame) {
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;color:' + DK_PIVOT_THEME.text + ';';

  // Config area
  var config = document.createElement('div');
  config.style.cssText = 'padding:8px;background:' + DK_PIVOT_THEME.bg + ';border-bottom:1px solid ' + DK_PIVOT_THEME.border + ';display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;';

  // Mode selector
  var modeLabel = _label('Mode');
  var modeSelect = _select(['aggregate', 'pivot']);
  modeLabel.appendChild(modeSelect);

  // Group by
  var groupLabel = _label('Group by');
  var groupSelect = _multiSelect();
  groupLabel.appendChild(groupSelect);

  // Agg column
  var aggColLabel = _label('Value column');
  var aggColSelect = _select([]);
  aggColLabel.appendChild(aggColSelect);

  // Agg function
  var aggFuncLabel = _label('Function');
  var aggFuncSelect = _select(['sum', 'count', 'avg', 'min', 'max', 'distinct', 'first', 'last', 'concat']);
  aggFuncLabel.appendChild(aggFuncSelect);

  // Pivot column (only visible in pivot mode)
  var pivotColLabel = _label('Pivot column');
  var pivotColSelect = _select([]);
  pivotColLabel.appendChild(pivotColSelect);

  // Run button
  var runBtn = document.createElement('button');
  runBtn.textContent = 'Run';
  runBtn.style.cssText = 'background:' + DK_PIVOT_THEME.cyan + ';color:#000;border:none;padding:4px 16px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:bold;border-radius:2px;height:24px;';

  config.appendChild(modeLabel);
  config.appendChild(groupLabel);
  config.appendChild(aggColLabel);
  config.appendChild(aggFuncLabel);
  config.appendChild(pivotColLabel);
  config.appendChild(runBtn);

  // Result area
  var resultArea = document.createElement('div');
  resultArea.style.cssText = 'flex:1;overflow:auto;';

  // Status
  var status = document.createElement('div');
  status.style.cssText = 'padding:4px 8px;font-size:10px;color:' + DK_PIVOT_THEME.textDim + ';';

  wrapper.appendChild(config);
  wrapper.appendChild(resultArea);
  wrapper.appendChild(status);
  container.appendChild(wrapper);

  // Toggle pivot column visibility
  function updateMode() {
    pivotColLabel.style.display = modeSelect.value === 'pivot' ? '' : 'none';
  }
  modeSelect.addEventListener('change', updateMode);
  updateMode();

  // Populate columns from current DataFrame
  function refreshColumns() {
    var df = getDataFrame();
    if (!df) return;
    var headers = df._headers || [];

    // Update group by (multi-select)
    groupSelect.innerHTML = '';
    headers.forEach(function (h) {
      var opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      groupSelect.appendChild(opt);
    });

    // Update value column
    _updateSelect(aggColSelect, headers);
    // Update pivot column
    _updateSelect(pivotColSelect, headers);
  }

  // Run aggregation/pivot
  runBtn.addEventListener('click', function () {
    var df = getDataFrame();
    if (!df || !df._rows.length) {
      status.textContent = 'No data loaded';
      return;
    }

    var selectedGroups = _getSelectedValues(groupSelect);
    if (selectedGroups.length === 0) {
      status.textContent = 'Select at least one group-by column';
      return;
    }

    var mode = modeSelect.value;
    var aggCol = aggColSelect.value;
    var aggFunc = aggFuncSelect.value;

    try {
      var result;
      var t0 = performance.now();

      if (mode === 'aggregate') {
        result = aggregate(df, selectedGroups, [{ column: aggCol, func: aggFunc }]);
      } else {
        var pivotCol = pivotColSelect.value;
        if (!pivotCol) { status.textContent = 'Select a pivot column'; return; }
        result = pivot(df, selectedGroups, pivotCol, aggCol, aggFunc);
      }

      var elapsed = (performance.now() - t0).toFixed(1);

      // Render result as a new table
      resultArea.innerHTML = '';
      var resultDf = { _headers: result.headers, _rows: result.rows };
      if (typeof renderTable === 'function') {
        renderTable(resultArea, resultDf);
      }

      status.textContent = result.rows.length + ' groups \u00b7 ' + elapsed + 'ms';
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
    }
  });

  // Helper: create label
  function _label(text) {
    var el = document.createElement('label');
    el.style.cssText = 'display:flex;flex-direction:column;gap:2px;font-size:10px;color:' + DK_PIVOT_THEME.textDim + ';text-transform:uppercase;letter-spacing:0.5px;';
    var span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    return el;
  }

  // Helper: create select
  function _select(options) {
    var sel = document.createElement('select');
    sel.style.cssText = 'background:' + DK_PIVOT_THEME.inputBg + ';color:' + DK_PIVOT_THEME.text + ';border:1px solid ' + DK_PIVOT_THEME.border + ';padding:2px 4px;font-family:inherit;font-size:12px;min-width:80px;';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    });
    return sel;
  }

  // Helper: create multi-select
  function _multiSelect() {
    var sel = document.createElement('select');
    sel.multiple = true;
    sel.size = 3;
    sel.style.cssText = 'background:' + DK_PIVOT_THEME.inputBg + ';color:' + DK_PIVOT_THEME.text + ';border:1px solid ' + DK_PIVOT_THEME.border + ';padding:2px 4px;font-family:inherit;font-size:12px;min-width:100px;max-height:60px;';
    return sel;
  }

  function _updateSelect(sel, options) {
    sel.innerHTML = '';
    options.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      sel.appendChild(opt);
    });
  }

  function _getSelectedValues(sel) {
    var vals = [];
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].selected) vals.push(sel.options[i].value);
    }
    return vals;
  }

  return {
    refresh: refreshColumns,
  };
}

// --- ui/notebook.js ---

/**
 * WDK Notebook — code+output cells supporting JS, SQL, and Markdown.
 * Each cell can be JS (runs against df context), SQL (runs against named tables),
 * or Markdown (renders basic markdown to HTML).
 * Synthwave 84 theme. Zero dependencies.
 */

/* global execSQL, renderTable */

var DK_NB_THEME = {
  bg: '#0d0d22',
  cellBg: '#121228',
  border: '#2a2a4e',
  cyan: '#00e5ff',
  pink: '#ff2975',
  green: '#80d080',
  yellow: '#ffe066',
  text: '#e0e0f0',
  textDim: '#8888aa',
  error: '#ff4444',
};

function createNotebook(container, getContext) {
  var cells = [];
  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;overflow-y:auto;background:' + DK_NB_THEME.bg + ';padding:8px;gap:6px;';

  // Inject notebook-specific CSS
  var nbStyle = document.createElement('style');
  nbStyle.textContent = [
    '.dk-cell-stale { opacity: 0.4; position: relative; }',
    '.dk-cell-stale::after {',
    '  content: "stale \\2014 re-run cell";',
    '  position: absolute; top: 4px; right: 8px;',
    '  font-size: 10px; color: ' + DK_NB_THEME.yellow + ';',
    '  background: ' + DK_NB_THEME.cellBg + '; padding: 1px 6px;',
    '  border-radius: 3px; border: 1px solid ' + DK_NB_THEME.yellow + '66;',
    '  pointer-events: none;',
    '}',
    '.dk-cell-drag-handle { cursor: grab; color: ' + DK_NB_THEME.textDim + '; padding: 0 4px; user-select: none; font-size: 14px; }',
    '.dk-cell-drag-handle:active { cursor: grabbing; }',
    '.dk-cell-dragover { border-top: 2px solid ' + DK_NB_THEME.cyan + ' !important; }',
    '.dk-nb-md-output h1, .dk-nb-md-output h2, .dk-nb-md-output h3 { margin: 0.4em 0 0.2em; color: ' + DK_NB_THEME.cyan + '; }',
    '.dk-nb-md-output h1 { font-size: 18px; }',
    '.dk-nb-md-output h2 { font-size: 15px; }',
    '.dk-nb-md-output h3 { font-size: 13px; }',
    '.dk-nb-md-output strong { color: ' + DK_NB_THEME.pink + '; }',
    '.dk-nb-md-output em { color: ' + DK_NB_THEME.purple || '#b967ff' + '; font-style: italic; }',
    '.dk-nb-md-output code { background: ' + DK_NB_THEME.cellBg + '; padding: 1px 4px; border-radius: 2px; font-size: 11px; color: ' + DK_NB_THEME.yellow + '; }',
    '.dk-nb-md-output pre { background: ' + DK_NB_THEME.cellBg + '; padding: 8px; border-radius: 3px; overflow-x: auto; }',
    '.dk-nb-md-output pre code { padding: 0; background: transparent; }',
    '.dk-nb-md-output ul, .dk-nb-md-output ol { margin: 0.3em 0; padding-left: 1.5em; }',
    '.dk-nb-md-output li { margin: 0.15em 0; }',
    '.dk-nb-md-output hr { border: none; border-top: 1px solid ' + DK_NB_THEME.border + '; margin: 0.5em 0; }',
    '.dk-nb-md-output p { margin: 0.3em 0; }',
    '.dk-nb-md-output { padding: 8px 12px; font-size: 12px; line-height: 1.5; color: ' + DK_NB_THEME.text + '; }',
  ].join('\n');
  document.head.appendChild(nbStyle);

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.style.cssText = 'display:flex;gap:6px;padding:4px 0;flex-shrink:0;';

  var addJSBtn = _btn('+ JS Cell', DK_NB_THEME.cyan);
  var addSQLBtn = _btn('+ SQL Cell', DK_NB_THEME.yellow);
  var addMDBtn = _btn('+ Markdown', DK_NB_THEME.pink);
  var runAllBtn = _btn('Run All', DK_NB_THEME.green);

  addJSBtn.addEventListener('click', function () { addCell('js'); });
  addSQLBtn.addEventListener('click', function () { addCell('sql'); });
  addMDBtn.addEventListener('click', function () { addCell('md'); });
  runAllBtn.addEventListener('click', function () { cells.forEach(function (c) { c.run(); }); });

  toolbar.appendChild(addJSBtn);
  toolbar.appendChild(addSQLBtn);
  toolbar.appendChild(addMDBtn);
  toolbar.appendChild(runAllBtn);

  var cellContainer = document.createElement('div');
  cellContainer.style.cssText = 'display:flex;flex-direction:column;gap:6px;flex:1;';

  wrapper.appendChild(toolbar);
  wrapper.appendChild(cellContainer);
  container.appendChild(wrapper);

  // Add initial cell
  addCell('sql');

  // ─── Basic markdown renderer ───────────────────────────────────────
  function renderMarkdown(src) {
    var lines = src.split('\n');
    var html = [];
    var inCodeBlock = false;
    var codeBlockLines = [];
    var inUl = false;
    var inOl = false;

    function closeLists() {
      if (inUl) { html.push('</ul>'); inUl = false; }
      if (inOl) { html.push('</ol>'); inOl = false; }
    }

    function inlineFormat(text) {
      // Code spans first (to avoid processing inside them)
      text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
      // Bold before italic
      text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
      return text;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];

      // Fenced code blocks
      if (line.trim().indexOf('```') === 0) {
        if (!inCodeBlock) {
          closeLists();
          inCodeBlock = true;
          codeBlockLines = [];
        } else {
          html.push('<pre><code>' + codeBlockLines.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
          inCodeBlock = false;
        }
        continue;
      }
      if (inCodeBlock) {
        codeBlockLines.push(line);
        continue;
      }

      // Blank line = paragraph break
      if (line.trim() === '') {
        closeLists();
        continue;
      }

      // Horizontal rule
      if (/^---+\s*$/.test(line.trim())) {
        closeLists();
        html.push('<hr>');
        continue;
      }

      // Headings
      if (/^### /.test(line)) { closeLists(); html.push('<h3>' + inlineFormat(line.slice(4)) + '</h3>'); continue; }
      if (/^## /.test(line)) { closeLists(); html.push('<h2>' + inlineFormat(line.slice(3)) + '</h2>'); continue; }
      if (/^# /.test(line)) { closeLists(); html.push('<h1>' + inlineFormat(line.slice(2)) + '</h1>'); continue; }

      // Unordered list
      if (/^[-*] /.test(line.trim())) {
        if (!inUl) { if (inOl) { html.push('</ol>'); inOl = false; } html.push('<ul>'); inUl = true; }
        html.push('<li>' + inlineFormat(line.trim().slice(2)) + '</li>');
        continue;
      }

      // Ordered list
      if (/^\d+\. /.test(line.trim())) {
        if (!inOl) { if (inUl) { html.push('</ul>'); inUl = false; } html.push('<ol>'); inOl = true; }
        html.push('<li>' + inlineFormat(line.trim().replace(/^\d+\.\s*/, '')) + '</li>');
        continue;
      }

      // Paragraph
      closeLists();
      html.push('<p>' + inlineFormat(line) + '</p>');
    }

    // Close any open blocks
    if (inCodeBlock) {
      html.push('<pre><code>' + codeBlockLines.join('\n').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</code></pre>');
    }
    closeLists();

    return html.join('\n');
  }

  // ─── Drag-and-drop reorder ────────────────────────────────────────
  var dragSourceIdx = null;

  function addCell(lang) {
    var cell = createCell(lang, cells.length + 1);
    cells.push(cell);
    cellContainer.appendChild(cell.el);
    cell.focus();
    return cell;
  }

  function createCell(lang, num) {
    var el = document.createElement('div');
    el.style.cssText = 'border:1px solid ' + DK_NB_THEME.border + ';border-radius:3px;overflow:hidden;';

    // Header bar
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:2px 8px;background:' + DK_NB_THEME.cellBg + ';border-bottom:1px solid ' + DK_NB_THEME.border + ';';

    var langColor = lang === 'sql' ? DK_NB_THEME.yellow : lang === 'md' ? DK_NB_THEME.pink : DK_NB_THEME.cyan;
    var langText = lang === 'sql' ? 'SQL' : lang === 'md' ? 'MD' : 'JS';

    var langLabel = document.createElement('span');
    langLabel.style.cssText = 'font-size:10px;color:' + langColor + ';text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;font-family:inherit;';
    langLabel.textContent = langText;

    var cellNum = document.createElement('span');
    cellNum.style.cssText = 'font-size:10px;color:' + DK_NB_THEME.textDim + ';';
    cellNum.textContent = '[' + num + ']';

    // Drag handle
    var dragHandle = document.createElement('span');
    dragHandle.className = 'dk-cell-drag-handle';
    dragHandle.textContent = '\u2801\u2801\u2801';
    dragHandle.draggable = true;

    dragHandle.addEventListener('dragstart', function (e) {
      dragSourceIdx = cells.indexOf(cellObj);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragSourceIdx));
    });

    el.addEventListener('dragover', function (e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('dk-cell-dragover');
    });

    el.addEventListener('dragleave', function () {
      el.classList.remove('dk-cell-dragover');
    });

    el.addEventListener('drop', function (e) {
      e.preventDefault();
      el.classList.remove('dk-cell-dragover');
      var targetIdx = cells.indexOf(cellObj);
      if (dragSourceIdx === null || dragSourceIdx === targetIdx) return;
      var movedCell = cells.splice(dragSourceIdx, 1)[0];
      cells.splice(targetIdx, 0, movedCell);
      // Re-append all cells in new order
      cells.forEach(function (c) { cellContainer.appendChild(c.el); });
      dragSourceIdx = null;
    });

    var btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:4px;';

    var runCellBtn = _btn('\u25b6', DK_NB_THEME.green, true);
    var delCellBtn = _btn('\u2715', DK_NB_THEME.pink, true);

    runCellBtn.addEventListener('click', function () { cellObj.run(); });
    delCellBtn.addEventListener('click', function () {
      var idx = cells.indexOf(cellObj);
      if (idx >= 0) cells.splice(idx, 1);
      el.remove();
    });

    btnGroup.appendChild(runCellBtn);
    btnGroup.appendChild(delCellBtn);

    var leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;gap:8px;align-items:center;';
    leftGroup.appendChild(dragHandle);
    leftGroup.appendChild(cellNum);
    leftGroup.appendChild(langLabel);

    header.appendChild(leftGroup);
    header.appendChild(btnGroup);

    // Input
    var input = document.createElement('textarea');
    input.style.cssText = 'width:100%;box-sizing:border-box;min-height:60px;resize:vertical;padding:8px;background:' + DK_NB_THEME.cellBg + ';color:' + DK_NB_THEME.text + ';border:none;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;outline:none;';
    input.spellcheck = false;
    input.placeholder = lang === 'sql' ? 'SELECT * FROM df WHERE ...' : lang === 'md' ? '# Heading\n\nWrite markdown here...' : '// df, rows, headers, meta available\nreturn df.filter(r => r.salary > 100)';

    // Tab key inserts spaces
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        var start = input.selectionStart;
        input.value = input.value.substring(0, start) + '  ' + input.value.substring(input.selectionEnd);
        input.selectionStart = input.selectionEnd = start + 2;
      }
      // Shift+Enter runs cell
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        cellObj.run();
      }
    });

    // Stale output warning — mark output stale when textarea edited after run
    input.addEventListener('input', function () {
      if (output.innerHTML !== '') {
        output.classList.add('dk-cell-stale');
      }
    });

    // Markdown: auto-render on blur
    if (lang === 'md') {
      input.addEventListener('blur', function () {
        if (input.value.trim()) {
          cellObj.run();
        }
      });
    }

    // Output
    var output = document.createElement('div');
    output.style.cssText = 'max-height:300px;overflow:auto;border-top:1px solid ' + DK_NB_THEME.border + ';';

    el.appendChild(header);
    el.appendChild(input);
    el.appendChild(output);

    var cellObj = {
      el: el,
      lang: lang,
      focus: function () { input.focus(); },
      setValue: function (code) { input.value = code; },
      run: function () {
        output.innerHTML = '';
        output.classList.remove('dk-cell-stale');
        var code = input.value.trim();
        if (!code) return;

        // Markdown rendering
        if (lang === 'md') {
          output.className = 'dk-nb-md-output';
          output.innerHTML = renderMarkdown(code);
          return;
        }

        var ctx = getContext();
        var t0 = performance.now();

        try {
          if (lang === 'sql') {
            // SQL execution
            var sqlTables = { df: { _headers: ctx.headers, _rows: ctx.rows } };
            var result = execSQL(code, sqlTables);
            var elapsed = (performance.now() - t0).toFixed(1);

            // Render result as table
            if (typeof renderTable === 'function') {
              renderTable(output, { _headers: result.headers, _rows: result.rows });
            }
            _appendStatus(output, result.rows.length + ' rows \u00b7 ' + elapsed + 'ms');
          } else {
            // JS execution
            var logs = [];
            var mockConsole = {
              log: function () { logs.push({ level: 'log', args: Array.from(arguments) }); },
              warn: function () { logs.push({ level: 'warn', args: Array.from(arguments) }); },
              error: function () { logs.push({ level: 'error', args: Array.from(arguments) }); },
            };

            var fn = new Function('df', 'data', 'rows', 'headers', 'meta', 'console', code);
            var result = fn(ctx.data, ctx.data, ctx.rows, ctx.headers, ctx.meta, mockConsole);
            var elapsed = (performance.now() - t0).toFixed(1);

            // Render console output
            logs.forEach(function (entry) {
              var line = document.createElement('div');
              line.style.cssText = 'padding:2px 8px;font-size:11px;font-family:monospace;color:' +
                (entry.level === 'error' ? DK_NB_THEME.error : entry.level === 'warn' ? DK_NB_THEME.yellow : DK_NB_THEME.text) + ';';
              line.textContent = entry.args.map(function (a) { return typeof a === 'object' ? JSON.stringify(a) : String(a); }).join(' ');
              output.appendChild(line);
            });

            // Render return value
            if (result !== undefined) {
              // If result looks like a table ({headers, rows} or array of objects), render as table
              if (result && result.headers && result.rows) {
                renderTable(output, { _headers: result.headers, _rows: result.rows });
              } else if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object') {
                var keys = Object.keys(result[0]);
                var tableRows = result.map(function (obj) { return keys.map(function (k) { return obj[k]; }); });
                renderTable(output, { _headers: keys, _rows: tableRows });
              } else {
                var valLine = document.createElement('div');
                valLine.style.cssText = 'padding:2px 8px;font-size:11px;font-family:monospace;color:' + DK_NB_THEME.green + ';';
                valLine.textContent = '\u21d2 ' + (typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
                output.appendChild(valLine);
              }
            }

            _appendStatus(output, elapsed + 'ms');
          }
        } catch (e) {
          var errLine = document.createElement('div');
          errLine.style.cssText = 'padding:4px 8px;font-size:11px;font-family:monospace;color:' + DK_NB_THEME.error + ';';
          errLine.textContent = '\u2717 ' + e.message;
          output.appendChild(errLine);
        }

        // Highlight active cell border
        el.style.borderColor = DK_NB_THEME.cyan;
        setTimeout(function () { el.style.borderColor = DK_NB_THEME.border; }, 1000);
      }
    };

    return cellObj;
  }

  function _btn(text, color, small) {
    var btn = document.createElement('button');
    btn.textContent = text;
    btn.style.cssText = 'background:transparent;color:' + color + ';border:1px solid ' + color + ';padding:' + (small ? '1px 6px' : '3px 10px') + ';cursor:pointer;font-family:inherit;font-size:' + (small ? '10px' : '11px') + ';border-radius:2px;';
    btn.addEventListener('mouseenter', function () { btn.style.background = color; btn.style.color = '#000'; });
    btn.addEventListener('mouseleave', function () { btn.style.background = 'transparent'; btn.style.color = color; });
    return btn;
  }

  function _appendStatus(container, text) {
    var s = document.createElement('div');
    s.style.cssText = 'padding:2px 8px;font-size:10px;color:' + DK_NB_THEME.textDim + ';text-align:right;';
    s.textContent = text;
    container.appendChild(s);
  }

  return {
    addCell: addCell,
  };
}

// --- ui/command-palette.js ---

/**
 * WDK Command Palette
 * Searchable action list triggered by Ctrl+P.
 * Fuzzy subsequence matching, keyboard navigation, Synthwave 84 theme.
 */

function createCommandPalette(actions) {
  var overlay = null;
  var isOpen = false;
  var selectedIndex = 0;
  var filteredActions = actions.slice();

  function fuzzyMatch(query, label) {
    var q = query.toLowerCase();
    var l = label.toLowerCase();
    var qi = 0;
    for (var li = 0; li < l.length && qi < q.length; li++) {
      if (l.charAt(li) === q.charAt(qi)) {
        qi++;
      }
    }
    return qi === q.length;
  }

  function injectPaletteStyles() {
    if (document.getElementById('dk-palette-styles')) return;
    var style = document.createElement('style');
    style.id = 'dk-palette-styles';
    style.textContent = [
      '.dk-palette-overlay {',
      '  position: fixed; top: 0; left: 0; width: 100%; height: 100%;',
      '  background: rgba(0,0,0,0.7); z-index: 10001;',
      '  display: flex; align-items: flex-start; justify-content: center;',
      '  padding-top: 20vh;',
      '}',
      '.dk-palette-box {',
      '  background: #12122a; border: 1px solid #2a2a4e; border-radius: 6px;',
      '  width: 420px; max-width: 90vw; overflow: hidden;',
      '  box-shadow: 0 8px 32px rgba(0,0,0,0.5);',
      '}',
      '.dk-palette-input {',
      '  background: #0a0a1a; color: #e0e0f0;',
      '  border: none; border-bottom: 1px solid #2a2a4e;',
      '  padding: 10px 14px; font-size: 14px; width: 100%;',
      '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
      '  outline: none; box-sizing: border-box;',
      '}',
      '.dk-palette-input::placeholder { color: #555577; }',
      '.dk-palette-list {',
      '  max-height: ' + (12 * 32) + 'px; overflow-y: auto;',
      '  scrollbar-width: thin; scrollbar-color: #2a2a4e #12122a;',
      '}',
      '.dk-palette-item {',
      '  padding: 6px 14px; cursor: pointer;',
      '  display: flex; align-items: center;',
      '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
      '  font-size: 13px; color: #e0e0f0;',
      '  border-left: 2px solid transparent;',
      '}',
      '.dk-palette-item:hover, .dk-palette-item.dk-palette-active {',
      '  background: #1a1a3a;',
      '}',
      '.dk-palette-item.dk-palette-active {',
      '  border-left: 2px solid #00e5ff;',
      '}',
      '.dk-palette-icon {',
      '  margin-right: 10px; font-size: 14px; width: 18px; text-align: center;',
      '}',
      '.dk-palette-label { flex: 1; }',
      '.dk-palette-shortcut {',
      '  color: #8888aa; font-size: 10px; float: right; margin-left: 12px;',
      '}',
      '.dk-palette-empty {',
      '  padding: 12px 14px; color: #555577; font-style: italic;',
      '  font-size: 12px; text-align: center;',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function buildUI() {
    injectPaletteStyles();

    overlay = document.createElement('div');
    overlay.className = 'dk-palette-overlay';

    var box = document.createElement('div');
    box.className = 'dk-palette-box';

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dk-palette-input';
    input.placeholder = 'Type a command...';

    var list = document.createElement('div');
    list.className = 'dk-palette-list';

    box.appendChild(input);
    box.appendChild(list);
    overlay.appendChild(box);

    function renderList() {
      list.innerHTML = '';
      if (filteredActions.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'dk-palette-empty';
        empty.textContent = 'No matching commands';
        list.appendChild(empty);
        return;
      }
      for (var i = 0; i < filteredActions.length; i++) {
        var action = filteredActions[i];
        var item = document.createElement('div');
        item.className = 'dk-palette-item';
        if (i === selectedIndex) {
          item.classList.add('dk-palette-active');
        }

        var icon = document.createElement('span');
        icon.className = 'dk-palette-icon';
        icon.textContent = action.icon || '';
        item.appendChild(icon);

        var label = document.createElement('span');
        label.className = 'dk-palette-label';
        label.textContent = action.label;
        item.appendChild(label);

        if (action.shortcut) {
          var shortcut = document.createElement('span');
          shortcut.className = 'dk-palette-shortcut';
          shortcut.textContent = action.shortcut;
          item.appendChild(shortcut);
        }

        (function (idx, act) {
          item.addEventListener('click', function () {
            close();
            if (act.handler) act.handler();
          });
          item.addEventListener('mouseenter', function () {
            selectedIndex = idx;
            renderList();
          });
        })(i, action);

        list.appendChild(item);
      }

      // Scroll active item into view
      var activeItem = list.querySelector('.dk-palette-active');
      if (activeItem) {
        activeItem.scrollIntoView({ block: 'nearest' });
      }
    }

    input.addEventListener('input', function () {
      var query = input.value;
      if (!query) {
        filteredActions = actions.slice();
      } else {
        filteredActions = actions.filter(function (a) {
          return fuzzyMatch(query, a.label);
        });
      }
      selectedIndex = 0;
      renderList();
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredActions.length > 0) {
          selectedIndex = (selectedIndex + 1) % filteredActions.length;
          renderList();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredActions.length > 0) {
          selectedIndex = (selectedIndex - 1 + filteredActions.length) % filteredActions.length;
          renderList();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredActions.length > 0 && filteredActions[selectedIndex]) {
          var handler = filteredActions[selectedIndex].handler;
          close();
          if (handler) handler();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) {
        close();
      }
    });

    renderList();

    return { overlay: overlay, input: input, renderList: renderList };
  }

  var ui = null;

  function open() {
    if (isOpen) return;
    isOpen = true;
    filteredActions = actions.slice();
    selectedIndex = 0;
    if (!ui) {
      ui = buildUI();
    } else {
      ui.input.value = '';
      filteredActions = actions.slice();
      selectedIndex = 0;
      ui.renderList();
    }
    document.body.appendChild(ui.overlay);
    ui.input.focus();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    if (ui && ui.overlay.parentNode) {
      ui.overlay.parentNode.removeChild(ui.overlay);
    }
  }

  function toggle() {
    if (isOpen) {
      close();
    } else {
      open();
    }
  }

  return {
    open: open,
    close: close,
    toggle: toggle
  };
}

// --- ui/build-config.js ---

/**
 * WDK Build Configurator UI.
 * Shows all modules with sizes, toggle on/off, displays build tier estimates.
 * Helps users understand what's included at each build level.
 */

var DK_BUILD_MODULES = [
  // Core (always included)
  { name: 'CSV Parser', file: 'parsers/csv.js', size: 2019, tier: 'core', required: true },
  { name: 'JSON Parser', file: 'parsers/json.js', size: 4449, tier: 'core', required: true },
  { name: 'DataFrame', file: 'transforms/data-model.js', size: 2827, tier: 'core', required: true },
  { name: 'Pipeline (Undo/Redo)', file: 'transforms/pipeline.js', size: 3469, tier: 'core', required: true },
  { name: 'Type Detection', file: 'util/detect-types.js', size: 3157, tier: 'core', required: true },
  { name: 'Audit Logger', file: 'util/audit-log.js', size: 2500, tier: 'core', required: false },
  { name: 'Export (CSV/JSON)', file: 'export/export.js', size: 3435, tier: 'core', required: true },
  { name: 'XLSX Writer', file: 'export/xlsx-writer.js', size: 6000, tier: 'xlsx', required: false },
  { name: 'Table Renderer', file: 'ui/table.js', size: 8335, tier: 'core', required: true },
  { name: 'File Import', file: 'ui/file-import.js', size: 8674, tier: 'core', required: true },
  { name: 'App Shell', file: 'ui/app-shell.js', size: 29680, tier: 'core', required: true },
  { name: 'Panel System', file: 'ui/panel.js', size: 9279, tier: 'core', required: true },

  // Optional — Tier 1 (bookmarklet-friendly)
  { name: 'Redaction (hash/mask)', file: 'transforms/redact.js', size: 2051, tier: 'clean', required: false },
  { name: 'REPL', file: 'ui/repl.js', size: 6264, tier: 'scripting', required: false },
  { name: 'Command Palette', file: 'ui/command-palette.js', size: 3500, tier: 'scripting', required: false },

  // Optional — Tier 2 (standalone HTML)
  { name: 'ZIP Parser', file: 'parsers/zip.js', size: 3318, tier: 'xlsx', required: false },
  { name: 'XLSX Parser', file: 'parsers/xlsx.js', size: 18570, tier: 'xlsx', required: false },
  { name: 'Pivot Engine', file: 'transforms/pivot.js', size: 6825, tier: 'analysis', required: false },
  { name: 'Pivot Panel', file: 'ui/pivot-panel.js', size: 6668, tier: 'analysis', required: false },
  { name: 'SQL Functions', file: 'transforms/sql-functions.js', size: 7464, tier: 'analysis', required: false },
  { name: 'SQL Engine', file: 'transforms/sql.js', size: 11705, tier: 'analysis', required: false },
  { name: 'Notebook', file: 'ui/notebook.js', size: 9613, tier: 'analysis', required: false },

  // Optional — Inspector (bookmarklet-only)
  { name: 'DOM Scraper', file: 'inspect/dom-scraper.js', size: 5596, tier: 'inspect', required: false },
  { name: 'Network Interceptor', file: 'inspect/network-interceptor.js', size: 4506, tier: 'inspect', required: false },
  { name: 'Storage Viewer', file: 'inspect/storage-viewer.js', size: 2318, tier: 'inspect', required: false },
  { name: 'Console Capture', file: 'inspect/console-capture.js', size: 2032, tier: 'inspect', required: false },
  { name: 'Debug Panel', file: 'ui/debug-panel.js', size: 5000, tier: 'inspect', required: false },
];

var DK_BUILD_TIERS = {
  core: { label: 'Core', color: '#00e5ff', desc: 'Always included' },
  clean: { label: 'Clean Room', color: '#b967ff', desc: 'Redaction tools' },
  scripting: { label: 'Scripting', color: '#ffe066', desc: 'REPL console' },
  xlsx: { label: 'XLSX', color: '#ff8c42', desc: 'Excel file support' },
  analysis: { label: 'Analysis', color: '#80d080', desc: 'Pivot, SQL, Notebook' },
  inspect: { label: 'Inspector', color: '#ff2975', desc: 'Page inspection (bookmarklet)' },
};

var DK_BUILD_PRESETS = {
  bookmarklet: { label: 'Bookmarklet', tiers: ['core', 'clean', 'inspect'], desc: 'Inject into any page. <100KB target.' },
  standalone: { label: 'Standalone HTML', tiers: ['core', 'clean', 'scripting', 'xlsx', 'analysis'], desc: 'Full-featured, open locally.' },
  full: { label: 'Full (all modules)', tiers: ['core', 'clean', 'scripting', 'xlsx', 'analysis', 'inspect'], desc: 'Everything included.' },
  minimal: { label: 'Minimal (CSV only)', tiers: ['core'], desc: 'Core only, smallest footprint.' },
};

function createBuildConfig(container) {
  var theme = { bg: '#0d0d22', cellBg: '#121228', border: '#2a2a4e', text: '#e0e0f0', textDim: '#8888aa', cyan: '#00e5ff' };

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;color:' + theme.text + ';background:' + theme.bg + ';padding:16px;overflow-y:auto;height:100%;';

  // Title
  var title = document.createElement('h3');
  title.textContent = 'Build Configurator';
  title.style.cssText = 'margin:0 0 12px;color:' + theme.cyan + ';font-size:14px;';
  wrapper.appendChild(title);

  // Presets
  var presetBar = document.createElement('div');
  presetBar.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap;';
  Object.keys(DK_BUILD_PRESETS).forEach(function (key) {
    var preset = DK_BUILD_PRESETS[key];
    var btn = document.createElement('button');
    btn.textContent = preset.label;
    btn.title = preset.desc;
    btn.style.cssText = 'background:transparent;color:' + theme.cyan + ';border:1px solid ' + theme.border + ';padding:3px 10px;cursor:pointer;font-family:inherit;font-size:11px;border-radius:2px;';
    btn.addEventListener('click', function () {
      DK_BUILD_MODULES.forEach(function (mod, i) {
        if (mod.required) return;
        checkboxes[i].checked = preset.tiers.indexOf(mod.tier) >= 0;
      });
      updateSummary();
    });
    btn.addEventListener('mouseenter', function () { btn.style.borderColor = theme.cyan; });
    btn.addEventListener('mouseleave', function () { btn.style.borderColor = theme.border; });
    presetBar.appendChild(btn);
  });
  wrapper.appendChild(presetBar);

  // Module list
  var table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;';

  var thead = document.createElement('thead');
  var headRow = document.createElement('tr');
  ['', 'Module', 'Tier', 'Size'].forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    th.style.cssText = 'text-align:left;padding:4px 8px;border-bottom:1px solid ' + theme.border + ';color:' + theme.textDim + ';font-size:10px;text-transform:uppercase;';
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var checkboxes = [];

  DK_BUILD_MODULES.forEach(function (mod, i) {
    var tr = document.createElement('tr');

    // Checkbox
    var tdCheck = document.createElement('td');
    tdCheck.style.cssText = 'padding:3px 8px;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.disabled = mod.required;
    cb.addEventListener('change', updateSummary);
    checkboxes.push(cb);
    tdCheck.appendChild(cb);

    // Name
    var tdName = document.createElement('td');
    tdName.style.cssText = 'padding:3px 8px;color:' + (mod.required ? theme.text : theme.textDim) + ';';
    tdName.textContent = mod.name;

    // Tier
    var tdTier = document.createElement('td');
    tdTier.style.cssText = 'padding:3px 8px;';
    var tierBadge = document.createElement('span');
    var tierInfo = DK_BUILD_TIERS[mod.tier];
    tierBadge.textContent = tierInfo.label;
    tierBadge.style.cssText = 'font-size:10px;color:' + tierInfo.color + ';border:1px solid ' + tierInfo.color + ';padding:1px 4px;border-radius:2px;';
    tdTier.appendChild(tierBadge);

    // Size
    var tdSize = document.createElement('td');
    tdSize.style.cssText = 'padding:3px 8px;text-align:right;color:' + theme.textDim + ';font-size:11px;';
    tdSize.textContent = formatKB(mod.size);

    tr.appendChild(tdCheck);
    tr.appendChild(tdName);
    tr.appendChild(tdTier);
    tr.appendChild(tdSize);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrapper.appendChild(table);

  // Summary
  var summary = document.createElement('div');
  summary.style.cssText = 'margin-top:12px;padding:8px;border:1px solid ' + theme.border + ';border-radius:3px;';
  wrapper.appendChild(summary);

  // Action buttons
  var actionBar = document.createElement('div');
  actionBar.style.cssText = 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap;';

  var copyBmBtn = document.createElement('button');
  copyBmBtn.textContent = 'Copy Bookmarklet';
  copyBmBtn.style.cssText = 'background:' + theme.cyan + ';color:#0a0a1a;border:none;padding:6px 14px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:bold;border-radius:2px;';
  copyBmBtn.addEventListener('click', function () {
    var scripts = document.querySelectorAll('script');
    var js = '';
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].textContent.length > 1000) { js = scripts[i].textContent; break; }
    }
    if (!js) { copyBmBtn.textContent = 'No script found'; return; }
    var uri = 'javascript:' + encodeURIComponent(js);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(uri).then(function () {
        copyBmBtn.textContent = 'Copied!';
        setTimeout(function () { copyBmBtn.textContent = 'Copy Bookmarklet'; }, 2000);
      });
    } else {
      var ta = document.createElement('textarea');
      ta.value = uri;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      copyBmBtn.textContent = 'Copied!';
      setTimeout(function () { copyBmBtn.textContent = 'Copy Bookmarklet'; }, 2000);
    }
  });

  var dlHtmlBtn = document.createElement('button');
  dlHtmlBtn.textContent = 'Download HTML';
  dlHtmlBtn.style.cssText = 'background:transparent;color:' + theme.cyan + ';border:1px solid ' + theme.border + ';padding:6px 14px;cursor:pointer;font-family:inherit;font-size:11px;border-radius:2px;';
  dlHtmlBtn.addEventListener('click', function () {
    var html = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: 'text/html' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'wdk.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  actionBar.appendChild(copyBmBtn);
  actionBar.appendChild(dlHtmlBtn);
  wrapper.appendChild(actionBar);

  container.appendChild(wrapper);
  updateSummary();

  function updateSummary() {
    var total = 0, count = 0;
    DK_BUILD_MODULES.forEach(function (mod, i) {
      if (checkboxes[i].checked) {
        total += mod.size;
        count++;
      }
    });
    // Estimate: IIFE wrapper + minification factor ~0.7
    var rawKB = total / 1024;
    var minEst = rawKB * 0.7;
    summary.innerHTML = '<span style="color:' + theme.cyan + ';font-weight:bold;">' + count + '/' + DK_BUILD_MODULES.length + ' modules</span>' +
      ' \u00b7 Raw: <b>' + rawKB.toFixed(1) + ' KB</b>' +
      ' \u00b7 Est. minified: <b>' + minEst.toFixed(1) + ' KB</b>' +
      (minEst < 100 ? ' \u00b7 <span style="color:#80d080;">Bookmarklet OK</span>' : ' \u00b7 <span style="color:#ff8c42;">Standalone+ only</span>');
  }

  function formatKB(bytes) {
    return (bytes / 1024).toFixed(1) + ' KB';
  }
}

// --- ui/debug-panel.js ---

/**
 * WDK Debug Panel
 * Unified debugging dashboard pulling together inspect modules
 * (network interceptor, console capture, storage viewer, DOM scraper)
 * into a single tabbed UI in the bottom panel.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */

/* global createDebugPanel */

var DK_DEBUG_THEME = {
  bg: '#0d0d22',
  cellBg: '#121228',
  border: '#2a2a4e',
  cyan: '#00e5ff',
  pink: '#ff2975',
  green: '#80d080',
  yellow: '#ffe066',
  text: '#e0e0f0',
  textDim: '#8888aa',
  error: '#ff4444',
};

function createDebugPanel(container, onDataLoaded) {
  var T = DK_DEBUG_THEME;

  // --- Inject styles ---
  if (!document.getElementById('dk-debug-panel-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'dk-debug-panel-styles';
    styleEl.textContent = [
      '.dk-debug-wrapper { display:flex; flex-direction:column; height:100%; font-family:"SF Mono","Fira Code","Consolas",monospace; font-size:12px; color:' + T.text + '; background:' + T.bg + '; }',
      '.dk-debug-tab-bar { display:flex; gap:0; background:' + T.bg + '; border-bottom:1px solid ' + T.border + '; flex-shrink:0; }',
      '.dk-debug-tab { background:transparent; color:' + T.textDim + '; border:none; border-bottom:2px solid transparent; padding:4px 12px; cursor:pointer; font-family:inherit; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; position:relative; }',
      '.dk-debug-tab.dk-active { color:' + T.cyan + '; border-bottom-color:' + T.cyan + '; }',
      '.dk-debug-tab .dk-debug-badge { position:absolute; top:1px; right:2px; background:' + T.pink + '; color:#fff; font-size:9px; padding:0 4px; border-radius:6px; min-width:14px; text-align:center; line-height:14px; }',
      '.dk-debug-content { flex:1; overflow:hidden; position:relative; }',
      '.dk-debug-pane { position:absolute; top:0; left:0; right:0; bottom:0; overflow-y:auto; padding:8px; display:none; }',
      '.dk-debug-pane.dk-active { display:block; }',
      '.dk-debug-btn { background:transparent; color:' + T.cyan + '; border:1px solid ' + T.border + '; padding:3px 10px; cursor:pointer; font-family:inherit; font-size:11px; border-radius:2px; margin-right:4px; }',
      '.dk-debug-btn:hover { border-color:' + T.cyan + '; }',
      '.dk-debug-btn-primary { background:' + T.cyan + '; color:#0a0a1a; border:none; font-weight:bold; }',
      '.dk-debug-table { width:100%; border-collapse:collapse; margin-top:6px; }',
      '.dk-debug-table th { text-align:left; padding:3px 6px; border-bottom:1px solid ' + T.border + '; color:' + T.textDim + '; font-size:10px; text-transform:uppercase; }',
      '.dk-debug-table td { padding:3px 6px; border-bottom:1px solid ' + T.border + '; font-size:11px; vertical-align:top; }',
      '.dk-debug-table tr:hover td { background:' + T.cellBg + '; }',
      '.dk-debug-table tr.dk-expandable { cursor:pointer; }',
      '.dk-debug-expand { padding:6px; background:' + T.cellBg + '; border:1px solid ' + T.border + '; border-radius:2px; margin:2px 0 6px; font-size:11px; white-space:pre-wrap; word-break:break-all; max-height:200px; overflow-y:auto; }',
      '.dk-debug-toolbar { display:flex; gap:4px; margin-bottom:6px; align-items:center; flex-wrap:wrap; }',
      '.dk-debug-status-2xx { color:' + T.green + '; }',
      '.dk-debug-status-4xx { color:' + T.yellow + '; }',
      '.dk-debug-status-5xx { color:' + T.error + '; }',
      '.dk-debug-level-log { background:#e0e0f0; color:#0a0a1a; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-level-warn { background:#ffe066; color:#0a0a1a; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-level-error { background:#ff4444; color:#fff; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-level-info { background:#00e5ff; color:#0a0a1a; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-input { background:' + T.cellBg + '; color:' + T.text + '; border:1px solid ' + T.border + '; padding:3px 8px; font-family:inherit; font-size:11px; border-radius:2px; flex:1; min-width:120px; }',
      '.dk-debug-input:focus { border-color:' + T.cyan + '; outline:none; }',
      '.dk-debug-msg { color:' + T.textDim + '; font-size:11px; padding:8px 0; }',
    ].join('\n');
    document.head.appendChild(styleEl);
  }

  // --- Wrapper ---
  var wrapper = document.createElement('div');
  wrapper.className = 'dk-debug-wrapper';

  // --- Tab bar ---
  var tabBar = document.createElement('div');
  tabBar.className = 'dk-debug-tab-bar';

  var panes = {};
  var tabs = {};
  var subTabNames = ['network', 'console', 'storage', 'dom', 'explore'];
  var subTabLabels = { network: 'Network', console: 'Console', storage: 'Storage', dom: 'DOM', explore: 'Explore' };

  var contentArea = document.createElement('div');
  contentArea.className = 'dk-debug-content';

  function switchTab(name) {
    subTabNames.forEach(function (k) {
      var isActive = k === name;
      if (panes[k]) {
        if (isActive) {
          panes[k].classList.add('dk-active');
        } else {
          panes[k].classList.remove('dk-active');
        }
      }
      if (tabs[k]) {
        if (isActive) {
          tabs[k].classList.add('dk-active');
        } else {
          tabs[k].classList.remove('dk-active');
        }
      }
    });
  }

  subTabNames.forEach(function (name) {
    var btn = document.createElement('button');
    btn.className = 'dk-debug-tab';
    btn.textContent = subTabLabels[name];
    btn.addEventListener('click', function () { switchTab(name); });
    tabs[name] = btn;
    tabBar.appendChild(btn);

    var pane = document.createElement('div');
    pane.className = 'dk-debug-pane';
    panes[name] = pane;
    contentArea.appendChild(pane);
  });

  wrapper.appendChild(tabBar);
  wrapper.appendChild(contentArea);
  container.appendChild(wrapper);

  // Badge helper
  function setBadge(tabName, count) {
    var tab = tabs[tabName];
    if (!tab) return;
    var badge = tab.querySelector('.dk-debug-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'dk-debug-badge';
        tab.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : String(count);
    } else if (badge) {
      tab.removeChild(badge);
    }
  }

  // Truncate helper
  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // Format time
  function fmtTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Status class helper
  function statusClass(code) {
    if (!code) return '';
    var n = parseInt(code, 10);
    if (n >= 200 && n < 300) return 'dk-debug-status-2xx';
    if (n >= 400 && n < 500) return 'dk-debug-status-4xx';
    if (n >= 500) return 'dk-debug-status-5xx';
    return '';
  }

  // =====================
  // NETWORK PANE
  // =====================
  var networkInterceptor = null;
  var networkExpandedRow = null;

  function initNetwork() {
    var pane = panes.network;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dk-debug-btn';
    clearBtn.textContent = 'Clear';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'dk-debug-btn';
    exportBtn.textContent = 'Export as CSV';

    toolbar.appendChild(clearBtn);
    toolbar.appendChild(exportBtn);
    pane.appendChild(toolbar);

    var tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;';
    pane.appendChild(tableWrap);

    function renderNetworkLog(log) {
      setBadge('network', log.length);
      var html = '<table class="dk-debug-table"><thead><tr>';
      html += '<th>Method</th><th>URL</th><th>Status</th><th>Size</th><th>Time</th>';
      html += '</tr></thead><tbody>';
      for (var i = 0; i < log.length; i++) {
        var entry = log[i];
        var sc = statusClass(entry.status);
        html += '<tr class="dk-expandable" data-idx="' + i + '">';
        html += '<td>' + (entry.method || 'GET') + '</td>';
        html += '<td title="' + (entry.url || '').replace(/"/g, '&quot;') + '">' + truncate(entry.url, 60) + '</td>';
        html += '<td class="' + sc + '">' + (entry.status || '-') + '</td>';
        html += '<td>' + (entry.size != null ? entry.size + 'B' : '-') + '</td>';
        html += '<td>' + (entry.duration != null ? entry.duration + 'ms' : '-') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      tableWrap.innerHTML = html;

      // Click to expand
      var rows = tableWrap.querySelectorAll('tr.dk-expandable');
      for (var j = 0; j < rows.length; j++) {
        (function (row) {
          row.addEventListener('click', function () {
            var idx = parseInt(row.getAttribute('data-idx'), 10);
            var entry = log[idx];
            // Remove previous expand
            if (networkExpandedRow) {
              try { networkExpandedRow.parentNode.removeChild(networkExpandedRow); } catch (e) { /* ok */ }
              networkExpandedRow = null;
            }
            var detail = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = 5;
            var content = document.createElement('div');
            content.className = 'dk-debug-expand';
            var parts = [];
            parts.push('URL: ' + (entry.url || '-'));
            if (entry.requestHeaders) {
              parts.push('\nRequest Headers:\n' + formatHeaders(entry.requestHeaders));
            }
            if (entry.responseHeaders) {
              parts.push('\nResponse Headers:\n' + formatHeaders(entry.responseHeaders));
            }
            if (entry.responseBody) {
              parts.push('\nResponse Body (preview):\n' + truncate(entry.responseBody, 500));
            }
            content.textContent = parts.join('');
            td.appendChild(content);
            detail.appendChild(td);
            row.parentNode.insertBefore(detail, row.nextSibling);
            networkExpandedRow = detail;
          });
        })(rows[j]);
      }
    }

    function formatHeaders(headers) {
      if (typeof headers === 'string') return headers;
      if (!headers) return '';
      var result = '';
      var keys = Object.keys(headers);
      for (var i = 0; i < keys.length; i++) {
        result += '  ' + keys[i] + ': ' + headers[keys[i]] + '\n';
      }
      return result;
    }

    clearBtn.addEventListener('click', function () {
      if (networkInterceptor) networkInterceptor.clear();
      networkExpandedRow = null;
      tableWrap.innerHTML = '<p class="dk-debug-msg">Log cleared.</p>';
      setBadge('network', 0);
    });

    exportBtn.addEventListener('click', function () {
      if (!networkInterceptor) return;
      var log = networkInterceptor.getLog();
      if (!log.length) return;
      var headers = ['method', 'url', 'status', 'size', 'duration'];
      var rows = [];
      for (var i = 0; i < log.length; i++) {
        rows.push([
          log[i].method || 'GET',
          log[i].url || '',
          log[i].status != null ? String(log[i].status) : '',
          log[i].size != null ? String(log[i].size) : '',
          log[i].duration != null ? String(log[i].duration) : ''
        ]);
      }
      if (typeof onDataLoaded === 'function') {
        onDataLoaded({ _headers: headers, _rows: rows });
      }
    });

    // Auto-start
    if (window.WDK && typeof window.WDK.startIntercepting === 'function') {
      networkInterceptor = window.WDK.startIntercepting();
      networkInterceptor.onRequest(function () {
        renderNetworkLog(networkInterceptor.getLog());
      });
      // Also poll every 2s as fallback
      setInterval(function () {
        if (networkInterceptor) {
          renderNetworkLog(networkInterceptor.getLog());
        }
      }, 2000);
    } else {
      tableWrap.innerHTML = '<p class="dk-debug-msg">Network interceptor not available. Load inspect/network-interceptor.js first.</p>';
    }
  }

  // =====================
  // CONSOLE PANE
  // =====================
  var consoleCapture = null;

  function initConsole() {
    var pane = panes.console;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dk-debug-btn';
    clearBtn.textContent = 'Clear';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'dk-debug-btn';
    exportBtn.textContent = 'Export';

    toolbar.appendChild(clearBtn);
    toolbar.appendChild(exportBtn);
    pane.appendChild(toolbar);

    var logArea = document.createElement('div');
    logArea.style.cssText = 'overflow-y:auto;flex:1;';
    pane.appendChild(logArea);

    function renderConsoleLog(log) {
      var html = '';
      for (var i = 0; i < log.length; i++) {
        var entry = log[i];
        var ts = fmtTime(entry.timestamp || Date.now());
        var levelClass = 'dk-debug-level-' + (entry.level || 'log');
        html += '<div style="margin-bottom:2px;display:flex;gap:6px;align-items:baseline;">';
        html += '<span style="color:' + T.textDim + ';font-size:10px;flex-shrink:0;">' + ts + '</span>';
        html += '<span class="' + levelClass + '">' + (entry.level || 'log') + '</span>';
        html += '<span style="flex:1;word-break:break-all;">' + escapeHtml(entry.message || '') + '</span>';
        html += '</div>';
      }
      logArea.innerHTML = html || '<p class="dk-debug-msg">No console messages captured.</p>';
    }

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    clearBtn.addEventListener('click', function () {
      if (consoleCapture) consoleCapture.clear();
      logArea.innerHTML = '<p class="dk-debug-msg">Log cleared.</p>';
    });

    exportBtn.addEventListener('click', function () {
      if (!consoleCapture) return;
      var log = consoleCapture.getLog();
      if (!log.length) return;
      var headers = ['timestamp', 'level', 'message'];
      var rows = [];
      for (var i = 0; i < log.length; i++) {
        rows.push([
          fmtTime(log[i].timestamp || Date.now()),
          log[i].level || 'log',
          log[i].message || ''
        ]);
      }
      if (typeof onDataLoaded === 'function') {
        onDataLoaded({ _headers: headers, _rows: rows });
      }
    });

    // Auto-start
    if (window.WDK && typeof window.WDK.startCapture === 'function') {
      consoleCapture = window.WDK.startCapture();
      // Poll to refresh display
      setInterval(function () {
        if (consoleCapture) {
          renderConsoleLog(consoleCapture.getLog());
        }
      }, 2000);
    } else {
      logArea.innerHTML = '<p class="dk-debug-msg">Console capture not available. Load inspect/console-capture.js first.</p>';
    }
  }

  // =====================
  // STORAGE PANE
  // =====================
  function initStorage() {
    var pane = panes.storage;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var captureBtn = document.createElement('button');
    captureBtn.className = 'dk-debug-btn dk-debug-btn-primary';
    captureBtn.textContent = 'Capture';

    var loadBtn = document.createElement('button');
    loadBtn.className = 'dk-debug-btn';
    loadBtn.textContent = 'Load as Table';
    loadBtn.style.display = 'none';

    toolbar.appendChild(captureBtn);
    toolbar.appendChild(loadBtn);
    pane.appendChild(toolbar);

    var tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;';
    tableWrap.innerHTML = '<p class="dk-debug-msg">Click "Capture" to snapshot cookies, localStorage, and sessionStorage.</p>';
    pane.appendChild(tableWrap);

    var lastCapture = null;
    var storageExpandedRow = null;

    captureBtn.addEventListener('click', function () {
      if (!window.WDK || typeof window.WDK.captureStorage !== 'function') {
        tableWrap.innerHTML = '<p class="dk-debug-msg">Storage viewer not available. Load inspect/storage-viewer.js first.</p>';
        return;
      }
      lastCapture = window.WDK.captureStorage();
      loadBtn.style.display = '';
      renderStorageTable(lastCapture);
    });

    loadBtn.addEventListener('click', function () {
      if (!lastCapture || typeof onDataLoaded !== 'function') return;
      onDataLoaded({ _headers: lastCapture.headers, _rows: lastCapture.rows });
    });

    function renderStorageTable(data) {
      if (!data || !data.rows || !data.rows.length) {
        tableWrap.innerHTML = '<p class="dk-debug-msg">No storage data found.</p>';
        return;
      }
      var html = '<table class="dk-debug-table"><thead><tr>';
      for (var h = 0; h < data.headers.length; h++) {
        html += '<th>' + data.headers[h] + '</th>';
      }
      html += '</tr></thead><tbody>';
      for (var i = 0; i < data.rows.length; i++) {
        html += '<tr class="dk-expandable" data-idx="' + i + '">';
        for (var c = 0; c < data.rows[i].length; c++) {
          var val = String(data.rows[i][c] || '');
          html += '<td title="' + val.replace(/"/g, '&quot;') + '">' + truncate(val, 60) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      tableWrap.innerHTML = html;

      // Click to expand value
      var rows = tableWrap.querySelectorAll('tr.dk-expandable');
      for (var j = 0; j < rows.length; j++) {
        (function (row) {
          row.addEventListener('click', function () {
            var idx = parseInt(row.getAttribute('data-idx'), 10);
            if (storageExpandedRow) {
              try { storageExpandedRow.parentNode.removeChild(storageExpandedRow); } catch (e) { /* ok */ }
              storageExpandedRow = null;
            }
            var detail = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = data.headers.length;
            var content = document.createElement('div');
            content.className = 'dk-debug-expand';
            content.textContent = data.rows[idx].join('\n');
            td.appendChild(content);
            detail.appendChild(td);
            row.parentNode.insertBefore(detail, row.nextSibling);
            storageExpandedRow = detail;
          });
        })(rows[j]);
      }
    }
  }

  // =====================
  // DOM PANE
  // =====================
  function initDOM() {
    var pane = panes.dom;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var selectBtn = document.createElement('button');
    selectBtn.className = 'dk-debug-btn dk-debug-btn-primary';
    selectBtn.textContent = 'Select Table';

    var selectorInput = document.createElement('input');
    selectorInput.className = 'dk-debug-input';
    selectorInput.placeholder = 'CSS selector (e.g. table.data)';

    var extractBtn = document.createElement('button');
    extractBtn.className = 'dk-debug-btn';
    extractBtn.textContent = 'Extract by Selector';

    var loadBtn = document.createElement('button');
    loadBtn.className = 'dk-debug-btn';
    loadBtn.textContent = 'Load as Table';
    loadBtn.style.display = 'none';

    toolbar.appendChild(selectBtn);
    toolbar.appendChild(selectorInput);
    toolbar.appendChild(extractBtn);
    toolbar.appendChild(loadBtn);
    pane.appendChild(toolbar);

    var statusMsg = document.createElement('div');
    statusMsg.className = 'dk-debug-msg';
    statusMsg.textContent = 'Use "Select Table" to click a table on the page, or enter a CSS selector.';
    pane.appendChild(statusMsg);

    var previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'overflow-y:auto;flex:1;';
    pane.appendChild(previewWrap);

    var lastExtraction = null;
    var scraper = null;

    function handleData(data) {
      if (!data || !data.headers || !data.rows) {
        statusMsg.textContent = 'No table data extracted.';
        return;
      }
      lastExtraction = data;
      loadBtn.style.display = '';
      statusMsg.textContent = 'Extracted ' + data.rows.length + ' rows, ' + data.headers.length + ' columns.';
      renderPreview(data);
    }

    function renderPreview(data) {
      var html = '<table class="dk-debug-table"><thead><tr>';
      for (var h = 0; h < data.headers.length; h++) {
        html += '<th>' + data.headers[h] + '</th>';
      }
      html += '</tr></thead><tbody>';
      var limit = Math.min(data.rows.length, 20);
      for (var i = 0; i < limit; i++) {
        html += '<tr>';
        for (var c = 0; c < data.rows[i].length; c++) {
          html += '<td>' + truncate(String(data.rows[i][c] || ''), 40) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      if (data.rows.length > 20) {
        html += '<p class="dk-debug-msg">Showing first 20 of ' + data.rows.length + ' rows.</p>';
      }
      previewWrap.innerHTML = html;
    }

    selectBtn.addEventListener('click', function () {
      if (!window.WDK || typeof window.WDK.createDOMScraper !== 'function') {
        statusMsg.textContent = 'DOM scraper not available. Load inspect/dom-scraper.js first.';
        return;
      }
      if (!scraper) {
        scraper = window.WDK.createDOMScraper(function (data) {
          handleData(data);
        });
      }
      statusMsg.textContent = 'Click on a table in the page to extract it...';
      scraper.startSelect();
    });

    extractBtn.addEventListener('click', function () {
      var sel = selectorInput.value.trim();
      if (!sel) {
        statusMsg.textContent = 'Please enter a CSS selector.';
        return;
      }
      if (!window.WDK || typeof window.WDK.createDOMScraper !== 'function') {
        statusMsg.textContent = 'DOM scraper not available. Load inspect/dom-scraper.js first.';
        return;
      }
      if (!scraper) {
        scraper = window.WDK.createDOMScraper(function (data) {
          handleData(data);
        });
      }
      var data = scraper.extractBySelector(sel);
      handleData(data);
    });

    loadBtn.addEventListener('click', function () {
      if (!lastExtraction || typeof onDataLoaded !== 'function') return;
      onDataLoaded({ _headers: lastExtraction.headers, _rows: lastExtraction.rows });
    });
  }

  // =====================
  // EXPLORE PANE
  // =====================
  function initExplore() {
    var pane = panes.explore;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var refreshBtn = document.createElement('button');
    refreshBtn.className = 'dk-debug-btn dk-debug-btn-primary';
    refreshBtn.textContent = 'Scan Page';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'dk-debug-btn';
    exportBtn.textContent = 'Export JSON';

    toolbar.appendChild(refreshBtn);
    toolbar.appendChild(exportBtn);
    pane.appendChild(toolbar);

    var resultArea = document.createElement('div');
    resultArea.style.cssText = 'overflow-y:auto;flex:1;';
    resultArea.innerHTML = '<p class="dk-debug-msg">Click "Scan Page" to explore this page.</p>';
    pane.appendChild(resultArea);

    var lastReport = null;

    function renderSection(title, content) {
      return '<div style="margin-bottom:12px;">' +
        '<div style="color:' + T.cyan + ';font-size:11px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">' + title + '</div>' +
        content + '</div>';
    }

    function renderKV(pairs) {
      var html = '<table class="dk-debug-table"><tbody>';
      for (var i = 0; i < pairs.length; i++) {
        html += '<tr><td style="color:' + T.textDim + ';width:160px;">' + escapeHtml(pairs[i][0]) + '</td>';
        html += '<td>' + escapeHtml(String(pairs[i][1])) + '</td></tr>';
      }
      html += '</tbody></table>';
      return html;
    }

    function renderReport(report) {
      var html = '';

      // Meta info
      if (report.meta) {
        var m = report.meta;
        var pairs = [
          ['Title', m.title || '-'],
          ['URL', truncate(m.url || '-', 80)],
          ['Charset', m.charset || '-'],
          ['Doctype', m.doctype || '-']
        ];
        if (m.metas) {
          for (var i = 0; i < m.metas.length && i < 10; i++) {
            pairs.push(['meta:' + m.metas[i].name, truncate(m.metas[i].content, 80)]);
          }
        }
        html += renderSection('Page Info', renderKV(pairs));
      }

      // Performance
      if (report.performance) {
        var p = report.performance;
        var perfPairs = [];
        if (p.memory) {
          perfPairs.push(['Heap Used', p.memory.usedMB + ' MB']);
          perfPairs.push(['Heap Total', p.memory.totalMB + ' MB']);
          perfPairs.push(['Heap Limit', p.memory.limitMB + ' MB']);
        }
        if (p.timing) {
          if (p.timing.ttfb != null) perfPairs.push(['TTFB', p.timing.ttfb + ' ms']);
          if (p.timing.domContentLoaded != null) perfPairs.push(['DOMContentLoaded', p.timing.domContentLoaded + ' ms']);
          if (p.timing.loadComplete != null) perfPairs.push(['Load Complete', p.timing.loadComplete + ' ms']);
        }
        if (p.resources) {
          var rKeys = Object.keys(p.resources);
          for (var r = 0; r < rKeys.length; r++) {
            perfPairs.push(['Resources: ' + rKeys[r], String(p.resources[rKeys[r]])]);
          }
        }
        if (p.totalTransferKB != null) perfPairs.push(['Total Transfer', p.totalTransferKB + ' KB']);
        html += renderSection('Performance', renderKV(perfPairs));
      }

      // DOM Summary
      if (report.dom) {
        var d = report.dom;
        var domPairs = [
          ['Total Nodes', String(d.nodeCount || 0)],
          ['Max Depth', String(d.depth || 0)],
          ['iframes', String(d.iframes || 0)],
          ['Shadow Roots', String(d.shadowRoots || 0)],
          ['Images', String(d.images || 0)],
          ['Scripts', String(d.scripts || 0)],
          ['Stylesheets', String(d.stylesheets || 0)],
          ['Forms', String(d.forms || 0)],
          ['Data Attributes', String(d.dataAttributes || 0)]
        ];
        if (d.tagCounts) {
          var tagKeys = Object.keys(d.tagCounts);
          for (var t = 0; t < tagKeys.length && t < 10; t++) {
            domPairs.push(['<' + tagKeys[t] + '>', String(d.tagCounts[tagKeys[t]])]);
          }
        }
        html += renderSection('DOM Summary', renderKV(domPairs));
      }

      // Globals
      if (report.globals && report.globals.length > 0) {
        var gHtml = '<table class="dk-debug-table"><thead><tr><th>Name</th><th>Type</th><th>Preview</th></tr></thead><tbody>';
        for (var g = 0; g < report.globals.length && g < 50; g++) {
          var gl = report.globals[g];
          gHtml += '<tr><td style="color:' + T.cyan + ';">' + escapeHtml(gl.name) + '</td>';
          gHtml += '<td style="color:' + T.textDim + ';">' + escapeHtml(gl.type) + '</td>';
          gHtml += '<td>' + escapeHtml(truncate(gl.preview, 60)) + '</td></tr>';
        }
        gHtml += '</tbody></table>';
        if (report.globals.length > 50) {
          gHtml += '<p class="dk-debug-msg">Showing 50 of ' + report.globals.length + ' globals.</p>';
        }
        html += renderSection('Page Globals (' + report.globals.length + ')', gHtml);
      } else {
        html += renderSection('Page Globals', '<p class="dk-debug-msg">No app-specific globals found.</p>');
      }

      // Event Listeners
      if (report.listeners && report.listeners.length > 0) {
        var lHtml = '<table class="dk-debug-table"><thead><tr><th>Element</th><th>Events</th></tr></thead><tbody>';
        for (var l = 0; l < report.listeners.length && l < 30; l++) {
          var li = report.listeners[l];
          lHtml += '<tr><td style="color:' + T.cyan + ';">' + escapeHtml(li.selector) + '</td>';
          lHtml += '<td>' + escapeHtml((li.events || []).join(', ')) + '</td></tr>';
        }
        lHtml += '</tbody></table>';
        html += renderSection('Event Listeners (' + report.listeners.length + ')', lHtml);
      }

      resultArea.innerHTML = html || '<p class="dk-debug-msg">No data collected.</p>';
    }

    refreshBtn.addEventListener('click', function () {
      if (!window.DK || !window.DK.pageExplorer) {
        resultArea.innerHTML = '<p class="dk-debug-msg">Page explorer not available. Load inspect/page-explorer.js first.</p>';
        return;
      }
      resultArea.innerHTML = '<p class="dk-debug-msg">Scanning...</p>';
      try {
        lastReport = window.DK.pageExplorer.explore();
        renderReport(lastReport);
        setBadge('explore', lastReport.globals ? lastReport.globals.length : 0);
      } catch (e) {
        resultArea.innerHTML = '<p class="dk-debug-msg" style="color:' + T.error + ';">Error: ' + escapeHtml(e.message) + '</p>';
      }
    });

    exportBtn.addEventListener('click', function () {
      if (!lastReport) return;
      var blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'page-explore-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // --- Initialize all panes ---
  initNetwork();
  initConsole();
  initStorage();
  initDOM();
  initExplore();

  // Activate first tab
  switchTab('network');

  return {
    switchTab: switchTab,
    getNetworkInterceptor: function () { return networkInterceptor; },
    getConsoleCapture: function () { return consoleCapture; }
  };
}

// --- ui/app-shell.js ---

/**
 * WDK App Shell
 * Full-page standalone application shell for Tier 2 deployment.
 * Detects bookmarklet vs standalone mode and routes accordingly.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

/* global createPanel, createFileImport, renderTable, createREPL, createPivotPanel, createNotebook, createBuildConfig, createDebugPanel, aggregate, pivot, execSQL, toCSV, toJSON, downloadBlob, createCommandPalette, AuditLog, toXLSX, downloadXLSX */

var DK_SHELL_THEME = {
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
  shadowPink: 'rgba(255, 41, 117, 0.12)',
};

function injectShellStyles() {
  if (document.getElementById('dk-shell-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-shell-styles';
  style.textContent = [
    /* Reset */
    '*, *::before, *::after { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }',
    'body {',
    '  background: ' + DK_SHELL_THEME.bg + ';',
    '  color: ' + DK_SHELL_THEME.text + ';',
    '  font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;',
    '  font-size: 13px;',
    '}',

    /* Shell layout */
    '#dk-shell {',
    '  display: flex; flex-direction: column; height: 100vh;',
    '  min-width: 800px;',
    '}',

    /* Header */
    '#dk-shell-header {',
    '  display: flex; align-items: center; gap: 12px;',
    '  padding: 0 16px; height: 44px; flex-shrink: 0;',
    '  background: linear-gradient(135deg, ' + DK_SHELL_THEME.bgLight + ' 0%, ' + DK_SHELL_THEME.bg + ' 100%);',
    '  border-bottom: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  box-shadow: 0 2px 16px ' + DK_SHELL_THEME.shadow + ';',
    '}',
    '#dk-shell-wordmark {',
    '  font-size: 15px; font-weight: 700; letter-spacing: 2px;',
    '  background: linear-gradient(90deg, ' + DK_SHELL_THEME.cyan + ' 0%, ' + DK_SHELL_THEME.purple + ' 60%, ' + DK_SHELL_THEME.pink + ' 100%);',
    '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '  background-clip: text; user-select: none;',
    '}',
    '#dk-shell-tagline {',
    '  font-size: 11px; color: ' + DK_SHELL_THEME.textMuted + '; letter-spacing: 0.5px;',
    '  border-left: 1px solid ' + DK_SHELL_THEME.border + '; padding-left: 12px;',
    '}',
    '#dk-shell-header-spacer { flex: 1; }',

    /* Toolbar */
    '#dk-shell-toolbar {',
    '  display: flex; align-items: center; gap: 4px;',
    '  padding: 5px 12px; flex-shrink: 0;',
    '  background: ' + DK_SHELL_THEME.bgPanel + ';',
    '  border-bottom: 1px solid ' + DK_SHELL_THEME.border + ';',
    '}',
    '.dk-toolbar-btn {',
    '  display: flex; align-items: center; gap: 5px;',
    '  padding: 4px 10px; border: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  border-radius: 4px; background: ' + DK_SHELL_THEME.bgHover + ';',
    '  color: ' + DK_SHELL_THEME.text + '; cursor: pointer;',
    '  font-family: inherit; font-size: 12px;',
    '  transition: background 0.12s, border-color 0.12s, color 0.12s;',
    '  white-space: nowrap;',
    '}',
    '.dk-toolbar-btn:hover {',
    '  background: ' + DK_SHELL_THEME.bgActive + ';',
    '  border-color: ' + DK_SHELL_THEME.borderBright + ';',
    '  color: ' + DK_SHELL_THEME.cyan + ';',
    '}',
    '.dk-toolbar-btn:disabled {',
    '  opacity: 0.35; cursor: not-allowed;',
    '}',
    '.dk-toolbar-btn:disabled:hover {',
    '  background: ' + DK_SHELL_THEME.bgHover + ';',
    '  border-color: ' + DK_SHELL_THEME.border + ';',
    '  color: ' + DK_SHELL_THEME.text + ';',
    '}',
    '.dk-toolbar-btn-icon { font-size: 14px; }',
    '.dk-toolbar-sep {',
    '  width: 1px; height: 20px;',
    '  background: ' + DK_SHELL_THEME.border + ';',
    '  margin: 0 4px; flex-shrink: 0;',
    '}',
    '#dk-col-types {',
    '  display: flex; gap: 4px; align-items: center;',
    '  margin-left: 8px; overflow: hidden;',
    '}',
    '.dk-col-badge {',
    '  font-size: 10px; padding: 1px 5px; border-radius: 3px;',
    '  background: ' + DK_SHELL_THEME.bgActive + ';',
    '  border: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  color: ' + DK_SHELL_THEME.textDim + ';',
    '  white-space: nowrap;',
    '}',
    '.dk-col-badge-num { color: ' + DK_SHELL_THEME.cyan + '; border-color: ' + DK_SHELL_THEME.cyan + '44; }',
    '.dk-col-badge-str { color: ' + DK_SHELL_THEME.purple + '; border-color: ' + DK_SHELL_THEME.purple + '44; }',
    '.dk-col-badge-bool { color: ' + DK_SHELL_THEME.yellow + '; border-color: ' + DK_SHELL_THEME.yellow + '44; }',
    '.dk-col-badge-more { color: ' + DK_SHELL_THEME.textDim + '; }',

    /* Content zone */
    '#dk-shell-content {',
    '  flex: 1; display: flex; flex-direction: column; overflow: hidden;',
    '}',

    /* Welcome / import view */
    '#dk-shell-welcome {',
    '  flex: 1; display: flex; align-items: center; justify-content: center;',
    '  padding: 40px 24px;',
    '}',
    '#dk-shell-import-wrap {',
    '  width: 100%; max-width: 560px;',
    '}',
    '#dk-shell-welcome-title {',
    '  text-align: center; margin-bottom: 28px;',
    '}',
    '#dk-shell-welcome-title h2 {',
    '  margin: 0 0 8px; font-size: 22px; font-weight: 700;',
    '  background: linear-gradient(90deg, ' + DK_SHELL_THEME.cyan + ', ' + DK_SHELL_THEME.purple + ');',
    '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '  background-clip: text;',
    '}',
    '#dk-shell-welcome-title p {',
    '  margin: 0; font-size: 12px; color: ' + DK_SHELL_THEME.textDim + ';',
    '}',

    /* Data view: table + repl split */
    '#dk-shell-data-view {',
    '  flex: 1; display: flex; flex-direction: column; overflow: hidden;',
    '  display: none;',
    '}',
    '#dk-shell-data-view.dk-active { display: flex; }',
    '#dk-shell-table-pane {',
    '  flex: 1; overflow: auto; min-height: 120px;',
    '  border-bottom: 1px solid ' + DK_SHELL_THEME.border + ';',
    '}',
    '#dk-shell-split-handle {',
    '  height: 5px; flex-shrink: 0; cursor: ns-resize;',
    '  background: ' + DK_SHELL_THEME.border + ';',
    '  transition: background 0.12s;',
    '}',
    '#dk-shell-split-handle:hover { background: ' + DK_SHELL_THEME.purple + '; }',
    '#dk-shell-repl-pane {',
    '  height: 280px; min-height: 80px; flex-shrink: 0; overflow: hidden;',
    '  display: flex; flex-direction: column;',
    '}',

    /* Status bar */
    '#dk-shell-status {',
    '  display: flex; align-items: center; gap: 16px;',
    '  padding: 3px 14px; height: 24px; flex-shrink: 0;',
    '  background: ' + DK_SHELL_THEME.bgPanel + ';',
    '  border-top: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  font-size: 11px; color: ' + DK_SHELL_THEME.textDim + ';',
    '}',
    '.dk-status-item { display: flex; align-items: center; gap: 4px; }',
    '.dk-status-val { color: ' + DK_SHELL_THEME.text + '; font-weight: 500; }',
    '#dk-status-filename { color: ' + DK_SHELL_THEME.cyan + '; }',
    '.dk-status-sep {',
    '  width: 1px; height: 12px; background: ' + DK_SHELL_THEME.border + ';',
    '}',
    '#dk-shell-kbd-hints {',
    '  margin-left: auto; color: ' + DK_SHELL_THEME.textMuted + '; font-size: 10px;',
    '  letter-spacing: 0.3px;',
    '}',

    /* Notification toast */
    '#dk-shell-toast {',
    '  position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%);',
    '  padding: 7px 18px; border-radius: 5px;',
    '  background: ' + DK_SHELL_THEME.bgActive + ';',
    '  border: 1px solid ' + DK_SHELL_THEME.borderBright + ';',
    '  color: ' + DK_SHELL_THEME.text + '; font-size: 12px;',
    '  box-shadow: 0 4px 20px rgba(0,0,0,0.4);',
    '  opacity: 0; pointer-events: none;',
    '  transition: opacity 0.18s;',
    '  z-index: 9999;',
    '}',
    '#dk-shell-toast.dk-visible { opacity: 1; }',

    /* Sheet tabs */
    '#dk-shell-sheet-tabs button:hover { color: ' + DK_SHELL_THEME.cyan + '; }',

    /* Focus-visible accessibility */
    '*:focus-visible {',
    '  outline: 2px solid #00e5ff;',
    '  outline-offset: 2px;',
    '}',
    '.dk-toolbar-btn:focus-visible {',
    '  outline: 2px solid #00e5ff;',
    '  outline-offset: 1px;',
    '  box-shadow: 0 0 8px rgba(0, 229, 255, 0.25);',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Detect if we are running as a full standalone page or injected into another page.
 * Standalone: the document body has no pre-existing meaningful content,
 * or the page URL ends in datakit.html / is a file:// origin.
 * @returns {boolean}
 */
function isStandaloneMode() {
  var loc = window.location;
  // file:// protocol — always standalone
  if (loc.protocol === 'file:') return true;
  // URL pathname ends with datakit.html
  if (loc.pathname && /wdk\.html?$/i.test(loc.pathname)) return true;
  // Body has no children at all yet (freshly opened page)
  if (document.body && document.body.children.length === 0) return true;
  return false;
}

/**
 * Guess a type classification for a column's values.
 * Returns 'num', 'bool', or 'str'.
 * @param {any[]} values
 * @returns {string}
 */
function guessColType(values) {
  var sample = values.slice(0, 50).filter(function (v) { return v !== null && v !== undefined && v !== ''; });
  if (sample.length === 0) return 'str';
  var numCount = 0;
  var boolCount = 0;
  for (var i = 0; i < sample.length; i++) {
    var s = String(sample[i]).trim().toLowerCase();
    if (s === 'true' || s === 'false') { boolCount++; continue; }
    if (!isNaN(s) && s !== '') numCount++;
  }
  if (numCount >= sample.length * 0.8) return 'num';
  if (boolCount >= sample.length * 0.8) return 'bool';
  return 'str';
}

/**
 * Build column type badges from a DataFrame.
 * Returns an array of { name, type } objects.
 * @param {object} df
 * @returns {Array}
 */
function buildColTypes(df) {
  var headers = df._headers || [];
  var rows = df._rows || [];
  return headers.map(function (h, i) {
    var values = rows.map(function (r) { return r[i]; });
    return { name: h, type: guessColType(values) };
  });
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Create and mount the full-page application shell.
 * Should be called once on DOMContentLoaded.
 */
function createAppShell() {
  injectShellStyles();

  var currentDf = null;
  var currentFilename = null;
  var currentSheets = null;
  var currentSheetIndex = 0;
  var replInstance = null;
  var pivotInstance = null;
  var notebookInstance = null;
  var toastTimer = null;

  // ─── Toast notification ──────────────────────────────────────────

  var toast = document.createElement('div');
  toast.id = 'dk-shell-toast';
  document.body.appendChild(toast);

  function showToast(msg, durationMs) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('dk-visible');
    toastTimer = setTimeout(function () {
      toast.classList.remove('dk-visible');
    }, durationMs || 2200);
  }

  // ─── Shell skeleton ───────────────────────────────────────────────

  var shell = document.createElement('div');
  shell.id = 'dk-shell';

  // Header
  var header = document.createElement('div');
  header.id = 'dk-shell-header';
  header.setAttribute('role', 'banner');

  var wordmark = document.createElement('span');
  wordmark.id = 'dk-shell-wordmark';
  wordmark.textContent = 'WDK';

  var tagline = document.createElement('span');
  tagline.id = 'dk-shell-tagline';
  tagline.textContent = "Wizard's Data Engineering Kit";

  var headerSpacer = document.createElement('span');
  headerSpacer.id = 'dk-shell-header-spacer';

  header.appendChild(wordmark);
  header.appendChild(tagline);
  header.appendChild(headerSpacer);

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.id = 'dk-shell-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Data tools');

  function makeToolbarBtn(icon, label, title, shortcut) {
    var btn = document.createElement('button');
    btn.className = 'dk-toolbar-btn';
    btn.title = title + (shortcut ? '  (' + shortcut + ')' : '');
    btn.setAttribute('aria-label', title + (shortcut ? ' (' + shortcut + ')' : ''));
    var iconSpan = document.createElement('span');
    iconSpan.className = 'dk-toolbar-btn-icon';
    iconSpan.textContent = icon;
    btn.appendChild(iconSpan);
    btn.appendChild(document.createTextNode(label));
    return btn;
  }

  function makeToolbarSep() {
    var sep = document.createElement('div');
    sep.className = 'dk-toolbar-sep';
    return sep;
  }

  var btnImport = makeToolbarBtn('\u2913', 'Import', 'Import a file', 'Ctrl+I');
  var btnExportCSV = makeToolbarBtn('\u2191', 'CSV', 'Export as CSV', 'Ctrl+E');
  var btnExportJSON = makeToolbarBtn('\u2191', 'JSON', 'Export as JSON');
  var btnExportXLSX = makeToolbarBtn('\u2191', 'XLSX', 'Export as Excel');
  var btnClear = makeToolbarBtn('\u2715', 'Clear', 'Clear loaded data', 'Ctrl+L');

  btnExportCSV.disabled = true;
  btnExportJSON.disabled = true;
  btnExportXLSX.disabled = true;
  btnClear.disabled = true;

  var colTypeContainer = document.createElement('div');
  colTypeContainer.id = 'dk-col-types';

  var btnScanner = makeToolbarBtn('\u26a0', 'Scanner', 'File preflight scanner');
  var btnHelp = makeToolbarBtn('?', 'Help', 'Keyboard shortcuts and usage guide', 'F1');
  var btnSettings = makeToolbarBtn('\u2699', 'Settings', 'User preferences');

  toolbar.appendChild(btnImport);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnExportCSV);
  toolbar.appendChild(btnExportJSON);
  toolbar.appendChild(btnExportXLSX);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnScanner);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnClear);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnHelp);
  toolbar.appendChild(btnSettings);

  var btnAudit = makeToolbarBtn('\u2261', 'Audit', 'Download audit log (JSON Lines)');
  btnAudit.addEventListener('click', function() {
    if (typeof AuditLog !== 'undefined') {
      AuditLog.download();
      showToast('Audit log downloaded (' + AuditLog.count() + ' entries)');
    }
  });
  toolbar.appendChild(btnAudit);

  toolbar.appendChild(colTypeContainer);

  // Keyboard navigation for toolbar: arrow keys move between buttons
  toolbar.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var btns = toolbar.querySelectorAll('.dk-toolbar-btn');
    var idx = -1;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i] === document.activeElement) { idx = i; break; }
    }
    if (idx === -1) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') {
      idx = (idx + 1) % btns.length;
    } else {
      idx = (idx - 1 + btns.length) % btns.length;
    }
    btns[idx].focus();
  });

  // Content area
  var content = document.createElement('div');
  content.id = 'dk-shell-content';
  content.setAttribute('role', 'main');

  // Welcome / import view
  var welcomeView = document.createElement('div');
  welcomeView.id = 'dk-shell-welcome';

  var welcomeTitleWrap = document.createElement('div');
  welcomeTitleWrap.id = 'dk-shell-welcome-title';

  var welcomeH2 = document.createElement('h2');
  welcomeH2.textContent = 'Open a data file';

  var welcomeP = document.createElement('p');
  welcomeP.textContent = 'Drop a .csv, .tsv, or .json file below — or click Browse to get started';

  welcomeTitleWrap.appendChild(welcomeH2);
  welcomeTitleWrap.appendChild(welcomeP);

  var importWrap = document.createElement('div');
  importWrap.id = 'dk-shell-import-wrap';
  importWrap.appendChild(welcomeTitleWrap);

  welcomeView.appendChild(importWrap);

  // Data view (table + REPL)
  var dataView = document.createElement('div');
  dataView.id = 'dk-shell-data-view';

  var sheetTabBar = document.createElement('div');
  sheetTabBar.id = 'dk-shell-sheet-tabs';
  sheetTabBar.style.cssText = 'display:none;gap:0;background:#0a0a1a;border-bottom:1px solid ' + DK_SHELL_THEME.border + ';flex-shrink:0;overflow-x:auto;white-space:nowrap;';
  sheetTabBar.setAttribute('role', 'tablist');
  sheetTabBar.setAttribute('aria-label', 'Spreadsheet sheets');

  var tablePane = document.createElement('div');
  tablePane.id = 'dk-shell-table-pane';

  var splitHandle = document.createElement('div');
  splitHandle.id = 'dk-shell-split-handle';

  var replPane = document.createElement('div');
  replPane.id = 'dk-shell-repl-pane';
  replPane.setAttribute('role', 'tabpanel');
  replPane.setAttribute('aria-label', 'REPL');

  var pivotPane = document.createElement('div');
  pivotPane.id = 'dk-shell-pivot-pane';
  pivotPane.setAttribute('role', 'tabpanel');
  pivotPane.setAttribute('aria-label', 'Pivot');
  pivotPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var notebookPane = document.createElement('div');
  notebookPane.id = 'dk-shell-notebook-pane';
  notebookPane.setAttribute('role', 'tabpanel');
  notebookPane.setAttribute('aria-label', 'Notebook');
  notebookPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  // ─── Empty state messages ──────────────────────────────────────────
  function _makeEmptyState(icon, msg) {
    var emptyEl = document.createElement('div');
    emptyEl.className = 'dk-empty-state';
    emptyEl.style.cssText = 'display:flex;align-items:center;justify-content:center;flex:1;padding:24px;text-align:center;color:' + DK_SHELL_THEME.textDim + ';font-style:italic;font-size:12px;opacity:0.7;';
    emptyEl.innerHTML = '<span style="font-size:18px;margin-right:8px;opacity:0.5;">' + icon + '</span> ' + msg;
    return emptyEl;
  }

  var replEmptyState = _makeEmptyState('\u2328', 'Load a data file to start scripting. Variables: data, rows, headers, meta');
  var pivotEmptyState = _makeEmptyState('\u2696', 'Load a data file to use pivot and aggregation tools');
  var notebookEmptyState = _makeEmptyState('\ud83d\udcd3', 'Load a data file to use the notebook. Supports JS, SQL, and Markdown cells.');
  replPane.appendChild(replEmptyState);
  pivotPane.appendChild(pivotEmptyState);
  notebookPane.appendChild(notebookEmptyState);

  var buildPane = document.createElement('div');
  buildPane.id = 'dk-shell-build-pane';
  buildPane.setAttribute('role', 'tabpanel');
  buildPane.setAttribute('aria-label', 'Build');
  buildPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var debugPane = document.createElement('div');
  debugPane.id = 'dk-shell-debug-pane';
  debugPane.setAttribute('role', 'tabpanel');
  debugPane.setAttribute('aria-label', 'Debug');
  debugPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  // Bottom panel tab bar
  var bottomTabBar = document.createElement('div');
  bottomTabBar.style.cssText = 'display:flex;gap:0;background:#0a0a1a;border-bottom:1px solid ' + DK_SHELL_THEME.border + ';flex-shrink:0;';
  bottomTabBar.setAttribute('role', 'tablist');
  bottomTabBar.setAttribute('aria-label', 'Bottom panels');
  var bottomPanes = { repl: replPane, pivot: pivotPane, notebook: notebookPane, build: buildPane, debug: debugPane };
  function makeBottomTab(label, target) {
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.style.cssText = 'background:transparent;color:' + DK_SHELL_THEME.textDim + ';border:none;border-bottom:2px solid transparent;padding:4px 12px;cursor:pointer;font-family:inherit;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
    btn.addEventListener('click', function () {
      Object.keys(bottomPanes).forEach(function (k) { bottomPanes[k].style.display = k === target ? 'flex' : 'none'; });
      bottomTabBar.querySelectorAll('button').forEach(function (b) {
        b.style.color = DK_SHELL_THEME.textDim;
        b.style.borderBottomColor = 'transparent';
        b.setAttribute('aria-selected', 'false');
      });
      btn.style.color = DK_SHELL_THEME.cyan;
      btn.style.borderBottomColor = DK_SHELL_THEME.cyan;
      btn.setAttribute('aria-selected', 'true');
    });
    return btn;
  }
  var replTab = makeBottomTab('REPL', 'repl');
  var pivotTab = makeBottomTab('Pivot', 'pivot');
  var notebookTab = makeBottomTab('Notebook', 'notebook');
  replTab.style.color = DK_SHELL_THEME.cyan;
  replTab.style.borderBottomColor = DK_SHELL_THEME.cyan;
  replTab.setAttribute('aria-selected', 'true');
  var buildTab = makeBottomTab('Build', 'build');
  var debugTab = makeBottomTab('Debug', 'debug');
  bottomTabBar.appendChild(replTab);
  bottomTabBar.appendChild(pivotTab);
  bottomTabBar.appendChild(notebookTab);
  bottomTabBar.appendChild(buildTab);
  bottomTabBar.appendChild(debugTab);

  // Bottom panel container
  var bottomPanel = document.createElement('div');
  bottomPanel.style.cssText = 'height:280px;min-height:80px;flex-shrink:0;overflow:hidden;display:flex;flex-direction:column;';
  bottomPanel.appendChild(bottomTabBar);
  bottomPanel.appendChild(replPane);
  bottomPanel.appendChild(pivotPane);
  bottomPanel.appendChild(notebookPane);
  bottomPanel.appendChild(buildPane);
  bottomPanel.appendChild(debugPane);

  dataView.appendChild(sheetTabBar);
  dataView.appendChild(tablePane);

  // Scanner view (full-content, independent of data view)
  var scannerView = document.createElement('div');
  scannerView.id = 'dk-shell-scanner-view';
  scannerView.style.cssText = 'flex:1;overflow:auto;display:none;';

  var scannerInitialized = false;
  btnScanner.addEventListener('click', function () {
    var showing = scannerView.style.display !== 'none';
    if (showing) {
      scannerView.style.display = 'none';
      welcomeView.style.display = '';
      dataView.style.display = '';
      btnScanner.style.borderColor = DK_SHELL_THEME.border;
      btnScanner.style.color = DK_SHELL_THEME.text;
    } else {
      welcomeView.style.display = 'none';
      dataView.style.display = 'none';
      scannerView.style.display = 'flex';
      btnScanner.style.borderColor = DK_SHELL_THEME.cyan;
      btnScanner.style.color = DK_SHELL_THEME.cyan;
      if (!scannerInitialized && typeof createScannerPanel === 'function') {
        createScannerPanel(scannerView);
        scannerInitialized = true;
      }
    }
  });

  content.appendChild(welcomeView);
  content.appendChild(dataView);
  content.appendChild(scannerView);
  content.appendChild(splitHandle);
  content.appendChild(bottomPanel);

  // Init build configurator (doesn't need data)
  if (typeof createBuildConfig === 'function') {
    createBuildConfig(buildPane);
  }

  // Init debug panel (doesn't need data)
  var debugInstance = null;
  if (typeof createDebugPanel === 'function') {
    debugInstance = createDebugPanel(debugPane, onDataLoaded);
  }

  // Status bar
  var statusBar = document.createElement('div');
  statusBar.id = 'dk-shell-status';
  statusBar.setAttribute('role', 'contentinfo');

  function makeStatusItem(id, label) {
    var item = document.createElement('span');
    item.className = 'dk-status-item';
    if (label) {
      var lbl = document.createElement('span');
      lbl.textContent = label;
      item.appendChild(lbl);
    }
    var val = document.createElement('span');
    val.className = 'dk-status-val';
    if (id) val.id = id;
    item.appendChild(val);
    return { item: item, val: val };
  }

  var filenameItem = makeStatusItem('dk-status-filename', '');
  filenameItem.val.id = 'dk-status-filename';
  var rowsItem = makeStatusItem('dk-status-rows', 'Rows:');
  var colsItem = makeStatusItem('dk-status-cols', 'Cols:');
  var sizeItem = makeStatusItem('dk-status-size', 'Size:');
  var statusSep1 = document.createElement('span');
  statusSep1.className = 'dk-status-sep';
  var statusSep2 = document.createElement('span');
  statusSep2.className = 'dk-status-sep';
  var statusSep3 = document.createElement('span');
  statusSep3.className = 'dk-status-sep';

  var kbdHints = document.createElement('span');
  kbdHints.id = 'dk-shell-kbd-hints';
  kbdHints.textContent = 'Ctrl+I import \u00b7 Ctrl+E export CSV \u00b7 Ctrl+L clear';

  statusBar.appendChild(filenameItem.item);
  statusBar.appendChild(statusSep1);
  statusBar.appendChild(rowsItem.item);
  statusBar.appendChild(statusSep2);
  statusBar.appendChild(colsItem.item);
  statusBar.appendChild(statusSep3);
  statusBar.appendChild(sizeItem.item);
  statusBar.appendChild(kbdHints);

  // Assemble shell
  shell.appendChild(header);
  shell.appendChild(toolbar);
  shell.appendChild(content);
  shell.appendChild(statusBar);

  document.body.appendChild(shell);

  // ─── File import widget ───────────────────────────────────────────

  if (typeof createFileImport === 'function') {
    createFileImport(importWrap, onDataLoaded);
  }

  // ─── REPL context factory ─────────────────────────────────────────

  function getREPLContext() {
    if (!currentDf) {
      return { data: [], rows: [], headers: [], meta: { rowCount: 0, columnCount: 0 } };
    }
    var headers = currentDf._headers || [];
    var rows = currentDf._rows || [];
    var data;
    if (typeof currentDf.toObjects === 'function') {
      data = currentDf.toObjects();
    } else {
      data = rows.map(function (row) {
        var obj = {};
        headers.forEach(function (h, i) { obj[h] = row[i]; });
        return obj;
      });
    }
    return {
      data: data,
      rows: rows,
      headers: headers,
      meta: { rowCount: rows.length, columnCount: headers.length }
    };
  }

  // ─── Data loaded callback ─────────────────────────────────────────

  function renderSheetTabs() {
    sheetTabBar.innerHTML = '';
    if (!currentSheets || currentSheets.length <= 1) {
      sheetTabBar.style.display = 'none';
      return;
    }
    sheetTabBar.style.display = 'flex';
    currentSheets.forEach(function (sheet, idx) {
      var btn = document.createElement('button');
      btn.textContent = sheet.name;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === currentSheetIndex ? 'true' : 'false');
      btn.style.cssText = 'background:transparent;border:none;border-bottom:2px solid transparent;padding:5px 14px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.3px;color:' + (idx === currentSheetIndex ? DK_SHELL_THEME.cyan : DK_SHELL_THEME.textDim) + ';' + (idx === currentSheetIndex ? 'border-bottom-color:' + DK_SHELL_THEME.cyan + ';' : '');
      btn.addEventListener('click', function () {
        currentSheetIndex = idx;
        var s = currentSheets[idx];
        var dt = new DataFrame(s.headers, s.rows);
        dt._xlsxSheets = currentSheets;
        currentDf = dt;
        tablePane.innerHTML = '';
        if (typeof renderTable === 'function') renderTable(tablePane, dt);
        updateColTypeBadges(dt);
        var rows = dt._rows || [];
        var headers = dt._headers || [];
        rowsItem.val.textContent = rows.length.toLocaleString();
        colsItem.val.textContent = headers.length.toLocaleString();
        sizeItem.val.textContent = formatBytes(JSON.stringify(rows).length);
        renderSheetTabs();
      });
      sheetTabBar.appendChild(btn);
    });
  }

  function onDataLoaded(table, filename) {
    currentDf = table;
    currentFilename = filename || 'data';

    // Track XLSX sheets
    currentSheets = table._xlsxSheets || null;
    currentSheetIndex = 0;
    renderSheetTabs();

    // Switch views
    welcomeView.style.display = 'none';
    dataView.classList.add('dk-active');

    // Render table
    if (typeof renderTable === 'function') {
      tablePane.innerHTML = '';
      renderTable(tablePane, table);
    }

    // Create REPL once
    if (typeof createREPL === 'function' && !replInstance) {
      replPane.innerHTML = '';
      replInstance = createREPL(replPane, getREPLContext);
      // First REPL use hint — listen for Enter key in REPL pane
      replPane.addEventListener('keydown', function _replHint(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          showHint('shift_enter', 'Tip: Use Shift+Enter for multiline in REPL');
          replPane.removeEventListener('keydown', _replHint);
        }
      });
    }

    // Create Pivot panel once, refresh columns on each load
    if (typeof createPivotPanel === 'function') {
      if (!pivotInstance) {
        pivotPane.innerHTML = '';
        pivotInstance = createPivotPanel(pivotPane, function () { return currentDf; });
      }
      pivotInstance.refresh();
    }

    // Create Notebook once, with welcome template
    if (typeof createNotebook === 'function' && !notebookInstance) {
      notebookPane.innerHTML = '';
      notebookInstance = createNotebook(notebookPane, getREPLContext);

      // Welcome cells
      var welcomeMD = notebookInstance.addCell('md');
      welcomeMD.setValue('# Welcome to WDK Notebook\n\nUse **JS**, **SQL**, or **Markdown** cells to explore your data.\nPress `Shift+Enter` to run a cell. Drag the \u2801\u2801\u2801 handle to reorder.');
      welcomeMD.run();

      var welcomeSQL = notebookInstance.addCell('sql');
      welcomeSQL.setValue('SELECT * FROM df LIMIT 10');

      var welcomeJS = notebookInstance.addCell('js');
      welcomeJS.setValue('// Try: data.filter(r => r.salary > 50000).length');
    }

    // Hide empty state messages
    if (replEmptyState.parentNode) replEmptyState.parentNode.removeChild(replEmptyState);
    if (pivotEmptyState.parentNode) pivotEmptyState.parentNode.removeChild(pivotEmptyState);
    if (notebookEmptyState.parentNode) notebookEmptyState.parentNode.removeChild(notebookEmptyState);

    // Update status bar
    var headers = table._headers || [];
    var rows = table._rows || [];
    var byteEst = JSON.stringify(rows).length;
    filenameItem.val.textContent = currentFilename;
    rowsItem.val.textContent = rows.length.toLocaleString();
    colsItem.val.textContent = headers.length.toLocaleString();
    sizeItem.val.textContent = formatBytes(byteEst);

    // Update column type badges
    updateColTypeBadges(table);

    // Enable export + clear
    btnExportCSV.disabled = false;
    btnExportJSON.disabled = false;
    btnExportXLSX.disabled = false;
    btnClear.disabled = false;

    showToast('\u2713 Loaded ' + currentFilename + ' \u2014 ' + rows.length.toLocaleString() + ' rows');
    if (typeof AuditLog !== 'undefined') { AuditLog.logImport(currentFilename, rows.length, headers.length, byteEst); }

    // First-load hint
    showHint('ctrl_p', 'Tip: Use Ctrl+P to open the command palette');
  }

  // ─── Tooltip hints (shown once per key, persisted in localStorage) ──
  var seenHints = {};
  try { seenHints = JSON.parse(localStorage.getItem('wdk_seen_hints') || '{}'); } catch(_) {}
  function showHint(key, msg) {
    if (seenHints[key]) return;
    seenHints[key] = true;
    try { localStorage.setItem('wdk_seen_hints', JSON.stringify(seenHints)); } catch(_) {}
    setTimeout(function() { showToast(msg, 4000); }, 1500);
  }

  // ─── Column type badges ───────────────────────────────────────────

  function updateColTypeBadges(table) {
    colTypeContainer.innerHTML = '';
    var colTypes = buildColTypes(table);
    var maxBadges = 6;
    var shown = Math.min(colTypes.length, maxBadges);

    for (var i = 0; i < shown; i++) {
      var ct = colTypes[i];
      var badge = document.createElement('span');
      badge.className = 'dk-col-badge dk-col-badge-' + ct.type;
      badge.title = ct.name + ' (' + ct.type + ')';
      var truncName = ct.name.length > 10 ? ct.name.slice(0, 9) + '\u2026' : ct.name;
      badge.textContent = truncName + ':' + ct.type;
      colTypeContainer.appendChild(badge);
    }

    if (colTypes.length > maxBadges) {
      var moreBadge = document.createElement('span');
      moreBadge.className = 'dk-col-badge dk-col-badge-more';
      moreBadge.textContent = '+' + (colTypes.length - maxBadges) + ' more';
      colTypeContainer.appendChild(moreBadge);
    }
  }

  // ─── Export helpers ───────────────────────────────────────────────

  function exportCSV() {
    if (!currentDf) return;
    if (typeof toCSV !== 'function' || typeof downloadBlob !== 'function') {
      showToast('Export functions not available');
      return;
    }
    var csvContent = toCSV({
      headers: currentDf._headers || [],
      rows: currentDf._rows || []
    });
    var name = (currentFilename || 'export').replace(/\.[^.]+$/, '') + '.csv';
    downloadBlob(csvContent, name, 'text/csv');
    showToast('\u2193 Exported ' + name);
    if (typeof AuditLog !== 'undefined') { AuditLog.logExport(name, 'csv', (currentDf._rows || []).length); }
  }

  function exportJSON() {
    if (!currentDf) return;
    if (typeof toJSON !== 'function' || typeof downloadBlob !== 'function') {
      showToast('Export functions not available');
      return;
    }
    var jsonContent = toJSON({
      headers: currentDf._headers || [],
      rows: currentDf._rows || []
    }, { pretty: true, asArray: true });
    var name = (currentFilename || 'export').replace(/\.[^.]+$/, '') + '.json';
    downloadBlob(jsonContent, name, 'application/json');
    showToast('\u2193 Exported ' + name);
    if (typeof AuditLog !== 'undefined') { AuditLog.logExport(name, 'json', (currentDf._rows || []).length); }
  }

  function exportXLSX() {
    if (!currentDf) return;
    if (typeof toXLSX !== 'function') {
      showToast('XLSX export not available');
      return;
    }
    var name = (currentFilename || 'export').replace(/\.[^.]+$/, '') + '.xlsx';
    downloadXLSX({ headers: currentDf._headers || [], rows: currentDf._rows || [] }, name);
    showToast('\u2193 Exported ' + name);
    if (typeof AuditLog !== 'undefined') { AuditLog.logExport(name, 'xlsx', (currentDf._rows || []).length); }
  }

  // ─── Clear ────────────────────────────────────────────────────────

  function clearData() {
    if (typeof AuditLog !== 'undefined') { AuditLog.logClear(); }
    currentDf = null;
    currentFilename = null;
    currentSheets = null;
    currentSheetIndex = 0;
    replInstance = null;
    sheetTabBar.style.display = 'none';
    sheetTabBar.innerHTML = '';

    dataView.classList.remove('dk-active');
    welcomeView.style.display = '';
    tablePane.innerHTML = '';
    replPane.innerHTML = '';
    colTypeContainer.innerHTML = '';

    filenameItem.val.textContent = '';
    rowsItem.val.textContent = '';
    colsItem.val.textContent = '';
    sizeItem.val.textContent = '';

    btnExportCSV.disabled = true;
    btnExportJSON.disabled = true;
    btnExportXLSX.disabled = true;
    btnClear.disabled = true;
  }

  // ─── Toolbar events ───────────────────────────────────────────────

  btnImport.addEventListener('click', function () {
    // Trigger the hidden file input inside the import widget
    var fileInput = importWrap.querySelector('input[type="file"]');
    if (fileInput) fileInput.click();
  });

  btnExportCSV.addEventListener('click', exportCSV);
  btnExportJSON.addEventListener('click', exportJSON);
  btnExportXLSX.addEventListener('click', exportXLSX);
  btnClear.addEventListener('click', clearData);

  // ─── Help panel ──────────────────────────────────────────────────

  var helpOverlay = document.createElement('div');
  helpOverlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';

  var helpBox = document.createElement('div');
  helpBox.style.cssText = 'background:#12122a;border:1px solid #2a2a4e;border-radius:6px;padding:24px 32px;max-width:560px;max-height:80vh;overflow-y:auto;color:#e0e0f0;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;line-height:1.7;scrollbar-width:thin;scrollbar-color:#2a2a4e #12122a;';

  var helpSections = [
    '<h2 style="margin:0 0 12px;color:#00e5ff;font-size:16px;">WDK Help</h2>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Getting Started</h3>',
    '<p>Drop a <b>.csv</b>, <b>.tsv</b>, <b>.json</b>, or <b>.xlsx</b> file onto the import area, or click Browse. Files >100MB stream automatically.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Command Palette</h3>',
    '<p>Press <b>Ctrl+P</b> to open the command palette. Fuzzy-search any action (import, export, switch tabs, etc).</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Table Features</h3>',
    '<p>Click a <b>column header</b> to sort. Click a <b>row</b> to select it (Shift+click for range). Selected rows show SUM/AVG in the summary bar. Null values display as gray italic.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">REPL Console</h3>',
    '<p>The bottom REPL panel lets you script against loaded data:</p>',
    '<ul style="padding-left:18px;margin:4px 0;">',
    '<li><code style="color:#00e5ff;">data</code> \u2014 array of row objects</li>',
    '<li><code style="color:#00e5ff;">headers</code> \u2014 column names array</li>',
    '<li><code style="color:#00e5ff;">rows</code> \u2014 raw 2D array</li>',
    '<li><code style="color:#00e5ff;">meta</code> \u2014 { rowCount, columnCount }</li>',
    '</ul>',
    '<p>Enter executes, Shift+Enter for multiline. Results auto-display with export buttons.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Pivot / Aggregate</h3>',
    '<p>Switch to the <b>Pivot</b> tab to group and aggregate data. Supports: sum, count, avg, min, max, distinct, first, last, concat.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">SQL Queries</h3>',
    '<p>Use the <b>Notebook</b> tab to run SQL against loaded tables. Supports SELECT, WHERE, ORDER BY, GROUP BY, JOIN, window functions.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Notebook</h3>',
    '<p>Supports <b>JS</b>, <b>SQL</b>, and <b>Markdown</b> cells. Drag cells to reorder. Stale outputs are grayed out after edits. Shift+Enter runs a cell.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Debug Panel</h3>',
    '<p>The <b>Debug</b> tab provides: Network request log, Console capture, Storage viewer, and DOM table scraper in a unified dashboard.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Keyboard Shortcuts</h3>',
    '<table style="border-collapse:collapse;width:100%;margin:4px 0;">',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+P</td><td>Command palette</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+I</td><td>Import file</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+E</td><td>Export as CSV</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+L</td><td>Clear data</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">F1</td><td>Toggle help</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Click header</td><td>Sort asc/desc</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Click row</td><td>Select (Shift+click for range)</td></tr>',
    '</table>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">REPL Shortcuts</h3>',
    '<table style="border-collapse:collapse;width:100%;margin:4px 0;">',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Enter</td><td>Execute</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Shift+Enter</td><td>New line</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Up/Down</td><td>Command history</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+L</td><td>Clear REPL output</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Tab</td><td>Insert 2 spaces</td></tr>',
    '</table>',
    '<p style="margin-top:14px;color:#8888aa;font-size:11px;">Press Escape or click outside to close.</p>',
  ];
  helpBox.innerHTML = helpSections.join('\n');

  helpOverlay.appendChild(helpBox);
  document.body.appendChild(helpOverlay);

  function toggleHelp() {
    helpOverlay.style.display = helpOverlay.style.display === 'none' ? 'flex' : 'none';
  }

  btnHelp.addEventListener('click', toggleHelp);
  helpOverlay.addEventListener('click', function (e) {
    if (e.target === helpOverlay) toggleHelp();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F1') { e.preventDefault(); toggleHelp(); }
    if (e.key === 'Escape' && helpOverlay.style.display !== 'none') { toggleHelp(); }
    if (e.key === 'Escape' && settingsOverlay.style.display !== 'none') { toggleSettings(); }
  });

  // ─── Settings panel ─────────────────────────────────────────────

  var WDK_SETTINGS_DEFAULTS = {
    replEnterExec: true,
    defaultExport: 'csv',
    tablePageSize: 500,
  };

  function loadSettings() {
    try {
      var saved = localStorage.getItem('wdk_settings');
      if (saved) {
        var parsed = JSON.parse(saved);
        var merged = {};
        for (var k in WDK_SETTINGS_DEFAULTS) merged[k] = WDK_SETTINGS_DEFAULTS[k];
        for (var k2 in parsed) merged[k2] = parsed[k2];
        return merged;
      }
    } catch (_) {}
    var copy = {};
    for (var k3 in WDK_SETTINGS_DEFAULTS) copy[k3] = WDK_SETTINGS_DEFAULTS[k3];
    return copy;
  }

  function saveSettings(s) {
    try { localStorage.setItem('wdk_settings', JSON.stringify(s)); } catch (_) {}
  }

  var wdkSettings = loadSettings();

  var settingsOverlay = document.createElement('div');
  settingsOverlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';

  var settingsBox = document.createElement('div');
  settingsBox.style.cssText = 'background:#12122a;border:1px solid #2a2a4e;border-radius:6px;padding:24px 32px;max-width:440px;color:#e0e0f0;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;line-height:1.7;';

  function buildSettingsUI() {
    settingsBox.innerHTML = '';
    var title = document.createElement('h2');
    title.textContent = 'Settings';
    title.style.cssText = 'margin:0 0 16px;color:#00e5ff;font-size:16px;';
    settingsBox.appendChild(title);

    function addToggle(label, key) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:8px 0;';
      var lbl = document.createElement('span');
      lbl.textContent = label;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = wdkSettings[key];
      cb.addEventListener('change', function () {
        wdkSettings[key] = cb.checked;
        saveSettings(wdkSettings);
      });
      row.appendChild(lbl);
      row.appendChild(cb);
      settingsBox.appendChild(row);
    }

    function addSelect(label, key, options) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:8px 0;';
      var lbl = document.createElement('span');
      lbl.textContent = label;
      var sel = document.createElement('select');
      sel.style.cssText = 'background:#0a0a1a;color:#e0e0f0;border:1px solid #2a2a4e;padding:2px 6px;font-family:inherit;font-size:11px;';
      options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (wdkSettings[key] === opt.value) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        wdkSettings[key] = isNaN(Number(sel.value)) ? sel.value : Number(sel.value);
        saveSettings(wdkSettings);
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      settingsBox.appendChild(row);
    }

    addToggle('Enter executes in REPL', 'replEnterExec');
    addSelect('Default export format', 'defaultExport', [
      { value: 'csv', label: 'CSV' },
      { value: 'json', label: 'JSON' },
    ]);
    addSelect('Table page size', 'tablePageSize', [
      { value: 100, label: '100 rows' },
      { value: 250, label: '250 rows' },
      { value: 500, label: '500 rows' },
      { value: 1000, label: '1000 rows' },
    ]);

    var note = document.createElement('p');
    note.style.cssText = 'margin-top:14px;color:#8888aa;font-size:11px;';
    note.textContent = 'Settings are saved in localStorage. Press Escape to close.';
    settingsBox.appendChild(note);
  }

  settingsOverlay.appendChild(settingsBox);
  document.body.appendChild(settingsOverlay);

  function toggleSettings() {
    if (settingsOverlay.style.display === 'none') buildSettingsUI();
    settingsOverlay.style.display = settingsOverlay.style.display === 'none' ? 'flex' : 'none';
  }

  btnSettings.addEventListener('click', toggleSettings);
  settingsOverlay.addEventListener('click', function (e) {
    if (e.target === settingsOverlay) toggleSettings();
  });

  // ─── Split handle drag ────────────────────────────────────────────

  var splitDragging = false;
  var splitStartY = 0;
  var splitStartReplH = 0;

  splitHandle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    splitDragging = true;
    splitStartY = e.clientY;
    splitStartReplH = bottomPanel.offsetHeight;
  });

  document.addEventListener('mousemove', function (e) {
    if (!splitDragging) return;
    e.preventDefault();
    var delta = splitStartY - e.clientY; // drag up = bigger panel
    var newH = Math.max(80, Math.min(splitStartReplH + delta, window.innerHeight - 200));
    bottomPanel.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', function () {
    splitDragging = false;
  });

  // ─── Keyboard shortcuts ───────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;

    if (e.key === 'i' || e.key === 'I') {
      // Don't intercept when typing in textarea/input
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) return;
      e.preventDefault();
      var fi = importWrap.querySelector('input[type="file"]');
      if (fi) fi.click();
    }

    if (e.key === 'e' || e.key === 'E') {
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) return;
      e.preventDefault();
      exportCSV();
    }

    if (e.key === 'l' || e.key === 'L') {
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) return;
      e.preventDefault();
      clearData();
    }
  });

  // ─── Command palette ─────────────────────────────────────────────

  if (typeof createCommandPalette === 'function') {
    var paletteActions = [
      { id: 'import', label: 'Import File', shortcut: 'Ctrl+I', icon: '\u2913', handler: function() { var fi = importWrap.querySelector('input[type="file"]'); if (fi) fi.click(); } },
      { id: 'export-csv', label: 'Export as CSV', shortcut: 'Ctrl+E', icon: '\u2191', handler: exportCSV },
      { id: 'export-json', label: 'Export as JSON', icon: '\u2191', handler: exportJSON },
      { id: 'export-xlsx', label: 'Export as XLSX', icon: '\u2191', handler: exportXLSX },
      { id: 'clear', label: 'Clear Data', shortcut: 'Ctrl+L', icon: '\u2715', handler: clearData },
      { id: 'scanner', label: 'File Scanner', icon: '\u26a0', handler: function() { btnScanner.click(); } },
      { id: 'help', label: 'Help', shortcut: 'F1', icon: '?', handler: toggleHelp },
      { id: 'settings', label: 'Settings', icon: '\u2699', handler: toggleSettings },
      { id: 'tab-repl', label: 'Switch to REPL', icon: '\u25b6', handler: function() { replTab.click(); } },
      { id: 'tab-pivot', label: 'Switch to Pivot', icon: '\u25b6', handler: function() { pivotTab.click(); } },
      { id: 'tab-notebook', label: 'Switch to Notebook', icon: '\u25b6', handler: function() { notebookTab.click(); } },
      { id: 'tab-build', label: 'Switch to Build', icon: '\u25b6', handler: function() { buildTab.click(); } },
    ];
    var palette = createCommandPalette(paletteActions);
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        palette.toggle();
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    shell: shell,
    loadData: onDataLoaded,
    clearData: clearData,
    exportCSV: exportCSV,
    exportJSON: exportJSON,
    exportXLSX: exportXLSX,
  };
}

/**
 * Entry point — detects mode and initialises accordingly.
 * Called by main() in build.js when app-shell is present.
 */
function initWDK() {
  if (isStandaloneMode()) {
    var app = createAppShell();
    if (app) { window.WDK = app; }
  } else {
    // Bookmarklet / injected mode — fall back to floating panel
    if (typeof createPanel === 'function') {
      var panel = createPanel();
      var contentArea = panel.contentArea || panel.content || panel;
      var currentDf = null;
      var replInstance = null;

      function getREPLContext() {
        if (!currentDf) {
          return { data: [], rows: [], headers: [], meta: { rowCount: 0, columnCount: 0 } };
        }
        var headers = currentDf._headers || currentDf.headers || [];
        var rows = currentDf._rows || currentDf.rows || [];
        var data;
        if (typeof currentDf.toObjects === 'function') {
          data = currentDf.toObjects();
        } else {
          data = rows.map(function (row) {
            var obj = {};
            headers.forEach(function (h, i) { obj[h] = row[i]; });
            return obj;
          });
        }
        return {
          data: data,
          rows: rows,
          headers: headers,
          meta: { rowCount: rows.length, columnCount: headers.length }
        };
      }

      function onDataLoaded(table) {
        currentDf = table;
        if (typeof renderTable === 'function') {
          var tableContainer = contentArea.querySelector('.dk-table-container');
          if (!tableContainer) {
            tableContainer = document.createElement('div');
            tableContainer.className = 'dk-table-container';
            contentArea.appendChild(tableContainer);
          }
          tableContainer.innerHTML = '';
          renderTable(tableContainer, table);
        }
        if (typeof createREPL === 'function' && !replInstance) {
          var replContainer = document.createElement('div');
          replContainer.className = 'dk-repl-container';
          replContainer.style.cssText = 'margin-top:12px;height:300px;';
          contentArea.appendChild(replContainer);
          replInstance = createREPL(replContainer, getREPLContext);
        }
      }

      if (typeof createFileImport === 'function') {
        createFileImport(contentArea, onDataLoaded);
      }
    }
  }
}

// --- scanner/preflight-scanner.js ---

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

// --- sharepoint/sp-auth.js ---

/**
 * SharePoint Connection & Auth Foundation
 * Digest-based auth via contextinfo endpoint, base spFetch wrapper,
 * on-domain detection, and settings UI.
 * Zero external dependencies.
 */

/* global DK_SHELL_THEME */

var _spDigestCache = { value: null, expiry: 0, siteUrl: null };

/**
 * Detect if currently running on a SharePoint domain.
 * Checks for SP global objects and _api availability.
 * @returns {boolean}
 */
function spDetectOnDomain() {
  if (typeof _spPageContextInfo !== 'undefined') return true;
  if (document.getElementById('s4-workspace')) return true;
  var metaGen = document.querySelector('meta[name="GENERATOR"]');
  if (metaGen && /sharepoint/i.test(metaGen.content)) return true;
  return false;
}

/**
 * Get the site URL from page context or user config.
 * @returns {string|null}
 */
function spGetSiteUrl() {
  if (typeof _spPageContextInfo !== 'undefined' && _spPageContextInfo.webAbsoluteUrl) {
    return _spPageContextInfo.webAbsoluteUrl;
  }
  return null;
}

/**
 * Fetch a form digest value from the contextinfo endpoint.
 * Caches the digest and refreshes when expired.
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<string>} The form digest value
 */
async function spGetDigest(siteUrl) {
  var now = Date.now();
  if (_spDigestCache.value && _spDigestCache.siteUrl === siteUrl && now < _spDigestCache.expiry) {
    return _spDigestCache.value;
  }

  var resp = await fetch(siteUrl + '/_api/contextinfo', {
    method: 'POST',
    headers: { 'Accept': 'application/json;odata=verbose' },
    credentials: 'include',
    body: ''
  });

  if (!resp.ok) {
    throw new Error('Failed to get digest: HTTP ' + resp.status);
  }

  var data = await resp.json();
  var info = data.d
    ? data.d.GetContextWebInformation
    : data;
  var digest = info.FormDigestValue;
  var timeout = (info.FormDigestTimeoutSeconds || 1800) * 1000;

  _spDigestCache = { value: digest, expiry: now + timeout - 60000, siteUrl: siteUrl };
  return digest;
}

/**
 * Invalidate the cached digest, forcing a refresh on next call.
 */
function spClearDigest() {
  _spDigestCache = { value: null, expiry: 0, siteUrl: null };
}

/**
 * Base fetch wrapper for SharePoint REST API calls.
 * Auto-includes digest for write operations, sets credentials and headers.
 *
 * @param {string} url - Full API URL
 * @param {object} [options] - Fetch options
 * @param {string} [options.method='GET'] - HTTP method
 * @param {string} [options.siteUrl] - Site URL for digest retrieval
 * @param {object} [options.headers] - Additional headers
 * @param {*} [options.body] - Request body
 * @param {string} [options.accept] - Accept header override
 * @returns {Promise<Response>}
 */
async function spFetch(url, options) {
  options = options || {};
  var method = (options.method || 'GET').toUpperCase();
  var headers = Object.assign({}, options.headers || {});

  // Set default Accept if not provided
  if (!headers['Accept']) {
    headers['Accept'] = options.accept || 'application/json;odata=verbose';
  }

  // For write operations, include the digest
  if (method !== 'GET' && options.siteUrl) {
    if (!headers['X-RequestDigest']) {
      headers['X-RequestDigest'] = await spGetDigest(options.siteUrl);
    }
  }

  // Set Content-Type for POST/PUT/PATCH with JSON body
  if ((method === 'POST' || method === 'PUT' || method === 'PATCH') && options.body && typeof options.body === 'object') {
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json;odata=verbose';
    }
    options.body = JSON.stringify(options.body);
  }

  var fetchOpts = {
    method: method,
    headers: headers,
    credentials: 'include'
  };

  if (options.body !== undefined && method !== 'GET') {
    fetchOpts.body = options.body;
  }

  var resp = await fetch(url, fetchOpts);

  // On 403, try refreshing digest and retry once
  if (resp.status === 403 && method !== 'GET' && options.siteUrl) {
    spClearDigest();
    headers['X-RequestDigest'] = await spGetDigest(options.siteUrl);
    fetchOpts.headers = headers;
    resp = await fetch(url, fetchOpts);
  }

  return resp;
}

/**
 * Test connection to a SharePoint site. Returns current user info.
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<{ok: boolean, user?: object, error?: string}>}
 */
async function spTestConnection(siteUrl) {
  try {
    var resp = await spFetch(siteUrl + '/_api/web/currentuser', {
      siteUrl: siteUrl,
      accept: 'application/json;odata=verbose'
    });
    if (!resp.ok) {
      return { ok: false, error: 'HTTP ' + resp.status + ' ' + resp.statusText };
    }
    var data = await resp.json();
    var user = data.d || data;
    return {
      ok: true,
      user: {
        title: user.Title,
        email: user.Email,
        loginName: user.LoginName,
        id: user.Id,
        isSiteAdmin: user.IsSiteAdmin
      }
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
}

/**
 * Render SharePoint connection settings UI.
 * @param {HTMLElement} container - Container element
 * @returns {{ getSiteUrl: () => string }}
 */
function spCreateSettingsUI(container) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var bg = '#12122a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;margin:8px 0;';

  var title = document.createElement('div');
  title.textContent = 'SharePoint Connection';
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:12px;letter-spacing:1px;';
  wrapper.appendChild(title);

  // Site URL row
  var urlRow = document.createElement('div');
  urlRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;';

  var urlLabel = document.createElement('label');
  urlLabel.textContent = 'Site URL';
  urlLabel.style.cssText = 'color:' + textDim + ';font-size:12px;min-width:60px;';
  urlRow.appendChild(urlLabel);

  var urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = 'https://your-site.sharepoint.com/sites/MySite';
  urlInput.style.cssText = 'flex:1;padding:6px 10px;background:#0a0a1a;border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;outline:none;';
  urlInput.addEventListener('focus', function() { urlInput.style.borderColor = cyan; });
  urlInput.addEventListener('blur', function() { urlInput.style.borderColor = border; });

  // Pre-fill if on-domain
  var detectedUrl = spGetSiteUrl();
  if (detectedUrl) {
    urlInput.value = detectedUrl;
  }
  urlRow.appendChild(urlInput);

  var testBtn = document.createElement('button');
  testBtn.textContent = 'Test Connection';
  testBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid ' + cyan + ';border-radius:4px;color:' + cyan + ';font-family:inherit;font-size:12px;cursor:pointer;white-space:nowrap;';
  testBtn.addEventListener('mouseenter', function() { testBtn.style.background = 'rgba(0,229,255,0.1)'; });
  testBtn.addEventListener('mouseleave', function() { testBtn.style.background = 'transparent'; });
  urlRow.appendChild(testBtn);
  wrapper.appendChild(urlRow);

  // Status area
  var statusDiv = document.createElement('div');
  statusDiv.style.cssText = 'font-size:12px;color:' + textDim + ';min-height:20px;padding:4px 0;';
  wrapper.appendChild(statusDiv);

  // On-domain indicator
  if (spDetectOnDomain()) {
    var domainNote = document.createElement('div');
    domainNote.textContent = '● Running on SharePoint domain';
    domainNote.style.cssText = 'font-size:11px;color:#4caf50;margin-top:4px;';
    wrapper.appendChild(domainNote);
  }

  testBtn.addEventListener('click', async function() {
    var siteUrl = urlInput.value.replace(/\/+$/, '');
    if (!siteUrl) {
      statusDiv.style.color = pink;
      statusDiv.textContent = 'Enter a site URL first';
      return;
    }
    statusDiv.style.color = textDim;
    statusDiv.textContent = 'Testing connection...';
    testBtn.disabled = true;

    var result = await spTestConnection(siteUrl);
    testBtn.disabled = false;

    if (result.ok) {
      statusDiv.style.color = '#4caf50';
      statusDiv.textContent = '● Connected as ' + result.user.title + (result.user.email ? ' (' + result.user.email + ')' : '');
      if (result.user.isSiteAdmin) {
        statusDiv.textContent += ' [Site Admin]';
      }
    } else {
      statusDiv.style.color = pink;
      statusDiv.textContent = '✗ ' + result.error;
    }
  });

  container.appendChild(wrapper);

  return {
    getSiteUrl: function() { return urlInput.value.replace(/\/+$/, ''); }
  };
}

// --- sharepoint/sp-compat.js ---

/**
 * SharePoint Version/Compatibility Layer
 * Detect SP version, toggle OData modes, feature matrix.
 * Zero external dependencies.
 */

/* global spFetch */

/**
 * Feature support matrix by SharePoint version.
 */
var SP_FEATURE_MATRIX = {
  '2013': {
    batch: false,
    modernUi: false,
    resourcePath: false,
    clientSideAssets: false,
    spfx: false,
    odataMode: 'verbose',
    minimalMetadata: false,
    webhooks: false,
    flowIntegration: false
  },
  '2016': {
    batch: true,
    modernUi: false,
    resourcePath: true,
    clientSideAssets: false,
    spfx: false,
    odataMode: 'nometadata',
    minimalMetadata: true,
    webhooks: false,
    flowIntegration: false
  },
  '2019': {
    batch: true,
    modernUi: true,
    resourcePath: true,
    clientSideAssets: true,
    spfx: true,
    odataMode: 'nometadata',
    minimalMetadata: true,
    webhooks: true,
    flowIntegration: false
  },
  'spo': {
    batch: true,
    modernUi: true,
    resourcePath: true,
    clientSideAssets: true,
    spfx: true,
    odataMode: 'nometadata',
    minimalMetadata: true,
    webhooks: true,
    flowIntegration: true
  }
};

/**
 * Detect SharePoint version by querying the web endpoint.
 * Falls back to page metadata inspection.
 *
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<{version: string, major: number, minor: number, label: string}>}
 */
async function spDetectVersion(siteUrl) {
  try {
    // Try _api/web to get server version from response headers
    var resp = await spFetch(siteUrl + '/_api/web?$select=UIVersion', {
      siteUrl: siteUrl,
      accept: 'application/json;odata=verbose'
    });

    // Check MicrosoftSharePointTeamServices header
    var serverVersion = resp.headers.get('MicrosoftSharePointTeamServices') || '';
    var data = await resp.json();

    if (serverVersion) {
      var parts = serverVersion.split('.');
      var major = parseInt(parts[0], 10);
      var minor = parseInt(parts[1], 10) || 0;
      return _resolveVersion(major, minor);
    }

    // Fallback: check UIVersion from response
    var uiVersion = data.d ? data.d.UIVersion : data.UIVersion;
    if (uiVersion) {
      // UIVersion 15 = 2013/2016/2019, 16 = SPO
      // Need more info to distinguish
    }
  } catch (e) {
    // Fallback to page context
  }

  // Fallback: check _spPageContextInfo
  if (typeof _spPageContextInfo !== 'undefined') {
    var ctx = _spPageContextInfo;
    if (ctx.isSPO) return { version: 'spo', major: 16, minor: 0, label: 'SharePoint Online' };
    if (ctx.webUIVersion === 15) {
      // Could be 2013, 2016, or 2019 — check for modern page support
      if (ctx.modernPageFeatureEnabled) return { version: '2019', major: 16, minor: 0, label: 'SharePoint 2019' };
    }
  }

  // Fallback: check for modern UI indicators in DOM
  if (document.querySelector('[data-sp-feature-tag]') || document.getElementById('spSiteHeader')) {
    return { version: 'spo', major: 16, minor: 0, label: 'SharePoint Online' };
  }

  // Default to 2013 (most conservative)
  return { version: '2013', major: 15, minor: 0, label: 'SharePoint 2013 (assumed)' };
}

/**
 * Resolve major.minor version numbers to a named version.
 * @param {number} major
 * @param {number} minor
 * @returns {{version: string, major: number, minor: number, label: string}}
 */
function _resolveVersion(major, minor) {
  if (major >= 16 && minor >= 20000) {
    return { version: 'spo', major: major, minor: minor, label: 'SharePoint Online' };
  }
  if (major >= 16 && minor >= 4351) {
    return { version: '2019', major: major, minor: minor, label: 'SharePoint 2019' };
  }
  if (major >= 16) {
    return { version: '2016', major: major, minor: minor, label: 'SharePoint 2016' };
  }
  if (major >= 15) {
    return { version: '2013', major: major, minor: minor, label: 'SharePoint 2013' };
  }
  return { version: '2013', major: major, minor: minor, label: 'SharePoint (unknown, v' + major + ')' };
}

/**
 * Get appropriate OData Accept header for a given SP version.
 * SP 2013 requires odata=verbose; 2016+ supports nometadata.
 *
 * @param {{version: string}} versionInfo - Output from spDetectVersion
 * @returns {string} Accept header value
 */
function spGetODataHeaders(versionInfo) {
  var mode = SP_FEATURE_MATRIX[versionInfo.version]
    ? SP_FEATURE_MATRIX[versionInfo.version].odataMode
    : 'verbose';
  if (mode === 'nometadata') {
    return 'application/json;odata=nometadata';
  }
  return 'application/json;odata=verbose';
}

/**
 * Check if a specific feature is supported by the detected SP version.
 *
 * @param {{version: string}} versionInfo - Output from spDetectVersion
 * @param {string} feature - Feature key: 'batch', 'modernUi', 'resourcePath', 'clientSideAssets', 'spfx', 'webhooks', 'flowIntegration'
 * @returns {boolean}
 */
function spSupportsFeature(versionInfo, feature) {
  var matrix = SP_FEATURE_MATRIX[versionInfo.version];
  if (!matrix) return false;
  return !!matrix[feature];
}

/**
 * Get warning HTML if running in IE11.
 * @returns {string|null} Warning HTML or null if not IE11
 */
function spGetIE11Warning() {
  if (typeof window !== 'undefined' && window.MSInputMethodContext && document.documentMode) {
    return '<div style="padding:10px;background:#3a1a00;border:1px solid #ff6600;border-radius:4px;color:#ffaa44;font-size:12px;margin:8px 0;">'
      + '⚠ Internet Explorer 11 detected. Some features may have limited functionality. '
      + 'Async operations use XHR fallback. Consider using Edge or Chrome for full support.'
      + '</div>';
  }
  return null;
}

/**
 * Get the full feature matrix for display purposes.
 * @returns {object}
 */
function spGetFeatureMatrix() {
  return SP_FEATURE_MATRIX;
}

// --- sharepoint/sp-errors.js ---

/**
 * SharePoint Error Handling & Throttle Recovery
 * Parse SP error responses, retry with exponential backoff,
 * digest refresh on 403, user-friendly error display.
 * Zero external dependencies.
 */

/* global spFetch, spClearDigest, spGetDigest */

/**
 * Module-level throttle state tracking.
 */
var spThrottleState = {
  consecutiveThrottles: 0,
  lastThrottleTime: 0,
  totalThrottles: 0
};

/**
 * Parse a SharePoint error response.
 * Handles both odata=verbose and minimal/nometadata formats.
 *
 * @param {Response} response - The fetch Response object
 * @returns {Promise<{code: string, message: string, status: number, raw?: object}>}
 */
async function spParseError(response) {
  var result = {
    code: 'Unknown',
    message: 'HTTP ' + response.status + ' ' + response.statusText,
    status: response.status,
    raw: null
  };

  try {
    var text = await response.text();
    if (!text) return result;

    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // May be XML error response
      var msgMatch = text.match(/<m:message[^>]*>([^<]+)<\/m:message>/i);
      if (msgMatch) {
        result.message = msgMatch[1];
      }
      return result;
    }

    result.raw = data;

    // odata=verbose format: { error: { code: "...", message: { value: "..." } } }
    if (data.error) {
      result.code = data.error.code || result.code;
      if (data.error.message) {
        result.message = typeof data.error.message === 'string'
          ? data.error.message
          : data.error.message.value || result.message;
      }
    }

    // odata=nometadata format: { "odata.error": { code: "...", message: { value: "..." } } }
    if (data['odata.error']) {
      var odataErr = data['odata.error'];
      result.code = odataErr.code || result.code;
      if (odataErr.message) {
        result.message = typeof odataErr.message === 'string'
          ? odataErr.message
          : odataErr.message.value || result.message;
      }
    }
  } catch (e) {
    // Could not parse body — return defaults
  }

  return result;
}

/**
 * Fetch with automatic retry on throttle (429) and service unavailable (503).
 * Uses exponential backoff with jitter. Refreshes digest on 403.
 *
 * @param {string} url - Full API URL
 * @param {object} [options] - Same options as spFetch
 * @param {number} [maxRetries=4] - Maximum retry attempts
 * @param {function} [onRetry] - Callback on retry: onRetry(attempt, waitMs, status)
 * @returns {Promise<Response>}
 */
async function spFetchWithRetry(url, options, maxRetries, onRetry) {
  maxRetries = maxRetries || 4;
  var attempt = 0;

  while (true) {
    var resp = await spFetch(url, options);

    // Success or non-retryable error
    if (resp.ok || (resp.status !== 429 && resp.status !== 503 && resp.status !== 403)) {
      if (spThrottleState.consecutiveThrottles > 0) {
        spThrottleState.consecutiveThrottles = 0;
      }
      return resp;
    }

    // 403 — try digest refresh (once)
    if (resp.status === 403 && attempt === 0) {
      spClearDigest();
      if (options && options.siteUrl) {
        await spGetDigest(options.siteUrl);
      }
      attempt++;
      continue;
    }

    // 429/503 — throttled
    if (resp.status === 429 || resp.status === 503) {
      spThrottleState.consecutiveThrottles++;
      spThrottleState.totalThrottles++;
      spThrottleState.lastThrottleTime = Date.now();
    }

    if (attempt >= maxRetries) {
      return resp; // Return the error response after max retries
    }

    // Calculate backoff
    var retryAfter = resp.headers.get('Retry-After');
    var waitMs;
    if (retryAfter) {
      waitMs = parseInt(retryAfter, 10) * 1000;
      if (isNaN(waitMs)) {
        // Retry-After might be a date
        var retryDate = new Date(retryAfter).getTime();
        waitMs = retryDate - Date.now();
      }
    } else {
      // Exponential backoff: 1s, 2s, 4s, 8s with jitter
      var base = Math.pow(2, attempt) * 1000;
      var jitter = Math.random() * 500;
      waitMs = base + jitter;
    }

    waitMs = Math.max(waitMs, 500);
    waitMs = Math.min(waitMs, 30000);

    if (onRetry) {
      onRetry(attempt + 1, waitMs, resp.status);
    }

    await new Promise(function(resolve) { setTimeout(resolve, waitMs); });
    attempt++;
  }
}

/**
 * Render a user-friendly error display.
 *
 * @param {HTMLElement} container - Container element
 * @param {{code?: string, message: string, status?: number}} error - Parsed error
 * @returns {HTMLElement} The error element (for removal)
 */
function spCreateErrorDisplay(container, error) {
  var pink = '#ff2975';
  var bgErr = '#1a0a14';
  var border = '#3a1a2a';

  var el = document.createElement('div');
  el.style.cssText = 'padding:10px 14px;background:' + bgErr + ';border:1px solid ' + border + ';border-radius:6px;margin:8px 0;font-size:12px;';

  var header = document.createElement('div');
  header.style.cssText = 'color:' + pink + ';font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:6px;';
  header.textContent = '✗ SharePoint Error';
  if (error.status) {
    var badge = document.createElement('span');
    badge.textContent = error.status;
    badge.style.cssText = 'font-size:10px;padding:1px 6px;border:1px solid ' + pink + ';border-radius:3px;font-weight:400;';
    header.appendChild(badge);
  }
  el.appendChild(header);

  var msg = document.createElement('div');
  msg.style.cssText = 'color:#e0a0b0;';
  msg.textContent = error.message;
  el.appendChild(msg);

  if (error.code && error.code !== 'Unknown') {
    var code = document.createElement('div');
    code.style.cssText = 'color:#886070;font-size:11px;margin-top:4px;';
    code.textContent = 'Code: ' + error.code;
    el.appendChild(code);
  }

  // Throttle info
  if (spThrottleState.totalThrottles > 0) {
    var throttleInfo = document.createElement('div');
    throttleInfo.style.cssText = 'color:#886070;font-size:11px;margin-top:4px;';
    throttleInfo.textContent = 'Throttle events: ' + spThrottleState.totalThrottles
      + ' (consecutive: ' + spThrottleState.consecutiveThrottles + ')';
    el.appendChild(throttleInfo);
  }

  // Dismiss button
  var dismiss = document.createElement('button');
  dismiss.textContent = '✕';
  dismiss.style.cssText = 'position:absolute;top:6px;right:8px;background:none;border:none;color:#886070;font-size:14px;cursor:pointer;padding:2px;';
  dismiss.addEventListener('click', function() { el.remove(); });
  el.style.position = 'relative';
  el.appendChild(dismiss);

  container.appendChild(el);
  return el;
}

/**
 * Get current throttle state for monitoring.
 * @returns {{consecutiveThrottles: number, lastThrottleTime: number, totalThrottles: number}}
 */
function spGetThrottleState() {
  return Object.assign({}, spThrottleState);
}

/**
 * Reset throttle state counters.
 */
function spResetThrottleState() {
  spThrottleState.consecutiveThrottles = 0;
  spThrottleState.lastThrottleTime = 0;
  spThrottleState.totalThrottles = 0;
}

// --- sharepoint/sp-list-browser.js ---

/**
 * SharePoint List Browser
 * Enumerate lists, view schema, paginated item read with 5000-item threshold handling.
 * Zero external dependencies.
 */

/* global spFetch, spFetchWithRetry, spGetODataHeaders, spParseError, spCreateErrorDisplay, renderTable, DataFrame */

/**
 * Get all non-hidden lists from a SharePoint site.
 *
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<Array<{title: string, id: string, itemCount: number, lastModified: string, baseTemplate: number}>>}
 */
async function spGetLists(siteUrl) {
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists?$filter=Hidden eq false&$select=Title,Id,ItemCount,LastItemModifiedDate,BaseTemplate&$orderby=Title",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;

  return results.map(function(list) {
    return {
      title: list.Title,
      id: list.Id || list.ID,
      itemCount: list.ItemCount,
      lastModified: list.LastItemModifiedDate,
      baseTemplate: list.BaseTemplate
    };
  });
}

/**
 * Get the field schema for a SharePoint list.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @returns {Promise<Array<{name: string, displayName: string, type: string, required: boolean, choices: string[]}>>}
 */
async function spGetListSchema(siteUrl, listTitle) {
  var encodedTitle = encodeURIComponent(listTitle);
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/fields?$filter=Hidden eq false and ReadOnlyField eq false&$select=InternalName,Title,TypeAsString,Required,Choices",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;

  return results.map(function(field) {
    return {
      name: field.InternalName,
      displayName: field.Title,
      type: field.TypeAsString,
      required: field.Required,
      choices: field.Choices ? (field.Choices.results || field.Choices) : []
    };
  });
}

/**
 * Get list items with pagination support.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {object} [options]
 * @param {number} [options.top=100] - Items per page
 * @param {string} [options.select] - $select fields
 * @param {string} [options.filter] - $filter expression
 * @param {string} [options.orderby] - $orderby expression
 * @param {string} [options.nextLink] - OData next link for pagination
 * @returns {Promise<{items: object[], totalCount: number, hasMore: boolean, nextLink: string|null}>}
 */
async function spGetListItems(siteUrl, listTitle, options) {
  options = options || {};
  var top = options.top || 100;

  var url;
  if (options.nextLink) {
    url = options.nextLink;
  } else {
    var encodedTitle = encodeURIComponent(listTitle);
    url = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items?$top=" + top;
    if (options.select) url += '&$select=' + options.select;
    if (options.filter) url += '&$filter=' + encodeURIComponent(options.filter);
    if (options.orderby) url += '&$orderby=' + encodeURIComponent(options.orderby);
  }

  var resp = await spFetchWithRetry(url, { siteUrl: siteUrl });

  if (!resp.ok) {
    var err = await spParseError(resp);
    // Check for 5000-item threshold
    if (resp.status === 500 && err.message.indexOf('threshold') !== -1) {
      throw new Error('List view threshold exceeded (5000 items). Add a filter on an indexed column to reduce results.');
    }
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;
  var nextLink = data.d ? (data.d.__next || null) : (data['odata.nextLink'] || null);

  return {
    items: results,
    totalCount: results.length,
    hasMore: !!nextLink,
    nextLink: nextLink
  };
}

/**
 * Render the list browser UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 */
function spCreateListBrowserUI(container, siteUrl) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';
  var yellow = '#f5e642';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:12px;letter-spacing:1px;';
  header.textContent = 'SharePoint Lists';
  wrapper.appendChild(header);

  // List selector row
  var selectorRow = document.createElement('div');
  selectorRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var listSelect = document.createElement('select');
  listSelect.style.cssText = 'flex:1;padding:6px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  listSelect.innerHTML = '<option value="">Loading lists...</option>';
  selectorRow.appendChild(listSelect);

  var loadBtn = document.createElement('button');
  loadBtn.textContent = 'Load Items';
  loadBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid ' + cyan + ';border-radius:4px;color:' + cyan + ';font-family:inherit;font-size:12px;cursor:pointer;';
  selectorRow.appendChild(loadBtn);
  wrapper.appendChild(selectorRow);

  // Threshold warning (hidden by default)
  var thresholdBanner = document.createElement('div');
  thresholdBanner.style.cssText = 'display:none;padding:8px 12px;background:#1a1a00;border:1px solid #555500;border-radius:4px;color:' + yellow + ';font-size:11px;margin-bottom:8px;';
  thresholdBanner.textContent = '⚠ This list has over 5,000 items. Use a filter on an indexed column to avoid threshold errors.';
  wrapper.appendChild(thresholdBanner);

  // Schema panel
  var schemaPanel = document.createElement('div');
  schemaPanel.style.cssText = 'display:none;margin-bottom:12px;padding:10px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';
  wrapper.appendChild(schemaPanel);

  // Table container
  var tableContainer = document.createElement('div');
  wrapper.appendChild(tableContainer);

  // Pagination row
  var pagRow = document.createElement('div');
  pagRow.style.cssText = 'display:none;margin-top:8px;display:flex;gap:8px;align-items:center;';

  var prevBtn = document.createElement('button');
  prevBtn.textContent = '← Previous';
  prevBtn.style.cssText = 'padding:4px 12px;background:transparent;border:1px solid ' + border + ';border-radius:4px;color:' + textDim + ';font-family:inherit;font-size:11px;cursor:pointer;';
  prevBtn.disabled = true;
  pagRow.appendChild(prevBtn);

  var pageInfo = document.createElement('span');
  pageInfo.style.cssText = 'font-size:11px;color:' + textDim + ';';
  pagRow.appendChild(pageInfo);

  var nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next →';
  nextBtn.style.cssText = 'padding:4px 12px;background:transparent;border:1px solid ' + border + ';border-radius:4px;color:' + textDim + ';font-family:inherit;font-size:11px;cursor:pointer;';
  nextBtn.disabled = true;
  pagRow.appendChild(nextBtn);
  wrapper.appendChild(pagRow);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var allLists = [];
  var pageHistory = [];
  var currentNextLink = null;

  // Load lists
  spGetLists(siteUrl).then(function(lists) {
    allLists = lists;
    listSelect.innerHTML = '<option value="">— Select a list (' + lists.length + ' available) —</option>';
    lists.forEach(function(list) {
      var opt = document.createElement('option');
      opt.value = list.title;
      opt.textContent = list.title + ' (' + list.itemCount + ' items)';
      listSelect.appendChild(opt);
    });
  }).catch(function(err) {
    listSelect.innerHTML = '<option value="">Error loading lists</option>';
    spCreateErrorDisplay(errorContainer, { message: err.message });
  });

  // On list selection — show schema
  listSelect.addEventListener('change', function() {
    var title = listSelect.value;
    schemaPanel.style.display = 'none';
    thresholdBanner.style.display = 'none';
    if (!title) return;

    // Check threshold
    var selectedList = allLists.find(function(l) { return l.title === title; });
    if (selectedList && selectedList.itemCount > 5000) {
      thresholdBanner.style.display = 'block';
    }

    schemaPanel.style.display = 'block';
    schemaPanel.innerHTML = '<div style="color:' + textDim + ';font-size:11px;">Loading schema...</div>';

    spGetListSchema(siteUrl, title).then(function(fields) {
      var html = '<div style="font-size:12px;font-weight:600;color:' + purple + ';margin-bottom:6px;">Columns (' + fields.length + ')</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:2px 12px;font-size:11px;">';
      html += '<div style="color:' + textDim + ';font-weight:600;">Name</div><div style="color:' + textDim + ';font-weight:600;">Type</div><div style="color:' + textDim + ';font-weight:600;">Req</div>';
      fields.forEach(function(f) {
        html += '<div style="color:' + text + ';">' + f.displayName + '</div>';
        html += '<div style="color:' + textDim + ';">' + f.type + '</div>';
        html += '<div style="color:' + (f.required ? pink : textDim) + ';">' + (f.required ? '●' : '○') + '</div>';
      });
      html += '</div>';
      schemaPanel.innerHTML = html;
    }).catch(function(err) {
      schemaPanel.innerHTML = '<div style="color:' + pink + ';font-size:11px;">Error: ' + err.message + '</div>';
    });
  });

  // Load items
  function loadItems(nextLink) {
    var title = listSelect.value;
    if (!title) return;

    tableContainer.innerHTML = '<div style="color:' + textDim + ';font-size:12px;padding:8px;">Loading items...</div>';

    var opts = nextLink ? { nextLink: nextLink } : {};

    spGetListItems(siteUrl, title, opts).then(function(result) {
      if (result.items.length === 0) {
        tableContainer.innerHTML = '<div style="color:' + textDim + ';font-size:12px;padding:8px;">No items found.</div>';
        return;
      }

      // Convert to DataFrame-compatible format
      var firstItem = result.items[0];
      var headers = Object.keys(firstItem).filter(function(k) {
        return k !== '__metadata' && k !== 'odata.type' && k !== 'odata.id' && k !== 'odata.editLink';
      });
      var rows = result.items.map(function(item) {
        return headers.map(function(h) {
          var val = item[h];
          if (val && typeof val === 'object') return JSON.stringify(val);
          return val;
        });
      });

      tableContainer.innerHTML = '';
      if (typeof renderTable === 'function') {
        var df = (typeof DataFrame === 'function')
          ? new DataFrame(headers, rows)
          : { headers: headers, rows: rows, _headers: headers, _rows: rows };
        renderTable(tableContainer, df);
      }

      // Pagination
      currentNextLink = result.nextLink;
      pagRow.style.display = 'flex';
      prevBtn.disabled = pageHistory.length === 0;
      nextBtn.disabled = !result.hasMore;
      pageInfo.textContent = 'Page ' + (pageHistory.length + 1) + ' · ' + result.items.length + ' items';

    }).catch(function(err) {
      tableContainer.innerHTML = '';
      spCreateErrorDisplay(errorContainer, { message: err.message });
    });
  }

  loadBtn.addEventListener('click', function() {
    pageHistory = [];
    loadItems(null);
  });

  nextBtn.addEventListener('click', function() {
    if (currentNextLink) {
      pageHistory.push(currentNextLink);
      loadItems(currentNextLink);
    }
  });

  prevBtn.addEventListener('click', function() {
    if (pageHistory.length > 0) {
      pageHistory.pop();
      var prev = pageHistory.length > 0 ? pageHistory[pageHistory.length - 1] : null;
      loadItems(prev);
    }
  });

  container.appendChild(wrapper);
}

// --- sharepoint/sp-list-export.js ---

/**
 * SharePoint List Export
 * Full paginated export with $select/$filter/$orderby support.
 * Download as CSV or JSON.
 * Zero external dependencies.
 */

/* global spFetchWithRetry, spParseError, toCSV, toJSON, downloadBlob */

/**
 * Export all items from a SharePoint list with pagination.
 * Follows odata.nextLink until all items are retrieved.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {object} [options]
 * @param {string} [options.select] - Comma-separated field names
 * @param {string} [options.filter] - OData filter expression
 * @param {string} [options.orderby] - OData orderby expression
 * @param {number} [options.top=100] - Items per page
 * @param {function} [options.onProgress] - Callback: onProgress(loadedCount, estimatedTotal)
 * @returns {Promise<{headers: string[], rows: any[][]}>} DataFrame-compatible result
 */
async function spExportList(siteUrl, listTitle, options) {
  options = options || {};
  var top = options.top || 100;
  var encodedTitle = encodeURIComponent(listTitle);

  var baseUrl = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items?$top=" + top;
  if (options.select) baseUrl += '&$select=' + options.select;
  if (options.filter) baseUrl += '&$filter=' + encodeURIComponent(options.filter);
  if (options.orderby) baseUrl += '&$orderby=' + encodeURIComponent(options.orderby);

  var allItems = [];
  var url = baseUrl;
  var headers = null;

  while (url) {
    var resp = await spFetchWithRetry(url, { siteUrl: siteUrl });
    if (!resp.ok) {
      var err = await spParseError(resp);
      throw new Error(err.message);
    }

    var data = await resp.json();
    var results = data.d ? data.d.results : data.value;

    if (results.length > 0 && !headers) {
      headers = Object.keys(results[0]).filter(function(k) {
        return k !== '__metadata' && k !== 'odata.type' && k !== 'odata.id' && k !== 'odata.editLink';
      });
    }

    allItems = allItems.concat(results);

    if (options.onProgress) {
      options.onProgress(allItems.length, null);
    }

    url = data.d ? (data.d.__next || null) : (data['odata.nextLink'] || null);
  }

  if (!headers && allItems.length > 0) {
    headers = Object.keys(allItems[0]).filter(function(k) {
      return k !== '__metadata';
    });
  }

  headers = headers || [];

  var rows = allItems.map(function(item) {
    return headers.map(function(h) {
      var val = item[h];
      if (val && typeof val === 'object') return JSON.stringify(val);
      return val;
    });
  });

  return { headers: headers, rows: rows };
}

/**
 * Render the export configuration UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {Array<{name: string, displayName: string, type: string}>} schema
 */
function spCreateExportUI(container, siteUrl, listTitle, schema) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + purple + ';margin-bottom:12px;';
  title.textContent = 'Export: ' + listTitle;
  wrapper.appendChild(title);

  // --- Field selection ---
  var fieldSection = document.createElement('div');
  fieldSection.style.cssText = 'margin-bottom:12px;';

  var fieldLabel = document.createElement('div');
  fieldLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  fieldLabel.textContent = 'Fields';
  fieldSection.appendChild(fieldLabel);

  var selectAllRow = document.createElement('div');
  selectAllRow.style.cssText = 'margin-bottom:4px;';
  var selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.style.cssText = 'padding:2px 8px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-size:10px;cursor:pointer;margin-right:4px;';
  var selectNoneBtn = document.createElement('button');
  selectNoneBtn.textContent = 'Select None';
  selectNoneBtn.style.cssText = selectAllBtn.style.cssText;
  selectAllRow.appendChild(selectAllBtn);
  selectAllRow.appendChild(selectNoneBtn);
  fieldSection.appendChild(selectAllRow);

  var fieldChecks = [];
  var fieldGrid = document.createElement('div');
  fieldGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:2px;max-height:120px;overflow-y:auto;';

  schema.forEach(function(field) {
    var label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:' + text + ';cursor:pointer;padding:2px 0;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.fieldName = field.name;
    fieldChecks.push(cb);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(field.displayName));
    fieldGrid.appendChild(label);
  });
  fieldSection.appendChild(fieldGrid);
  wrapper.appendChild(fieldSection);

  selectAllBtn.addEventListener('click', function() { fieldChecks.forEach(function(cb) { cb.checked = true; }); });
  selectNoneBtn.addEventListener('click', function() { fieldChecks.forEach(function(cb) { cb.checked = false; }); });

  // --- Filter builder ---
  var filterSection = document.createElement('div');
  filterSection.style.cssText = 'margin-bottom:12px;';

  var filterLabel = document.createElement('div');
  filterLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  filterLabel.textContent = 'Filters';
  filterSection.appendChild(filterLabel);

  var filterRows = document.createElement('div');
  filterSection.appendChild(filterRows);

  var addFilterBtn = document.createElement('button');
  addFilterBtn.textContent = '+ Add Filter';
  addFilterBtn.style.cssText = 'padding:3px 10px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-size:10px;cursor:pointer;margin-top:4px;';
  filterSection.appendChild(addFilterBtn);
  wrapper.appendChild(filterSection);

  var operators = [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'gt', label: 'greater than' },
    { value: 'lt', label: 'less than' },
    { value: 'ge', label: 'greater or equal' },
    { value: 'le', label: 'less or equal' },
    { value: 'substringof', label: 'contains' },
    { value: 'startswith', label: 'starts with' }
  ];

  function addFilterRow() {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px;';

    var colSelect = document.createElement('select');
    colSelect.style.cssText = 'padding:4px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
    schema.forEach(function(f) {
      var opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = f.displayName;
      colSelect.appendChild(opt);
    });
    row.appendChild(colSelect);

    var opSelect = document.createElement('select');
    opSelect.style.cssText = colSelect.style.cssText;
    operators.forEach(function(op) {
      var opt = document.createElement('option');
      opt.value = op.value;
      opt.textContent = op.label;
      opSelect.appendChild(opt);
    });
    row.appendChild(opSelect);

    var valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'value';
    valInput.style.cssText = 'flex:1;padding:4px 8px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
    row.appendChild(valInput);

    var removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = 'padding:2px 6px;background:transparent;border:none;color:' + pink + ';font-size:12px;cursor:pointer;';
    removeBtn.addEventListener('click', function() { row.remove(); });
    row.appendChild(removeBtn);

    filterRows.appendChild(row);
  }

  addFilterBtn.addEventListener('click', addFilterRow);

  // --- Sort ---
  var sortSection = document.createElement('div');
  sortSection.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var sortLabel = document.createElement('span');
  sortLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  sortLabel.textContent = 'Sort by';
  sortSection.appendChild(sortLabel);

  var sortSelect = document.createElement('select');
  sortSelect.style.cssText = 'padding:4px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none)';
  sortSelect.appendChild(noneOpt);
  schema.forEach(function(f) {
    var opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.displayName;
    sortSelect.appendChild(opt);
  });
  sortSection.appendChild(sortSelect);

  var sortDirSelect = document.createElement('select');
  sortDirSelect.style.cssText = sortSelect.style.cssText;
  sortDirSelect.innerHTML = '<option value="asc">Ascending</option><option value="desc">Descending</option>';
  sortSection.appendChild(sortDirSelect);
  wrapper.appendChild(sortSection);

  // --- Format + Export button ---
  var exportRow = document.createElement('div');
  exportRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:8px;';

  var fmtLabel = document.createElement('span');
  fmtLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  fmtLabel.textContent = 'Format:';
  exportRow.appendChild(fmtLabel);

  var csvRadio = document.createElement('input');
  csvRadio.type = 'radio';
  csvRadio.name = 'sp-export-fmt';
  csvRadio.value = 'csv';
  csvRadio.checked = true;
  csvRadio.id = 'sp-exp-csv';
  var csvLabel = document.createElement('label');
  csvLabel.htmlFor = 'sp-exp-csv';
  csvLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  csvLabel.textContent = ' CSV';
  exportRow.appendChild(csvRadio);
  exportRow.appendChild(csvLabel);

  var jsonRadio = document.createElement('input');
  jsonRadio.type = 'radio';
  jsonRadio.name = 'sp-export-fmt';
  jsonRadio.value = 'json';
  jsonRadio.id = 'sp-exp-json';
  var jsonLabel = document.createElement('label');
  jsonLabel.htmlFor = 'sp-exp-json';
  jsonLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  jsonLabel.textContent = ' JSON';
  exportRow.appendChild(jsonRadio);
  exportRow.appendChild(jsonLabel);

  var exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = 'padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-left:auto;';
  exportRow.appendChild(exportBtn);
  wrapper.appendChild(exportRow);

  // Progress bar
  var progressContainer = document.createElement('div');
  progressContainer.style.cssText = 'display:none;margin-top:8px;';
  var progressBar = document.createElement('div');
  progressBar.style.cssText = 'height:4px;background:' + border + ';border-radius:2px;overflow:hidden;';
  var progressFill = document.createElement('div');
  progressFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,' + cyan + ',' + purple + ');transition:width 0.3s;';
  progressBar.appendChild(progressFill);
  progressContainer.appendChild(progressBar);
  var progressText = document.createElement('div');
  progressText.style.cssText = 'font-size:10px;color:' + textDim + ';margin-top:2px;';
  progressContainer.appendChild(progressText);
  wrapper.appendChild(progressContainer);

  // Export action
  exportBtn.addEventListener('click', async function() {
    var selectedFields = fieldChecks
      .filter(function(cb) { return cb.checked; })
      .map(function(cb) { return cb.dataset.fieldName; });

    if (selectedFields.length === 0) return;

    // Build filter
    var filterParts = [];
    var fRows = filterRows.querySelectorAll('div');
    fRows.forEach(function(row) {
      var col = row.querySelector('select:first-child');
      var op = row.querySelectorAll('select')[1];
      var val = row.querySelector('input');
      if (col && op && val && val.value) {
        var v = val.value;
        if (op.value === 'substringof') {
          filterParts.push("substringof('" + v + "'," + col.value + ")");
        } else if (op.value === 'startswith') {
          filterParts.push("startswith(" + col.value + ",'" + v + "')");
        } else {
          filterParts.push(col.value + " " + op.value + " '" + v + "'");
        }
      }
    });

    var opts = {
      select: selectedFields.join(','),
      filter: filterParts.length > 0 ? filterParts.join(' and ') : undefined,
      orderby: sortSelect.value ? (sortSelect.value + ' ' + sortDirSelect.value) : undefined,
      onProgress: function(loaded) {
        progressFill.style.width = '50%'; // Indeterminate since we don't know total
        progressText.textContent = loaded + ' items loaded...';
      }
    };

    progressContainer.style.display = 'block';
    progressFill.style.width = '10%';
    progressText.textContent = 'Starting export...';
    exportBtn.disabled = true;

    try {
      var result = await spExportList(siteUrl, listTitle, opts);
      progressFill.style.width = '100%';
      progressText.textContent = result.rows.length + ' items exported.';

      // Download
      var fmt = csvRadio.checked ? 'csv' : 'json';
      var content, mimeType, ext;
      if (fmt === 'csv') {
        content = typeof toCSV === 'function' ? toCSV(result) : _fallbackCSV(result);
        mimeType = 'text/csv';
        ext = 'csv';
      } else {
        content = typeof toJSON === 'function' ? toJSON(result, { pretty: true, asArray: true }) : JSON.stringify(result.rows, null, 2);
        mimeType = 'application/json';
        ext = 'json';
      }

      var blob = new Blob([content], { type: mimeType });
      if (typeof downloadBlob === 'function') {
        downloadBlob(blob, listTitle + '.' + ext);
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = listTitle + '.' + ext;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (err) {
      progressText.style.color = pink;
      progressText.textContent = 'Error: ' + err.message;
    }

    exportBtn.disabled = false;
  });

  container.appendChild(wrapper);
}

/**
 * Fallback CSV generation if toCSV is not available.
 * @param {{headers: string[], rows: any[][]}} table
 * @returns {string}
 */
function _fallbackCSV(table) {
  var lines = [table.headers.join(',')];
  table.rows.forEach(function(row) {
    lines.push(row.map(function(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(','));
  });
  return lines.join('\n');
}

// --- sharepoint/sp-list-import.js ---

/**
 * SharePoint List Import
 * CSV → SharePoint list with column mapping, sequential and batch POST modes.
 * Zero external dependencies.
 */

/* global spFetch, spFetchWithRetry, spGetDigest, spGetLists, spGetListSchema, spParseError, spCreateErrorDisplay, spSupportsFeature, parseCSV */

/**
 * Get the ListItemEntityTypeFullName for a list.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @returns {Promise<string>}
 */
async function spGetEntityType(siteUrl, listTitle) {
  var encodedTitle = encodeURIComponent(listTitle);
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')?$select=ListItemEntityTypeFullName",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  return data.d ? data.d.ListItemEntityTypeFullName : data.ListItemEntityTypeFullName;
}

/**
 * Import items into a SharePoint list.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {object[]} items - Array of objects with field:value pairs
 * @param {object} [options]
 * @param {string} [options.mode='sequential'] - 'sequential' or 'batch'
 * @param {function} [options.onProgress] - Callback: onProgress(importedCount, totalCount)
 * @returns {Promise<{success: number, failed: number, errors: Array<{index: number, error: string}>}>}
 */
async function spImportItems(siteUrl, listTitle, items, options) {
  options = options || {};
  var mode = options.mode || 'sequential';
  var encodedTitle = encodeURIComponent(listTitle);
  var entityType = await spGetEntityType(siteUrl, listTitle);

  var result = { success: 0, failed: 0, errors: [] };

  if (mode === 'batch') {
    result = await _importBatch(siteUrl, listTitle, encodedTitle, entityType, items, options);
  } else {
    result = await _importSequential(siteUrl, listTitle, encodedTitle, entityType, items, options);
  }

  return result;
}

/**
 * Sequential import — one item at a time.
 */
async function _importSequential(siteUrl, listTitle, encodedTitle, entityType, items, options) {
  var result = { success: 0, failed: 0, errors: [] };
  var url = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items";

  for (var i = 0; i < items.length; i++) {
    var body = Object.assign({}, items[i]);
    body['__metadata'] = { type: entityType };

    try {
      var resp = await spFetchWithRetry(url, {
        method: 'POST',
        siteUrl: siteUrl,
        body: body,
        headers: {
          'Content-Type': 'application/json;odata=verbose',
          'Accept': 'application/json;odata=verbose'
        }
      });

      if (resp.ok) {
        result.success++;
      } else {
        var err = await spParseError(resp);
        result.failed++;
        result.errors.push({ index: i, error: err.message });
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ index: i, error: e.message });
    }

    if (options.onProgress) {
      options.onProgress(result.success + result.failed, items.length);
    }
  }

  return result;
}

/**
 * Batch import — multiple items per $batch request (SP 2016+/SPO).
 */
async function _importBatch(siteUrl, listTitle, encodedTitle, entityType, items, options) {
  var result = { success: 0, failed: 0, errors: [] };
  var batchSize = 100;
  var url = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items";
  var batchUrl = siteUrl + '/_api/$batch';

  for (var start = 0; start < items.length; start += batchSize) {
    var chunk = items.slice(start, start + batchSize);
    var batchId = 'batch_' + Math.random().toString(36).substr(2, 9);
    var changesetId = 'changeset_' + Math.random().toString(36).substr(2, 9);

    var batchBody = '--' + batchId + '\r\n';
    batchBody += 'Content-Type: multipart/mixed; boundary=' + changesetId + '\r\n\r\n';

    chunk.forEach(function(item) {
      var itemBody = Object.assign({}, item);
      itemBody['__metadata'] = { type: entityType };

      batchBody += '--' + changesetId + '\r\n';
      batchBody += 'Content-Type: application/http\r\n';
      batchBody += 'Content-Transfer-Encoding: binary\r\n\r\n';
      batchBody += 'POST ' + url + ' HTTP/1.1\r\n';
      batchBody += 'Content-Type: application/json;odata=verbose\r\n';
      batchBody += 'Accept: application/json;odata=verbose\r\n\r\n';
      batchBody += JSON.stringify(itemBody) + '\r\n';
    });

    batchBody += '--' + changesetId + '--\r\n';
    batchBody += '--' + batchId + '--\r\n';

    try {
      var digest = await spGetDigest(siteUrl);
      var resp = await fetch(batchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/mixed; boundary=' + batchId,
          'Accept': 'application/json;odata=verbose',
          'X-RequestDigest': digest
        },
        credentials: 'include',
        body: batchBody
      });

      if (resp.ok) {
        result.success += chunk.length;
      } else {
        // Fallback: count entire batch as failed
        result.failed += chunk.length;
        var err = await spParseError(resp);
        chunk.forEach(function(_, idx) {
          result.errors.push({ index: start + idx, error: err.message });
        });
      }
    } catch (e) {
      result.failed += chunk.length;
      chunk.forEach(function(_, idx) {
        result.errors.push({ index: start + idx, error: e.message });
      });
    }

    if (options.onProgress) {
      options.onProgress(result.success + result.failed, items.length);
    }
  }

  return result;
}

/**
 * Render the import UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 */
function spCreateImportUI(container, siteUrl) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + purple + ';margin-bottom:12px;';
  title.textContent = 'Import CSV to SharePoint List';
  wrapper.appendChild(title);

  // List selector
  var listRow = document.createElement('div');
  listRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var listLabel = document.createElement('span');
  listLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  listLabel.textContent = 'Target list:';
  listRow.appendChild(listLabel);

  var listSelect = document.createElement('select');
  listSelect.style.cssText = 'flex:1;padding:6px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  listSelect.innerHTML = '<option value="">Loading...</option>';
  listRow.appendChild(listSelect);
  wrapper.appendChild(listRow);

  // File picker
  var fileRow = document.createElement('div');
  fileRow.style.cssText = 'margin-bottom:12px;';

  var fileLabel = document.createElement('div');
  fileLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  fileLabel.textContent = 'CSV File';
  fileRow.appendChild(fileLabel);

  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv';
  fileInput.style.cssText = 'font-family:inherit;font-size:11px;color:' + text + ';';
  fileRow.appendChild(fileInput);
  wrapper.appendChild(fileRow);

  // Column mapping (populated after file load)
  var mappingSection = document.createElement('div');
  mappingSection.style.cssText = 'display:none;margin-bottom:12px;';

  var mappingLabel = document.createElement('div');
  mappingLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  mappingLabel.textContent = 'Column Mapping';
  mappingSection.appendChild(mappingLabel);

  var mappingTable = document.createElement('div');
  mappingSection.appendChild(mappingTable);
  wrapper.appendChild(mappingSection);

  // Preview
  var previewSection = document.createElement('div');
  previewSection.style.cssText = 'display:none;margin-bottom:12px;';
  var previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  previewLabel.textContent = 'Preview (first 5 rows)';
  previewSection.appendChild(previewLabel);
  var previewContainer = document.createElement('div');
  previewContainer.style.cssText = 'font-size:11px;overflow-x:auto;';
  previewSection.appendChild(previewContainer);
  wrapper.appendChild(previewSection);

  // Import mode
  var modeRow = document.createElement('div');
  modeRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:12px;';

  var modeLabel = document.createElement('span');
  modeLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  modeLabel.textContent = 'Mode:';
  modeRow.appendChild(modeLabel);

  var seqRadio = document.createElement('input');
  seqRadio.type = 'radio';
  seqRadio.name = 'sp-import-mode';
  seqRadio.value = 'sequential';
  seqRadio.checked = true;
  seqRadio.id = 'sp-imp-seq';
  var seqLabel = document.createElement('label');
  seqLabel.htmlFor = 'sp-imp-seq';
  seqLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  seqLabel.textContent = ' Sequential';
  modeRow.appendChild(seqRadio);
  modeRow.appendChild(seqLabel);

  var batchRadio = document.createElement('input');
  batchRadio.type = 'radio';
  batchRadio.name = 'sp-import-mode';
  batchRadio.value = 'batch';
  batchRadio.id = 'sp-imp-batch';
  var batchLabel = document.createElement('label');
  batchLabel.htmlFor = 'sp-imp-batch';
  batchLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  batchLabel.textContent = ' Batch (SP 2016+)';
  modeRow.appendChild(batchRadio);
  modeRow.appendChild(batchLabel);
  wrapper.appendChild(modeRow);

  // Import button
  var importBtn = document.createElement('button');
  importBtn.textContent = 'Import';
  importBtn.style.cssText = 'padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;';
  importBtn.disabled = true;
  wrapper.appendChild(importBtn);

  // Progress
  var progressContainer = document.createElement('div');
  progressContainer.style.cssText = 'display:none;margin-top:8px;';
  var progressBar = document.createElement('div');
  progressBar.style.cssText = 'height:4px;background:' + border + ';border-radius:2px;overflow:hidden;';
  var progressFill = document.createElement('div');
  progressFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,' + cyan + ',' + purple + ');transition:width 0.3s;';
  progressBar.appendChild(progressFill);
  progressContainer.appendChild(progressBar);
  var progressText = document.createElement('div');
  progressText.style.cssText = 'font-size:10px;color:' + textDim + ';margin-top:2px;';
  progressContainer.appendChild(progressText);
  wrapper.appendChild(progressContainer);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var csvData = null;
  var spSchema = [];

  // Load lists
  spGetLists(siteUrl).then(function(lists) {
    listSelect.innerHTML = '<option value="">— Select target list —</option>';
    lists.forEach(function(list) {
      var opt = document.createElement('option');
      opt.value = list.title;
      opt.textContent = list.title;
      listSelect.appendChild(opt);
    });
  });

  // On list select — load schema for mapping
  listSelect.addEventListener('change', function() {
    if (!listSelect.value) { spSchema = []; return; }
    spGetListSchema(siteUrl, listSelect.value).then(function(fields) {
      spSchema = fields;
      if (csvData) buildMapping();
    });
  });

  // On file select — parse CSV
  fileInput.addEventListener('change', function() {
    var file = fileInput.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      if (typeof parseCSV === 'function') {
        csvData = parseCSV(text);
      } else {
        // Simple fallback CSV parse
        var lines = text.split('\n').filter(function(l) { return l.trim(); });
        var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
        var rows = lines.slice(1).map(function(l) {
          return l.split(',').map(function(v) { return v.trim().replace(/^"|"$/g, ''); });
        });
        csvData = { headers: headers, rows: rows, _headers: headers, _rows: rows };
      }

      // Show preview
      previewSection.style.display = 'block';
      var previewHeaders = csvData.headers || csvData._headers;
      var previewRows = (csvData.rows || csvData._rows).slice(0, 5);
      var html = '<table style="border-collapse:collapse;width:100%;"><tr>';
      previewHeaders.forEach(function(h) {
        html += '<th style="padding:3px 8px;border:1px solid ' + border + ';color:' + cyan + ';font-size:10px;text-align:left;">' + h + '</th>';
      });
      html += '</tr>';
      previewRows.forEach(function(row) {
        html += '<tr>';
        row.forEach(function(v) {
          html += '<td style="padding:3px 8px;border:1px solid ' + border + ';color:' + text + ';font-size:10px;">' + (v || '') + '</td>';
        });
        html += '</tr>';
      });
      html += '</table>';
      previewContainer.innerHTML = html;

      if (spSchema.length > 0) buildMapping();
      importBtn.disabled = false;
    };
    reader.readAsText(file);
  });

  function buildMapping() {
    mappingSection.style.display = 'block';
    mappingTable.innerHTML = '';

    var csvHeaders = csvData.headers || csvData._headers;
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;gap:4px 8px;align-items:center;';

    // Header row
    grid.innerHTML = '<div style="font-size:10px;color:' + textDim + ';font-weight:600;">CSV Column</div>'
      + '<div style="font-size:10px;color:' + textDim + ';">→</div>'
      + '<div style="font-size:10px;color:' + textDim + ';font-weight:600;">SP Field</div>';

    csvHeaders.forEach(function(csvCol) {
      var csvDiv = document.createElement('div');
      csvDiv.style.cssText = 'font-size:11px;color:' + text + ';';
      csvDiv.textContent = csvCol;
      grid.appendChild(csvDiv);

      var arrow = document.createElement('div');
      arrow.style.cssText = 'font-size:11px;color:' + textDim + ';text-align:center;';
      arrow.textContent = '→';
      grid.appendChild(arrow);

      var select = document.createElement('select');
      select.style.cssText = 'padding:3px 6px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
      select.dataset.csvCol = csvCol;
      select.innerHTML = '<option value="">(skip)</option>';
      spSchema.forEach(function(f) {
        var opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.displayName;
        // Auto-match by name (case-insensitive)
        if (f.name.toLowerCase() === csvCol.toLowerCase() || f.displayName.toLowerCase() === csvCol.toLowerCase()) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      grid.appendChild(select);
    });

    mappingTable.appendChild(grid);
  }

  // Import action
  importBtn.addEventListener('click', async function() {
    if (!csvData || !listSelect.value) return;

    var csvHeaders = csvData.headers || csvData._headers;
    var csvRows = csvData.rows || csvData._rows;

    // Build mapping from UI
    var mapping = {};
    var selects = mappingTable.querySelectorAll('select');
    selects.forEach(function(sel) {
      if (sel.value) {
        mapping[sel.dataset.csvCol] = sel.value;
      }
    });

    // Convert rows to objects using mapping
    var items = csvRows.map(function(row) {
      var obj = {};
      csvHeaders.forEach(function(h, i) {
        if (mapping[h]) {
          obj[mapping[h]] = row[i];
        }
      });
      return obj;
    });

    var mode = batchRadio.checked ? 'batch' : 'sequential';

    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starting import...';
    importBtn.disabled = true;

    try {
      var result = await spImportItems(siteUrl, listSelect.value, items, {
        mode: mode,
        onProgress: function(done, total) {
          var pct = Math.round((done / total) * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = done + ' / ' + total + ' items (' + pct + '%)';
        }
      });

      progressFill.style.width = '100%';
      var summary = result.success + ' imported';
      if (result.failed > 0) {
        summary += ', ' + result.failed + ' failed';
        progressText.style.color = pink;
      }
      progressText.textContent = summary;

      if (result.errors.length > 0) {
        var errSummary = result.errors.slice(0, 5).map(function(e) {
          return 'Row ' + (e.index + 1) + ': ' + e.error;
        }).join('\n');
        if (result.errors.length > 5) {
          errSummary += '\n... and ' + (result.errors.length - 5) + ' more errors';
        }
        spCreateErrorDisplay(errorContainer, { message: errSummary });
      }
    } catch (err) {
      progressText.style.color = pink;
      progressText.textContent = 'Error: ' + err.message;
    }

    importBtn.disabled = false;
  });

  container.appendChild(wrapper);
}

// --- sharepoint/sp-doc-browser.js ---

/**
 * SharePoint Document Library Browser
 * Browse doc libraries, navigate folders, preview metadata, download files.
 * Zero external dependencies.
 */

/* global spFetch, spFetchWithRetry, spParseError, spCreateErrorDisplay */

/**
 * Get all document libraries from a SharePoint site.
 *
 * @param {string} siteUrl
 * @returns {Promise<Array<{title: string, id: string, itemCount: number, rootFolder: string}>>}
 */
async function spGetDocLibraries(siteUrl) {
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists?$filter=BaseTemplate eq 101 and Hidden eq false&$select=Title,Id,ItemCount,RootFolder/ServerRelativeUrl&$expand=RootFolder",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;

  return results.map(function(lib) {
    return {
      title: lib.Title,
      id: lib.Id || lib.ID,
      itemCount: lib.ItemCount,
      rootFolder: lib.RootFolder ? (lib.RootFolder.ServerRelativeUrl || lib.RootFolder.serverRelativeUrl) : ''
    };
  });
}

/**
 * Get contents of a folder (subfolders and files).
 *
 * @param {string} siteUrl
 * @param {string} folderPath - Server-relative folder path
 * @returns {Promise<{folders: object[], files: object[]}>}
 */
async function spGetFolderContents(siteUrl, folderPath) {
  var encodedPath = encodeURIComponent(folderPath);

  var foldersResp = await spFetchWithRetry(
    siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedPath + "')/Folders?$select=Name,ServerRelativeUrl,ItemCount,TimeLastModified&$orderby=Name",
    { siteUrl: siteUrl }
  );

  var filesResp = await spFetchWithRetry(
    siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedPath + "')/Files?$select=Name,ServerRelativeUrl,Length,TimeLastModified,Author/Title&$expand=Author&$orderby=Name",
    { siteUrl: siteUrl }
  );

  var folders = [];
  var files = [];

  if (foldersResp.ok) {
    var fData = await foldersResp.json();
    var fResults = fData.d ? fData.d.results : fData.value;
    folders = fResults
      .filter(function(f) { return f.Name !== 'Forms'; })
      .map(function(f) {
        return {
          name: f.Name,
          path: f.ServerRelativeUrl,
          itemCount: f.ItemCount,
          modified: f.TimeLastModified
        };
      });
  }

  if (filesResp.ok) {
    var fileData = await filesResp.json();
    var fileResults = fileData.d ? fileData.d.results : fileData.value;
    files = fileResults.map(function(f) {
      return {
        name: f.Name,
        path: f.ServerRelativeUrl,
        size: parseInt(f.Length, 10) || 0,
        modified: f.TimeLastModified,
        author: f.Author ? f.Author.Title : ''
      };
    });
  }

  return { folders: folders, files: files };
}

/**
 * Get detailed file metadata including version history.
 *
 * @param {string} siteUrl
 * @param {string} fileUrl - Server-relative file URL
 * @returns {Promise<object>}
 */
async function spGetFileMetadata(siteUrl, fileUrl) {
  var encodedUrl = encodeURIComponent(fileUrl);
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedUrl + "')?$select=Name,ServerRelativeUrl,Length,TimeCreated,TimeLastModified,CheckOutType,MajorVersion,MinorVersion,UIVersionLabel,Author/Title,ModifiedBy/Title&$expand=Author,ModifiedBy",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var file = data.d || data;

  return {
    name: file.Name,
    path: file.ServerRelativeUrl,
    size: parseInt(file.Length, 10) || 0,
    created: file.TimeCreated,
    modified: file.TimeLastModified,
    version: file.UIVersionLabel || (file.MajorVersion + '.' + file.MinorVersion),
    checkedOut: file.CheckOutType !== 2, // 2 = None
    author: file.Author ? file.Author.Title : '',
    modifiedBy: file.ModifiedBy ? file.ModifiedBy.Title : ''
  };
}

/**
 * Download a file from SharePoint.
 *
 * @param {string} siteUrl
 * @param {string} fileUrl - Server-relative file URL
 * @param {string} [fileName] - Override download filename
 */
async function spDownloadFile(siteUrl, fileUrl, fileName) {
  var encodedUrl = encodeURIComponent(fileUrl);
  var resp = await spFetch(
    siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedUrl + "')/$value",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var blob = await resp.blob();
  var name = fileName || fileUrl.split('/').pop();
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

/**
 * Format file size for display.
 * @param {number} bytes
 * @returns {string}
 */
function _formatSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(i, units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Get file extension for icon display.
 * @param {string} name
 * @returns {string}
 */
function _getFileIcon(name) {
  var ext = (name.split('.').pop() || '').toLowerCase();
  var icons = {
    pdf: '\uD83D\uDCC4', doc: '\uD83D\uDCC3', docx: '\uD83D\uDCC3',
    xls: '\uD83D\uDCCA', xlsx: '\uD83D\uDCCA', ppt: '\uD83D\uDCCA', pptx: '\uD83D\uDCCA',
    jpg: '\uD83D\uDDBC', jpeg: '\uD83D\uDDBC', png: '\uD83D\uDDBC', gif: '\uD83D\uDDBC',
    zip: '\uD83D\uDCE6', rar: '\uD83D\uDCE6',
    txt: '\uD83D\uDCC4', csv: '\uD83D\uDCC4', json: '\uD83D\uDCC4'
  };
  return icons[ext] || '\uD83D\uDCC4';
}

/**
 * Render the document library browser UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 */
function spCreateDocBrowserUI(container, siteUrl) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var bgHover = '#1a1a3a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:12px;letter-spacing:1px;';
  header.textContent = 'Document Libraries';
  wrapper.appendChild(header);

  // Library selector
  var libRow = document.createElement('div');
  libRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var libSelect = document.createElement('select');
  libSelect.style.cssText = 'flex:1;padding:6px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  libSelect.innerHTML = '<option value="">Loading libraries...</option>';
  libRow.appendChild(libSelect);
  wrapper.appendChild(libRow);

  // Breadcrumb
  var breadcrumb = document.createElement('div');
  breadcrumb.style.cssText = 'display:none;margin-bottom:8px;font-size:11px;color:' + textDim + ';';
  wrapper.appendChild(breadcrumb);

  // Up button
  var upBtn = document.createElement('button');
  upBtn.textContent = '\u2191 Up';
  upBtn.style.cssText = 'display:none;padding:3px 10px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-family:inherit;font-size:10px;cursor:pointer;margin-bottom:8px;';
  wrapper.appendChild(upBtn);

  // File list
  var fileList = document.createElement('div');
  fileList.style.cssText = 'border:1px solid ' + border + ';border-radius:6px;overflow:hidden;';
  wrapper.appendChild(fileList);

  // Metadata panel (shown on file click)
  var metaPanel = document.createElement('div');
  metaPanel.style.cssText = 'display:none;margin-top:8px;padding:10px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;font-size:11px;';
  wrapper.appendChild(metaPanel);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var libraries = [];
  var currentPath = '';
  var pathHistory = [];

  // Load libraries
  spGetDocLibraries(siteUrl).then(function(libs) {
    libraries = libs;
    libSelect.innerHTML = '<option value="">— Select library (' + libs.length + ') —</option>';
    libs.forEach(function(lib) {
      var opt = document.createElement('option');
      opt.value = lib.rootFolder;
      opt.textContent = lib.title + ' (' + lib.itemCount + ' items)';
      libSelect.appendChild(opt);
    });
  }).catch(function(err) {
    libSelect.innerHTML = '<option value="">Error loading libraries</option>';
    spCreateErrorDisplay(errorContainer, { message: err.message });
  });

  function updateBreadcrumb(path) {
    breadcrumb.style.display = 'block';
    var parts = path.split('/').filter(function(p) { return p; });
    breadcrumb.innerHTML = '';

    parts.forEach(function(part, idx) {
      if (idx > 0) {
        var sep = document.createElement('span');
        sep.textContent = ' / ';
        sep.style.color = textDim;
        breadcrumb.appendChild(sep);
      }
      var link = document.createElement('span');
      link.textContent = part;
      link.style.cssText = 'cursor:pointer;color:' + (idx === parts.length - 1 ? text : cyan) + ';';
      if (idx < parts.length - 1) {
        var targetPath = '/' + parts.slice(0, idx + 1).join('/');
        link.addEventListener('click', function() { navigateTo(targetPath); });
      }
      breadcrumb.appendChild(link);
    });
  }

  function navigateTo(folderPath) {
    currentPath = folderPath;
    upBtn.style.display = 'inline-block';
    updateBreadcrumb(folderPath);
    metaPanel.style.display = 'none';

    fileList.innerHTML = '<div style="padding:10px;color:' + textDim + ';font-size:11px;">Loading...</div>';

    spGetFolderContents(siteUrl, folderPath).then(function(contents) {
      renderContents(contents);
    }).catch(function(err) {
      fileList.innerHTML = '';
      spCreateErrorDisplay(errorContainer, { message: err.message });
    });
  }

  function renderContents(contents) {
    fileList.innerHTML = '';

    // Header row
    var headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:grid;grid-template-columns:1fr 80px 140px 120px 40px;padding:6px 10px;background:' + bgDark + ';border-bottom:1px solid ' + border + ';font-size:10px;color:' + textDim + ';font-weight:600;';
    headerRow.innerHTML = '<div>Name</div><div>Size</div><div>Modified</div><div>Author</div><div></div>';
    fileList.appendChild(headerRow);

    if (contents.folders.length === 0 && contents.files.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:20px;text-align:center;color:' + textDim + ';font-size:11px;';
      empty.textContent = 'Empty folder';
      fileList.appendChild(empty);
      return;
    }

    // Folders
    contents.folders.forEach(function(folder) {
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 140px 120px 40px;padding:5px 10px;border-bottom:1px solid ' + border + ';font-size:11px;cursor:pointer;align-items:center;';
      row.addEventListener('mouseenter', function() { row.style.background = bgHover; });
      row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });

      row.innerHTML = '<div style="color:' + cyan + ';">\uD83D\uDCC1 ' + folder.name + '</div>'
        + '<div style="color:' + textDim + ';">' + (folder.itemCount || '') + ' items</div>'
        + '<div style="color:' + textDim + ';">' + _formatDate(folder.modified) + '</div>'
        + '<div></div><div></div>';

      row.addEventListener('click', function() {
        pathHistory.push(currentPath);
        navigateTo(folder.path);
      });

      fileList.appendChild(row);
    });

    // Files
    contents.files.forEach(function(file) {
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 80px 140px 120px 40px;padding:5px 10px;border-bottom:1px solid ' + border + ';font-size:11px;align-items:center;';
      row.addEventListener('mouseenter', function() { row.style.background = bgHover; });
      row.addEventListener('mouseleave', function() { row.style.background = 'transparent'; });

      var nameCell = document.createElement('div');
      nameCell.style.cssText = 'color:' + text + ';cursor:pointer;';
      nameCell.textContent = _getFileIcon(file.name) + ' ' + file.name;
      nameCell.addEventListener('click', function() { showMetadata(file); });

      var sizeCell = document.createElement('div');
      sizeCell.style.cssText = 'color:' + textDim + ';';
      sizeCell.textContent = _formatSize(file.size);

      var modCell = document.createElement('div');
      modCell.style.cssText = 'color:' + textDim + ';';
      modCell.textContent = _formatDate(file.modified);

      var authorCell = document.createElement('div');
      authorCell.style.cssText = 'color:' + textDim + ';';
      authorCell.textContent = file.author;

      var dlCell = document.createElement('div');
      var dlBtn = document.createElement('button');
      dlBtn.textContent = '\u2B07';
      dlBtn.title = 'Download';
      dlBtn.style.cssText = 'padding:2px 6px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + cyan + ';font-size:12px;cursor:pointer;';
      dlBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        spDownloadFile(siteUrl, file.path, file.name).catch(function(err) {
          spCreateErrorDisplay(errorContainer, { message: err.message });
        });
      });
      dlCell.appendChild(dlBtn);

      row.appendChild(nameCell);
      row.appendChild(sizeCell);
      row.appendChild(modCell);
      row.appendChild(authorCell);
      row.appendChild(dlCell);
      fileList.appendChild(row);
    });
  }

  function showMetadata(file) {
    metaPanel.style.display = 'block';
    metaPanel.innerHTML = '<div style="color:' + textDim + ';">Loading metadata...</div>';

    spGetFileMetadata(siteUrl, file.path).then(function(meta) {
      metaPanel.innerHTML = '<div style="font-weight:600;color:' + purple + ';margin-bottom:6px;">' + meta.name + '</div>'
        + '<div style="display:grid;grid-template-columns:100px 1fr;gap:2px 8px;">'
        + '<span style="color:' + textDim + ';">Size</span><span style="color:' + text + ';">' + _formatSize(meta.size) + '</span>'
        + '<span style="color:' + textDim + ';">Version</span><span style="color:' + text + ';">' + meta.version + '</span>'
        + '<span style="color:' + textDim + ';">Created</span><span style="color:' + text + ';">' + _formatDate(meta.created) + '</span>'
        + '<span style="color:' + textDim + ';">Modified</span><span style="color:' + text + ';">' + _formatDate(meta.modified) + '</span>'
        + '<span style="color:' + textDim + ';">Author</span><span style="color:' + text + ';">' + meta.author + '</span>'
        + '<span style="color:' + textDim + ';">Modified by</span><span style="color:' + text + ';">' + meta.modifiedBy + '</span>'
        + '<span style="color:' + textDim + ';">Checked out</span><span style="color:' + (meta.checkedOut ? pink : text) + ';">' + (meta.checkedOut ? 'Yes' : 'No') + '</span>'
        + '</div>';
    }).catch(function(err) {
      metaPanel.innerHTML = '<div style="color:' + pink + ';">' + err.message + '</div>';
    });
  }

  // Library select handler
  libSelect.addEventListener('change', function() {
    var rootFolder = libSelect.value;
    if (!rootFolder) return;
    pathHistory = [];
    navigateTo(rootFolder);
  });

  // Up button
  upBtn.addEventListener('click', function() {
    if (pathHistory.length > 0) {
      var prev = pathHistory.pop();
      navigateTo(prev);
    } else {
      // Go up by trimming last path segment
      var parent = currentPath.replace(/\/[^\/]+$/, '');
      if (parent && parent !== currentPath) {
        navigateTo(parent);
      }
    }
  });

  container.appendChild(wrapper);
}

/**
 * Format ISO date for display.
 * @param {string} dateStr
 * @returns {string}
 */
function _formatDate(dateStr) {
  if (!dateStr) return '';
  try {
    var d = new Date(dateStr);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return dateStr;
  }
}

// --- sharepoint/sp-file-upload.js ---

/**
 * SharePoint File Upload
 * Upload via REST with support for special characters and chunked upload for large files.
 * Zero external dependencies.
 */

/* global spFetch, spGetDigest, spParseError, spCreateErrorDisplay */

var SP_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB chunks
var SP_LARGE_FILE_THRESHOLD = 250 * 1024 * 1024; // 250 MB

/**
 * Upload a file to a SharePoint folder.
 * Uses chunked upload for files > 250 MB.
 * Handles special characters in filenames via ResourcePath API.
 *
 * @param {string} siteUrl
 * @param {string} folderPath - Server-relative folder path
 * @param {string} fileName - Target file name
 * @param {File|ArrayBuffer} fileContent - File data
 * @param {object} [options]
 * @param {boolean} [options.overwrite=true] - Overwrite existing file
 * @param {function} [options.onProgress] - Progress callback: onProgress(loaded, total)
 * @returns {Promise<{name: string, path: string, size: number}>}
 */
async function spUploadFile(siteUrl, folderPath, fileName, fileContent, options) {
  options = options || {};
  var overwrite = options.overwrite !== false;

  // Convert File to ArrayBuffer if needed
  var buffer;
  var fileSize;
  if (fileContent instanceof ArrayBuffer) {
    buffer = fileContent;
    fileSize = buffer.byteLength;
  } else if (fileContent instanceof File) {
    buffer = await fileContent.arrayBuffer();
    fileSize = buffer.byteLength;
  } else {
    throw new Error('fileContent must be a File or ArrayBuffer');
  }

  // Use chunked upload for large files
  if (fileSize > SP_LARGE_FILE_THRESHOLD) {
    return _chunkedUpload(siteUrl, folderPath, fileName, buffer, fileSize, overwrite, options.onProgress);
  }

  // Check for special characters in filename
  var hasSpecialChars = /[%#]/.test(fileName);
  var encodedFolder = encodeURIComponent(folderPath);

  var url;
  if (hasSpecialChars) {
    // Use ResourcePath API for filenames with % or #
    url = siteUrl + "/_api/web/GetFolderByServerRelativePath(decodedurl='" + encodedFolder + "')/Files/AddUsingPath(decodedurl='" + encodeURIComponent(fileName) + "',overwrite=" + overwrite + ")";
  } else {
    url = siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedFolder + "')/Files/add(url='" + encodeURIComponent(fileName) + "',overwrite=" + overwrite + ")";
  }

  var digest = await spGetDigest(siteUrl);

  var resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Accept': 'application/json;odata=verbose',
      'X-RequestDigest': digest
    },
    credentials: 'include',
    body: buffer
  });

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var file = data.d || data;

  if (options.onProgress) {
    options.onProgress(fileSize, fileSize);
  }

  return {
    name: file.Name,
    path: file.ServerRelativeUrl,
    size: parseInt(file.Length, 10) || fileSize
  };
}

/**
 * Chunked upload for large files using StartUpload/ContinueUpload/FinishUpload.
 */
async function _chunkedUpload(siteUrl, folderPath, fileName, buffer, fileSize, overwrite, onProgress) {
  var encodedFolder = encodeURIComponent(folderPath);
  var encodedName = encodeURIComponent(fileName);

  // Generate upload ID
  var uploadId = _generateGuid();

  // Create empty file first
  var createUrl = siteUrl + "/_api/web/GetFolderByServerRelativeUrl('" + encodedFolder + "')/Files/add(url='" + encodedName + "',overwrite=" + overwrite + ")";
  var digest = await spGetDigest(siteUrl);

  var createResp = await fetch(createUrl, {
    method: 'POST',
    headers: {
      'Accept': 'application/json;odata=verbose',
      'X-RequestDigest': digest,
      'Content-Length': '0'
    },
    credentials: 'include',
    body: ''
  });

  if (!createResp.ok) {
    var err = await spParseError(createResp);
    throw new Error('Failed to create file: ' + err.message);
  }

  var createData = await createResp.json();
  var fileUrl = (createData.d || createData).ServerRelativeUrl;
  var encodedFileUrl = encodeURIComponent(fileUrl);

  var offset = 0;
  var chunkIndex = 0;
  var totalChunks = Math.ceil(fileSize / SP_CHUNK_SIZE);

  while (offset < fileSize) {
    var chunkEnd = Math.min(offset + SP_CHUNK_SIZE, fileSize);
    var chunk = buffer.slice(offset, chunkEnd);
    var isFirst = offset === 0;
    var isLast = chunkEnd >= fileSize;

    digest = await spGetDigest(siteUrl);

    var chunkUrl;
    if (isFirst) {
      chunkUrl = siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedFileUrl + "')/StartUpload(uploadId=guid'" + uploadId + "')";
    } else if (isLast) {
      chunkUrl = siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedFileUrl + "')/FinishUpload(uploadId=guid'" + uploadId + "',fileOffset=" + offset + ")";
    } else {
      chunkUrl = siteUrl + "/_api/web/GetFileByServerRelativeUrl('" + encodedFileUrl + "')/ContinueUpload(uploadId=guid'" + uploadId + "',fileOffset=" + offset + ")";
    }

    var chunkResp = await fetch(chunkUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/json;odata=verbose',
        'X-RequestDigest': digest
      },
      credentials: 'include',
      body: chunk
    });

    if (!chunkResp.ok) {
      var chunkErr = await spParseError(chunkResp);
      throw new Error('Chunk upload failed at offset ' + offset + ': ' + chunkErr.message);
    }

    offset = chunkEnd;
    chunkIndex++;

    if (onProgress) {
      onProgress(offset, fileSize);
    }
  }

  return {
    name: fileName,
    path: fileUrl,
    size: fileSize
  };
}

/**
 * Generate a GUID for upload ID.
 * @returns {string}
 */
function _generateGuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Format file size for display.
 * @param {number} bytes
 * @returns {string}
 */
function _uploadFormatSize(bytes) {
  if (bytes === 0) return '0 B';
  var units = ['B', 'KB', 'MB', 'GB'];
  var i = Math.floor(Math.log(bytes) / Math.log(1024));
  i = Math.min(i, units.length - 1);
  return (bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

/**
 * Render the file upload UI with drag-and-drop.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 * @param {string} currentFolderPath - Server-relative folder path
 */
function spCreateUploadUI(container, siteUrl, currentFolderPath) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + purple + ';margin-bottom:12px;';
  title.textContent = 'Upload Files';
  wrapper.appendChild(title);

  var folderInfo = document.createElement('div');
  folderInfo.style.cssText = 'font-size:11px;color:' + textDim + ';margin-bottom:12px;';
  folderInfo.textContent = 'Target: ' + currentFolderPath;
  wrapper.appendChild(folderInfo);

  // Drop zone
  var dropZone = document.createElement('div');
  dropZone.style.cssText = 'border:2px dashed ' + border + ';border-radius:8px;padding:32px;text-align:center;margin-bottom:12px;transition:border-color 0.2s,background 0.2s;cursor:pointer;';

  var dropLabel = document.createElement('div');
  dropLabel.style.cssText = 'color:' + textDim + ';font-size:12px;margin-bottom:8px;';
  dropLabel.textContent = 'Drag files here or click to browse';
  dropZone.appendChild(dropLabel);

  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.style.display = 'none';
  dropZone.appendChild(fileInput);

  dropZone.addEventListener('click', function() { fileInput.click(); });
  dropZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    dropZone.style.borderColor = cyan;
    dropZone.style.background = 'rgba(0,229,255,0.05)';
  });
  dropZone.addEventListener('dragleave', function() {
    dropZone.style.borderColor = border;
    dropZone.style.background = 'transparent';
  });
  dropZone.addEventListener('drop', function(e) {
    e.preventDefault();
    dropZone.style.borderColor = border;
    dropZone.style.background = 'transparent';
    addFiles(e.dataTransfer.files);
  });

  wrapper.appendChild(dropZone);

  // File queue
  var queueContainer = document.createElement('div');
  wrapper.appendChild(queueContainer);

  // Upload button
  var uploadBtn = document.createElement('button');
  uploadBtn.textContent = 'Upload All';
  uploadBtn.style.cssText = 'display:none;padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-top:8px;';
  wrapper.appendChild(uploadBtn);

  // Overall progress
  var overallProgress = document.createElement('div');
  overallProgress.style.cssText = 'display:none;margin-top:8px;font-size:11px;color:' + textDim + ';';
  wrapper.appendChild(overallProgress);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var fileQueue = [];
  var uploading = false;

  fileInput.addEventListener('change', function() {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  function addFiles(fileList) {
    for (var i = 0; i < fileList.length; i++) {
      fileQueue.push({
        file: fileList[i],
        status: 'pending', // pending, uploading, done, error
        progress: 0,
        error: null,
        el: null
      });
    }
    renderQueue();
  }

  function renderQueue() {
    queueContainer.innerHTML = '';
    if (fileQueue.length === 0) {
      uploadBtn.style.display = 'none';
      return;
    }

    uploadBtn.style.display = 'inline-block';

    fileQueue.forEach(function(item, idx) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid ' + border + ';font-size:11px;';

      // Status indicator
      var statusDot = document.createElement('span');
      var colors = { pending: textDim, uploading: cyan, done: '#4caf50', error: pink };
      statusDot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:' + (colors[item.status] || textDim) + ';flex-shrink:0;';
      row.appendChild(statusDot);

      // File info
      var info = document.createElement('div');
      info.style.cssText = 'flex:1;min-width:0;';
      var nameSpan = document.createElement('div');
      nameSpan.style.cssText = 'color:' + text + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      nameSpan.textContent = item.file.name;
      info.appendChild(nameSpan);

      var sizeSpan = document.createElement('div');
      sizeSpan.style.cssText = 'color:' + textDim + ';font-size:10px;';
      sizeSpan.textContent = _uploadFormatSize(item.file.size);
      if (item.error) {
        sizeSpan.style.color = pink;
        sizeSpan.textContent = item.error;
      }
      info.appendChild(sizeSpan);
      row.appendChild(info);

      // Progress bar (shown during upload)
      if (item.status === 'uploading') {
        var progBar = document.createElement('div');
        progBar.style.cssText = 'width:80px;height:3px;background:' + border + ';border-radius:2px;overflow:hidden;';
        var progFill = document.createElement('div');
        progFill.style.cssText = 'height:100%;width:' + item.progress + '%;background:' + cyan + ';transition:width 0.3s;';
        progBar.appendChild(progFill);
        row.appendChild(progBar);
      }

      // Remove button (only when pending)
      if (item.status === 'pending') {
        var removeBtn = document.createElement('button');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'background:transparent;border:none;color:' + pink + ';font-size:12px;cursor:pointer;padding:2px 4px;flex-shrink:0;';
        removeBtn.addEventListener('click', function() {
          fileQueue.splice(idx, 1);
          renderQueue();
        });
        row.appendChild(removeBtn);
      }

      // Done checkmark
      if (item.status === 'done') {
        var check = document.createElement('span');
        check.textContent = '✓';
        check.style.cssText = 'color:#4caf50;font-size:14px;flex-shrink:0;';
        row.appendChild(check);
      }

      item.el = row;
      queueContainer.appendChild(row);
    });
  }

  uploadBtn.addEventListener('click', async function() {
    if (uploading) return;
    uploading = true;
    uploadBtn.disabled = true;
    overallProgress.style.display = 'block';

    var total = fileQueue.length;
    var completed = 0;
    var failed = 0;

    for (var i = 0; i < fileQueue.length; i++) {
      var item = fileQueue[i];
      if (item.status !== 'pending') continue;

      item.status = 'uploading';
      renderQueue();

      try {
        await spUploadFile(siteUrl, currentFolderPath, item.file.name, item.file, {
          onProgress: function(loaded, fileTotal) {
            item.progress = Math.round((loaded / fileTotal) * 100);
            renderQueue();
          }
        });
        item.status = 'done';
        item.progress = 100;
        completed++;
      } catch (err) {
        item.status = 'error';
        item.error = err.message;
        failed++;
      }

      renderQueue();
      overallProgress.textContent = (completed + failed) + ' / ' + total + ' files processed'
        + (failed > 0 ? ' (' + failed + ' failed)' : '');
    }

    uploading = false;
    uploadBtn.disabled = false;
    overallProgress.textContent = 'Done: ' + completed + ' uploaded'
      + (failed > 0 ? ', ' + failed + ' failed' : '');
  });

  container.appendChild(wrapper);
}

// --- sharepoint/sp-spfx.js ---

/**
 * SPFx Web Part Packaging Helper
 * Manifest generation, config templates, and interactive packaging guide.
 * Zero external dependencies.
 */

/**
 * Generate a UUID v4 for component IDs.
 * @returns {string}
 */
function _spfxUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Generate an SPFx web part manifest JSON object.
 *
 * @param {object} [options]
 * @param {string} [options.title='WDK'] - Web part title
 * @param {string} [options.description='Wizard Data Engineering Kit'] - Description
 * @param {string} [options.version='1.0.0'] - Version
 * @param {string} [options.componentId] - Component UUID (auto-generated if omitted)
 * @returns {object} SPFx manifest object
 */
function spfxGetManifest(options) {
  options = options || {};
  var componentId = options.componentId || _spfxUuid();

  return {
    '$schema': 'https://developer.microsoft.com/json-schemas/spfx/client-side-web-part-manifest.schema.json',
    'id': componentId,
    'alias': (options.title || 'WDK').replace(/\s+/g, '') + 'WebPart',
    'componentType': 'WebPart',
    'version': '*',
    'manifestVersion': 2,
    'requiresCustomScript': false,
    'supportedHosts': ['SharePointWebPart', 'SharePointFullPage'],
    'preconfiguredEntries': [{
      'groupId': '5c03119e-3074-46fd-976b-c60198311f70',
      'group': { 'default': 'Other' },
      'title': { 'default': options.title || 'WDK' },
      'description': { 'default': options.description || "Wizard's Data Engineering Kit — browser-based data toolkit" },
      'officeFabricIconFontName': 'Database',
      'properties': {}
    }]
  };
}

/**
 * Get SPFx configuration files content.
 *
 * @returns {{packageSolution: object, serveJson: object, configJson: object}}
 */
function spfxGetWebPartConfig() {
  return {
    packageSolution: {
      '$schema': 'https://developer.microsoft.com/json-schemas/spfx-build/package-solution.schema.json',
      'solution': {
        'name': 'wdk-webpart',
        'id': _spfxUuid(),
        'version': '1.0.0.0',
        'includeClientSideAssets': true,
        'isDomainIsolated': false,
        'developer': {
          'name': 'WDK',
          'websiteUrl': '',
          'privacyUrl': '',
          'termsOfUseUrl': '',
          'mpnId': 'Undefined-1.0.0'
        }
      },
      'paths': {
        'zippedPackage': 'solution/wdk-webpart.sppkg'
      }
    },
    serveJson: {
      '$schema': 'https://developer.microsoft.com/json-schemas/core-build/serve.schema.json',
      'port': 4321,
      'https': true,
      'initialPage': 'https://enter-your-SharePoint-site/_layouts/15/workbench.aspx'
    },
    configJson: {
      '$schema': 'https://developer.microsoft.com/json-schemas/spfx-build/config.2.0.schema.json',
      'version': '2.0',
      'bundles': {
        'wdk-web-part': {
          'components': [{
            'entrypoint': './lib/webparts/wdk/WdkWebPart.js',
            'manifest': './src/webparts/wdk/WdkWebPart.manifest.json'
          }]
        }
      },
      'externals': {},
      'localizedResources': {
        'WdkWebPartStrings': 'lib/webparts/wdk/loc/{locale}.js'
      }
    }
  };
}

/**
 * Render an interactive SPFx packaging guide.
 *
 * @param {HTMLElement} container
 */
function spfxCreatePackagingGuide(container) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:16px;letter-spacing:1px;';
  title.textContent = 'SPFx Web Part Packaging Guide';
  wrapper.appendChild(title);

  var steps = [
    {
      title: '1. Prerequisites',
      content: 'Install Node.js 18 LTS, Yeoman, and SPFx generator.\nFor air-gapped environments, use the Docker build instead (step 5).',
      code: 'npm install -g yo @microsoft/generator-sharepoint'
    },
    {
      title: '2. Scaffold SPFx Project',
      content: 'Create a new SPFx project that will wrap the WDK bundle.',
      code: 'yo @microsoft/sharepoint --solution-name wdk-webpart --component-type webpart --component-name WDK --framework none --skip-feature-deployment'
    },
    {
      title: '3. Inject WDK Bundle',
      content: 'Copy the built wiz.js into the web part render method. The web part\'s render() should create a container div and inject the WDK IIFE.',
      code: '// In WdkWebPart.ts render():\npublic render(): void {\n  this.domElement.innerHTML = \'<div id="wdk-root"></div>\';\n  // Inject wiz.js content here or load via require\n  const script = document.createElement(\'script\');\n  script.textContent = WDK_BUNDLE; // inlined at build\n  this.domElement.appendChild(script);\n}'
    },
    {
      title: '4. Configure for Air-Gapped Deployment',
      content: 'Set includeClientSideAssets: true in package-solution.json.\nThis bundles all assets inside the .sppkg file — no CDN needed.',
      code: '// config/package-solution.json\n{\n  "solution": {\n    "includeClientSideAssets": true,\n    "skipFeatureDeployment": true\n  }\n}'
    },
    {
      title: '5. Docker Build (Air-Gapped)',
      content: 'Use the provided Dockerfile for consistent builds without local Node.js setup.',
      code: 'docker build -t wdk-spfx .\ndocker run -v $(pwd)/dist:/out wdk-spfx\n# Output: dist/wdk-webpart.sppkg'
    },
    {
      title: '6. Deploy to SharePoint',
      content: 'SP 2019: Upload .sppkg to App Catalog → Site Contents → Add an App.\nSPO: Upload to tenant App Catalog or site-level App Catalog.',
      code: null
    },
    {
      title: 'SP 2019 vs SPO Differences',
      content: '• SP 2019: SPFx 1.4.1 max, no modern pages in some configs, use skipFeatureDeployment\n• SPO: Latest SPFx supported, modern pages, tenant-scoped deployment available\n• Both: includeClientSideAssets=true works for air-gapped',
      code: null
    }
  ];

  steps.forEach(function(step) {
    var section = document.createElement('div');
    section.style.cssText = 'margin-bottom:16px;padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

    var stepTitle = document.createElement('div');
    stepTitle.style.cssText = 'font-size:12px;font-weight:700;color:' + purple + ';margin-bottom:6px;';
    stepTitle.textContent = step.title;
    section.appendChild(stepTitle);

    var desc = document.createElement('div');
    desc.style.cssText = 'font-size:11px;color:' + text + ';white-space:pre-wrap;line-height:1.5;';
    desc.textContent = step.content;
    section.appendChild(desc);

    if (step.code) {
      var codeBlock = document.createElement('div');
      codeBlock.style.cssText = 'margin-top:8px;position:relative;';

      var pre = document.createElement('pre');
      pre.style.cssText = 'background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;padding:8px 12px;font-size:11px;color:' + cyan + ';overflow-x:auto;margin:0;white-space:pre-wrap;';
      pre.textContent = step.code;
      codeBlock.appendChild(pre);

      var copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.style.cssText = 'position:absolute;top:4px;right:4px;padding:2px 8px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-size:9px;cursor:pointer;';
      copyBtn.addEventListener('click', function() {
        var codeText = pre.textContent;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(codeText).then(function() {
            copyBtn.textContent = 'Copied!';
            setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
          });
        } else {
          // Fallback
          var ta = document.createElement('textarea');
          ta.value = codeText;
          ta.style.cssText = 'position:fixed;left:-9999px;';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
          copyBtn.textContent = 'Copied!';
          setTimeout(function() { copyBtn.textContent = 'Copy'; }, 1500);
        }
      });
      codeBlock.appendChild(copyBtn);
      section.appendChild(codeBlock);
    }

    wrapper.appendChild(section);
  });

  // Generated manifest preview
  var manifestSection = document.createElement('div');
  manifestSection.style.cssText = 'margin-top:16px;padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var manifestTitle = document.createElement('div');
  manifestTitle.style.cssText = 'font-size:12px;font-weight:700;color:' + purple + ';margin-bottom:6px;';
  manifestTitle.textContent = 'Generated Manifest';
  manifestSection.appendChild(manifestTitle);

  var manifest = spfxGetManifest();
  var manifestPre = document.createElement('pre');
  manifestPre.style.cssText = 'background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;padding:8px 12px;font-size:10px;color:' + text + ';overflow-x:auto;margin:0;max-height:200px;overflow-y:auto;';
  manifestPre.textContent = JSON.stringify(manifest, null, 2);
  manifestSection.appendChild(manifestPre);
  wrapper.appendChild(manifestSection);

  container.appendChild(wrapper);
}

// --- sharepoint/sp-aspx.js ---

/**
 * ASPX Application Page Template Generator
 * For on-prem SharePoint 2013+ farm admin deployment via _layouts.
 * Zero external dependencies.
 */

/**
 * Generate an ASPX application page template.
 *
 * @param {object} [options]
 * @param {string} [options.title='WDK'] - Page title
 * @param {string} [options.masterPage='~masterurl/default.master'] - Master page reference
 * @param {boolean} [options.includeRibbon=false] - Include ribbon placeholder
 * @param {boolean} [options.includeCodeBehind=true] - Include code-behind reference
 * @returns {string} Complete .aspx file content
 */
function aspxGetTemplate(options) {
  options = options || {};
  var pageTitle = options.title || 'WDK';
  var masterPage = options.masterPage || '~masterurl/default.master';
  var includeRibbon = options.includeRibbon || false;
  var includeCodeBehind = options.includeCodeBehind !== false;

  var lines = [];

  // Page directive
  if (includeCodeBehind) {
    lines.push('<%@ Page Language="C#" AutoEventWireup="true"');
    lines.push('    CodeBehind="' + pageTitle.replace(/\s+/g, '') + '.aspx.cs"');
    lines.push('    Inherits="WDK.Layouts.' + pageTitle.replace(/\s+/g, '') + 'Page"');
    lines.push('    MasterPageFile="' + masterPage + '"');
    lines.push('    DynamicMasterPageFile="' + masterPage + '" %>');
  } else {
    lines.push('<%@ Page Language="C#" AutoEventWireup="true"');
    lines.push('    MasterPageFile="' + masterPage + '"');
    lines.push('    DynamicMasterPageFile="' + masterPage + '" %>');
  }

  lines.push('');
  lines.push('<%@ Assembly Name="Microsoft.SharePoint, Version=15.0.0.0, Culture=neutral, PublicKeyToken=71e9bce111e9429c" %>');
  lines.push('<%@ Import Namespace="Microsoft.SharePoint" %>');
  lines.push('<%@ Import Namespace="Microsoft.SharePoint.WebControls" %>');
  lines.push('');

  // Page title
  lines.push('<asp:Content ID="PageTitle" ContentPlaceHolderID="PlaceHolderPageTitle" runat="server">');
  lines.push('    ' + pageTitle);
  lines.push('</asp:Content>');
  lines.push('');

  // Page title in title area
  lines.push('<asp:Content ID="PageTitleInTitleArea" ContentPlaceHolderID="PlaceHolderPageTitleInTitleArea" runat="server">');
  lines.push('    ' + pageTitle);
  lines.push('</asp:Content>');
  lines.push('');

  // Ribbon (optional)
  if (includeRibbon) {
    lines.push('<asp:Content ID="PageRibbon" ContentPlaceHolderID="PlaceHolderAdditionalPageHead" runat="server">');
    lines.push('    <!-- Additional page head content (scripts, styles) -->');
    lines.push('</asp:Content>');
    lines.push('');
  }

  // Main content
  lines.push('<asp:Content ID="Main" ContentPlaceHolderID="PlaceHolderMain" runat="server">');
  lines.push('');
  lines.push('    <!-- WDK Application Container -->');
  lines.push('    <div id="wdk-root" style="width:100%;min-height:600px;"></div>');
  lines.push('');

  if (includeCodeBehind) {
    lines.push('    <!-- Server-side data injection (populated by code-behind) -->');
    lines.push('    <asp:HiddenField ID="hdnSiteUrl" runat="server" />');
    lines.push('    <asp:HiddenField ID="hdnUserName" runat="server" />');
    lines.push('    <asp:HiddenField ID="hdnListData" runat="server" />');
    lines.push('');
  }

  lines.push('    <!-- Inline WDK bundle -->');
  lines.push('    <script type="text/javascript">');
  lines.push('        // Paste the contents of dist/wiz.js here');
  lines.push('        // Or reference as: <script src="/_layouts/15/WDK/wiz.js"><\/' + 'script>');
  lines.push('    <\/' + 'script>');
  lines.push('');

  if (includeCodeBehind) {
    lines.push('    <script type="text/javascript">');
    lines.push('        // Read server-side injected data');
    lines.push('        (function() {');
    lines.push('            var siteUrl = document.getElementById("<%= hdnSiteUrl.ClientID %>").value;');
    lines.push('            var userName = document.getElementById("<%= hdnUserName.ClientID %>").value;');
    lines.push('            var listData = document.getElementById("<%= hdnListData.ClientID %>").value;');
    lines.push('            if (listData) {');
    lines.push('                try { window.__wdkServerData = JSON.parse(listData); }');
    lines.push('                catch(e) { console.warn("WDK: Could not parse server data"); }');
    lines.push('            }');
    lines.push('            window.__wdkSiteUrl = siteUrl;');
    lines.push('            window.__wdkUserName = userName;');
    lines.push('        })();');
    lines.push('    <\/' + 'script>');
    lines.push('');
  }

  lines.push('    <!--');
  lines.push('    DEPLOYMENT:');
  lines.push('    1. Build the WDK bundle: node build.js');
  lines.push('    2. Copy this .aspx (and .aspx.cs if using code-behind) to:');
  lines.push('       C:\\Program Files\\Common Files\\microsoft shared\\Web Server Extensions\\15\\TEMPLATE\\LAYOUTS\\WDK\\');
  lines.push('    3. For SP 2016/2019, use "16" instead of "15" in the path');
  lines.push('    4. Run iisreset');
  lines.push('    5. Access at: https://your-site/_layouts/15/WDK/' + pageTitle.replace(/\s+/g, '') + '.aspx');
  lines.push('    -->');
  lines.push('');
  lines.push('</asp:Content>');

  return lines.join('\n');
}

/**
 * Generate a C# code-behind template.
 *
 * @param {object} [options]
 * @param {string} [options.title='WDK'] - Page title (used for class name)
 * @param {boolean} [options.includeListRead=true] - Include example list data read
 * @returns {string} Complete .aspx.cs file content
 */
function aspxGetCodeBehind(options) {
  options = options || {};
  var className = (options.title || 'WDK').replace(/\s+/g, '') + 'Page';
  var includeListRead = options.includeListRead !== false;

  var lines = [];

  lines.push('using System;');
  lines.push('using System.Web.Script.Serialization;');
  lines.push('using Microsoft.SharePoint;');
  lines.push('using Microsoft.SharePoint.WebControls;');
  lines.push('');
  lines.push('namespace WDK.Layouts');
  lines.push('{');
  lines.push('    /// <summary>');
  lines.push('    /// WDK application page code-behind.');
  lines.push('    /// Provides server-side data injection for the client-side WDK toolkit.');
  lines.push('    /// </summary>');
  lines.push('    public partial class ' + className + ' : LayoutsPageBase');
  lines.push('    {');
  lines.push('        protected void Page_Load(object sender, EventArgs e)');
  lines.push('        {');
  lines.push('            if (!IsPostBack)');
  lines.push('            {');
  lines.push('                // Inject site URL and current user');
  lines.push('                hdnSiteUrl.Value = SPContext.Current.Web.Url;');
  lines.push('                hdnUserName.Value = SPContext.Current.Web.CurrentUser.Name;');

  if (includeListRead) {
    lines.push('');
    lines.push('                // Example: pre-load list data server-side');
    lines.push('                // This runs with elevated privileges for full API access');
    lines.push('                SPSecurity.RunWithElevatedPrivileges(delegate()');
    lines.push('                {');
    lines.push('                    using (SPSite site = new SPSite(SPContext.Current.Site.ID))');
    lines.push('                    using (SPWeb web = site.OpenWeb(SPContext.Current.Web.ID))');
    lines.push('                    {');
    lines.push('                        // Example: read a list and serialize to JSON');
    lines.push('                        SPList list = web.Lists.TryGetList("YourListName");');
    lines.push('                        if (list != null)');
    lines.push('                        {');
    lines.push('                            var items = new System.Collections.Generic.List<object>();');
    lines.push('                            foreach (SPListItem item in list.Items)');
    lines.push('                            {');
    lines.push('                                items.Add(new');
    lines.push('                                {');
    lines.push('                                    Id = item.ID,');
    lines.push('                                    Title = item.Title,');
    lines.push('                                    // Add more fields as needed');
    lines.push('                                });');
    lines.push('                            }');
    lines.push('');
    lines.push('                            var serializer = new JavaScriptSerializer();');
    lines.push('                            hdnListData.Value = serializer.Serialize(items);');
    lines.push('                        }');
    lines.push('                    }');
    lines.push('                });');
  }

  lines.push('            }');
  lines.push('        }');
  lines.push('    }');
  lines.push('}');

  return lines.join('\n');
}

/**
 * Render the ASPX template generator UI.
 *
 * @param {HTMLElement} container
 */
function aspxCreateTemplateUI(container) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:16px;letter-spacing:1px;';
  title.textContent = 'ASPX Application Page Generator';
  wrapper.appendChild(title);

  // Options form
  var form = document.createElement('div');
  form.style.cssText = 'display:grid;grid-template-columns:120px 1fr;gap:8px 12px;align-items:center;margin-bottom:16px;padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  // Page title
  var titleLabel = document.createElement('label');
  titleLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  titleLabel.textContent = 'Page Title';
  form.appendChild(titleLabel);

  var titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.value = 'WDK';
  titleInput.style.cssText = 'padding:5px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  form.appendChild(titleInput);

  // Master page
  var masterLabel = document.createElement('label');
  masterLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  masterLabel.textContent = 'Master Page';
  form.appendChild(masterLabel);

  var masterSelect = document.createElement('select');
  masterSelect.style.cssText = 'padding:5px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  var masterPages = [
    { value: '~masterurl/default.master', label: 'default.master (SP 2013)' },
    { value: '~masterurl/custom.master', label: 'seattle.master (SP 2013)' },
    { value: '~site/_catalogs/masterpage/seattle.master', label: 'seattle.master (direct)' },
    { value: '~site/_catalogs/masterpage/oslo.master', label: 'oslo.master' },
    { value: '~masterurl/default.master', label: 'v4.master (SP 2010 compat)' }
  ];
  masterPages.forEach(function(mp) {
    var opt = document.createElement('option');
    opt.value = mp.value;
    opt.textContent = mp.label;
    masterSelect.appendChild(opt);
  });
  form.appendChild(masterSelect);

  // Include ribbon
  var ribbonLabel = document.createElement('label');
  ribbonLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  ribbonLabel.textContent = 'Include Ribbon';
  form.appendChild(ribbonLabel);

  var ribbonCheck = document.createElement('input');
  ribbonCheck.type = 'checkbox';
  ribbonCheck.checked = false;
  form.appendChild(ribbonCheck);

  // Include code-behind
  var cbLabel = document.createElement('label');
  cbLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  cbLabel.textContent = 'Code-Behind';
  form.appendChild(cbLabel);

  var cbCheck = document.createElement('input');
  cbCheck.type = 'checkbox';
  cbCheck.checked = true;
  form.appendChild(cbCheck);

  wrapper.appendChild(form);

  // Generate button
  var genBtn = document.createElement('button');
  genBtn.textContent = 'Generate';
  genBtn.style.cssText = 'padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-bottom:16px;';
  wrapper.appendChild(genBtn);

  // Preview area
  var previewSection = document.createElement('div');
  previewSection.style.cssText = 'margin-bottom:12px;';

  var previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'font-size:12px;font-weight:600;color:' + purple + ';margin-bottom:6px;';
  previewLabel.textContent = '.aspx Preview';
  previewSection.appendChild(previewLabel);

  var aspxPreview = document.createElement('pre');
  aspxPreview.style.cssText = 'background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;padding:10px;font-size:10px;color:' + text + ';overflow:auto;max-height:300px;margin:0;white-space:pre-wrap;';
  previewSection.appendChild(aspxPreview);
  wrapper.appendChild(previewSection);

  // Code-behind preview
  var cbSection = document.createElement('div');
  cbSection.style.cssText = 'margin-bottom:12px;';

  var cbPreviewLabel = document.createElement('div');
  cbPreviewLabel.style.cssText = 'font-size:12px;font-weight:600;color:' + purple + ';margin-bottom:6px;';
  cbPreviewLabel.textContent = '.aspx.cs Preview';
  cbSection.appendChild(cbPreviewLabel);

  var cbPreview = document.createElement('pre');
  cbPreview.style.cssText = aspxPreview.style.cssText;
  cbSection.appendChild(cbPreview);
  wrapper.appendChild(cbSection);

  // Download buttons
  var downloadRow = document.createElement('div');
  downloadRow.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;';

  var dlAspxBtn = document.createElement('button');
  dlAspxBtn.textContent = 'Download .aspx';
  dlAspxBtn.style.cssText = 'padding:5px 14px;background:transparent;border:1px solid ' + cyan + ';border-radius:4px;color:' + cyan + ';font-family:inherit;font-size:11px;cursor:pointer;';
  downloadRow.appendChild(dlAspxBtn);

  var dlCsBtn = document.createElement('button');
  dlCsBtn.textContent = 'Download .aspx.cs';
  dlCsBtn.style.cssText = dlAspxBtn.style.cssText;
  downloadRow.appendChild(dlCsBtn);
  wrapper.appendChild(downloadRow);

  // Deployment instructions
  var deploySection = document.createElement('div');
  deploySection.style.cssText = 'padding:12px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var deployTitle = document.createElement('div');
  deployTitle.style.cssText = 'font-size:12px;font-weight:700;color:' + purple + ';margin-bottom:6px;';
  deployTitle.textContent = 'Deployment Instructions';
  deploySection.appendChild(deployTitle);

  var deployContent = document.createElement('div');
  deployContent.style.cssText = 'font-size:11px;color:' + text + ';line-height:1.6;white-space:pre-wrap;';
  deployContent.textContent = '1. Build WDK: node build.js\n'
    + '2. Copy .aspx and .aspx.cs to:\n'
    + '   SP 2013: C:\\...\\Web Server Extensions\\15\\TEMPLATE\\LAYOUTS\\WDK\\\n'
    + '   SP 2016+: C:\\...\\Web Server Extensions\\16\\TEMPLATE\\LAYOUTS\\WDK\\\n'
    + '3. Run: iisreset\n'
    + '4. Access: https://your-site/_layouts/15/WDK/YourPage.aspx\n'
    + '\n'
    + 'Requirements:\n'
    + '• Farm administrator access\n'
    + '• Server filesystem access (RDP or mapped drive)\n'
    + '• Application page runs with full trust\n'
    + '• SPSecurity.RunWithElevatedPrivileges available';
  deploySection.appendChild(deployContent);
  wrapper.appendChild(deploySection);

  // State
  var currentAspx = '';
  var currentCs = '';

  function generate() {
    var opts = {
      title: titleInput.value || 'WDK',
      masterPage: masterSelect.value,
      includeRibbon: ribbonCheck.checked,
      includeCodeBehind: cbCheck.checked
    };

    currentAspx = aspxGetTemplate(opts);
    aspxPreview.textContent = currentAspx;

    if (cbCheck.checked) {
      currentCs = aspxGetCodeBehind({ title: opts.title });
      cbPreview.textContent = currentCs;
      cbSection.style.display = 'block';
      dlCsBtn.style.display = 'inline-block';
    } else {
      cbSection.style.display = 'none';
      dlCsBtn.style.display = 'none';
      currentCs = '';
    }
  }

  genBtn.addEventListener('click', generate);

  // Auto-generate on load
  generate();

  // Download handlers
  dlAspxBtn.addEventListener('click', function() {
    var name = (titleInput.value || 'WDK').replace(/\s+/g, '') + '.aspx';
    _downloadText(currentAspx, name, 'text/plain');
  });

  dlCsBtn.addEventListener('click', function() {
    var name = (titleInput.value || 'WDK').replace(/\s+/g, '') + '.aspx.cs';
    _downloadText(currentCs, name, 'text/plain');
  });

  container.appendChild(wrapper);
}

/**
 * Download text content as a file.
 * @param {string} content
 * @param {string} filename
 * @param {string} mimeType
 */
function _downloadText(content, filename, mimeType) {
  var blob = new Blob([content], { type: mimeType });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// --- inspect/dom-scraper.js ---

/**
 * INSPECT-001: DOM Scraper
 * Click-to-select and CSS selector extraction of HTML tables from the host page.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */
(function () {
  'use strict';

  var HIGHLIGHT_CLASS = 'dk-scraper-highlight';
  var STYLE_ID = 'dk-scraper-style';

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent =
      '.' + HIGHLIGHT_CLASS + ' { outline: 3px solid #2563eb !important; outline-offset: 2px; cursor: crosshair !important; }';
    document.head.appendChild(style);
  }

  function removeStyles() {
    var el = document.getElementById(STYLE_ID);
    if (el) el.parentNode.removeChild(el);
  }

  /**
   * Extract an HTML <table> element into a DataFrame object.
   * @param {HTMLTableElement} table
   * @returns {{ headers: string[], rows: string[][] }}
   */
  function tableToDataFrame(table) {
    var headers = [];
    var rows = [];
    var headerRow = table.querySelector('thead tr') || table.querySelector('tr');

    if (headerRow) {
      var thCells = headerRow.querySelectorAll('th');
      if (thCells.length > 0) {
        for (var h = 0; h < thCells.length; h++) {
          headers.push(thCells[h].textContent.trim());
        }
      } else {
        // Fall back to td cells in first row as headers
        var tdCells = headerRow.querySelectorAll('td');
        for (var t = 0; t < tdCells.length; t++) {
          headers.push(tdCells[t].textContent.trim());
        }
      }
    }

    var tbody = table.querySelector('tbody') || table;
    var allRows = tbody.querySelectorAll('tr');
    var startIdx = 0;

    // Skip header row if it was the first tr (no thead)
    if (!table.querySelector('thead') && allRows.length > 0 && allRows[0] === headerRow) {
      startIdx = 1;
    }

    for (var r = startIdx; r < allRows.length; r++) {
      var cells = allRows[r].querySelectorAll('td');
      if (cells.length === 0) continue;
      var row = [];
      for (var c = 0; c < cells.length; c++) {
        row.push(cells[c].textContent.trim());
      }
      rows.push(row);
    }

    // Generate column headers if none found
    if (headers.length === 0 && rows.length > 0) {
      for (var i = 0; i < rows[0].length; i++) {
        headers.push('Column ' + (i + 1));
      }
    }

    return { headers: headers, rows: rows };
  }

  /**
   * Find the closest <table> ancestor (or self) from an element.
   * @param {HTMLElement} el
   * @returns {HTMLTableElement|null}
   */
  function findTable(el) {
    var current = el;
    while (current && current !== document.body) {
      if (current.tagName === 'TABLE') return current;
      current = current.parentElement;
    }
    return null;
  }

  /**
   * Create a DOM scraper instance.
   * @param {function} onData - Callback receiving a DataFrame object when a table is extracted.
   * @returns {{ startSelect: function, stopSelect: function, extractBySelector: function }}
   */
  function createDOMScraper(onData) {
    var active = false;
    var lastHighlighted = null;

    function onMouseOver(e) {
      var table = findTable(e.target);
      if (lastHighlighted && lastHighlighted !== table) {
        lastHighlighted.classList.remove(HIGHLIGHT_CLASS);
      }
      if (table) {
        table.classList.add(HIGHLIGHT_CLASS);
        lastHighlighted = table;
      }
    }

    function onMouseOut(e) {
      var table = findTable(e.target);
      if (table) {
        table.classList.remove(HIGHLIGHT_CLASS);
      }
      if (lastHighlighted === table) {
        lastHighlighted = null;
      }
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      var table = findTable(e.target);
      if (table) {
        if (lastHighlighted) {
          lastHighlighted.classList.remove(HIGHLIGHT_CLASS);
          lastHighlighted = null;
        }
        var data = tableToDataFrame(table);
        if (typeof onData === 'function') {
          onData(data);
        }
      }
    }

    function startSelect() {
      if (active) return;
      active = true;
      injectStyles();
      document.addEventListener('mouseover', onMouseOver, true);
      document.addEventListener('mouseout', onMouseOut, true);
      document.addEventListener('click', onClick, true);
    }

    function stopSelect() {
      if (!active) return;
      active = false;
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('mouseout', onMouseOut, true);
      document.removeEventListener('click', onClick, true);
      if (lastHighlighted) {
        lastHighlighted.classList.remove(HIGHLIGHT_CLASS);
        lastHighlighted = null;
      }
      removeStyles();
    }

    /**
     * Extract a table by CSS selector.
     * @param {string} selector - CSS selector targeting a <table> element.
     * @returns {{ headers: string[], rows: string[][] }|null}
     */
    function extractBySelector(selector) {
      var el = document.querySelector(selector);
      if (!el) return null;
      var table = (el.tagName === 'TABLE') ? el : findTable(el);
      if (!table) return null;
      var data = tableToDataFrame(table);
      if (typeof onData === 'function') {
        onData(data);
      }
      return data;
    }

    return {
      startSelect: startSelect,
      stopSelect: stopSelect,
      extractBySelector: extractBySelector
    };
  }

  // Expose globally
  window.WDK = window.WDK || {};
  window.WDK.createDOMScraper = createDOMScraper;
})();

// --- inspect/network-interceptor.js ---

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
  window.WDK = window.WDK || {};
  window.WDK.startIntercepting = startIntercepting;
})();

// --- inspect/storage-viewer.js ---

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
  window.WDK = window.WDK || {};
  window.WDK.captureStorage = captureStorage;
})();

// --- inspect/console-capture.js ---

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

// --- inspect/page-explorer.js ---

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

// --- inspect/var-discovery.js ---

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

// --- export/docx-writer.js ---

/**
 * WDK DOCX Writer
 * Zero-dependency Word (.docx) file generator.
 * Creates valid OOXML WordprocessingML archives using a minimal ZIP writer.
 * Reuses CRC-32 + ZIP builder pattern from xlsx-writer.js.
 */
(function () {
  'use strict';
  if (typeof window.DK === 'undefined') window.DK = {};

  // ─── CRC-32 ────────────────────────────────────────────────────────
  var CRC32_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c;
    }
    return table;
  })();

  function crc32(data) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < data.length; i++) {
      crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // ─── UTF-8 + ZIP (STORE) ───────────────────────────────────────────
  function encodeUTF8(str) {
    var arr = [];
    for (var i = 0; i < str.length; i++) {
      var code = str.charCodeAt(i);
      if (code < 0x80) { arr.push(code); }
      else if (code < 0x800) { arr.push(0xC0 | (code >> 6)); arr.push(0x80 | (code & 0x3F)); }
      else if (code >= 0xD800 && code <= 0xDBFF && i + 1 < str.length) {
        var cp = ((code - 0xD800) << 10) + (str.charCodeAt(++i) - 0xDC00) + 0x10000;
        arr.push(0xF0 | (cp >> 18)); arr.push(0x80 | ((cp >> 12) & 0x3F));
        arr.push(0x80 | ((cp >> 6) & 0x3F)); arr.push(0x80 | (cp & 0x3F));
      } else { arr.push(0xE0 | (code >> 12)); arr.push(0x80 | ((code >> 6) & 0x3F)); arr.push(0x80 | (code & 0x3F)); }
    }
    return new Uint8Array(arr);
  }

  function writeU16LE(buf, o, v) { buf[o] = v & 0xFF; buf[o + 1] = (v >> 8) & 0xFF; }
  function writeU32LE(buf, o, v) { buf[o] = v & 0xFF; buf[o + 1] = (v >> 8) & 0xFF; buf[o + 2] = (v >> 16) & 0xFF; buf[o + 3] = (v >> 24) & 0xFF; }

  function buildZip(files) {
    var localHeaders = [], centralEntries = [], offset = 0;
    for (var i = 0; i < files.length; i++) {
      var nameBytes = encodeUTF8(files[i].name), fileData = files[i].data, fileCrc = crc32(fileData);
      var localSize = 30 + nameBytes.length + fileData.length;
      var local = new Uint8Array(localSize);
      local[0] = 0x50; local[1] = 0x4B; local[2] = 0x03; local[3] = 0x04;
      writeU16LE(local, 4, 20); writeU16LE(local, 6, 0x0800); writeU16LE(local, 8, 0);
      writeU16LE(local, 10, 0); writeU16LE(local, 12, 0);
      writeU32LE(local, 14, fileCrc); writeU32LE(local, 18, fileData.length); writeU32LE(local, 22, fileData.length);
      writeU16LE(local, 26, nameBytes.length); writeU16LE(local, 28, 0);
      local.set(nameBytes, 30); local.set(fileData, 30 + nameBytes.length);
      localHeaders.push(local);
      var central = new Uint8Array(46 + nameBytes.length);
      central[0] = 0x50; central[1] = 0x4B; central[2] = 0x01; central[3] = 0x02;
      writeU16LE(central, 4, 20); writeU16LE(central, 6, 20); writeU16LE(central, 8, 0x0800); writeU16LE(central, 10, 0);
      writeU16LE(central, 12, 0); writeU16LE(central, 14, 0);
      writeU32LE(central, 16, fileCrc); writeU32LE(central, 20, fileData.length); writeU32LE(central, 24, fileData.length);
      writeU16LE(central, 28, nameBytes.length); writeU16LE(central, 30, 0); writeU16LE(central, 32, 0);
      writeU16LE(central, 34, 0); writeU16LE(central, 36, 0); writeU32LE(central, 38, 0); writeU32LE(central, 42, offset);
      central.set(nameBytes, 46);
      centralEntries.push(central); offset += localSize;
    }
    var cdOffset = offset, cdSize = 0, j;
    for (j = 0; j < centralEntries.length; j++) cdSize += centralEntries[j].length;
    var eocd = new Uint8Array(22);
    eocd[0] = 0x50; eocd[1] = 0x4B; eocd[2] = 0x05; eocd[3] = 0x06;
    writeU16LE(eocd, 4, 0); writeU16LE(eocd, 6, 0); writeU16LE(eocd, 8, files.length);
    writeU16LE(eocd, 10, files.length); writeU32LE(eocd, 12, cdSize); writeU32LE(eocd, 16, cdOffset);
    var result = new Uint8Array(offset + cdSize + 22), pos = 0;
    for (j = 0; j < localHeaders.length; j++) { result.set(localHeaders[j], pos); pos += localHeaders[j].length; }
    for (j = 0; j < centralEntries.length; j++) { result.set(centralEntries[j], pos); pos += centralEntries[j].length; }
    result.set(eocd, pos); return result;
  }

  // ─── XML helpers ──────────────────────────────────────────────────
  var W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  var R_NS = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ─── WordprocessingML builders ────────────────────────────────────
  function wPara(text, opts) {
    var o = opts || {};
    var pPr = '', rPr = '';
    if (o.style) pPr += '<w:pStyle w:val="' + o.style + '"/>';
    if (o.center) pPr += '<w:jc w:val="center"/>';
    if (pPr) pPr = '<w:pPr>' + pPr + '</w:pPr>';
    if (o.bold) rPr = '<w:rPr><w:b/></w:rPr>';
    return '<w:p>' + pPr + '<w:r>' + rPr + '<w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
  }

  function wBanner(text) {
    return wPara(text, { bold: true, center: true });
  }

  function wTable(headers, rows) {
    var bdr = ' w:val="single" w:sz="4" w:space="0" w:color="000000"/>';
    var xml = '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
      '<w:tblBorders><w:top' + bdr + '<w:left' + bdr + '<w:bottom' + bdr +
      '<w:right' + bdr + '<w:insideH' + bdr + '<w:insideV' + bdr + '</w:tblBorders></w:tblPr>';
    // Header row
    xml += '<w:tr>';
    for (var h = 0; h < headers.length; h++) {
      xml += '<w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>' + esc(headers[h]) + '</w:t></w:r></w:p></w:tc>';
    }
    xml += '</w:tr>';
    // Data rows
    for (var r = 0; r < rows.length; r++) {
      xml += '<w:tr>';
      for (var c = 0; c < headers.length; c++) {
        var val = c < rows[r].length ? rows[r][c] : '';
        xml += '<w:tc><w:p><w:r><w:t>' + esc(val) + '</w:t></w:r></w:p></w:tc>';
      }
      xml += '</w:tr>';
    }
    xml += '</w:tbl>';
    return xml;
  }

  // ─── DOCX XML parts ──────────────────────────────────────────────
  function makeContentTypes() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
      '</Types>';
  }

  function makeRootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      '</Relationships>';
  }

  function makeDocRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';
  }

  function makeStyles() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:styles ' + W_NS + '>' +
      '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
      '<w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/>' +
      '<w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/>' +
      '<w:pPr><w:spacing w:before="200" w:after="80"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/>' +
      '<w:pPr><w:spacing w:before="160" w:after="60"/></w:pPr>' +
      '<w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>' +
      '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style>' +
      '</w:styles>';
  }

  function makeDocument(bodyXml) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document ' + W_NS + ' ' + R_NS + '><w:body>' + bodyXml +
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      '</w:body></w:document>';
  }

  // ─── Main generate function ───────────────────────────────────────
  function generate(options) {
    var opts = options || {};
    var content = opts.content || [];
    var classification = opts.classification || '';
    var filename = opts.filename || 'export.docx';
    var body = '';

    // Leading classification banner
    if (classification) body += wBanner(classification);

    // Content blocks
    for (var i = 0; i < content.length; i++) {
      var block = content[i];
      var type = block.type || 'paragraph';

      if (type === 'banner') {
        body += wBanner(block.text || '');
      } else if (type === 'heading') {
        var lvl = Math.min(Math.max(block.level || 1, 1), 3);
        body += wPara(block.text || '', { style: 'Heading' + lvl });
      } else if (type === 'paragraph') {
        body += wPara(block.text || '', { bold: !!block.bold });
      } else if (type === 'table') {
        body += wTable(block.headers || [], block.rows || []);
      } else if (type === 'list') {
        var items = block.items || [];
        for (var li = 0; li < items.length; li++) {
          body += wPara('\u2022 ' + items[li]);
        }
      }
    }

    // Trailing classification banner
    if (classification) body += wBanner(classification);

    // Build ZIP
    var zipData = buildZip([
      { name: '[Content_Types].xml', data: encodeUTF8(makeContentTypes()) },
      { name: '_rels/.rels', data: encodeUTF8(makeRootRels()) },
      { name: 'word/document.xml', data: encodeUTF8(makeDocument(body)) },
      { name: 'word/_rels/document.xml.rels', data: encodeUTF8(makeDocRels()) },
      { name: 'word/styles.xml', data: encodeUTF8(makeStyles()) }
    ]);

    var blob = new Blob([zipData], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });

    return {
      blob: blob,
      download: function () {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    };
  }

  window.DK.docxWriter = { generate: generate };
})();

// --- export/classification.js ---

/**
 * WDK Classification Banner Module
 * Adds CAPCO-style classification markings to WDK exports.
 */
(function () {
  'use strict';

  var VALID_LEVELS = [
    'UNCLASSIFIED', 'CUI', 'CONFIDENTIAL', 'SECRET',
    'TOP SECRET', 'TOP SECRET//SCI'
  ];

  var ALIASES = {
    'U': 'UNCLASSIFIED',
    'C': 'CONFIDENTIAL',
    'S': 'SECRET',
    'TS': 'TOP SECRET',
    'TS//SCI': 'TOP SECRET//SCI'
  };

  var currentLevel = 'UNCLASSIFIED';

  function normalizeLevel(level) {
    var upper = String(level).toUpperCase().replace(/\s+/g, ' ').trim();
    if (ALIASES[upper]) {
      return ALIASES[upper];
    }
    if (VALID_LEVELS.indexOf(upper) !== -1) {
      return upper;
    }
    return null;
  }

  function setLevel(level) {
    var normalized = normalizeLevel(level);
    if (!normalized) {
      throw new Error(
        'Invalid classification level: "' + level + '". ' +
        'Valid levels: ' + VALID_LEVELS.join(', ')
      );
    }
    currentLevel = normalized;
  }

  function getLevel() {
    return currentLevel;
  }

  function getBanner() {
    return currentLevel;
  }

  function wrapCSV(csvString) {
    var banner = getBanner();
    return banner + '\n' + csvString + '\n' + banner;
  }

  function wrapJSON(jsonObj) {
    var now = new Date();
    var year = now.getFullYear();
    var month = now.getMonth() + 1;
    var day = now.getDate();
    var dateStr = year + '-' +
      (month < 10 ? '0' + month : month) + '-' +
      (day < 10 ? '0' + day : day);

    return {
      '_classification': getBanner(),
      '_classified_by': 'WDK Export',
      '_date': dateStr,
      'data': jsonObj
    };
  }

  function wrapText(text) {
    var banner = getBanner();
    return banner + '\n\n' + text + '\n\n' + banner;
  }

  function getDocxBanner() {
    return {
      type: 'banner',
      text: getBanner(),
      position: 'both'
    };
  }

  function validate(text) {
    var errors = [];
    var detectedLevel = null;
    var lines = String(text).split('\n');
    var firstLine = lines[0] ? lines[0].trim() : '';
    var lastLine = '';
    var i;

    for (i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== '') {
        lastLine = lines[i].trim();
        break;
      }
    }

    var topLevel = normalizeLevel(firstLine);
    var bottomLevel = normalizeLevel(lastLine);

    if (!topLevel) {
      errors.push('Missing or invalid classification banner at top');
    }

    if (!bottomLevel) {
      errors.push('Missing or invalid classification banner at bottom');
    }

    if (topLevel && bottomLevel && topLevel !== bottomLevel) {
      errors.push(
        'Top banner (' + topLevel + ') does not match bottom banner (' + bottomLevel + ')'
      );
    }

    if (topLevel && bottomLevel && topLevel === bottomLevel) {
      detectedLevel = topLevel;
    } else if (topLevel) {
      detectedLevel = topLevel;
    } else if (bottomLevel) {
      detectedLevel = bottomLevel;
    }

    return {
      valid: errors.length === 0,
      level: detectedLevel,
      errors: errors
    };
  }

  // Expose on window.DK namespace
  if (typeof window !== 'undefined') {
    window.DK = window.DK || {};
    window.DK.classification = {
      setLevel: setLevel,
      getLevel: getLevel,
      getBanner: getBanner,
      wrapCSV: wrapCSV,
      wrapJSON: wrapJSON,
      wrapText: wrapText,
      getDocxBanner: getDocxBanner,
      validate: validate
    };
  }
})();

// --- export/nipr-safe.js ---

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

// --- parsers/docx-reader.js ---

/**
 * WDK DOCX Reader — extracts text, tables, and metadata from .docx files.
 * Reuses the existing ZIP reader at src/parsers/zip.js (unzip function).
 * Zero dependencies, IIFE pattern, var only.
 *
 * API: DK.docxReader.parse(arrayBuffer) -> Promise<{text, paragraphs, tables, metadata}>
 */
(function() {
  "use strict";

  var DK = window.DK = window.DK || {};

  // --- XML helpers (string-based, no DOMParser) ---

  function findAll(xml, tag) {
    var results = [];
    var open = "<" + tag;
    var close = "</" + tag + ">";
    var selfClose = "/>";
    var idx = 0;
    while (idx < xml.length) {
      var start = xml.indexOf(open, idx);
      if (start === -1) break;
      var afterTag = start + open.length;
      var ch = xml.charAt(afterTag);
      if (ch !== " " && ch !== ">" && ch !== "/") { idx = afterTag; continue; }
      var endSelf = xml.indexOf(selfClose, afterTag);
      var endClose = xml.indexOf(close, afterTag);
      var end;
      if (endClose === -1 && endSelf === -1) break;
      if (endClose === -1) { end = endSelf + selfClose.length; }
      else if (endSelf === -1) { end = endClose + close.length; }
      else if (endSelf < endClose) {
        var gt = xml.indexOf(">", afterTag);
        if (gt === endSelf + 1) { end = endSelf + selfClose.length; }
        else { end = endClose + close.length; }
      } else { end = endClose + close.length; }
      results.push(xml.substring(start, end));
      idx = end;
    }
    return results;
  }

  function innerContent(xml, tag) {
    var open = "<" + tag;
    var start = xml.indexOf(open);
    if (start === -1) return "";
    var gt = xml.indexOf(">", start + open.length);
    if (gt === -1) return "";
    if (xml.charAt(gt - 1) === "/") return "";
    var close = "</" + tag + ">";
    var end = xml.indexOf(close, gt);
    if (end === -1) return "";
    return xml.substring(gt + 1, end);
  }

  function attrVal(xml, attr) {
    var pat = attr + '="';
    var idx = xml.indexOf(pat);
    if (idx === -1) return "";
    var start = idx + pat.length;
    var end = xml.indexOf('"', start);
    if (end === -1) return "";
    return xml.substring(start, end);
  }

  function extractText(xml) {
    var parts = [];
    var wts = findAll(xml, "w:t");
    for (var i = 0; i < wts.length; i++) {
      var gt = wts[i].indexOf(">");
      if (gt === -1) continue;
      var close = wts[i].lastIndexOf("</w:t>");
      if (close === -1) continue;
      parts.push(wts[i].substring(gt + 1, close));
    }
    return parts.join("");
  }

  // --- DOCX parsing ---

  function parseParagraphs(docXml) {
    var paragraphs = [];
    var pBlocks = findAll(docXml, "w:p");
    for (var i = 0; i < pBlocks.length; i++) {
      var p = pBlocks[i];
      var style = "Normal";
      var pStyleIdx = p.indexOf("<w:pStyle");
      if (pStyleIdx !== -1) {
        var val = attrVal(p.substring(pStyleIdx), "w:val");
        if (val) style = val;
      }
      var text = extractText(p);
      paragraphs.push({ text: text, style: style });
    }
    return paragraphs;
  }

  function parseTables(docXml) {
    var tables = [];
    var tblBlocks = findAll(docXml, "w:tbl");
    for (var i = 0; i < tblBlocks.length; i++) {
      var tbl = tblBlocks[i];
      var rows = findAll(tbl, "w:tr");
      var rowData = [];
      for (var r = 0; r < rows.length; r++) {
        var cells = findAll(rows[r], "w:tc");
        var cellTexts = [];
        for (var c = 0; c < cells.length; c++) {
          cellTexts.push(extractText(cells[c]));
        }
        rowData.push(cellTexts);
      }
      var headers = rowData.length > 0 ? rowData[0] : [];
      var dataRows = rowData.length > 1 ? rowData.slice(1) : [];
      tables.push({ headers: headers, rows: dataRows });
    }
    return tables;
  }

  function parseMetadata(coreXml) {
    if (!coreXml) return { title: "", author: "" };
    return {
      title: innerContent(coreXml, "dc:title") || innerContent(coreXml, "dcterms:title") || "",
      author: innerContent(coreXml, "dc:creator") || innerContent(coreXml, "cp:lastModifiedBy") || ""
    };
  }

  // --- Main API ---

  DK.docxReader = {
    parse: function(arrayBuffer) {
      return unzip(arrayBuffer).then(function(entries) {
        var docXml = "";
        var coreXml = "";
        var decoder = new TextDecoder();

        if (entries.has("word/document.xml")) {
          docXml = decoder.decode(entries.get("word/document.xml"));
        }
        if (entries.has("docProps/core.xml")) {
          coreXml = decoder.decode(entries.get("docProps/core.xml"));
        }

        if (!docXml) {
          return { text: "", paragraphs: [], tables: [], metadata: { title: "", author: "" } };
        }

        var paragraphs = parseParagraphs(docXml);
        var tables = parseTables(docXml);
        var metadata = parseMetadata(coreXml);
        var textParts = [];
        for (var i = 0; i < paragraphs.length; i++) {
          textParts.push(paragraphs[i].text);
        }

        return {
          text: textParts.join("\n"),
          paragraphs: paragraphs,
          tables: tables,
          metadata: metadata
        };
      })["catch"](function() {
        return { text: "", paragraphs: [], tables: [], metadata: { title: "", author: "" } };
      });
    }
  };

})();

// --- ui/robo.js ---

/**
 * WDK Robo — browser automation script builder
 * Define actions as JSON, export as Playwright / Selenium / Cypress scripts.
 */
(function () {
  'use strict';
  if (!window.DK) { window.DK = {}; }

  /* ------------------------------------------------------------------ */
  /*  Helpers                                                            */
  /* ------------------------------------------------------------------ */

  function escStr(s) {
    return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
  }

  function escPy(s) {
    return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  function indent(lines, n) {
    var pad = '';
    for (var i = 0; i < n; i++) { pad += ' '; }
    return lines.map(function (l) { return pad + l; });
  }

  /* ------------------------------------------------------------------ */
  /*  buildSelector                                                      */
  /* ------------------------------------------------------------------ */

  function buildSelector(el) {
    if (!el || el.nodeType !== 1) { return ''; }

    // 1. id
    if (el.id) { return '#' + CSS.escape(el.id); }

    // 2. data-testid
    var tid = el.getAttribute('data-testid');
    if (tid) { return '[data-testid="' + tid + '"]'; }

    // 3. tag.class combo — check uniqueness
    var tag = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/).map(function (c) { return '.' + CSS.escape(c); }).join('');
      var candidate = tag + cls;
      if (document.querySelectorAll(candidate).length === 1) { return candidate; }
    }

    // 4. nth-child path
    var parts = [];
    var cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      var p = cur.parentElement;
      if (!p) { break; }
      var children = p.children;
      var idx = 1;
      for (var i = 0; i < children.length; i++) {
        if (children[i] === cur) { idx = i + 1; break; }
      }
      parts.unshift(cur.tagName.toLowerCase() + ':nth-child(' + idx + ')');
      cur = p;
    }
    return parts.join(' > ');
  }

  /* ------------------------------------------------------------------ */
  /*  Playwright export                                                  */
  /* ------------------------------------------------------------------ */

  function toPlaywright(actions, options) {
    var opts = options || {};
    var name = opts.name || 'Automation Script';
    var timeout = opts.timeout || 30000;
    var lines = [];

    lines.push("const { test, expect } = require('@playwright/test');");
    lines.push('');
    if (opts.baseURL) {
      lines.push("test.use({ baseURL: '" + escStr(opts.baseURL) + "' });");
      lines.push('');
    }
    lines.push("test('" + escStr(name) + "', async ({ page }) => {");
    lines.push("  test.setTimeout(" + timeout + ");");

    var extractIdx = 0;
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var s = a.selector ? escStr(a.selector) : '';
      switch (a.action) {
        case 'navigate':
          lines.push("  await page.goto('" + escStr(a.url) + "');");
          break;
        case 'wait':
          if (a.selector) {
            lines.push("  await page.waitForSelector('" + s + "', { timeout: " + (a.timeout || timeout) + " });");
          } else {
            lines.push("  await page.waitForTimeout(" + (a.ms || 1000) + ");");
          }
          break;
        case 'click':
          lines.push("  await page.click('" + s + "');");
          break;
        case 'type':
          lines.push("  await page.fill('" + s + "', '" + escStr(a.value || '') + "');");
          break;
        case 'select':
          lines.push("  await page.selectOption('" + s + "', '" + escStr(a.value || '') + "');");
          break;
        case 'press':
          lines.push("  await page.keyboard.press('" + escStr(a.key || a.value || '') + "');");
          break;
        case 'scroll':
          if (a.selector) {
            lines.push("  await page.locator('" + s + "').scrollIntoViewIfNeeded();");
          } else {
            lines.push("  await page.evaluate(() => window.scrollBy(0, " + (a.y || a.pixels || 500) + "));");
          }
          break;
        case 'screenshot':
          lines.push("  await page.screenshot({ path: '" + escStr(a.name || 'screenshot_' + i) + ".png' });");
          break;
        case 'extract':
          var varName = a.as || 'extracted_' + (extractIdx++);
          lines.push("  const " + varName + " = await page.locator('" + s + "').textContent();");
          break;
        case 'assert':
          if (a.text !== undefined) {
            lines.push("  await expect(page.locator('" + s + "')).toHaveText('" + escStr(a.text) + "');");
          } else {
            lines.push("  await expect(page.locator('" + s + "')).toBeVisible();");
          }
          break;
        default:
          lines.push("  // unsupported action: " + (a.action || 'unknown'));
      }
    }

    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Selenium (Python) export                                           */
  /* ------------------------------------------------------------------ */

  function toSelenium(actions, options) {
    var opts = options || {};
    var lines = [];

    lines.push('from selenium import webdriver');
    lines.push('from selenium.webdriver.common.by import By');
    lines.push('from selenium.webdriver.common.keys import Keys');
    lines.push('from selenium.webdriver.support.ui import WebDriverWait, Select');
    lines.push('from selenium.webdriver.support import expected_conditions as EC');
    lines.push('import time');
    lines.push('');
    lines.push('driver = webdriver.Chrome()');
    lines.push('driver.implicitly_wait(' + ((opts.timeout || 30000) / 1000) + ')');
    lines.push('');

    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var s = a.selector ? escPy(a.selector) : '';
      switch (a.action) {
        case 'navigate':
          lines.push('driver.get("' + escPy(a.url) + '")');
          break;
        case 'wait':
          if (a.selector) {
            lines.push('WebDriverWait(driver, ' + ((a.timeout || 10000) / 1000) + ').until(');
            lines.push('    EC.presence_of_element_located((By.CSS_SELECTOR, "' + s + '"))');
            lines.push(')');
          } else {
            lines.push('time.sleep(' + ((a.ms || 1000) / 1000) + ')');
          }
          break;
        case 'click':
          lines.push('driver.find_element(By.CSS_SELECTOR, "' + s + '").click()');
          break;
        case 'type':
          lines.push('el = driver.find_element(By.CSS_SELECTOR, "' + s + '")');
          lines.push('el.clear()');
          lines.push('el.send_keys("' + escPy(a.value || '') + '")');
          break;
        case 'select':
          lines.push('Select(driver.find_element(By.CSS_SELECTOR, "' + s + '")).select_by_value("' + escPy(a.value || '') + '")');
          break;
        case 'press':
          lines.push('driver.find_element(By.TAG_NAME, "body").send_keys(Keys.' + (a.key || a.value || 'ENTER').toUpperCase() + ')');
          break;
        case 'scroll':
          if (a.selector) {
            lines.push('el = driver.find_element(By.CSS_SELECTOR, "' + s + '")');
            lines.push('driver.execute_script("arguments[0].scrollIntoView(true);", el)');
          } else {
            lines.push('driver.execute_script("window.scrollBy(0, ' + (a.y || a.pixels || 500) + ')")');
          }
          break;
        case 'screenshot':
          lines.push('driver.save_screenshot("' + escPy(a.name || 'screenshot_' + i) + '.png")');
          break;
        case 'extract':
          lines.push((a.as || 'extracted') + ' = driver.find_element(By.CSS_SELECTOR, "' + s + '").text');
          break;
        case 'assert':
          if (a.text !== undefined) {
            lines.push('assert driver.find_element(By.CSS_SELECTOR, "' + s + '").text == "' + escPy(a.text) + '"');
          } else {
            lines.push('assert driver.find_element(By.CSS_SELECTOR, "' + s + '").is_displayed()');
          }
          break;
        default:
          lines.push('# unsupported action: ' + (a.action || 'unknown'));
      }
    }

    lines.push('');
    lines.push('driver.quit()');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  Cypress export                                                     */
  /* ------------------------------------------------------------------ */

  function toCypress(actions, options) {
    var opts = options || {};
    var name = opts.name || 'Automation Script';
    var lines = [];

    lines.push("describe('" + escStr(name) + "', () => {");
    lines.push("  it('runs the automation', () => {");

    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var s = a.selector ? escStr(a.selector) : '';
      switch (a.action) {
        case 'navigate':
          lines.push("    cy.visit('" + escStr(a.url) + "');");
          break;
        case 'wait':
          if (a.selector) {
            lines.push("    cy.get('" + s + "', { timeout: " + (a.timeout || 10000) + " }).should('exist');");
          } else {
            lines.push("    cy.wait(" + (a.ms || 1000) + ");");
          }
          break;
        case 'click':
          lines.push("    cy.get('" + s + "').click();");
          break;
        case 'type':
          lines.push("    cy.get('" + s + "').clear().type('" + escStr(a.value || '') + "');");
          break;
        case 'select':
          lines.push("    cy.get('" + s + "').select('" + escStr(a.value || '') + "');");
          break;
        case 'press':
          lines.push("    cy.get('body').type('{" + (a.key || a.value || 'enter').toLowerCase() + "}');");
          break;
        case 'scroll':
          if (a.selector) {
            lines.push("    cy.get('" + s + "').scrollIntoView();");
          } else {
            lines.push("    cy.scrollTo(0, " + (a.y || a.pixels || 500) + ");");
          }
          break;
        case 'screenshot':
          lines.push("    cy.screenshot('" + escStr(a.name || 'screenshot_' + i) + "');");
          break;
        case 'extract':
          lines.push("    cy.get('" + s + "').invoke('text').as('" + escStr(a.as || 'extracted') + "');");
          break;
        case 'assert':
          if (a.text !== undefined) {
            lines.push("    cy.get('" + s + "').should('have.text', '" + escStr(a.text) + "');");
          } else {
            lines.push("    cy.get('" + s + "').should('be.visible');");
          }
          break;
        default:
          lines.push("    // unsupported action: " + (a.action || 'unknown'));
      }
    }

    lines.push('  });');
    lines.push('});');
    lines.push('');
    return lines.join('\n');
  }

  /* ------------------------------------------------------------------ */
  /*  createScript                                                       */
  /* ------------------------------------------------------------------ */

  function createScript(actions, options) {
    var opts = options || {};
    var script = {
      name: opts.name || 'Untitled Script',
      description: opts.description || '',
      actions: actions.slice(),
      createdAt: new Date().toISOString(),

      addAction: function (action) { script.actions.push(action); return script; },
      removeAction: function (idx) { script.actions.splice(idx, 1); return script; },
      toPlaywright: function (o) { return toPlaywright(script.actions, mergeOpts(opts, o)); },
      toSelenium: function (o) { return toSelenium(script.actions, mergeOpts(opts, o)); },
      toCypress: function (o) { return toCypress(script.actions, mergeOpts(opts, o)); },
      toJSON: function () {
        return JSON.stringify({
          name: script.name,
          description: script.description,
          actions: script.actions,
          createdAt: script.createdAt
        }, null, 2);
      }
    };
    return script;
  }

  function mergeOpts(base, extra) {
    if (!extra) { return base; }
    var out = {};
    var k;
    for (k in base) { if (base.hasOwnProperty(k)) { out[k] = base[k]; } }
    for (k in extra) { if (extra.hasOwnProperty(k)) { out[k] = extra[k]; } }
    return out;
  }

  /* ------------------------------------------------------------------ */
  /*  Recorder                                                           */
  /* ------------------------------------------------------------------ */

  function record() {
    var actions = [];
    var active = true;

    function onClick(e) {
      if (!active) { return; }
      var sel = buildSelector(e.target);
      if (sel) { actions.push({ action: 'click', selector: sel }); }
    }

    function onInput(e) {
      if (!active) { return; }
      var el = e.target;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
        var sel = buildSelector(el);
        if (!sel) { return; }
        if (el.tagName === 'SELECT') {
          actions.push({ action: 'select', selector: sel, value: el.value });
        } else {
          // Merge consecutive types on same selector
          var last = actions[actions.length - 1];
          if (last && last.action === 'type' && last.selector === sel) {
            last.value = el.value;
          } else {
            actions.push({ action: 'type', selector: sel, value: el.value });
          }
        }
      }
    }

    function onSubmit(e) {
      if (!active) { return; }
      var sel = buildSelector(e.target);
      if (sel) { actions.push({ action: 'click', selector: sel + ' [type="submit"]' }); }
    }

    function onNav() {
      if (!active) { return; }
      actions.push({ action: 'navigate', url: window.location.href });
    }

    document.addEventListener('click', onClick, true);
    document.addEventListener('change', onInput, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('popstate', onNav);
    window.addEventListener('hashchange', onNav);

    return {
      stop: function () {
        active = false;
        document.removeEventListener('click', onClick, true);
        document.removeEventListener('change', onInput, true);
        document.removeEventListener('submit', onSubmit, true);
        window.removeEventListener('popstate', onNav);
        window.removeEventListener('hashchange', onNav);
      },
      getActions: function () { return actions.slice(); },
      isRecording: function () { return active; }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Download                                                           */
  /* ------------------------------------------------------------------ */

  function download(actions, format, options) {
    var opts = options || {};
    var content, ext, mime;

    switch (format) {
      case 'playwright':
        content = toPlaywright(actions, opts);
        ext = '.spec.js';
        mime = 'text/javascript';
        break;
      case 'selenium':
        content = toSelenium(actions, opts);
        ext = '.py';
        mime = 'text/x-python';
        break;
      case 'cypress':
        content = toCypress(actions, opts);
        ext = '.cy.js';
        mime = 'text/javascript';
        break;
      case 'json':
        content = JSON.stringify(actions, null, 2);
        ext = '.json';
        mime = 'application/json';
        break;
      default:
        content = toPlaywright(actions, opts);
        ext = '.spec.js';
        mime = 'text/javascript';
    }

    var name = (opts.name || 'automation').replace(/\s+/g, '-').toLowerCase() + ext;
    var blob = new Blob([content], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ------------------------------------------------------------------ */
  /*  Validate                                                           */
  /* ------------------------------------------------------------------ */

  var VALID_ACTIONS = {
    navigate: ['url'],
    wait: [],
    click: ['selector'],
    type: ['selector', 'value'],
    select: ['selector', 'value'],
    press: [],
    scroll: [],
    screenshot: [],
    extract: ['selector'],
    assert: ['selector']
  };

  function validate(actions) {
    var errors = [];
    if (!Array.isArray(actions)) { return [{ index: -1, message: 'Actions must be an array' }]; }
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      if (!a || !a.action) {
        errors.push({ index: i, message: 'Missing action property' });
        continue;
      }
      if (!(a.action in VALID_ACTIONS)) {
        errors.push({ index: i, message: 'Unknown action: ' + a.action });
        continue;
      }
      var required = VALID_ACTIONS[a.action];
      for (var j = 0; j < required.length; j++) {
        if (!a[required[j]] && a[required[j]] !== 0) {
          errors.push({ index: i, message: a.action + ' requires ' + required[j] });
        }
      }
    }
    return errors;
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  window.DK.robo = {
    createScript: createScript,
    toPlaywright: toPlaywright,
    toSelenium: toSelenium,
    toCypress: toCypress,
    record: record,
    buildSelector: buildSelector,
    download: download,
    validate: validate
  };
})();

// --- main ---

function main() {
  // Prefer app-shell entry point (Tier 2)
  if (typeof initWDK === "function") {
    initWDK();
    return;
  }

  // Legacy bookmarklet-only fallback
  if (typeof createPanel !== "function") {
    console.error("WDK: createPanel not available. Build may be incomplete.");
    return;
  }

  var panel = createPanel();
  var contentArea = panel.contentArea || panel.content || panel;
  var currentTable = null;
  var replInstance = null;

  function getREPLContext() {
    if (!currentTable) {
      return { data: [], rows: [], headers: [], meta: { rowCount: 0, columnCount: 0 } };
    }
    var headers = currentTable._headers || currentTable.headers || [];
    var rows = currentTable._rows || currentTable.rows || [];
    var data;
    if (typeof currentTable.toObjects === "function") {
      data = currentTable.toObjects();
    } else {
      data = rows.map(function (row) {
        var obj = {};
        headers.forEach(function (h, i) { obj[h] = row[i]; });
        return obj;
      });
    }
    return {
      data: data,
      rows: rows,
      headers: headers,
      meta: { rowCount: rows.length, columnCount: headers.length }
    };
  }

  function onDataLoaded(table) {
    currentTable = table;
    if (typeof renderTable === "function") {
      var tableContainer = contentArea.querySelector(".dk-table-container");
      if (!tableContainer) {
        tableContainer = document.createElement("div");
        tableContainer.className = "dk-table-container";
        contentArea.appendChild(tableContainer);
      }
      tableContainer.innerHTML = "";
      renderTable(tableContainer, table);
    }
    if (typeof createREPL === "function" && !replInstance) {
      var replContainer = document.createElement("div");
      replContainer.className = "dk-repl-container";
      replContainer.style.cssText = "margin-top:12px;height:300px;";
      contentArea.appendChild(replContainer);
      replInstance = createREPL(replContainer, getREPLContext);
    }
  }

  if (typeof createFileImport === "function") {
    createFileImport(contentArea, onDataLoaded);
  }
}

// Auto-run
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", main);
} else {
  main();
}

})();
