/**
 * WDK File Type Detection Tests
 * Tests for the updated detectFileType function in file-import.js
 *
 * Run: node test/file-detect.test.js
 */

// Load the file-import module
var importModule = require('../src/ui/file-import.js');
global.detectFileType = importModule.detectFileType;

var assert = require('assert');
var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL: ' + name + ' — ' + e.message);
  }
}

console.log('\n=== Plain file extensions ===');

test('detects .csv', function () {
  var r = detectFileType('data.csv');
  assert.deepStrictEqual(r, { type: 'csv', compressed: null });
});

test('detects .tsv', function () {
  var r = detectFileType('data.tsv');
  assert.deepStrictEqual(r, { type: 'tsv', compressed: null });
});

test('detects .json', function () {
  var r = detectFileType('data.json');
  assert.deepStrictEqual(r, { type: 'json', compressed: null });
});

test('detects .jsonl', function () {
  var r = detectFileType('data.jsonl');
  assert.deepStrictEqual(r, { type: 'json', compressed: null });
});

test('detects .ndjson', function () {
  var r = detectFileType('data.ndjson');
  assert.deepStrictEqual(r, { type: 'json', compressed: null });
});

test('detects .xlsx', function () {
  var r = detectFileType('data.xlsx');
  assert.deepStrictEqual(r, { type: 'xlsx', compressed: null });
});

test('detects .parquet', function () {
  var r = detectFileType('data.parquet');
  assert.deepStrictEqual(r, { type: 'parquet', compressed: null });
});

test('detects .pq', function () {
  var r = detectFileType('data.pq');
  assert.deepStrictEqual(r, { type: 'parquet', compressed: null });
});

console.log('\n=== Compressed file extensions ===');

test('detects .csv.gz', function () {
  var r = detectFileType('data.csv.gz');
  assert.deepStrictEqual(r, { type: 'csv', compressed: 'gzip' });
});

test('detects .csv.zst', function () {
  var r = detectFileType('data.csv.zst');
  assert.deepStrictEqual(r, { type: 'csv', compressed: 'zstd' });
});

test('detects .json.gz', function () {
  var r = detectFileType('data.json.gz');
  assert.deepStrictEqual(r, { type: 'json', compressed: 'gzip' });
});

test('detects .tsv.gz', function () {
  var r = detectFileType('data.tsv.gz');
  assert.deepStrictEqual(r, { type: 'tsv', compressed: 'gzip' });
});

test('detects .json.zst', function () {
  var r = detectFileType('data.json.zst');
  assert.deepStrictEqual(r, { type: 'json', compressed: 'zstd' });
});

test('detects .jsonl.gz', function () {
  var r = detectFileType('data.jsonl.gz');
  assert.deepStrictEqual(r, { type: 'json', compressed: 'gzip' });
});

test('detects bare .gz as compressed', function () {
  var r = detectFileType('archive.gz');
  assert.deepStrictEqual(r, { type: 'compressed', compressed: 'gzip' });
});

test('detects bare .zst as compressed', function () {
  var r = detectFileType('archive.zst');
  assert.deepStrictEqual(r, { type: 'compressed', compressed: 'zstd' });
});

console.log('\n=== Edge cases ===');

test('returns null for unknown extension', function () {
  assert.strictEqual(detectFileType('readme.md'), null);
});

test('returns null for no extension', function () {
  assert.strictEqual(detectFileType('datafile'), null);
});

test('returns null for empty string', function () {
  assert.strictEqual(detectFileType(''), null);
});

test('case insensitive', function () {
  var r = detectFileType('Data.CSV.GZ');
  assert.deepStrictEqual(r, { type: 'csv', compressed: 'gzip' });
});

test('handles paths with directories', function () {
  var r = detectFileType('/path/to/data.parquet');
  assert.deepStrictEqual(r, { type: 'parquet', compressed: null });
});

console.log('\n=== Results ===');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
