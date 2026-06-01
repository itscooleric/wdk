/**
 * WDK Parquet Reader Tests
 * Tests for readParquetMetadata, readParquetFile, readParquetToDataFrame
 *
 * Run: node test/parquet.test.js
 */

// Load vendor libs as globals
var fflateModule = require('../node_modules/fflate/lib/node.cjs');
global.fflate = fflateModule;

var fzstdModule = require('../node_modules/fzstd/lib/index.js');
global.fzstd = fzstdModule;

// Load hyparquet — ESM module, need dynamic import
async function runTests() {
  var hyparquetMod = await import('../node_modules/hyparquet/src/index.js');
  global.hyparquet = hyparquetMod;

  // Load compress module
  var compressModule = require('../src/compress/compress.js');
  global.wdkDetectFormat = compressModule.wdkDetectFormat;
  global.wdkDecompress = compressModule.wdkDecompress;
  global.wdkCompress = compressModule.wdkCompress;
  global.wdkDecompressText = compressModule.wdkDecompressText;

  // Load parquet module
  var parquetModule = require('../src/compress/parquet.js');
  global.readParquetMetadata = parquetModule.readParquetMetadata;
  global.readParquetFile = parquetModule.readParquetFile;
  global.readParquetToDataFrame = parquetModule.readParquetToDataFrame;

  // Mock DataFrame for testing
  global.DataFrame = function (headers, rows) {
    this.headers = headers;
    this.rows = rows;
  };

  var assert = require('assert');
  var fs = require('fs');
  var path = require('path');
  var passed = 0;
  var failed = 0;

  function test(name, fn) {
    return fn().then(function () {
      passed++;
      console.log('  PASS: ' + name);
    }).catch(function (e) {
      failed++;
      console.error('  FAIL: ' + name + ' — ' + e.message);
    });
  }

  // Generate a minimal Parquet test file using hyparquet's own format understanding
  // We'll use a pre-built Parquet file from the test fixtures if available,
  // or test with the API surface

  console.log('\n=== Parquet format detection ===');

  await test('detects Parquet from magic bytes', async function () {
    // PAR1 header
    var data = new Uint8Array([0x50, 0x41, 0x52, 0x31, 0x00, 0x00]);
    assert.strictEqual(wdkDetectFormat(data), 'parquet');
  });

  // Try to find or create a test Parquet file
  var fixtureDir = path.join(__dirname, 'fixtures');
  var parquetFixture = path.join(fixtureDir, 'test.parquet');
  var hasFixture = fs.existsSync(parquetFixture);

  if (!hasFixture) {
    console.log('\n  (No test Parquet fixture found at test/fixtures/test.parquet)');
    console.log('  (Generate with: python3 -c "import pandas as pd; pd.DataFrame({\'id\':range(100),\'name\':[f\'item_{i}\' for i in range(100)]}).to_parquet(\'test/fixtures/test.parquet\')")');
    console.log('  (Skipping file-based Parquet tests)');

    // Test that API exists and has correct shape
    console.log('\n=== Parquet API shape ===');

    await test('readParquetMetadata is a function', async function () {
      assert.strictEqual(typeof readParquetMetadata, 'function');
    });

    await test('readParquetFile is a function', async function () {
      assert.strictEqual(typeof readParquetFile, 'function');
    });

    await test('readParquetToDataFrame is a function', async function () {
      assert.strictEqual(typeof readParquetToDataFrame, 'function');
    });

    await test('readParquetMetadata throws on invalid input', async function () {
      try {
        readParquetMetadata(new ArrayBuffer(10));
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e.message.length > 0);
      }
    });

    await test('readParquetFile rejects on invalid input', async function () {
      try {
        await readParquetFile(new ArrayBuffer(10));
        assert.fail('should have thrown');
      } catch (e) {
        assert.ok(e.message.length > 0);
      }
    });
  } else {
    console.log('\n=== Parquet file reading ===');
    var fileBuf = fs.readFileSync(parquetFixture);
    var buffer = new ArrayBuffer(fileBuf.length);
    var u8 = new Uint8Array(buffer);
    for (var bi = 0; bi < fileBuf.length; bi++) u8[bi] = fileBuf[bi];

    await test('readParquetMetadata reads schema', async function () {
      var meta = readParquetMetadata(buffer);
      assert.ok(meta.schema.length > 0, 'should have columns');
      assert.ok(meta.rowCount > 0, 'should have rows');
      assert.ok(meta.rowGroups > 0, 'should have row groups');
    });

    await test('readParquetFile reads data', async function () {
      var result = await readParquetFile(buffer);
      assert.ok(result.headers.length > 0, 'should have headers');
      assert.ok(result.rows.length > 0, 'should have rows');
    });

    await test('readParquetToDataFrame returns DataFrame', async function () {
      var df = await readParquetToDataFrame(buffer);
      assert.ok(df instanceof DataFrame);
      assert.ok(df.headers.length > 0);
      assert.ok(df.rows.length > 0);
    });

    await test('column subset read works', async function () {
      var meta = readParquetMetadata(buffer);
      if (meta.schema.length >= 2) {
        var firstCol = meta.schema[0].name;
        var result = await readParquetFile(buffer, { columns: [firstCol] });
        assert.strictEqual(result.headers.length, 1);
        assert.strictEqual(result.headers[0], firstCol);
      }
    });

    await test('row range read works', async function () {
      var result = await readParquetFile(buffer, { rowStart: 0, rowEnd: 5 });
      assert.ok(result.rows.length <= 5);
    });
  }

  // Test the compressors builder
  console.log('\n=== Compressor integration ===');

  await test('_buildCompressors returns valid map', async function () {
    // Access internal function via the module
    var compressors = parquetModule._buildCompressors ? parquetModule._buildCompressors() : null;
    // If not exported, just verify the module works
    if (!compressors) {
      // Can still verify hyparquet.snappyUncompress exists
      assert.strictEqual(typeof hyparquet.snappyUncompress, 'function');
    } else {
      assert.strictEqual(typeof compressors.SNAPPY, 'function');
      assert.strictEqual(typeof compressors.GZIP, 'function');
      assert.strictEqual(typeof compressors.ZSTD, 'function');
    }
  });

  console.log('\n=== Results ===');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(function (e) {
  console.error('Test runner error:', e);
  process.exit(1);
});
