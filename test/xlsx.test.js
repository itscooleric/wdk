/**
 * Tests for WDK XLSX parser (zip.js + xlsx.js).
 *
 * These tests run under Node.js (node:test).
 * DecompressionStream is polyfilled from stream/web for the stored-method ZIP tests.
 * The full deflate path is tested via a minimal real XLSX constructed with Node's zlib.
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const deflateRaw = promisify(zlib.deflateRaw);

// Polyfill DecompressionStream for Node.js environment
const { DecompressionStream } = require('stream/web');
globalThis.DecompressionStream = DecompressionStream;

const { unzip } = require('../src/parsers/zip.js');
const {
  parseXLSX,
  excelSerialToDate,
  parseSharedStrings,
  parseWorkbook,
  parseSheet,
  parseStyles,
  colLetterToIndex,
  parseCellRef,
  isDateFormat,
} = require('../src/parsers/xlsx.js');

// ---------------------------------------------------------------------------
// ZIP building helpers
// ---------------------------------------------------------------------------

/** Compute CRC-32 of a Buffer. */
function crc32(buf) {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  let crc = 0xFFFFFFFF;
  for (const b of buf) crc = (table[(crc ^ b) & 0xff] ^ (crc >>> 8)) >>> 0;
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Build a ZIP local file header + data entry.
 * @param {string} name - Filename
 * @param {Buffer} data - Uncompressed data
 * @param {number} [method=0] - Compression method (0=stored, 8=deflate)
 * @param {Buffer} [compressed] - Pre-compressed data (required if method=8)
 */
function makeZipEntry(name, data, method, compressed) {
  method = method || 0;
  const compData = (method === 8 && compressed) ? compressed : data;
  const nameBytes = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const header = Buffer.alloc(30 + nameBytes.length);
  header.writeUInt32LE(0x04034B50, 0);         // local file header sig
  header.writeUInt16LE(20, 4);                  // version needed
  header.writeUInt16LE(0, 6);                   // flags
  header.writeUInt16LE(method, 8);              // compression method
  header.writeUInt16LE(0, 10);                  // last mod time
  header.writeUInt16LE(0, 12);                  // last mod date
  header.writeUInt32LE(crc, 14);               // crc-32
  header.writeUInt32LE(compData.length, 18);   // compressed size
  header.writeUInt32LE(data.length, 22);        // uncompressed size
  header.writeUInt16LE(nameBytes.length, 26);  // name length
  header.writeUInt16LE(0, 28);                  // extra field length
  nameBytes.copy(header, 30);

  return Buffer.concat([header, compData]);
}

/**
 * Build a complete minimal ZIP from an array of { name, data } entries.
 * Uses stored method (0) — no compression.
 * @param {Array<{name: string, data: Buffer|string}>} entries
 * @returns {ArrayBuffer}
 */
function buildStoredZip(entries) {
  const parts = entries.map(e => ({
    name: e.name,
    data: Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8'),
  }));

  const localEntries = parts.map(p => makeZipEntry(p.name, p.data, 0));
  const zip = Buffer.concat(localEntries);
  const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);
  return ab;
}

/**
 * Build a minimal XLSX from an array of XML strings per sheet.
 * Includes: [Content_Types].xml, xl/workbook.xml, xl/_rels/workbook.xml.rels,
 * xl/sharedStrings.xml, xl/worksheets/sheet*.xml
 *
 * @param {Array<{name: string, xml: string}>} sheets
 * @param {string} [sharedStringsXml]
 * @returns {ArrayBuffer}
 */
