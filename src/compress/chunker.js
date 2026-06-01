/**
 * WDK File Chunker — Split & Compress / Combine & Decompress
 *
 * Split: Takes a large file, reads it in chunks via File.slice(), compresses
 * each chunk, and triggers downloads of numbered parts.
 *
 * Combine: Takes multiple chunk files, decompresses each, and concatenates
 * them back into the original file.
 *
 * Globals expected: fflate, fzstd, wdkDetectFormat
 *
 * Provides:
 *   - wdkChunkCompress(file, options) → downloads numbered chunk files
 *   - wdkCombineDecompress(files, options) → Promise<Blob>
 *   - createChunkerUI(container) → chunker/combiner UI panel
 */

/* global fflate, fzstd, wdkDetectFormat, wdkDecompress, wdkCompress */

var WDK_CHUNK_MAGIC = 'WDKC';  // 4-byte header identifying WDK chunk files
var WDK_CHUNK_VERSION = 1;

/**
 * Build a WDK chunk header.
 * Layout: WDKC (4) + version (1) + compression (1) + chunk_index (4 LE) +
 *         total_chunks (4 LE) + original_name_len (2 LE) + original_name (var) +
 *         uncompressed_size (4 LE) + compressed_size (4 LE)
 *
 * @param {Object} meta
 * @returns {Uint8Array}
 */
function _buildChunkHeader(meta) {
  var nameBytes = new TextEncoder().encode(meta.originalName);
  var headerSize = 4 + 1 + 1 + 4 + 4 + 2 + nameBytes.length + 4 + 4;
  var buf = new Uint8Array(headerSize);
  var view = new DataView(buf.buffer);
  // Magic
  buf[0] = 0x57; buf[1] = 0x44; buf[2] = 0x4B; buf[3] = 0x43; // WDKC
  buf[4] = WDK_CHUNK_VERSION;
  // Compression: 0=none, 1=gzip, 2=zstd
  buf[5] = meta.compression;
  view.setUint32(6, meta.chunkIndex, true);
  view.setUint32(10, meta.totalChunks, true);
  view.setUint16(14, nameBytes.length, true);
  buf.set(nameBytes, 16);
  var offset = 16 + nameBytes.length;
  view.setUint32(offset, meta.uncompressedSize, true);
  view.setUint32(offset + 4, meta.compressedSize, true);
  return buf;
}

/**
 * Parse a WDK chunk header.
 * @param {Uint8Array} data
 * @returns {{ headerSize: number, version: number, compression: number, chunkIndex: number, totalChunks: number, originalName: string, uncompressedSize: number, compressedSize: number }}
 */
function _parseChunkHeader(data) {
  if (data.length < 16) throw new Error('wdk-chunk: file too small for header');
  if (data[0] !== 0x57 || data[1] !== 0x44 || data[2] !== 0x4B || data[3] !== 0x43) {
    throw new Error('wdk-chunk: not a WDK chunk file (missing WDKC magic)');
  }
  var view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  var version = data[4];
  var compression = data[5];
  var chunkIndex = view.getUint32(6, true);
  var totalChunks = view.getUint32(10, true);
  var nameLen = view.getUint16(14, true);
  var originalName = new TextDecoder().decode(data.subarray(16, 16 + nameLen));
  var offset = 16 + nameLen;
  var uncompressedSize = view.getUint32(offset, true);
  var compressedSize = view.getUint32(offset + 4, true);
  return {
    headerSize: offset + 8,
    version: version,
    compression: compression,
    chunkIndex: chunkIndex,
    totalChunks: totalChunks,
    originalName: originalName,
    uncompressedSize: uncompressedSize,
    compressedSize: compressedSize
  };
}

/**
 * Trigger a browser file download.
 * @param {Uint8Array|Blob} data
 * @param {string} filename
 */
function _downloadFile(data, filename) {
  var blob = data instanceof Blob ? data : new Blob([data]);
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
}

/**
 * Split a file into compressed chunks and download each.
 *
 * @param {File} file - The file to split
 * @param {{ chunkSize?: number, format?: 'gzip'|'none', onProgress?: function(number, number): void, autoDownload?: boolean }} [options]
 * @returns {Promise<{ chunks: Uint8Array[], filenames: string[] }>}
 */
