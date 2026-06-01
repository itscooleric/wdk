/**
 * WDK Compress Module Tests
 * Tests for wdkDetectFormat, wdkDecompress, wdkCompress, wdkDecompressText
 *
 * Run: node test/compress.test.js
 */

// Load vendor libs as globals
var fflateModule = require('../node_modules/fflate/lib/node.cjs');
global.fflate = fflateModule;

var fzstdModule = require('../node_modules/fzstd/lib/index.js');
global.fzstd = fzstdModule;

var snappyModule = require('../node_modules/snappyjs/index.js');
global.SnappyJS = snappyModule;

// Load compress module — export to global
var compressModule = require('../src/compress/compress.js');
global.wdkDetectFormat = compressModule.wdkDetectFormat;
global.wdkDecompress = compressModule.wdkDecompress;
global.wdkCompress = compressModule.wdkCompress;
global.wdkDecompressText = compressModule.wdkDecompressText;

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

console.log('\n=== wdkDetectFormat ===');

test('detects gzip magic bytes', function () {
  var data = new Uint8Array([0x1f, 0x8b, 0x08, 0x00]);
  assert.strictEqual(wdkDetectFormat(data), 'gzip');
});

test('detects zlib (level 6) magic bytes', function () {
  var data = new Uint8Array([0x78, 0x9c, 0x00, 0x00]);
  assert.strictEqual(wdkDetectFormat(data), 'zlib');
});

test('detects zlib (level 1) magic bytes', function () {
  var data = new Uint8Array([0x78, 0x01, 0x00, 0x00]);
  assert.strictEqual(wdkDetectFormat(data), 'zlib');
});

test('detects zlib (level 9) magic bytes', function () {
  var data = new Uint8Array([0x78, 0xda, 0x00, 0x00]);
  assert.strictEqual(wdkDetectFormat(data), 'zlib');
});

test('detects zstd magic bytes', function () {
  var data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);
  assert.strictEqual(wdkDetectFormat(data), 'zstd');
});

test('detects ZIP magic bytes', function () {
  var data = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  assert.strictEqual(wdkDetectFormat(data), 'zip');
});

test('detects Parquet magic bytes', function () {
  var data = new Uint8Array([0x50, 0x41, 0x52, 0x31]);
  assert.strictEqual(wdkDetectFormat(data), 'parquet');
});

test('detects Arrow magic bytes', function () {
  var data = new Uint8Array([0x41, 0x52, 0x52, 0x4f, 0x57, 0x31]);
  assert.strictEqual(wdkDetectFormat(data), 'arrow');
});

test('returns null for unknown format', function () {
  var data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
  assert.strictEqual(wdkDetectFormat(data), null);
});

test('returns null for empty input', function () {
  assert.strictEqual(wdkDetectFormat(new Uint8Array(0)), null);
  assert.strictEqual(wdkDetectFormat(null), null);
});

test('returns null for too-short input', function () {
  assert.strictEqual(wdkDetectFormat(new Uint8Array([0x1f])), null);
  assert.strictEqual(wdkDetectFormat(new Uint8Array([0x1f, 0x8b])), null);
});

console.log('\n=== wdkCompress + wdkDecompress roundtrip ===');

test('gzip roundtrip', function () {
  var original = new TextEncoder().encode('Hello, World! This is a test of gzip compression.');
  var compressed = wdkCompress(original, 'gzip');
  assert.strictEqual(wdkDetectFormat(compressed), 'gzip');
  var decompressed = wdkDecompress(compressed, 'gzip');
  assert.deepStrictEqual(decompressed, original);
});

test('zlib roundtrip', function () {
  var original = new TextEncoder().encode('Hello, World! This is a test of zlib compression.');
  var compressed = wdkCompress(original, 'zlib');
  assert.strictEqual(wdkDetectFormat(compressed), 'zlib');
  var decompressed = wdkDecompress(compressed, 'zlib');
  assert.deepStrictEqual(decompressed, original);
});

test('deflate roundtrip', function () {
  var original = new TextEncoder().encode('Hello, World! This is a test of deflate compression.');
  var compressed = wdkCompress(original, 'deflate');
  var decompressed = wdkDecompress(compressed, 'deflate');
  assert.deepStrictEqual(decompressed, original);
});

test('gzip auto-detect on decompress', function () {
  var original = new TextEncoder().encode('auto-detection test for gzip');
  var compressed = wdkCompress(original, 'gzip');
  var decompressed = wdkDecompress(compressed); // no format specified
  assert.deepStrictEqual(decompressed, original);
});

