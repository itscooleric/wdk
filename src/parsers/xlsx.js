/**
 * DataKit XLSX Parser
 * Reads .xlsx files (OOXML ZIP archives) and returns DataTable-compatible objects.
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
 * Returns an object compatible with the DataTable constructor:
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
