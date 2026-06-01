/**
 * Tests for WDK XLSX writer (xlsx-writer.js).
 * Runs under Node.js (node:test). Zero external dependencies.
 */

'use strict';

var test = require('node:test');
var describe = test.describe;
var it = test.it;
var assert = require('node:assert');

var mod = require('../src/export/xlsx-writer.js');
var toXLSX = mod.toXLSX;
var colIndexToLetter = mod.colIndexToLetter;
var escapeXML = mod.escapeXML;
var crc32 = mod.crc32;
var buildZip = mod.buildZip;
var encodeUTF8 = mod.encodeUTF8;
var dateToExcelSerial = mod.dateToExcelSerial;

// ---------------------------------------------------------------------------
// toXLSX basics
// ---------------------------------------------------------------------------
describe('toXLSX', function () {
  it('should return a Uint8Array', function () {
    var table = { headers: ['a'], rows: [['1']] };
    var result = toXLSX(table);
    assert.ok(result instanceof Uint8Array, 'Expected Uint8Array');
  });

  it('should start with ZIP magic bytes (PK\\x03\\x04)', function () {
    var table = { headers: ['x'], rows: [] };
    var result = toXLSX(table);
    assert.strictEqual(result[0], 0x50, 'First byte P');
    assert.strictEqual(result[1], 0x4B, 'Second byte K');
    assert.strictEqual(result[2], 0x03, 'Third byte 0x03');
    assert.strictEqual(result[3], 0x04, 'Fourth byte 0x04');
  });

  it('should contain expected XML filenames in central directory', function () {
    var table = { headers: ['a'], rows: [['hello']] };
    var result = toXLSX(table);
    var text = new TextDecoder().decode(result);
    var expected = [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/sharedStrings.xml',
      'xl/worksheets/sheet1.xml'
    ];
    for (var i = 0; i < expected.length; i++) {
      assert.ok(text.indexOf(expected[i]) !== -1, 'Missing file: ' + expected[i]);
    }
  });

  it('should produce valid output for empty table', function () {
    var table = { headers: [], rows: [] };
    var result = toXLSX(table);
    assert.ok(result instanceof Uint8Array);
    assert.ok(result.length > 0, 'Output should not be empty');
    assert.strictEqual(result[0], 0x50, 'Should start with PK');
  });

  it('should produce valid output for single row table', function () {
    var table = { headers: ['name', 'value'], rows: [['test', 42]] };
    var result = toXLSX(table);
    assert.ok(result instanceof Uint8Array);
    assert.ok(result.length > 100, 'Output should have substantial content');
  });

  it('should detect numeric values correctly', function () {
    var table = { headers: ['num'], rows: [[42], [3.14], ['100']] };
    var result = toXLSX(table);
    var text = new TextDecoder().decode(result);
    // Numeric values should appear as t="n" cells
    assert.ok(text.indexOf('t="n"') !== -1, 'Should contain numeric cells');
    assert.ok(text.indexOf('<v>42</v>') !== -1, 'Should contain value 42');
    assert.ok(text.indexOf('<v>3.14</v>') !== -1, 'Should contain value 3.14');
  });

  it('should use shared strings for string values', function () {
    var table = { headers: ['col'], rows: [['hello'], ['world']] };
    var result = toXLSX(table);
    var text = new TextDecoder().decode(result);
    // Strings use t="s" cells
    assert.ok(text.indexOf('t="s"') !== -1, 'Should contain shared string cells');
    // sharedStrings.xml should contain our strings
    assert.ok(text.indexOf('<t>hello</t>') !== -1, 'Shared strings should include "hello"');
    assert.ok(text.indexOf('<t>world</t>') !== -1, 'Shared strings should include "world"');
  });

  it('should apply bold style to header row', function () {
    var table = { headers: ['Name'], rows: [['Alice']] };
    var result = toXLSX(table);
    var text = new TextDecoder().decode(result);
    // Header cells should reference style s="1" (bold font)
    assert.ok(text.indexOf('s="1"') !== -1, 'Header cells should have bold style reference');
  });

  it('should handle boolean values', function () {
    var table = { headers: ['flag'], rows: [[true], [false]] };
    var result = toXLSX(table);
    var text = new TextDecoder().decode(result);
    assert.ok(text.indexOf('t="b"') !== -1, 'Should contain boolean cells');
  });

  it('should accept sheetName option', function () {
    var table = { headers: ['a'], rows: [] };
    var result = toXLSX(table, { sheetName: 'MySheet' });
    var text = new TextDecoder().decode(result);
    assert.ok(text.indexOf('MySheet') !== -1, 'Should contain custom sheet name');
  });
});