function buildMinimalXLSX(sheets, sharedStringsXml) {
  const entries = [];

  // [Content_Types].xml — minimal
  entries.push({
    name: '[Content_Types].xml',
    data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
  });

  // xl/workbook.xml
  const sheetElements = sheets.map((s, i) =>
    '<sheet name="' + s.name + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'
  ).join('');
  entries.push({
    name: 'xl/workbook.xml',
    data: '<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheetElements + '</sheets></workbook>',
  });

  // xl/_rels/workbook.xml.rels
  const relElements = sheets.map((s, i) =>
    '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'
  ).join('');
  if (sharedStringsXml) {
    // Add sharedStrings relationship
    relElements.concat('<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>');
  }
  entries.push({
    name: 'xl/_rels/workbook.xml.rels',
    data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + relElements + '</Relationships>',
  });

  // xl/sharedStrings.xml (optional)
  if (sharedStringsXml) {
    entries.push({ name: 'xl/sharedStrings.xml', data: sharedStringsXml });
  }

  // xl/worksheets/sheet*.xml
  sheets.forEach((s, i) => {
    entries.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: s.xml });
  });

  return buildStoredZip(entries);
}

// ---------------------------------------------------------------------------
// Test 1-3: ZIP reader — stored method
// ---------------------------------------------------------------------------

describe('unzip (stored method)', () => {
  it('should extract a single stored file', async () => {
    const ab = buildStoredZip([{ name: 'readme.txt', data: 'hello world' }]);
    const entries = await unzip(ab);
    assert.ok(entries.has('readme.txt'));
    assert.strictEqual(Buffer.from(entries.get('readme.txt')).toString(), 'hello world');
  });

  it('should extract multiple stored files', async () => {
    const ab = buildStoredZip([
      { name: 'a.txt', data: 'alpha' },
      { name: 'b.txt', data: 'beta' },
      { name: 'subdir/c.txt', data: 'gamma' },
    ]);
    const entries = await unzip(ab);
    assert.strictEqual(entries.size, 3);
    assert.strictEqual(Buffer.from(entries.get('a.txt')).toString(), 'alpha');
    assert.strictEqual(Buffer.from(entries.get('b.txt')).toString(), 'beta');
    assert.strictEqual(Buffer.from(entries.get('subdir/c.txt')).toString(), 'gamma');
  });

  it('should handle UTF-8 content correctly', async () => {
    const text = 'caf\u00e9 \u4e2d\u6587'; // 'café 中文'
    const ab = buildStoredZip([{ name: 'utf8.txt', data: Buffer.from(text, 'utf8') }]);
    const entries = await unzip(ab);
    assert.strictEqual(new TextDecoder().decode(entries.get('utf8.txt')), text);
  });
});

// ---------------------------------------------------------------------------
// Test 4-5: ZIP reader — deflate method
// ---------------------------------------------------------------------------

describe('unzip (deflate-raw method)', () => {
  it('should decompress a deflate-compressed file', async () => {
    const original = Buffer.from('Hello, compressed world! '.repeat(20));
    const compressed = await deflateRaw(original);

    const entry = makeZipEntry('data.txt', original, 8, compressed);
    const zip = Buffer.concat([entry]);
    const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);

    const entries = await unzip(ab);
    assert.ok(entries.has('data.txt'));
    assert.strictEqual(Buffer.from(entries.get('data.txt')).toString(), original.toString());
  });

  it('should handle mixed stored and deflated entries', async () => {
    const original = Buffer.from('Compressible data '.repeat(30));
    const compressed = await deflateRaw(original);

    const storedEntry = makeZipEntry('stored.txt', Buffer.from('stored data'), 0);
    const deflateEntry = makeZipEntry('deflated.txt', original, 8, compressed);
    const zip = Buffer.concat([storedEntry, deflateEntry]);
    const ab = zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength);

    const entries = await unzip(ab);
    assert.strictEqual(entries.size, 2);
    assert.strictEqual(Buffer.from(entries.get('stored.txt')).toString(), 'stored data');
    assert.strictEqual(Buffer.from(entries.get('deflated.txt')).toString(), original.toString());
  });
});

// ---------------------------------------------------------------------------
// Test 6-7: Excel date serial conversion
// ---------------------------------------------------------------------------

