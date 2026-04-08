/**
 * Minimal ZIP reader for WDK.
 * Reads ZIP local file headers and extracts entries using the DecompressionStream API.
 * Zero dependencies. Works in modern browsers.
 *
 * Supports:
 *   - Stored files (compression method 0)
 *   - Deflate-compressed files (compression method 8) via DecompressionStream('deflate-raw')
 *
 * Does NOT support: encrypted ZIPs, ZIP64, data descriptors with unknown sizes.
 *
 * @param {ArrayBuffer} arrayBuffer - ZIP file bytes
 * @returns {Promise<Map<string, Uint8Array>>} Map of filename -> decompressed bytes
 */
async function unzip(arrayBuffer) {
  var bytes = new Uint8Array(arrayBuffer);
  var view = new DataView(arrayBuffer);
  var entries = new Map();

  // Walk local file headers starting at offset 0.
  // Local file header signature: 0x04034B50 (little-endian: 50 4B 03 04)
  var offset = 0;

  while (offset + 30 <= bytes.length) {
    var sig = view.getUint32(offset, true);

    // Local file header: PK\x03\x04
    if (sig !== 0x04034B50) {
      // Could be central directory (0x02014B50) or EOCD (0x06054B50) — stop walking.
      break;
    }

    var compression  = view.getUint16(offset + 8,  true);
    var compSize     = view.getUint32(offset + 18, true);
    var uncompSize   = view.getUint32(offset + 22, true);
    var nameLen      = view.getUint16(offset + 26, true);
    var extraLen     = view.getUint16(offset + 28, true);

    var nameBytes = bytes.subarray(offset + 30, offset + 30 + nameLen);
    var filename  = new TextDecoder().decode(nameBytes);

    var dataStart = offset + 30 + nameLen + extraLen;
    var compData  = bytes.subarray(dataStart, dataStart + compSize);

    var decompressed;

    if (compression === 0) {
      // Stored — no compression, copy as-is
      decompressed = compData.slice();
    } else if (compression === 8) {
      // Deflate-raw — use DecompressionStream
      decompressed = await _inflateRaw(compData, uncompSize);
    } else {
      throw new Error('ZIP: unsupported compression method ' + compression + ' in "' + filename + '"');
    }

    entries.set(filename, decompressed);

    offset = dataStart + compSize;
  }

  if (entries.size === 0) {
    throw new Error('ZIP: no entries found — is this a valid ZIP file?');
  }

  return entries;
}

/**
 * Decompress raw deflate data using the browser's DecompressionStream API.
 *
 * @param {Uint8Array} data - Compressed bytes
 * @param {number} [expectedSize] - Expected decompressed size (used to pre-allocate)
 * @returns {Promise<Uint8Array>}
 */
async function _inflateRaw(data, expectedSize) {
  var ds = new DecompressionStream('deflate-raw');
  var writer = ds.writable.getWriter();
  var reader = ds.readable.getReader();

  // Write compressed data then close
  writer.write(data);
  writer.close();

  // Collect output chunks
  var chunks = [];
  var totalLen = 0;

  while (true) {
    var result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    totalLen += result.value.length;
  }

  // Merge into a single Uint8Array
  var out = new Uint8Array(totalLen);
  var pos = 0;
  for (var i = 0; i < chunks.length; i++) {
    out.set(chunks[i], pos);
    pos += chunks[i].length;
  }

  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { unzip: unzip };
}