async function wdkChunkCompress(file, options) {
  options = options || {};
  var chunkSize = options.chunkSize || (50 * 1024 * 1024); // 50 MB default
  var format = options.format || 'gzip';
  var autoDownload = options.autoDownload !== false;
  var compressionCode = format === 'gzip' ? 1 : format === 'zstd' ? 2 : 0;

  var totalChunks = Math.ceil(file.size / chunkSize);
  if (totalChunks === 0) totalChunks = 1;

  var chunks = [];
  var filenames = [];

  for (var i = 0; i < totalChunks; i++) {
    var start = i * chunkSize;
    var end = Math.min(start + chunkSize, file.size);
    var blob = file.slice(start, end);
    var rawBuf = await blob.arrayBuffer();
    var raw = new Uint8Array(rawBuf);

    // Compress the chunk
    var compressed;
    if (format === 'gzip') {
      compressed = fflate.gzipSync(raw);
    } else if (format === 'zstd' && typeof wdkCompress === 'function') {
      // zstd compression requires zstd-codec addon
      compressed = wdkCompress(raw, 'zstd');
    } else {
      compressed = raw; // no compression
    }

    // Build chunk with header
    var header = _buildChunkHeader({
      originalName: file.name,
      compression: compressionCode,
      chunkIndex: i,
      totalChunks: totalChunks,
      uncompressedSize: raw.length,
      compressedSize: compressed.length
    });

    var chunk = new Uint8Array(header.length + compressed.length);
    chunk.set(header, 0);
    chunk.set(compressed, header.length);

    // Pad chunk index for sorting: 001, 002, etc.
    var pad = String(i + 1);
    while (pad.length < String(totalChunks).length) pad = '0' + pad;
    var chunkName = file.name + '.wdkc.' + pad;

    chunks.push(chunk);
    filenames.push(chunkName);

    if (autoDownload) {
      _downloadFile(chunk, chunkName);
    }

    if (options.onProgress) {
      options.onProgress(i + 1, totalChunks);
    }
  }

  return { chunks: chunks, filenames: filenames };
}

/**
 * Combine chunk files back into the original file.
 *
 * @param {File[]|FileList} files - The .wdkc chunk files (any order)
 * @param {{ onProgress?: function(number, number): void, autoDownload?: boolean }} [options]
 * @returns {Promise<{ blob: Blob, filename: string, totalSize: number }>}
 */
async function wdkCombineDecompress(files, options) {
  options = options || {};
  var autoDownload = options.autoDownload !== false;

  // Read all chunk files
  var chunkEntries = [];
  for (var i = 0; i < files.length; i++) {
    var buf = await files[i].arrayBuffer();
    var data = new Uint8Array(buf);
    var meta = _parseChunkHeader(data);
    var compressedData = data.subarray(meta.headerSize);

    // Decompress
    var decompressed;
    if (meta.compression === 1) {
      decompressed = fflate.gunzipSync(compressedData);
    } else if (meta.compression === 2) {
      decompressed = fzstd.decompress(compressedData);
    } else {
      decompressed = compressedData;
    }

    chunkEntries.push({
      index: meta.chunkIndex,
      totalChunks: meta.totalChunks,
      originalName: meta.originalName,
      data: decompressed
    });
  }

  // Sort by chunk index
  chunkEntries.sort(function (a, b) { return a.index - b.index; });

  // Validate completeness
  var totalExpected = chunkEntries[0].totalChunks;
  var originalName = chunkEntries[0].originalName;
  var missing = [];
  for (var j = 0; j < totalExpected; j++) {
    var found = false;
    for (var k = 0; k < chunkEntries.length; k++) {
      if (chunkEntries[k].index === j) { found = true; break; }
    }
    if (!found) missing.push(j + 1);
  }
  if (missing.length > 0) {
    throw new Error('wdk-chunk: missing chunk(s): ' + missing.join(', ') + ' of ' + totalExpected);
  }

  // Concatenate
  var totalSize = 0;
  for (var m = 0; m < chunkEntries.length; m++) totalSize += chunkEntries[m].data.length;

  var result = new Uint8Array(totalSize);
  var offset = 0;
  for (var n = 0; n < chunkEntries.length; n++) {
    result.set(chunkEntries[n].data, offset);
    offset += chunkEntries[n].data.length;
    if (options.onProgress) {
      options.onProgress(n + 1, chunkEntries.length);
    }
  }

  var blob = new Blob([result]);

  if (autoDownload) {
    _downloadFile(result, originalName);
  }

  return { blob: blob, filename: originalName, totalSize: totalSize };
}

