/**
 * WDK Parquet Reader
 * Reads Parquet files using hyparquet with fflate (gzip) and fzstd (zstd) codecs.
 * hyparquet includes a built-in Snappy decompressor.
 *
 * Globals expected: hyparquet, fflate, fzstd
 *
 * Provides:
 *   - readParquetMetadata(arrayBuffer) → metadata object
 *   - readParquetFile(arrayBuffer) → Promise<{ headers, rows, metadata }>
 *   - readParquetToDataFrame(arrayBuffer) → Promise<DataFrame>
 */

/* global hyparquet, fflate, fzstd, DataFrame */

/**
 * Build compressors map for hyparquet using our vendor libs.
 * @returns {Object} compressors map
 */
function _buildCompressors() {
  return {
    SNAPPY: hyparquet.snappyUncompress,
    GZIP: function (input, outputLength) {
      return fflate.gunzipSync(input);
    },
    ZSTD: function (input) {
      return fzstd.decompress(input);
    }
  };
}

/**
 * Read Parquet file metadata without loading data.
 * @param {ArrayBuffer} arrayBuffer - Parquet file bytes
 * @returns {{ schema: Array, rowCount: number, rowGroups: number, createdBy: string }}
 */
function readParquetMetadata(arrayBuffer) {
  var metadata = hyparquet.parquetMetadata(arrayBuffer);
  var schema = hyparquet.parquetSchema(metadata);

  // Extract column info from schema
  var columns = [];
  if (schema && schema.children) {
    for (var i = 0; i < schema.children.length; i++) {
      var col = schema.children[i];
      columns.push({
        name: col.element.name,
        type: col.element.type || 'unknown',
        convertedType: col.element.converted_type || null,
        logicalType: col.element.logicalType || null
      });
    }
  }

  return {
    schema: columns,
    rowCount: metadata.num_rows || 0,
    rowGroups: (metadata.row_groups || []).length,
    createdBy: metadata.created_by || 'unknown',
    _raw: metadata
  };
}

/**
 * Read a Parquet file and return headers + rows.
 * @param {ArrayBuffer} arrayBuffer - Parquet file bytes
 * @param {{ columns?: string[], rowStart?: number, rowEnd?: number }} [options]
 * @returns {Promise<{ headers: string[], rows: any[][], metadata: Object }>}
 */
async function readParquetFile(arrayBuffer, options) {
  options = options || {};
  var metadata = readParquetMetadata(arrayBuffer);
  var compressors = _buildCompressors();

  var readOptions = {
    file: arrayBuffer,
    compressors: compressors
  };

  if (options.columns) {
    readOptions.columns = options.columns;
  }

  var data = [];
  readOptions.onComplete = function (result) {
    data = result;
  };

  await hyparquet.parquetRead(readOptions);

  // data is array of row objects
  if (!data || data.length === 0) {
    return { headers: metadata.schema.map(function (c) { return c.name; }), rows: [], metadata: metadata };
  }

  // Extract headers from first row
  var headers = Object.keys(data[0]);
  if (options.columns) {
    headers = options.columns;
  }

  // Convert objects to row arrays
  var rows = [];
  var start = options.rowStart || 0;
  var end = options.rowEnd != null ? Math.min(options.rowEnd, data.length) : data.length;
  for (var i = start; i < end; i++) {
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      var val = data[i][headers[j]];
      // Convert BigInt to number for display
      if (typeof val === 'bigint') {
        val = Number(val);
      }
      // Format Date objects
      if (val instanceof Date) {
        val = val.toISOString();
      }
      row.push(val != null ? val : null);
    }
    rows.push(row);
  }

  return { headers: headers, rows: rows, metadata: metadata };
}

/**
 * Read a Parquet file and return a DataFrame (if DataFrame is available).
 * @param {ArrayBuffer} arrayBuffer - Parquet file bytes
 * @param {Object} [options]
 * @returns {Promise<DataFrame>}
 */
async function readParquetToDataFrame(arrayBuffer, options) {
  var result = await readParquetFile(arrayBuffer, options);
  if (typeof DataFrame !== 'undefined') {
    return new DataFrame(result.headers, result.rows);
  }
  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readParquetMetadata: readParquetMetadata, readParquetFile: readParquetFile, readParquetToDataFrame: readParquetToDataFrame };
}
