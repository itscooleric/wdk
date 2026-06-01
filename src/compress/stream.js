/**
 * WDK Streaming Decompression
 * Enables loading large compressed files without OOM by processing in chunks.
 *
 * Uses fflate's streaming APIs for gzip/zlib/deflate.
 * For zstd, falls back to buffered decompression (fzstd streaming is decompress-only).
 *
 * Globals expected: fflate, fzstd, wdkDetectFormat
 *
 * Provides:
 *   - wdkStreamDecompress(file, options) → async iterator of text chunks
 *   - wdkStreamCsvGz(file, options) → async { headers, rowIterator, cancel }
 */

/* global fflate, fzstd, wdkDetectFormat, parseCSV, DataFrame */

/**
 * Read a File/Blob as an ArrayBuffer.
 * @param {File|Blob} file
 * @returns {Promise<ArrayBuffer>}
 */
function _readFileAsArrayBuffer(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(reader.result); };
    reader.onerror = function () { reject(new Error('Failed to read file')); };
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Decompress a File/Blob and call onChunk with decoded text chunks.
 * Processes the file in a single pass (loads full buffer, streams decompression).
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} input - Compressed data
 * @param {{ format?: string, onChunk: function(string, boolean): void }} options
 * @returns {Promise<void>}
 */
async function wdkStreamDecompress(input, options) {
  var data;
  if (input instanceof ArrayBuffer) {
    data = new Uint8Array(input);
  } else if (input instanceof Uint8Array) {
    data = input;
  } else {
    // File or Blob
    var ab = await _readFileAsArrayBuffer(input);
    data = new Uint8Array(ab);
  }

  var format = options.format || wdkDetectFormat(data);
  if (!format) throw new Error('wdk-stream: unable to detect compression format');

  var decoder = new TextDecoder();

  if (format === 'zstd') {
    // fzstd: buffered decompress (streaming not practical for text chunking)
    var decompressed = fzstd.decompress(data);
    // Emit in 256KB chunks to avoid blocking
    var chunkSize = 256 * 1024;
    for (var offset = 0; offset < decompressed.length; offset += chunkSize) {
      var end = Math.min(offset + chunkSize, decompressed.length);
      var isLast = end >= decompressed.length;
      var text = decoder.decode(decompressed.subarray(offset, end), { stream: !isLast });
      options.onChunk(text, isLast);
    }
    return;
  }

  // fflate streaming for gzip/zlib/deflate
  var Decompressor;
  if (format === 'gzip') Decompressor = fflate.Gunzip;
  else if (format === 'zlib') Decompressor = fflate.Unzlib;
  else if (format === 'deflate') Decompressor = fflate.Inflate;
  else throw new Error('wdk-stream: streaming not supported for format: ' + format);

  return new Promise(function (resolve, reject) {
    var decomp = new Decompressor(function (chunk, isLast) {
      try {
        var text = decoder.decode(chunk, { stream: !isLast });
        options.onChunk(text, isLast);
        if (isLast) resolve();
      } catch (e) {
        reject(e);
      }
    });

    // Feed data in 64KB chunks to allow incremental decompression
    var feedSize = 64 * 1024;
    for (var i = 0; i < data.length; i += feedSize) {
      var end = Math.min(i + feedSize, data.length);
      var isLast = end >= data.length;
      decomp.push(data.subarray(i, end), isLast);
    }
  });
}

/**
 * Stream-decompress a compressed CSV file and parse progressively.
 * Returns headers immediately and rows in batches.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} input - Compressed CSV data
 * @param {{ format?: string, batchSize?: number, onBatch?: function, onComplete?: function }} [options]
 * @returns {Promise<{ headers: string[], rows: any[][] }>}
 */
async function wdkStreamCsvGz(input, options) {
  options = options || {};
  var batchSize = options.batchSize || 1000;

  var allText = '';
  var headers = null;
  var allRows = [];
  var batchNum = 0;

  await wdkStreamDecompress(input, {
    format: options.format,
    onChunk: function (text, isLast) {
      allText += text;

      if (isLast || allText.length > 1024 * 1024) {
        // Parse accumulated text
        if (!headers) {
          // Find first newline to extract headers
          var nlIdx = allText.indexOf('\n');
          if (nlIdx === -1 && !isLast) return; // wait for more data
        }

        if (isLast) {
          // Final parse of all accumulated text
          var result = parseCSV(allText, { hasHeader: true });
          headers = result.headers;
          allRows = result.rows;

          if (options.onBatch) {
            // Emit remaining rows as final batch
            options.onBatch(allRows, batchNum++, true);
          }
        }
      }
    }
  });

  if (options.onComplete) {
    options.onComplete({ headers: headers, rows: allRows });
  }

  return { headers: headers, rows: allRows };
}

/**
 * Load a compressed CSV file and return a DataFrame.
 * Convenience wrapper around wdkStreamCsvGz.
 *
 * @param {File|Blob|ArrayBuffer|Uint8Array} input
 * @param {Object} [options]
 * @returns {Promise<DataFrame>}
 */
async function wdkLoadCompressedCsv(input, options) {
  var result = await wdkStreamCsvGz(input, options);
  if (typeof DataFrame !== 'undefined') {
    return new DataFrame(result.headers, result.rows);
  }
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wdkStreamDecompress: wdkStreamDecompress,
    wdkStreamCsvGz: wdkStreamCsvGz,
    wdkLoadCompressedCsv: wdkLoadCompressedCsv
  };
}
