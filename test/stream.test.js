/**
 * WDK Streaming Decompression Tests
 *
 * Run: node test/stream.test.js
 */

// Load vendor libs
var fflateModule = require('../node_modules/fflate/lib/node.cjs');
global.fflate = fflateModule;
var fzstdModule = require('../node_modules/fzstd/lib/index.js');
global.fzstd = fzstdModule;

// Load compress module for wdkDetectFormat
var compressModule = require('../src/compress/compress.js');
global.wdkDetectFormat = compressModule.wdkDetectFormat;
global.wdkCompress = compressModule.wdkCompress;

// Load CSV parser
var csvModule = require('../src/parsers/csv.js');
global.parseCSV = csvModule.parseCSV;

// Mock DataFrame
global.DataFrame = function (headers, rows) { this.headers = headers; this.rows = rows; };

// Load stream module
var streamModule = require('../src/compress/stream.js');
global.wdkStreamDecompress = streamModule.wdkStreamDecompress;
global.wdkStreamCsvGz = streamModule.wdkStreamCsvGz;
global.wdkLoadCompressedCsv = streamModule.wdkLoadCompressedCsv;

var assert = require('assert');
var passed = 0;
var failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  PASS: ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL: ' + name + ' — ' + e.message);
  }
}

async function run() {

  console.log('\n=== wdkStreamDecompress ===');

  await test('streams gzip decompression', async function () {
    var original = 'Hello, streaming world! '.repeat(1000);
    var compressed = fflate.gzipSync(new TextEncoder().encode(original));
    var chunks = [];
    await wdkStreamDecompress(compressed, {
      onChunk: function (text, isLast) { chunks.push(text); }
    });
    var result = chunks.join('');
    assert.strictEqual(result, original);
  });

  await test('streams zlib decompression', async function () {
    var original = 'Zlib streaming test data. '.repeat(500);
    var compressed = fflate.zlibSync(new TextEncoder().encode(original));
    var chunks = [];
    await wdkStreamDecompress(compressed, {
      format: 'zlib',
      onChunk: function (text, isLast) { chunks.push(text); }
    });
    assert.strictEqual(chunks.join(''), original);
  });

  await test('auto-detects format', async function () {
    var original = 'auto-detect test data';
    var compressed = fflate.gzipSync(new TextEncoder().encode(original));
    var result = '';
    await wdkStreamDecompress(compressed, {
      onChunk: function (text) { result += text; }
    });
    assert.strictEqual(result, original);
  });

  await test('emits multiple chunks for large data', async function () {
    var original = 'x'.repeat(500000);
    var compressed = fflate.gzipSync(new TextEncoder().encode(original));
    var chunkCount = 0;
    await wdkStreamDecompress(compressed, {
      onChunk: function (text, isLast) { chunkCount++; }
    });
    assert.ok(chunkCount >= 1, 'should have at least 1 chunk');
  });

  await test('handles empty compressed data', async function () {
    var compressed = fflate.gzipSync(new Uint8Array(0));
    var result = '';
    await wdkStreamDecompress(compressed, {
      onChunk: function (text) { result += text; }
    });
    assert.strictEqual(result, '');
  });

  await test('handles UTF-8 in stream', async function () {
    var original = '\u00e9l\u00e8ve caf\u00e9 na\u00efve '.repeat(100);
    var compressed = fflate.gzipSync(new TextEncoder().encode(original));
    var result = '';
    await wdkStreamDecompress(compressed, {
      onChunk: function (text) { result += text; }
    });
    assert.strictEqual(result, original);
  });

  console.log('\n=== wdkStreamCsvGz ===');

  await test('parses gzip CSV', async function () {
    var csv = 'id,name,value\n';
    for (var i = 0; i < 100; i++) csv += i + ',item_' + i + ',' + (i * 1.5) + '\n';
    var compressed = fflate.gzipSync(new TextEncoder().encode(csv));

    var result = await wdkStreamCsvGz(compressed);
    assert.deepStrictEqual(result.headers, ['id', 'name', 'value']);
    assert.strictEqual(result.rows.length, 100);
    assert.strictEqual(result.rows[0][0], '0');
    assert.strictEqual(result.rows[0][1], 'item_0');
  });

  await test('handles large CSV (10K rows)', async function () {
    var csv = 'a,b,c\n';
    for (var i = 0; i < 10000; i++) csv += i + ',val_' + i + ',' + Math.random().toFixed(4) + '\n';
    var compressed = fflate.gzipSync(new TextEncoder().encode(csv));

    var result = await wdkStreamCsvGz(compressed);
    assert.strictEqual(result.headers.length, 3);
    assert.strictEqual(result.rows.length, 10000);
  });

  await test('calls onComplete callback', async function () {
    var csv = 'x,y\n1,2\n3,4\n';
    var compressed = fflate.gzipSync(new TextEncoder().encode(csv));
    var completed = false;

    await wdkStreamCsvGz(compressed, {
      onComplete: function (result) {
        completed = true;
        assert.strictEqual(result.rows.length, 2);
      }
    });
    assert.ok(completed, 'onComplete should have been called');
  });

  console.log('\n=== wdkLoadCompressedCsv ===');

  await test('returns DataFrame', async function () {
    var csv = 'col1,col2\na,1\nb,2\n';
    var compressed = fflate.gzipSync(new TextEncoder().encode(csv));
    var df = await wdkLoadCompressedCsv(compressed);
    assert.ok(df instanceof DataFrame);
    assert.deepStrictEqual(df.headers, ['col1', 'col2']);
    assert.strictEqual(df.rows.length, 2);
  });

  console.log('\n=== Results ===');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function (e) {
  console.error('Test runner error:', e);
  process.exit(1);
});
