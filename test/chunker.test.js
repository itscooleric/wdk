/**
 * WDK Chunker Tests — Split & Compress / Combine & Decompress
 *
 * Run: node test/chunker.test.js
 */

var fflateModule = require('../node_modules/fflate/lib/node.cjs');
global.fflate = fflateModule;
var fzstdModule = require('../node_modules/fzstd/lib/index.js');
global.fzstd = fzstdModule;

var compressModule = require('../src/compress/compress.js');
global.wdkDetectFormat = compressModule.wdkDetectFormat;
global.wdkCompress = compressModule.wdkCompress;
global.wdkDecompress = compressModule.wdkDecompress;

// Mock browser APIs for Node.js
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

var chunkerModule = require('../src/compress/chunker.js');

var assert = require('assert');
var passed = 0;
var failed = 0;

function test(name, fn) {
  try {
    var result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(function () {
        passed++;
        console.log('  PASS: ' + name);
      }).catch(function (e) {
        failed++;
        console.error('  FAIL: ' + name + ' — ' + e.message);
      });
    }
    passed++;
    console.log('  PASS: ' + name);
    return Promise.resolve();
  } catch (e) {
    failed++;
    console.error('  FAIL: ' + name + ' — ' + e.message);
    return Promise.resolve();
  }
}

