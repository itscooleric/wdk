/**
 * WDK Compression Module
 * Unified compression/decompression API wrapping fflate, fzstd, and snappyjs.
 *
 * Globals expected: fflate, fzstd, SnappyJS
 *
 * Provides:
 *   - wdkCompress(data, format, options) → Uint8Array
 *   - wdkDecompress(data, format?) → Uint8Array
 *   - wdkDetectFormat(data) → string|null
 */

/* global fflate, fzstd, SnappyJS */

/**
 * Detect compression format from magic bytes.
 * @param {Uint8Array} data
 * @returns {'gzip'|'zlib'|'zstd'|'zip'|'parquet'|'arrow'|null}
 */
function wdkDetectFormat(data) {
  if (!data || data.length < 4) return null;
  // gzip: 1f 8b
  if (data[0] === 0x1f && data[1] === 0x8b) return 'gzip';
  // zlib: 78 01 (level 1), 78 5e (level 2-5), 78 9c (level 6), 78 da (level 9)
  if (data[0] === 0x78 && (data[1] === 0x01 || data[1] === 0x5e || data[1] === 0x9c || data[1] === 0xda)) return 'zlib';
  // zstd: 28 b5 2f fd
  if (data[0] === 0x28 && data[1] === 0xb5 && data[2] === 0x2f && data[3] === 0xfd) return 'zstd';
  // ZIP: 50 4b 03 04
  if (data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04) return 'zip';
  // Parquet: PAR1
  if (data[0] === 0x50 && data[1] === 0x41 && data[2] === 0x52 && data[3] === 0x31) return 'parquet';
  // Arrow IPC: ARROW1
  if (data.length >= 6 && data[0] === 0x41 && data[1] === 0x52 && data[2] === 0x52 &&
      data[3] === 0x4f && data[4] === 0x57 && data[5] === 0x31) return 'arrow';
  return null;
}

/**
 * Decompress data. Auto-detects format if not specified.
 * @param {Uint8Array} data - Compressed bytes
 * @param {'gzip'|'zlib'|'deflate'|'zstd'|'snappy'|'zip'} [format] - Compression format
 * @returns {Uint8Array} Decompressed bytes
 */
function wdkDecompress(data, format) {
  if (!format) {
    format = wdkDetectFormat(data);
    if (!format) throw new Error('wdk-compress: unable to detect compression format');
  }
  if (!(data instanceof Uint8Array)) {
    data = new Uint8Array(data);
  }

  switch (format) {
    case 'gzip':
      return fflate.gunzipSync(data);
    case 'zlib':
      return fflate.unzlibSync(data);
    case 'deflate':
      return fflate.inflateSync(data);
    case 'zstd':
      return fzstd.decompress(data);
    case 'snappy':
      return new Uint8Array(SnappyJS.uncompress(data));
    case 'zip':
      return fflate.unzipSync(data);
    default:
      throw new Error('wdk-compress: unsupported format: ' + format);
  }
}

/**
 * Compress data.
 * @param {Uint8Array} data - Raw bytes
 * @param {'gzip'|'zlib'|'deflate'} [format='gzip'] - Compression format
 * @param {{ level?: number }} [options] - Compression options
 * @returns {Uint8Array} Compressed bytes
 */
function wdkCompress(data, format, options) {
  format = format || 'gzip';
  options = options || {};
  if (!(data instanceof Uint8Array)) {
    data = new Uint8Array(data);
  }
  var level = options.level != null ? options.level : 6;

  switch (format) {
    case 'gzip':
      return fflate.gzipSync(data, { level: level });
    case 'zlib':
      return fflate.zlibSync(data, { level: level });
    case 'deflate':
      return fflate.deflateSync(data, { level: level });
    default:
      throw new Error('wdk-compress: compression not supported for format: ' + format);
  }
}

/**
 * Decompress a compressed text file (e.g., .csv.gz) and return as string.
 * @param {Uint8Array} data - Compressed bytes
 * @param {string} [format] - Compression format (auto-detected if omitted)
 * @returns {string} Decompressed text
 */
function wdkDecompressText(data, format) {
  var bytes = wdkDecompress(data, format);
  return new TextDecoder().decode(bytes);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { wdkDetectFormat: wdkDetectFormat, wdkDecompress: wdkDecompress, wdkCompress: wdkCompress, wdkDecompressText: wdkDecompressText };
}