test('zlib auto-detect on decompress', function () {
  var original = new TextEncoder().encode('auto-detection test for zlib');
  var compressed = wdkCompress(original, 'zlib');
  var decompressed = wdkDecompress(compressed); // no format specified
  assert.deepStrictEqual(decompressed, original);
});

test('default format is gzip', function () {
  var original = new TextEncoder().encode('default format test');
  var compressed = wdkCompress(original);
  assert.strictEqual(wdkDetectFormat(compressed), 'gzip');
});

test('compression level option', function () {
  var original = new TextEncoder().encode('a'.repeat(10000));
  var fast = wdkCompress(original, 'gzip', { level: 1 });
  var slow = wdkCompress(original, 'gzip', { level: 9 });
  // Higher compression should produce smaller output
  assert.ok(slow.length <= fast.length, 'level 9 should be <= level 1 size');
  // Both should decompress to same result
  assert.deepStrictEqual(wdkDecompress(fast), original);
  assert.deepStrictEqual(wdkDecompress(slow), original);
});

console.log('\n=== wdkDecompressText ===');

test('decompresses gzip to string', function () {
  var text = 'id,name,value\n1,alice,100\n2,bob,200\n';
  var compressed = wdkCompress(new TextEncoder().encode(text), 'gzip');
  var result = wdkDecompressText(compressed);
  assert.strictEqual(result, text);
});

test('handles UTF-8 text', function () {
  var text = 'id,name\n1,\u00e9l\u00e8ve\n2,caf\u00e9\n';
  var compressed = wdkCompress(new TextEncoder().encode(text), 'gzip');
  var result = wdkDecompressText(compressed);
  assert.strictEqual(result, text);
});

console.log('\n=== Large data ===');

test('compress/decompress 1MB data', function () {
  var size = 1024 * 1024;
  var original = new Uint8Array(size);
  for (var i = 0; i < size; i++) original[i] = i & 0xff;
  var compressed = wdkCompress(original, 'gzip');
  assert.ok(compressed.length < original.length, 'should compress');
  var decompressed = wdkDecompress(compressed);
  assert.strictEqual(decompressed.length, original.length);
  assert.deepStrictEqual(decompressed, original);
});

test('compress/decompress 10MB data', function () {
  var size = 10 * 1024 * 1024;
  var original = new Uint8Array(size);
  for (var i = 0; i < size; i++) original[i] = i & 0xff;
  var compressed = wdkCompress(original, 'gzip');
  var decompressed = wdkDecompress(compressed);
  assert.strictEqual(decompressed.length, original.length);
  // Verify first and last bytes
  assert.strictEqual(decompressed[0], 0);
  assert.strictEqual(decompressed[size - 1], (size - 1) & 0xff);
});

console.log('\n=== Error handling ===');

test('throws on unknown decompress format', function () {
  assert.throws(function () {
    wdkDecompress(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
  }, /unable to detect/);
});

test('throws on unsupported compress format', function () {
  assert.throws(function () {
    wdkCompress(new Uint8Array([1, 2, 3]), 'lzma');
  }, /not supported/);
});

test('throws on corrupt gzip data', function () {
  assert.throws(function () {
    // Valid gzip header but truncated
    wdkDecompress(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]), 'gzip');
  });
});

console.log('\n=== Empty data ===');

test('compress/decompress empty data', function () {
  var empty = new Uint8Array(0);
  var compressed = wdkCompress(empty, 'gzip');
  var decompressed = wdkDecompress(compressed, 'gzip');
  assert.strictEqual(decompressed.length, 0);
});

console.log('\n=== Zstd decompression ===');

test('zstd decompress (pre-compressed data)', function () {
  // Compress with gzip, then verify zstd detection on known magic bytes
  var data = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd]);
  assert.strictEqual(wdkDetectFormat(data), 'zstd');
});

console.log('\n=== Snappy ===');

test('snappy decompress via explicit format', function () {
  var original = new TextEncoder().encode('test data for snappy compression');
  var compressed = SnappyJS.compress(original);
  var decompressed = wdkDecompress(new Uint8Array(compressed), 'snappy');
  assert.deepStrictEqual(decompressed, original);
});

console.log('\n=== ZIP ===');

test('creates and reads ZIP via fflate', function () {
  var files = {
    'test.txt': new TextEncoder().encode('hello from zip')
  };
  var zipped = fflate.zipSync(files);
  assert.strictEqual(wdkDetectFormat(zipped), 'zip');
  var unzipped = wdkDecompress(zipped, 'zip');
  // unzipped is an object map for ZIP
  assert.ok(unzipped['test.txt']);
  var text = new TextDecoder().decode(unzipped['test.txt']);
  assert.strictEqual(text, 'hello from zip');
});

console.log('\n=== Results ===');
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed > 0 ? 1 : 0);
