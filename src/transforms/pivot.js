/**
 * WDK pivot / aggregation engine.
 * Provides groupBy, aggregate, and pivot table operations on DataFrames.
 * Zero dependencies.
 */

/**
 * Group rows by one or more columns.
 * @param {object} df - DataFrame with _headers and _rows
 * @param {string[]} groupCols - Column names to group by
 * @returns {Map<string, any[][]>} Map of group key → array of rows
 */
function groupBy(df, groupCols) {
  var indices = groupCols.map(function (name) {
    var idx = df._headers.indexOf(name);
    if (idx === -1) throw new Error('Column "' + name + '" not found');
    return idx;
  });

  var groups = new Map();
  for (var i = 0; i < df._rows.length; i++) {
    var row = df._rows[i];
    var key = indices.map(function (idx) { return String(row[idx]); }).join('\x00');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/**
 * Parse a numeric value from a cell, returning NaN for non-numeric.
 */
function toNum(val) {
  if (val === null || val === undefined || val === '') return NaN;
  var n = Number(val);
  return n;
}

/**
 * Built-in aggregation functions.
 */
var AGG_FUNCS = {
  count: function (vals) { return vals.length; },
  sum: function (vals) {
    var s = 0, c = 0;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n)) { s += n; c++; }
    }
    return c > 0 ? s : 0;
  },
  avg: function (vals) {
    var s = 0, c = 0;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n)) { s += n; c++; }
    }
    return c > 0 ? (s / c) : 0;
  },
  min: function (vals) {
    var m = Infinity;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n) && n < m) m = n;
    }
    return m === Infinity ? '' : m;
  },
  max: function (vals) {
    var m = -Infinity;
    for (var i = 0; i < vals.length; i++) {
      var n = toNum(vals[i]);
      if (!isNaN(n) && n > m) m = n;
    }
    return m === -Infinity ? '' : m;
  },
  distinct: function (vals) {
    var seen = new Set();
    for (var i = 0; i < vals.length; i++) seen.add(String(vals[i]));
    return seen.size;
  },
  first: function (vals) { return vals.length > 0 ? vals[0] : ''; },
  last: function (vals) { return vals.length > 0 ? vals[vals.length - 1] : ''; },
  concat: function (vals) {
    var seen = new Set();
    var result = [];
    for (var i = 0; i < vals.length; i++) {
      var s = String(vals[i]);
      if (!seen.has(s)) { seen.add(s); result.push(s); }
    }
    return result.join(', ');
  }
};

/**
 * Aggregate a DataFrame by grouping columns with specified aggregations.
 *
 * @param {object} df - DataFrame with _headers and _rows
 * @param {string[]} groupCols - Columns to group by
 * @param {Array<{column: string, func: string, alias?: string}>} aggs - Aggregations to apply
 * @returns {{headers: string[], rows: any[][]}}
 */
function aggregate(df, groupCols, aggs) {
  var groups = groupBy(df, groupCols);
  var groupIndices = groupCols.map(function (name) { return df._headers.indexOf(name); });
  var aggSpecs = aggs.map(function (a) {
    var idx = df._headers.indexOf(a.column);
    if (idx === -1 && a.func !== 'count') throw new Error('Column "' + a.column + '" not found');
    var fn = AGG_FUNCS[a.func];
    if (!fn) throw new Error('Unknown aggregation: ' + a.func);
    return { idx: idx, fn: fn, alias: a.alias || (a.column + '_' + a.func) };
  });

  var headers = groupCols.concat(aggSpecs.map(function (s) { return s.alias; }));
  var rows = [];

  groups.forEach(function (groupRows, key) {
    var row = key.split('\x00');
    for (var a = 0; a < aggSpecs.length; a++) {
      var spec = aggSpecs[a];
      var vals;
      if (spec.idx === -1) {
        vals = groupRows; // count uses row array directly
      } else {
        vals = groupRows.map(function (r) { return r[spec.idx]; });
      }
      row.push(spec.fn(vals));
    }
    rows.push(row);
  });

  return { headers: headers, rows: rows };
}

/**
 * Pivot table: group by row columns, spread a pivot column's values across new columns,
 * and fill cells with an aggregation of a value column.
 *
 * @param {object} df - DataFrame with _headers and _rows
 * @param {string[]} rowCols - Row grouping columns (left side)
 * @param {string} pivotCol - Column whose distinct values become new columns
 * @param {string} valueCol - Column to aggregate in each cell
 * @param {string} aggFunc - Aggregation function name (sum, count, avg, etc.)
 * @returns {{headers: string[], rows: any[][]}}
 */
function pivot(df, rowCols, pivotCol, valueCol, aggFunc) {
  var pivotIdx = df._headers.indexOf(pivotCol);
  if (pivotIdx === -1) throw new Error('Pivot column "' + pivotCol + '" not found');
  var valueIdx = df._headers.indexOf(valueCol);
  if (valueIdx === -1) throw new Error('Value column "' + valueCol + '" not found');
  var fn = AGG_FUNCS[aggFunc];
  if (!fn) throw new Error('Unknown aggregation: ' + aggFunc);

  var rowIndices = rowCols.map(function (name) {
    var idx = df._headers.indexOf(name);
    if (idx === -1) throw new Error('Column "' + name + '" not found');
    return idx;
  });

  // Collect distinct pivot values in order of appearance
  var pivotValues = [];
  var pivotSet = new Set();
  for (var i = 0; i < df._rows.length; i++) {
    var pv = String(df._rows[i][pivotIdx]);
    if (!pivotSet.has(pv)) { pivotSet.add(pv); pivotValues.push(pv); }
  }

  // Group by rowCols + pivotCol
  var buckets = new Map();
  for (var i = 0; i < df._rows.length; i++) {
    var row = df._rows[i];
    var rowKey = rowIndices.map(function (idx) { return String(row[idx]); }).join('\x00');
    var pv = String(row[pivotIdx]);
    var bKey = rowKey + '\x01' + pv;
    if (!buckets.has(bKey)) buckets.set(bKey, { rowKey: rowKey, rowVals: rowIndices.map(function (idx) { return row[idx]; }), vals: [] });
    buckets.get(bKey).vals.push(row[valueIdx]);
  }

  // Build output: rowCols + one column per pivot value
  var headers = rowCols.concat(pivotValues);
  var rowMap = new Map();

  buckets.forEach(function (bucket) {
    if (!rowMap.has(bucket.rowKey)) {
      var outRow = bucket.rowVals.slice();
      for (var p = 0; p < pivotValues.length; p++) outRow.push('');
      rowMap.set(bucket.rowKey, outRow);
    }
  });

  buckets.forEach(function (bucket, bKey) {
    var parts = bKey.split('\x01');
    var rowKey = parts[0];
    var pv = parts[1];
    var colIdx = rowCols.length + pivotValues.indexOf(pv);
    var outRow = rowMap.get(rowKey);
    outRow[colIdx] = fn(bucket.vals);
  });

  var rows = [];
  rowMap.forEach(function (row) { rows.push(row); });

  return { headers: headers, rows: rows };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { groupBy: groupBy, aggregate: aggregate, pivot: pivot, AGG_FUNCS: AGG_FUNCS };
}
