/**
 * E2E Test: Data parsing edge cases, DataFrame operations, pipeline round-trips
 * Ticket #37
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var { parseCSV } = require('../src/parsers/csv.js');
var { DataFrame } = require('../src/transforms/data-model.js');

var toCSV;
before(async function () {
  var mod = await import('../src/export/export.js');
  toCSV = mod.toCSV;
});

describe('E2E: Data parsing edge cases and round-trips', function () {

  it('1. CSV with special characters (quotes, commas, newlines in fields)', function () {
    var csv = 'name,bio,city\n' +
      '"Alice ""The Great""","Loves cats, dogs","New York"\n' +
      '"Bob","Has a\nmultiline bio","Los Angeles"\n' +
      'Carol,"She said ""hello, world""",Chicago';
    var result = parseCSV(csv);
    assert.deepStrictEqual(result.headers, ['name', 'bio', 'city']);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0][0], 'Alice "The Great"');
    assert.equal(result.rows[0][1], 'Loves cats, dogs');
    assert.equal(result.rows[1][1], 'Has a\nmultiline bio');
    assert.equal(result.rows[2][1], 'She said "hello, world"');
  });

  it('2. TSV parsing with tab delimiter', function () {
    var tsv = 'name\tage\tcity\n' +
      'Alice\t30\tNew York\n' +
      'Bob\t25\tChicago\n' +
      'Carol\t35\tBoston';
    var result = parseCSV(tsv, { delimiter: '\t' });
    assert.deepStrictEqual(result.headers, ['name', 'age', 'city']);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0][0], 'Alice');
    assert.equal(result.rows[0][1], '30');
    assert.equal(result.rows[2][2], 'Boston');
  });

  it('3. Large dataset: 10000 rows parse correctly', function () {
    var lines = ['id,value,category'];
    for (var i = 0; i < 10000; i++) {
      var cat = ['A', 'B', 'C', 'D'][i % 4];
      lines.push(i + ',' + (i * 1.5) + ',' + cat);
    }
    var csv = lines.join('\n');
    var result = parseCSV(csv);
    assert.equal(result.rows.length, 10000);
    assert.deepStrictEqual(result.headers, ['id', 'value', 'category']);
    assert.equal(result.rows[0][0], '0');
    assert.equal(result.rows[9999][0], '9999');
    assert.equal(result.rows[9999][2], 'D'); // 9999 % 4 = 3 -> D
  });

  it('4. DataFrame operations: filter, sort, dedupe', function () {
    var df = new DataFrame(
      ['name', 'score', 'grade'],
      [
        ['Alice', 95, 'A'],
        ['Bob',   85, 'B'],
        ['Carol', 95, 'A'],
        ['Dave',  70, 'C'],
        ['Eve',   85, 'B'],
        ['Alice', 95, 'A'], // duplicate
      ]
    );
    assert.equal(df.rowCount, 6);

    // Filter: score >= 85
    var filtered = df.filterRows(function (row) { return Number(row[1]) >= 85; });
    assert.equal(filtered.rowCount, 5);

    // Sort by score descending
    var sorted = df.sortRows('score', false);
    assert.equal(sorted.getRow(0)[0], 'Alice'); // score 95
    assert.equal(sorted.getRow(sorted.rowCount - 1)[0], 'Dave'); // score 70

    // Dedupe by all columns
    var deduped = df.dedupe();
    assert.equal(deduped.rowCount, 5); // one duplicate removed
  });

  it('5. Pipeline: import -> filter -> sort -> export CSV -> re-import -> compare', function () {
    var csv = 'product,price,qty\n' +
      'Widget,9.99,100\n' +
      'Gadget,24.99,50\n' +
      'Doohickey,4.99,200\n' +
      'Thingamajig,14.99,75\n' +
      'Whatchamacallit,19.99,30';
    var parsed = parseCSV(csv);

    // Build DataFrame
    var df = new DataFrame(parsed.headers, parsed.rows);

    // Filter: price > 10
    var filtered = df.filterRows(function (row) {
      return Number(row[1]) > 10;
    });
    assert.equal(filtered.rowCount, 3);

    // Sort by price ascending
    var sorted = filtered.sortRows('price', true);

    // Export to CSV
    var exported = toCSV({ headers: sorted._headers, rows: sorted._rows });

    // Re-import
    var reimported = parseCSV(exported);
    assert.deepStrictEqual(reimported.headers, sorted._headers);
    assert.equal(reimported.rows.length, sorted.rowCount);

    // Verify data integrity
    for (var i = 0; i < sorted.rowCount; i++) {
      var origRow = sorted.getRow(i);
      var newRow = reimported.rows[i];
      for (var j = 0; j < origRow.length; j++) {
        assert.equal(String(newRow[j]), String(origRow[j]));
      }
    }
  });

  it('6. Empty cells and null handling', function () {
    var csv = 'name,email,phone\n' +
      'Alice,alice@test.com,555-0101\n' +
      'Bob,,555-0102\n' +
      ',carol@test.com,\n' +
      ',,';
    var result = parseCSV(csv);
    assert.equal(result.rows.length, 4);
    // Empty fields should be empty strings
    assert.equal(result.rows[1][1], '');
    assert.equal(result.rows[2][0], '');
    assert.equal(result.rows[2][2], '');
    assert.equal(result.rows[3][0], '');
    assert.equal(result.rows[3][1], '');
    assert.equal(result.rows[3][2], '');

    // DataFrame should handle empty values in filter
    var df = new DataFrame(result.headers, result.rows);
    var withEmail = df.filterRows(function (row) { return row[1] !== ''; });
    assert.equal(withEmail.rowCount, 2);
  });

  it('7. Mixed types: numbers, strings, booleans - type detection', function () {
    var csv = 'col_str,col_num,col_bool,col_float\n' +
      'hello,42,true,3.14\n' +
      'world,0,false,2.718\n' +
      'test,-5,true,0.001';
    var result = parseCSV(csv);
    assert.equal(result.rows.length, 3);

    // CSV parser returns all values as strings - verify they are parseable
    assert.equal(result.rows[0][0], 'hello');
    assert.equal(Number(result.rows[0][1]), 42);
    assert.equal(result.rows[0][2], 'true');
    assert.equal(Number(result.rows[0][3]), 3.14);
    assert.equal(Number(result.rows[1][1]), 0);
    assert.equal(result.rows[1][2], 'false');
    assert.equal(Number(result.rows[2][1]), -5);

    // DataFrame can work with these as strings and sort numerically
    var df = new DataFrame(result.headers, result.rows);
    var sorted = df.sortRows('col_num', true);
    assert.equal(sorted.getRow(0)[1], '-5'); // string sort: -5 < 0 < 42
  });

  it('8. Unicode content: CJK characters, emoji, accented', function () {
    var csv = 'name,city,notes\n' +
      '\u5F20\u4F1F,\u5317\u4EAC,\u4E2D\u6587\u6D4B\u8BD5\n' +
      'Jos\u00E9,M\u00E9xico,caf\u00E9 con le\u00F1a\n' +
      'Tanaka,\u6771\u4EAC,\u65E5\u672C\u8A9E\u30C6\u30B9\u30C8';
    var result = parseCSV(csv);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0][0], '\u5F20\u4F1F');
    assert.equal(result.rows[0][1], '\u5317\u4EAC');
    assert.equal(result.rows[1][0], 'Jos\u00E9');
    assert.equal(result.rows[1][2], 'caf\u00E9 con le\u00F1a');
    assert.equal(result.rows[2][1], '\u6771\u4EAC');

    // Round-trip through export/re-parse
    var exported = toCSV({ headers: result.headers, rows: result.rows });
    var reimported = parseCSV(exported);
    assert.deepStrictEqual(reimported.headers, result.headers);
    for (var i = 0; i < result.rows.length; i++) {
      assert.deepStrictEqual(reimported.rows[i], result.rows[i]);
    }
  });
});