/**
 * Create a Chunker/Combiner UI panel.
 * @param {HTMLElement} container
 * @returns {{ destroy: function }}
 */
function createChunkerUI(container) {
  var T = {
    bg: '#0a0a1a', bgHover: '#12122a', cyan: '#00e5ff', pink: '#ff2975',
    purple: '#b967ff', text: '#e0e0f0', textDim: '#8888aa', border: '#2a2a4a'
  };

  var panel = document.createElement('div');
  panel.style.cssText = 'font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:13px;color:' + T.text + ';background:' + T.bg + ';border:1px solid ' + T.border + ';border-radius:8px;padding:16px;margin-top:12px;';

  panel.innerHTML = [
    '<div style="font-size:15px;font-weight:700;margin-bottom:12px;background:linear-gradient(90deg,' + T.cyan + ',' + T.purple + ');-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;">File Chunker</div>',
    '<div style="display:flex;gap:8px;margin-bottom:12px;">',
    '  <button id="wdk-chunk-tab-split" style="padding:6px 14px;background:' + T.bgHover + ';border:1px solid ' + T.cyan + ';border-radius:4px;color:' + T.cyan + ';cursor:pointer;font-family:inherit;font-size:12px;">Split & Compress</button>',
    '  <button id="wdk-chunk-tab-combine" style="padding:6px 14px;background:' + T.bgHover + ';border:1px solid ' + T.border + ';border-radius:4px;color:' + T.textDim + ';cursor:pointer;font-family:inherit;font-size:12px;">Combine & Decompress</button>',
    '</div>',
    // Split panel
    '<div id="wdk-chunk-split">',
    '  <div style="margin-bottom:8px;color:' + T.textDim + ';">Select a large file to split into compressed chunks:</div>',
    '  <input type="file" id="wdk-chunk-split-input" style="margin-bottom:8px;color:' + T.text + ';font-family:inherit;">',
    '  <div style="display:flex;gap:12px;align-items:center;margin-bottom:8px;">',
    '    <label style="color:' + T.textDim + ';">Chunk size:</label>',
    '    <select id="wdk-chunk-size" style="background:' + T.bgHover + ';color:' + T.text + ';border:1px solid ' + T.border + ';border-radius:4px;padding:4px 8px;font-family:inherit;">',
    '      <option value="10">10 MB</option>',
    '      <option value="25">25 MB</option>',
    '      <option value="50" selected>50 MB</option>',
    '      <option value="100">100 MB</option>',
    '      <option value="250">250 MB</option>',
    '      <option value="500">500 MB</option>',
    '    </select>',
    '    <label style="color:' + T.textDim + ';">Compression:</label>',
    '    <select id="wdk-chunk-format" style="background:' + T.bgHover + ';color:' + T.text + ';border:1px solid ' + T.border + ';border-radius:4px;padding:4px 8px;font-family:inherit;">',
    '      <option value="gzip" selected>gzip</option>',
    '      <option value="none">none (split only)</option>',
    '    </select>',
    '  </div>',
    '  <button id="wdk-chunk-split-btn" style="padding:8px 20px;background:linear-gradient(135deg,' + T.cyan + ',' + T.purple + ');border:none;border-radius:4px;color:#000;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;">Split & Download Chunks</button>',
    '  <div id="wdk-chunk-split-status" style="margin-top:8px;color:' + T.textDim + ';"></div>',
    '</div>',
    // Combine panel (hidden initially)
    '<div id="wdk-chunk-combine" style="display:none;">',
    '  <div style="margin-bottom:8px;color:' + T.textDim + ';">Select all .wdkc chunk files to reassemble:</div>',
    '  <input type="file" id="wdk-chunk-combine-input" multiple style="margin-bottom:8px;color:' + T.text + ';font-family:inherit;">',
    '  <button id="wdk-chunk-combine-btn" style="padding:8px 20px;background:linear-gradient(135deg,' + T.pink + ',' + T.purple + ');border:none;border-radius:4px;color:#fff;font-weight:700;cursor:pointer;font-family:inherit;font-size:13px;">Combine & Download</button>',
    '  <div id="wdk-chunk-combine-status" style="margin-top:8px;color:' + T.textDim + ';"></div>',
    '</div>'
  ].join('\n');

  container.appendChild(panel);

  // Tab switching
  var splitTab = panel.querySelector('#wdk-chunk-tab-split');
  var combineTab = panel.querySelector('#wdk-chunk-tab-combine');
  var splitPanel = panel.querySelector('#wdk-chunk-split');
  var combinePanel = panel.querySelector('#wdk-chunk-combine');

  splitTab.onclick = function () {
    splitPanel.style.display = '';
    combinePanel.style.display = 'none';
    splitTab.style.borderColor = T.cyan;
    splitTab.style.color = T.cyan;
    combineTab.style.borderColor = T.border;
    combineTab.style.color = T.textDim;
  };
  combineTab.onclick = function () {
    splitPanel.style.display = 'none';
    combinePanel.style.display = '';
    combineTab.style.borderColor = T.pink;
    combineTab.style.color = T.pink;
    splitTab.style.borderColor = T.border;
    splitTab.style.color = T.textDim;
  };

  // Split action
  panel.querySelector('#wdk-chunk-split-btn').onclick = async function () {
    var input = panel.querySelector('#wdk-chunk-split-input');
    if (!input.files || !input.files[0]) {
      panel.querySelector('#wdk-chunk-split-status').textContent = 'No file selected.';
      return;
    }
    var file = input.files[0];
    var chunkMB = parseInt(panel.querySelector('#wdk-chunk-size').value);
    var format = panel.querySelector('#wdk-chunk-format').value;
    var status = panel.querySelector('#wdk-chunk-split-status');

    var totalChunks = Math.ceil(file.size / (chunkMB * 1024 * 1024));
    status.textContent = 'Splitting ' + file.name + ' (' + (file.size / 1024 / 1024).toFixed(1) + ' MB) into ' + totalChunks + ' chunks...';

    try {
      var result = await wdkChunkCompress(file, {
        chunkSize: chunkMB * 1024 * 1024,
        format: format,
        onProgress: function (done, total) {
          status.textContent = 'Chunk ' + done + '/' + total + ' compressed and downloading...';
        }
      });
      status.textContent = 'Done! ' + result.filenames.length + ' chunks downloaded. To reassemble: switch to Combine tab and select all .wdkc files.';
      status.style.color = T.cyan;
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.style.color = T.pink;
    }
  };

  // Combine action
  panel.querySelector('#wdk-chunk-combine-btn').onclick = async function () {
    var input = panel.querySelector('#wdk-chunk-combine-input');
    if (!input.files || input.files.length === 0) {
      panel.querySelector('#wdk-chunk-combine-status').textContent = 'No files selected.';
      return;
    }
    var status = panel.querySelector('#wdk-chunk-combine-status');
    status.textContent = 'Reading ' + input.files.length + ' chunk files...';
    status.style.color = T.textDim;

    try {
      var result = await wdkCombineDecompress(input.files, {
        onProgress: function (done, total) {
          status.textContent = 'Decompressing chunk ' + done + '/' + total + '...';
        }
      });
      status.textContent = 'Done! Reassembled ' + result.filename + ' (' + (result.totalSize / 1024 / 1024).toFixed(1) + ' MB). Download started.';
      status.style.color = T.cyan;
    } catch (e) {
      status.textContent = 'Error: ' + e.message;
      status.style.color = T.pink;
    }
  };

  return {
    destroy: function () {
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    wdkChunkCompress: wdkChunkCompress,
    wdkCombineDecompress: wdkCombineDecompress,
    createChunkerUI: createChunkerUI,
    _buildChunkHeader: _buildChunkHeader,
    _parseChunkHeader: _parseChunkHeader
  };
}