describe('excelSerialToDate', () => {
  it('should convert serial 1 to 1900-01-01', () => {
    const d = excelSerialToDate(1);
    assert.strictEqual(d.getUTCFullYear(), 1900);
    assert.strictEqual(d.getUTCMonth(), 0);   // January
    assert.strictEqual(d.getUTCDate(), 1);
  });

  it('should handle the 1900 leap year bug: serial 61 = 1900-03-01', () => {
    // Serial 60 = phantom 1900-02-29; serial 61 = 1900-03-01 (adjusted by -1)
    const d = excelSerialToDate(61);
    assert.strictEqual(d.getUTCFullYear(), 1900);
    assert.strictEqual(d.getUTCMonth(), 2);   // March
    assert.strictEqual(d.getUTCDate(), 1);
  });

  it('should convert serial 44927 to 2023-01-01', () => {
    const d = excelSerialToDate(44927);
    assert.strictEqual(d.getUTCFullYear(), 2023);
    assert.strictEqual(d.getUTCMonth(), 0);
    assert.strictEqual(d.getUTCDate(), 1);
  });

  it('should preserve fractional time component', () => {
    // Serial 44927.5 = 2023-01-01 12:00:00 UTC
    const d = excelSerialToDate(44927.5);
    assert.strictEqual(d.getUTCHours(), 12);
    assert.strictEqual(d.getUTCMinutes(), 0);
  });

  it('should convert serial 2 to 1900-01-02', () => {
    const d = excelSerialToDate(2);
    assert.strictEqual(d.getUTCFullYear(), 1900);
    assert.strictEqual(d.getUTCMonth(), 0);
    assert.strictEqual(d.getUTCDate(), 2);
  });
});

// ---------------------------------------------------------------------------
// Test 8-9: Shared string parsing
// ---------------------------------------------------------------------------

describe('parseSharedStrings', () => {
  it('should parse simple shared strings', () => {
    const xml = '<sst><si><t>Name</t></si><si><t>Age</t></si><si><t>City</t></si></sst>';
    const ss = parseSharedStrings(xml);
    assert.deepStrictEqual(ss, ['Name', 'Age', 'City']);
  });

  it('should decode XML entities in shared strings', () => {
    const xml = '<sst><si><t>Hello &amp; World</t></si><si><t>&lt;tag&gt;</t></si></sst>';
    const ss = parseSharedStrings(xml);
    assert.strictEqual(ss[0], 'Hello & World');
    assert.strictEqual(ss[1], '<tag>');
  });

  it('should concatenate rich text runs (multiple <t> in one <si>)', () => {
    // Rich text: <si><r><t>Hello</t></r><r><t> World</t></r></si>
    const xml = '<sst><si><r><t>Hello</t></r><r><t> World</t></r></si></sst>';
    const ss = parseSharedStrings(xml);
    assert.strictEqual(ss[0], 'Hello World');
  });

  it('should return empty array for empty shared strings XML', () => {
    const ss = parseSharedStrings('<sst count="0" uniqueCount="0"></sst>');
    assert.deepStrictEqual(ss, []);
  });
});

// ---------------------------------------------------------------------------
// Test 10: Column/cell reference helpers
// ---------------------------------------------------------------------------

describe('column and cell ref helpers', () => {
  it('colLetterToIndex: single letters', () => {
    assert.strictEqual(colLetterToIndex('A'), 0);
    assert.strictEqual(colLetterToIndex('B'), 1);
    assert.strictEqual(colLetterToIndex('Z'), 25);
  });

  it('colLetterToIndex: multi-letter columns', () => {
    assert.strictEqual(colLetterToIndex('AA'), 26);
    assert.strictEqual(colLetterToIndex('AB'), 27);
    assert.strictEqual(colLetterToIndex('AZ'), 51);
    assert.strictEqual(colLetterToIndex('BA'), 52);
  });

  it('parseCellRef: parses row and column correctly', () => {
    assert.deepStrictEqual(parseCellRef('A1'), { col: 0, row: 0 });
    assert.deepStrictEqual(parseCellRef('B3'), { col: 1, row: 2 });
    assert.deepStrictEqual(parseCellRef('Z10'), { col: 25, row: 9 });
    assert.deepStrictEqual(parseCellRef('AA1'), { col: 26, row: 0 });
  });
});