async function run() {

  console.log('\n=== Chunk Header ===');

  await test('builds and parses chunk header', function () {
    var header = chunkerModule._buildChunkHeader({
      originalName: 'test-data.csv',
      compression: 1,
      chunkIndex: 0,
      totalChunks: 5,
      uncompressedSize: 1000000,
      compressedSize: 350000
    });
    assert.ok(header instanceof Uint8Array);
    assert.ok(header.length > 16);
    // Verify magic bytes
    assert.strictEqual(header[0], 0x57); // W
    assert.strictEqual(header[1], 0x44); // D
    assert.strictEqual(header[2], 0x4B); // K
    assert.strictEqual(header[3], 0x43); // C

    var parsed = chunkerModule._parseChunkHeader(header);
    assert.strictEqual(parsed.version, 1);
    assert.strictEqual(parsed.compression, 1);
    assert.strictEqual(parsed.chunkIndex, 0);
    assert.strictEqual(parsed.totalChunks, 5);
    assert.strictEqual(parsed.originalName, 'test-data.csv');
    assert.strictEqual(parsed.uncompressedSize, 1000000);
    assert.strictEqual(parsed.compressedSize, 350000);
  });

  await test('handles long filenames', function () {
    var longName = 'a'.repeat(200) + '.csv';
    var header = chunkerModule._buildChunkHeader({
      originalName: longName,
      compression: 0,
      chunkIndex: 99,
      totalChunks: 100,
      uncompressedSize: 500,
      compressedSize: 500
    });
    var parsed = chunkerModule._parseChunkHeader(header);
    assert.strictEqual(parsed.originalName, longName);
    assert.strictEqual(parsed.chunkIndex, 99);
    assert.strictEqual(parsed.totalChunks, 100);
  });

  await test('handles UTF-8 filenames', function () {
    var name = 'data-\u00e9l\u00e8ve-2024.csv';
    var header = chunkerModule._buildChunkHeader({
      originalName: name,
      compression: 1,
      chunkIndex: 0,
      totalChunks: 1,
      uncompressedSize: 100,
      compressedSize: 50
    });
    var parsed = chunkerModule._parseChunkHeader(header);
    assert.strictEqual(parsed.originalName, name);
  });

  await test('rejects non-WDKC files', function () {
    assert.throws(function () {
      chunkerModule._parseChunkHeader(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11]));
    }, /WDKC magic/);
  });

  await test('rejects too-small data', function () {
    assert.throws(function () {
      chunkerModule._parseChunkHeader(new Uint8Array([0x57, 0x44]));
    }, /too small/);
  });

  console.log('\n=== Chunk + Combine Roundtrip ===');

  // Create a mock File-like object for Node.js
  function MockFile(name, data) {
    this.name = name;
    this.size = data.length;
    this._data = data;
    this.slice = function (start, end) {
      var sliced = data.slice(start, end);
      return {
        arrayBuffer: function () { return Promise.resolve(sliced.buffer.slice(sliced.byteOffset, sliced.byteOffset + sliced.byteLength)); }
      };
    };
    this.arrayBuffer = function () { return Promise.resolve(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); };
  }

  await test('roundtrip: chunk with gzip then combine', async function () {
    // Create test data: 500 KB
    var original = new Uint8Array(500 * 1024);
    for (var i = 0; i < original.length; i++) original[i] = i & 0xff;

    var file = new MockFile('test-data.bin', original);

    // Split into 100KB chunks with gzip
    var result = await chunkerModule.wdkChunkCompress(file, {
      chunkSize: 100 * 1024,
      format: 'gzip',
      autoDownload: false
    });

    assert.strictEqual(result.chunks.length, 5);
    assert.strictEqual(result.filenames.length, 5);
    assert.strictEqual(result.filenames[0], 'test-data.bin.wdkc.1');
    assert.strictEqual(result.filenames[4], 'test-data.bin.wdkc.5');

    // Verify each chunk has WDKC header
    for (var j = 0; j < result.chunks.length; j++) {
      var meta = chunkerModule._parseChunkHeader(result.chunks[j]);
      assert.strictEqual(meta.chunkIndex, j);
      assert.strictEqual(meta.totalChunks, 5);
      assert.strictEqual(meta.originalName, 'test-data.bin');
      assert.strictEqual(meta.compression, 1); // gzip
    }

    // Combine back — create mock files from chunks
    var chunkFiles = result.chunks.map(function (chunk, idx) {
      return new MockFile(result.filenames[idx], chunk);
    });

    var combined = await chunkerModule.wdkCombineDecompress(chunkFiles, {
      autoDownload: false
    });

    assert.strictEqual(combined.filename, 'test-data.bin');
    assert.strictEqual(combined.totalSize, original.length);

    // Verify data integrity
    var combinedData = new Uint8Array(await combined.blob.arrayBuffer());
    assert.deepStrictEqual(combinedData, original);
  });

  await test('roundtrip: chunk without compression', async function () {
    var original = new Uint8Array(300 * 1024);
    for (var i = 0; i < original.length; i++) original[i] = (i * 7) & 0xff;

    var file = new MockFile('raw-data.dat', original);

    var result = await chunkerModule.wdkChunkCompress(file, {
      chunkSize: 200 * 1024,
      format: 'none',
      autoDownload: false
    });

    assert.strictEqual(result.chunks.length, 2);

    var chunkFiles = result.chunks.map(function (chunk, idx) {
      return new MockFile(result.filenames[idx], chunk);
    });

    var combined = await chunkerModule.wdkCombineDecompress(chunkFiles, { autoDownload: false });
    var combinedData = new Uint8Array(await combined.blob.arrayBuffer());
    assert.deepStrictEqual(combinedData, original);
  });

  await test('combine handles out-of-order chunks', async function () {
    var original = new Uint8Array(250 * 1024);
    for (var i = 0; i < original.length; i++) original[i] = i & 0xff;

    var file = new MockFile('shuffled.bin', original);

    var result = await chunkerModule.wdkChunkCompress(file, {
      chunkSize: 100 * 1024,
      format: 'gzip',
      autoDownload: false
    });

    // Reverse the chunk order
    var reversed = result.chunks.slice().reverse();
    var chunkFiles = reversed.map(function (chunk, idx) {
      return new MockFile('chunk-' + idx, chunk);
    });

    var combined = await chunkerModule.wdkCombineDecompress(chunkFiles, { autoDownload: false });
    var combinedData = new Uint8Array(await combined.blob.arrayBuffer());
    assert.deepStrictEqual(combinedData, original);
  });

  await test('combine detects missing chunks', async function () {
    var file = new MockFile('test.bin', new Uint8Array(300 * 1024));
    var result = await chunkerModule.wdkChunkCompress(file, {
      chunkSize: 100 * 1024,
      format: 'none',
      autoDownload: false
    });

    // Only provide chunk 0 and 2, skip chunk 1
    var partial = [result.chunks[0], result.chunks[2]].map(function (c, i) {
      return new MockFile('c' + i, c);
    });

    try {
      await chunkerModule.wdkCombineDecompress(partial, { autoDownload: false });
      assert.fail('should have thrown');
    } catch (e) {
      assert.ok(e.message.includes('missing'), 'should mention missing chunks');
    }
  });

  await test('progress callbacks fire', async function () {
    var original = new Uint8Array(200 * 1024);
    var file = new MockFile('progress.bin', original);

    var progressCalls = [];
    await chunkerModule.wdkChunkCompress(file, {
      chunkSize: 100 * 1024,
      format: 'gzip',
      autoDownload: false,
      onProgress: function (done, total) { progressCalls.push([done, total]); }
    });

    assert.strictEqual(progressCalls.length, 2);
    assert.deepStrictEqual(progressCalls[0], [1, 2]);
    assert.deepStrictEqual(progressCalls[1], [2, 2]);
  });

  await test('single chunk for small files', async function () {
    var small = new Uint8Array(1000);
    var file = new MockFile('tiny.txt', small);

    var result = await chunkerModule.wdkChunkCompress(file, {
      chunkSize: 50 * 1024 * 1024,
      format: 'gzip',
      autoDownload: false
    });

    assert.strictEqual(result.chunks.length, 1);
    assert.strictEqual(result.filenames[0], 'tiny.txt.wdkc.1');
  });

  console.log('\n=== Results ===');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(function (e) { console.error('Runner error:', e); process.exit(1); });