// ---------------------------------------------------------------------------
// colIndexToLetter
// ---------------------------------------------------------------------------
describe('colIndexToLetter', function () {
  it('should convert 0 to A', function () {
    assert.strictEqual(colIndexToLetter(0), 'A');
  });

  it('should convert 25 to Z', function () {
    assert.strictEqual(colIndexToLetter(25), 'Z');
  });

  it('should convert 26 to AA', function () {
    assert.strictEqual(colIndexToLetter(26), 'AA');
  });

  it('should convert 27 to AB', function () {
    assert.strictEqual(colIndexToLetter(27), 'AB');
  });

  it('should convert 701 to ZZ', function () {
    assert.strictEqual(colIndexToLetter(701), 'ZZ');
  });

  it('should convert 702 to AAA', function () {
    assert.strictEqual(colIndexToLetter(702), 'AAA');
  });
});

// ---------------------------------------------------------------------------
// escapeXML
// ---------------------------------------------------------------------------
describe('escapeXML', function () {
  it('should escape ampersand', function () {
    assert.strictEqual(escapeXML('a&b'), 'a&amp;b');
  });

  it('should escape angle brackets', function () {
    assert.strictEqual(escapeXML('<b>'), '&lt;b&gt;');
  });

  it('should escape double quotes', function () {
    assert.strictEqual(escapeXML('say "hi"'), 'say &quot;hi&quot;');
  });

  it('should escape single quotes', function () {
    assert.strictEqual(escapeXML("it's"), 'it&apos;s');
  });

  it('should handle null and undefined', function () {
    assert.strictEqual(escapeXML(null), '');
    assert.strictEqual(escapeXML(undefined), '');
  });

  it('should escape all special characters together', function () {
    assert.strictEqual(escapeXML('<a href="x">&\''), '&lt;a href=&quot;x&quot;&gt;&amp;&apos;');
  });
});

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------
describe('crc32', function () {
  it('should compute CRC-32 for known input', function () {
    // CRC-32 of "123456789" is 0xCBF43926
    var input = encodeUTF8('123456789');
    var result = crc32(input);
    assert.strictEqual(result, 0xCBF43926, 'CRC-32 of "123456789" should be 0xCBF43926');
  });

  it('should return 0 for empty input', function () {
    var result = crc32(new Uint8Array(0));
    assert.strictEqual(result, 0x00000000);
  });
});

// ---------------------------------------------------------------------------
// buildZip
// ---------------------------------------------------------------------------
describe('buildZip', function () {
  it('should produce valid ZIP with magic bytes', function () {
    var files = [{ name: 'test.txt', data: encodeUTF8('hello') }];
    var zip = buildZip(files);
    assert.strictEqual(zip[0], 0x50);
    assert.strictEqual(zip[1], 0x4B);
    assert.strictEqual(zip[2], 0x03);
    assert.strictEqual(zip[3], 0x04);
  });

  it('should contain EOCD signature', function () {
    var files = [{ name: 'a.txt', data: encodeUTF8('data') }];
    var zip = buildZip(files);
    // EOCD signature should be near the end: PK\x05\x06
    var found = false;
    for (var i = zip.length - 22; i >= 0; i--) {
      if (zip[i] === 0x50 && zip[i+1] === 0x4B && zip[i+2] === 0x05 && zip[i+3] === 0x06) {
        found = true;
        break;
      }
    }
    assert.ok(found, 'ZIP should contain EOCD signature');
  });

  it('should handle multiple files', function () {
    var files = [
      { name: 'a.txt', data: encodeUTF8('aaa') },
      { name: 'b.txt', data: encodeUTF8('bbb') },
      { name: 'c.txt', data: encodeUTF8('ccc') }
    ];
    var zip = buildZip(files);
    var text = new TextDecoder().decode(zip);
    assert.ok(text.indexOf('a.txt') !== -1);
    assert.ok(text.indexOf('b.txt') !== -1);
    assert.ok(text.indexOf('c.txt') !== -1);
  });
});

// ---------------------------------------------------------------------------
// dateToExcelSerial
// ---------------------------------------------------------------------------
describe('dateToExcelSerial', function () {
  it('should convert ISO date string', function () {
    var serial = dateToExcelSerial('2024-01-01');
    assert.ok(serial !== null, 'Should detect ISO date');
    assert.ok(typeof serial === 'number');
    // 2024-01-01 should be around serial 45292
    assert.ok(serial > 45000 && serial < 46000, 'Serial should be in range for 2024');
  });

  it('should return null for non-dates', function () {
    assert.strictEqual(dateToExcelSerial('hello'), null);
    assert.strictEqual(dateToExcelSerial(42), null);
    assert.strictEqual(dateToExcelSerial(null), null);
  });
});
