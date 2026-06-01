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