// ---------------------------------------------------------------------------
// Test 11: isDateFormat
// ---------------------------------------------------------------------------

describe('isDateFormat', () => {
  it('recognizes built-in date format IDs', () => {
    assert.ok(isDateFormat(14, new Map())); // mm-dd-yy
    assert.ok(isDateFormat(15, new Map())); // d-mmm-yy
    assert.ok(isDateFormat(22, new Map())); // m/d/yy h:mm
    assert.ok(isDateFormat(45, new Map())); // mm:ss
  });

  it('does not flag non-date format IDs', () => {
    assert.ok(!isDateFormat(0, new Map()));    // General
    assert.ok(!isDateFormat(1, new Map()));    // 0
    assert.ok(!isDateFormat(4, new Map()));    // #,##0.00
    assert.ok(!isDateFormat(49, new Map()));   // @  (text)
  });

  it('recognizes custom date format by code', () => {
    const numFmts = new Map([[164, 'yyyy-mm-dd']]);
    assert.ok(isDateFormat(164, numFmts));
  });

  it('does not flag custom non-date format', () => {
    const numFmts = new Map([[165, '#,##0.00']]);
    assert.ok(!isDateFormat(165, numFmts));
  });
});

// ---------------------------------------------------------------------------
// Test 12: parseSheet
// ---------------------------------------------------------------------------

describe('parseSheet', () => {
  it('parses a simple sheet with shared strings and numbers', () => {
    const xml = [
      '<worksheet><sheetData>',
      '<row r="1">',
      '  <c r="A1" t="s"><v>0</v></c>',
      '  <c r="B1" t="s"><v>1</v></c>',
      '</row>',
      '<row r="2">',
      '  <c r="A2"><v>42</v></c>',
      '  <c r="B2"><v>7</v></c>',
      '</row>',
      '</sheetData></worksheet>',
    ].join('');
    const grid = parseSheet(xml, ['Name', 'Score'], [], new Map());
    assert.deepStrictEqual(grid[0], ['Name', 'Score']);
    assert.strictEqual(grid[1][0], 42);
    assert.strictEqual(grid[1][1], 7);
  });

  it('handles boolean cells', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c></row></sheetData></worksheet>';
    const grid = parseSheet(xml, [], [], new Map());
    assert.strictEqual(grid[0][0], true);
    assert.strictEqual(grid[0][1], false);
  });

  it('handles error cells', () => {
    const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="e"><v>#VALUE!</v></c></row></sheetData></worksheet>';
    const grid = parseSheet(xml, [], [], new Map());
    assert.strictEqual(grid[0][0], '#VALUE!');
  });

  it('handles sparse columns (non-contiguous cell refs)', () => {
    // A1=1, C1=3 — B1 should be empty string
    const xml = '<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c><c r="C1"><v>3</v></c></row></sheetData></worksheet>';
    const grid = parseSheet(xml, [], [], new Map());
    assert.strictEqual(grid[0][0], 1);
    assert.strictEqual(grid[0][1], '');
    assert.strictEqual(grid[0][2], 3);
  });
});

// ---------------------------------------------------------------------------
// Test 13-15: Full parseXLSX integration (stored-method XLSX)
// ---------------------------------------------------------------------------

describe('parseXLSX (integration)', () => {
  it('parses a minimal single-sheet XLSX', async () => {
    const sharedStrings = '<sst><si><t>Name</t></si><si><t>Age</t></si><si><t>Alice</t></si><si><t>Bob</t></si></sst>';
    const sheetXml = [
      '<worksheet><sheetData>',
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>30</v></c></row>',
      '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>25</v></c></row>',
      '</sheetData></worksheet>',
    ].join('');

    const ab = buildMinimalXLSX([{ name: 'Sheet1', xml: sheetXml }], sharedStrings);
    const result = await parseXLSX(ab);

    assert.deepStrictEqual(result.headers, ['Name', 'Age']);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0][0], 'Alice');
    assert.strictEqual(result.rows[0][1], 30);
    assert.strictEqual(result.rows[1][0], 'Bob');
    assert.strictEqual(result.rows[1][1], 25);
  });

  it('exposes all sheets in result.sheets', async () => {
    const sheet1Xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const sheet2Xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>';
    const sharedStrings = '<sst><si><t>Alpha</t></si><si><t>Beta</t></si></sst>';

    const ab = buildMinimalXLSX(
      [{ name: 'First', xml: sheet1Xml }, { name: 'Second', xml: sheet2Xml }],
      sharedStrings
    );
    const result = await parseXLSX(ab);

    assert.strictEqual(result.sheets.length, 2);
    assert.strictEqual(result.sheets[0].name, 'First');
    assert.strictEqual(result.sheets[1].name, 'Second');
  });

  it('selects sheet by index', async () => {
    const sheet1Xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const sheet2Xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>1</v></c></row></sheetData></worksheet>';
    const sharedStrings = '<sst><si><t>FromFirst</t></si><si><t>FromSecond</t></si></sst>';

    const ab = buildMinimalXLSX(
      [{ name: 'Sheet1', xml: sheet1Xml }, { name: 'Sheet2', xml: sheet2Xml }],
      sharedStrings
    );

    const result1 = await parseXLSX(ab, { sheet: 0, headerRow: 0 });
    assert.deepStrictEqual(result1.headers, ['FromFirst']);

    const result2 = await parseXLSX(ab, { sheet: 1, headerRow: 0 });
    assert.deepStrictEqual(result2.headers, ['FromSecond']);
  });

  it('selects sheet by name', async () => {
    const sheetXml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>';
    const sharedStrings = '<sst><si><t>Header</t></si></sst>';
    const ab = buildMinimalXLSX([{ name: 'MySheet', xml: sheetXml }], sharedStrings);

    const result = await parseXLSX(ab, { sheet: 'MySheet' });
    assert.deepStrictEqual(result.headers, ['Header']);
  });

  it('throws when selecting a non-existent sheet name', async () => {
    const sheetXml = '<worksheet><sheetData></sheetData></worksheet>';
    const ab = buildMinimalXLSX([{ name: 'Sheet1', xml: sheetXml }]);
    await assert.rejects(
      () => parseXLSX(ab, { sheet: 'NoSuchSheet' }),
      (err) => {
        assert.ok(err.message.includes('not found'));
        return true;
      }
    );
  });

  it('throws when selecting an out-of-range sheet index', async () => {
    const sheetXml = '<worksheet><sheetData></sheetData></worksheet>';
    const ab = buildMinimalXLSX([{ name: 'Sheet1', xml: sheetXml }]);
    await assert.rejects(
      () => parseXLSX(ab, { sheet: 5 }),
      (err) => {
        assert.ok(err.message.includes('out of range'));
        return true;
      }
    );
  });

  it('returns DataFrame-compatible headers and rows (no DataFrame class needed)', async () => {
    const sharedStrings = '<sst><si><t>id</t></si><si><t>val</t></si></sst>';
    const sheetXml = [
      '<worksheet><sheetData>',
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>',
      '<row r="2"><c r="A2"><v>1</v></c><c r="B2"><v>99</v></c></row>',
      '</sheetData></worksheet>',
    ].join('');

    const ab = buildMinimalXLSX([{ name: 'Data', xml: sheetXml }], sharedStrings);
    const result = await parseXLSX(ab);

    // Verify the result is compatible with DataFrame constructor
    const { DataFrame } = require('../src/transforms/data-model.js');
    const dt = new DataFrame(result.headers, result.rows);
    assert.strictEqual(dt.rowCount, 1);
    assert.strictEqual(dt.columnCount, 2);
    assert.deepStrictEqual(dt.getRow(0), [1, 99]);
  });
});
