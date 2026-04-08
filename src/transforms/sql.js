/**
 * WDK SQL engine — lightweight SQL SELECT parser + executor against DataFrames.
 * Supports: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT, aliases, *, COUNT/SUM/AVG/MIN/MAX.
 * Window functions: ROW_NUMBER, RANK, LAG, LEAD, SUM OVER, AVG OVER, COUNT OVER.
 * Zero dependencies. Not a full SQL parser — covers analyst use cases.
 */

/**
 * Execute a SQL SELECT query against a map of named DataFrames.
 * @param {string} sql - SQL query string
 * @param {object} tables - Map of table name → {_headers, _rows}
 * @returns {{headers: string[], rows: any[][]}}
 */
function execSQL(sql, tables) {
  var parsed = parseSelect(sql);
  var df = tables[parsed.from];
  if (!df) throw new Error('Table "' + parsed.from + '" not found. Available: ' + Object.keys(tables).join(', '));

  var headers, rows;

  if (parsed.joins && parsed.joins.length > 0) {
    var fromAlias = parsed.fromAlias ? parsed.fromAlias : parsed.from;
    var merged = buildJoinedResult(df, fromAlias, parsed.joins, tables);
    headers = merged.headers;
    rows = merged.rows;
  } else {
    headers = df._headers;
    rows = df._rows;
  }

  // WHERE
  if (parsed.where) {
    var whereFn = compileWhere(parsed.where, headers);
    rows = rows.filter(whereFn);
  }

  // GROUP BY
  if (parsed.groupBy.length > 0 || hasAggregates(parsed.columns)) {
    return execGrouped(parsed, headers, rows);
  }

  // Separate window columns from regular columns
  var windowCols = parsed.columns.filter(function (c) { return c.type === 'window'; });
  var regularCols = parsed.columns.filter(function (c) { return c.type !== 'window'; });

  // SELECT regular columns
  var colSpecs = resolveColumns(regularCols, headers);

  // ORDER BY (applied to source rows before projection)
  if (parsed.orderBy.length > 0) {
    rows = applyOrderBy(rows, parsed.orderBy, headers);
  }

  // Project regular columns
  var outHeaders = colSpecs.map(function (c) { return c.alias; });
  var outRows = rows.map(function (row) {
    return colSpecs.map(function (c) { return row[c.idx]; });
  });

  // Window functions — post-process on source rows, then append columns
  if (windowCols.length > 0) {
    var winResult = applyWindowFunctions(rows, headers, windowCols);
    // Append window column headers
    winResult.headers.forEach(function (h) { outHeaders.push(h); });
    // Append window column values per row
    for (var i = 0; i < outRows.length; i++) {
      winResult.columns.forEach(function (col) {
        outRows[i].push(col[i]);
      });
    }
  }

  // LIMIT
  if (parsed.limit !== null) {
    outRows = outRows.slice(0, parsed.limit);
  }

  return { headers: outHeaders, rows: outRows };
}

// ─── JOIN executor ─────────────────────────────────────────────────────

/**
 * Build a flat joined result from the primary DataFrame + list of join specs.
 * All headers in the result use "alias.col" notation.
 */
function buildJoinedResult(leftDf, leftAlias, joins, tables) {
  var currentHeaders = leftDf._headers.map(function (h) { return leftAlias + '.' + h; });
  var currentRows = leftDf._rows.map(function (r) { return r.slice(); });

  for (var j = 0; j < joins.length; j++) {
    var joinSpec = joins[j];
    var rightTableName = joinSpec.table;
    var rightAlias = joinSpec.alias ? joinSpec.alias : rightTableName;
    var rightDf = tables[rightTableName];
    if (!rightDf) throw new Error('JOIN: table "' + rightTableName + '" not found. Available: ' + Object.keys(tables).join(', '));

    var rightHeaders = rightDf._headers.map(function (h) { return rightAlias + '.' + h; });
    var rightRows = rightDf._rows;
    var joinType = joinSpec.type;

    var mergedHeaders = currentHeaders.concat(rightHeaders);
    var nullRight = rightHeaders.map(function () { return null; });
    var nullLeft = currentHeaders.map(function () { return null; });
    var mergedRows = [];

    if (joinType === 'cross') {
      for (var li = 0; li < currentRows.length; li++) {
        for (var ri = 0; ri < rightRows.length; ri++) {
          mergedRows.push(currentRows[li].concat(rightRows[ri]));
        }
      }
    } else {
      // Resolve ON predicate indices into the merged header space
      var onPreds = joinSpec.on.map(function (pred) {
        var lIdx = mergedHeaders.indexOf(pred.left);
        var rIdx = mergedHeaders.indexOf(pred.right);
        if (lIdx === -1) throw new Error('JOIN ON: column "' + pred.left + '" not found in joined columns');
        if (rIdx === -1) throw new Error('JOIN ON: column "' + pred.right + '" not found in joined columns');
        return { lIdx: lIdx, rIdx: rIdx };
      });

      function rowsMatch(combined) {
        for (var p = 0; p < onPreds.length; p++) {
          if (combined[onPreds[p].lIdx] !== combined[onPreds[p].rIdx]) return false;
        }
        return true;
      }

      if (joinType === 'inner') {
        for (var li = 0; li < currentRows.length; li++) {
          for (var ri = 0; ri < rightRows.length; ri++) {
            var combined = currentRows[li].concat(rightRows[ri]);
            if (rowsMatch(combined)) mergedRows.push(combined);
          }
        }
      } else if (joinType === 'left') {
        for (var li = 0; li < currentRows.length; li++) {
          var leftMatched = false;
          for (var ri = 0; ri < rightRows.length; ri++) {
            var combined = currentRows[li].concat(rightRows[ri]);
            if (rowsMatch(combined)) { mergedRows.push(combined); leftMatched = true; }
          }
          if (!leftMatched) mergedRows.push(currentRows[li].concat(nullRight));
        }
      } else if (joinType === 'right') {
        for (var ri = 0; ri < rightRows.length; ri++) {
          var rightMatched = false;
          for (var li = 0; li < currentRows.length; li++) {
            var combined = currentRows[li].concat(rightRows[ri]);
            if (rowsMatch(combined)) { mergedRows.push(combined); rightMatched = true; }
          }
          if (!rightMatched) mergedRows.push(nullLeft.concat(rightRows[ri]));
        }
      }
    }

    currentHeaders = mergedHeaders;
    currentRows = mergedRows;
  }

  return { headers: currentHeaders, rows: currentRows };
}

// ─── Parser ───────────────────────────────────────────────────────────

function parseSelect(sql) {
  var s = sql.trim().replace(/;$/, '').trim();
  var tokens = tokenize(s);
  var pos = 0;

  function peek() { return pos < tokens.length ? tokens[pos].toUpperCase() : ''; }
  function next() { return tokens[pos++]; }
  function expect(val) {
    if (peek() !== val.toUpperCase()) throw new Error('Expected ' + val + ' but got ' + (tokens[pos] || 'end'));
    return next();
  }

  expect('SELECT');

  // Columns
  var columns = [];
  do {
    if (columns.length > 0 && peek() === ',') next(); // consume comma
    columns.push(parseColumnExpr());
  } while (peek() === ',');

  expect('FROM');
  var from = next().toLowerCase();

  // Optional table alias: FROM tbl AS a  or  FROM tbl a
  var fromAlias = null;
  if (peek() === 'AS') { next(); fromAlias = next().toLowerCase(); }
  else if (peek() !== '' && ['WHERE','JOIN','INNER','LEFT','RIGHT','CROSS','GROUP','ORDER','LIMIT'].indexOf(peek()) < 0) {
    fromAlias = next().toLowerCase();
  }

  // JOINs: [INNER|LEFT [OUTER]|RIGHT [OUTER]|CROSS] JOIN tbl [AS alias] ON left = right [AND ...]
  var joins = [];
  while (['JOIN','INNER','LEFT','RIGHT','CROSS'].indexOf(peek()) >= 0) {
    var joinType = 'inner';
    if (peek() === 'INNER') { next(); joinType = 'inner'; }
    else if (peek() === 'LEFT') { next(); joinType = 'left'; if (peek() === 'OUTER') next(); }
    else if (peek() === 'RIGHT') { next(); joinType = 'right'; if (peek() === 'OUTER') next(); }
    else if (peek() === 'CROSS') { next(); joinType = 'cross'; }
    expect('JOIN');
    var joinTable = next().toLowerCase();
    var joinAlias = null;
    if (peek() === 'AS') { next(); joinAlias = next().toLowerCase(); }
    else if (peek() !== '' && ['ON','WHERE','JOIN','INNER','LEFT','RIGHT','CROSS','GROUP','ORDER','LIMIT'].indexOf(peek()) < 0) {
      joinAlias = next().toLowerCase();
    }
    var onPreds = [];
    if (joinType !== 'cross' && peek() === 'ON') {
      next(); // consume ON
      // Parse one or more equality predicates joined by AND
      // Each predicate is: left . col = right . col  (tokenized as separate tokens)
      do {
        var lParts = [next()];
        if (peek() === '.') { next(); lParts.push(next()); }
        var leftCol = lParts.join('.').toLowerCase();
        expect('=');
        var rParts = [next()];
        if (peek() === '.') { next(); rParts.push(next()); }
        var rightCol = rParts.join('.').toLowerCase();
        onPreds.push({ left: leftCol, right: rightCol });
      } while (peek() === 'AND' && next() && true);
    }
    joins.push({ type: joinType, table: joinTable, alias: joinAlias, on: onPreds });
  }

  // WHERE
  var where = null;
  if (peek() === 'WHERE') {
    next();
    where = collectUntil(['GROUP', 'ORDER', 'LIMIT']);
  }

  // GROUP BY
  var groupBy = [];
  if (peek() === 'GROUP') {
    next(); expect('BY');
    do {
      if (groupBy.length > 0 && peek() === ',') next();
      groupBy.push(next());
    } while (peek() === ',');
  }

  // ORDER BY
  var orderBy = [];
  if (peek() === 'ORDER') {
    next(); expect('BY');
    do {
      if (orderBy.length > 0 && peek() === ',') next();
      var col = next();
      var dir = 'asc';
      if (peek() === 'ASC') { next(); dir = 'asc'; }
      else if (peek() === 'DESC') { next(); dir = 'desc'; }
      orderBy.push({ column: col, dir: dir });
    } while (peek() === ',');
  }

  // LIMIT
  var limit = null;
  if (peek() === 'LIMIT') {
    next();
    limit = parseInt(next(), 10);
  }

  return { columns: columns, from: from, fromAlias: fromAlias, joins: joins, where: where, groupBy: groupBy, orderBy: orderBy, limit: limit };

  function parseColumnExpr() {
    var tok = peek();

    // Check for window functions: ROW_NUMBER, RANK, LAG, LEAD, and agg OVER
    var windowFuncs = ['ROW_NUMBER', 'RANK', 'LAG', 'LEAD'];
    var aggWindowFuncs = ['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'];
    var isWindowFunc = windowFuncs.indexOf(tok) >= 0;
    var isAggWindow = aggWindowFuncs.indexOf(tok) >= 0;

    if (isWindowFunc || isAggWindow) {
      var fn = next();
      expect('(');
      // Collect arguments inside parens
      var args = [];
      while (peek() !== ')') {
        if (peek() === ',') { next(); continue; }
        args.push(next());
      }
      expect(')');

      // If followed by OVER, this is a window function
      if (peek() === 'OVER') {
        next(); // consume OVER
        expect('(');

        // PARTITION BY (optional)
        var partitionBy = [];
        if (peek() === 'PARTITION') {
          next(); // PARTITION
          // peek may be BY
          if (tokens[pos] && tokens[pos].toUpperCase() === 'BY') next();
          while (peek() !== ')' && peek() !== 'ORDER' && peek() !== '') {
            if (peek() === ',') { next(); continue; }
            partitionBy.push(next());
          }
        }

        // ORDER BY (optional)
        var overOrderBy = [];
        if (peek() === 'ORDER') {
          next(); // ORDER
          if (tokens[pos] && tokens[pos].toUpperCase() === 'BY') next();
          while (peek() !== ')' && peek() !== '') {
            if (peek() === ',') { next(); continue; }
            var ocol = next();
            var odir = 'asc';
            if (peek() === 'ASC') { next(); odir = 'asc'; }
            else if (peek() === 'DESC') { next(); odir = 'desc'; }
            overOrderBy.push({ column: ocol, dir: odir });
          }
        }

        expect(')');

        var defaultAlias = fn.toLowerCase() + '_over';
        var alias = defaultAlias;
        if (peek() === 'AS') { next(); alias = next(); }

        return {
          type: 'window',
          func: fn.toLowerCase(),
          args: args,
          partitionBy: partitionBy,
          orderBy: overOrderBy,
          alias: alias
        };
      }

      // Not a window function — fall back to aggregate
      var arg = args.length > 0 ? args[0] : '*';
      var aggAlias = fn.toLowerCase() + '_' + arg.toLowerCase();
      if (peek() === 'AS') { next(); aggAlias = next(); }
      return { type: 'agg', func: fn.toLowerCase(), arg: arg, alias: aggAlias };
    }

    // Star
    if (tok === '*') {
      next();
      return { type: 'star' };
    }
    // Plain column, possibly aliased (may be table.col — tokenized as ["table", ".", "col"])
    var name = next();
    if (peek() === '.') { next(); name = name + '.' + next(); }
    var alias = name;
    if (peek() === 'AS') { next(); alias = next(); }
    return { type: 'col', name: name, alias: alias };
  }

  function collectUntil(stops) {
    var parts = [];
    while (pos < tokens.length && stops.indexOf(peek()) < 0) {
      parts.push(next());
    }
    return parts.join(' ');
  }
}

function tokenize(sql) {
  var tokens = [];
  var i = 0;
  while (i < sql.length) {
    // Skip whitespace
    if (/\s/.test(sql[i])) { i++; continue; }
    // Quoted string
    if (sql[i] === "'") {
      var j = i + 1;
      while (j < sql.length && sql[j] !== "'") j++;
      tokens.push(sql.substring(i, j + 1));
      i = j + 1;
      continue;
    }
    // Special chars (include . so table.col tokenizes as ["table",".","col"])
    if ('(),*.'.indexOf(sql[i]) >= 0) {
      tokens.push(sql[i]);
      i++;
      continue;
    }
    // Operators
    if (sql[i] === '!' && sql[i + 1] === '=') { tokens.push('!='); i += 2; continue; }
    if (sql[i] === '<' && sql[i + 1] === '=') { tokens.push('<='); i += 2; continue; }
    if (sql[i] === '>' && sql[i + 1] === '=') { tokens.push('>='); i += 2; continue; }
    if ('<>=,'.indexOf(sql[i]) >= 0) { tokens.push(sql[i]); i++; continue; }
    // Word/number
    var start = i;
    while (i < sql.length && !/[\s(),<>=!,.]/.test(sql[i]) && sql[i] !== "'") i++;
    if (i > start) tokens.push(sql.substring(start, i));
  }
  return tokens;
}

// ─── WHERE compiler ────────────────────────────────────────────────────

function compileWhere(whereStr, headers) {
  // Simple expression evaluator: col op value [AND|OR col op value ...]
  var parts = tokenize(whereStr);
  var conditions = [];
  var i = 0;
  while (i < parts.length) {
    if (parts[i].toUpperCase() === 'AND' || parts[i].toUpperCase() === 'OR') {
      conditions.push({ type: 'logic', op: parts[i].toUpperCase() });
      i++;
      continue;
    }
    var col = parts[i++];
    // Reassemble dotted column names: ["a", ".", "id"] → "a.id"
    if (parts[i] === '.') { col = col + '.' + parts[i + 1]; i += 2; }
    var op = parts[i++];
    var val = parts[i++];
    // Strip quotes from string values
    if (val && val[0] === "'" && val[val.length - 1] === "'") val = val.substring(1, val.length - 1);
    var colIdx = headers.indexOf(col);
    if (colIdx === -1) throw new Error('WHERE: column "' + col + '" not found');
    conditions.push({ type: 'cond', colIdx: colIdx, op: op, val: val });
  }

  return function (row) {
    var result = evalCond(conditions[0], row);
    for (var c = 1; c < conditions.length; c += 2) {
      var logic = conditions[c];
      var next = conditions[c + 1];
      if (logic.op === 'AND') result = result && evalCond(next, row);
      else result = result || evalCond(next, row);
    }
    return result;
  };

  function evalCond(cond, row) {
    var cellVal = row[cond.colIdx];
    var cmpVal = cond.val;
    // Try numeric comparison
    var numCell = Number(cellVal);
    var numCmp = Number(cmpVal);
    var useNum = !isNaN(numCell) && !isNaN(numCmp);
    var a = useNum ? numCell : String(cellVal);
    var b = useNum ? numCmp : cmpVal;

    switch (cond.op) {
      case '=': case '==': return a == b;
      case '!=': case '<>': return a != b;
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
      case 'LIKE': case 'like':
        var pattern = String(cmpVal).replace(/%/g, '.*').replace(/_/g, '.');
        return new RegExp('^' + pattern + '$', 'i').test(String(cellVal));
      default: throw new Error('Unknown operator: ' + cond.op);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function hasAggregates(columns) {
  return columns.some(function (c) { return c.type === 'agg'; });
}

function resolveColumns(columns, headers) {
  var specs = [];
  columns.forEach(function (c) {
    if (c.type === 'star') {
      headers.forEach(function (h, i) {
        specs.push({ idx: i, alias: h });
      });
    } else if (c.type === 'col') {
      var idx = headers.indexOf(c.name);
      if (idx === -1) throw new Error('Column "' + c.name + '" not found');
      specs.push({ idx: idx, alias: c.alias });
    }
  });
  return specs;
}

function applyOrderBy(rows, orderBy, headers) {
  var specs = orderBy.map(function (o) {
    var idx = headers.indexOf(o.column);
    if (idx === -1) throw new Error('ORDER BY: column "' + o.column + '" not found');
    return { idx: idx, asc: o.dir === 'asc' };
  });
  return rows.slice().sort(function (a, b) {
    for (var s = 0; s < specs.length; s++) {
      var spec = specs[s];
      var va = a[spec.idx], vb = b[spec.idx];
      var na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) { va = na; vb = nb; }
      if (va < vb) return spec.asc ? -1 : 1;
      if (va > vb) return spec.asc ? 1 : -1;
    }
    return 0;
  });
}

function execGrouped(parsed, headers, rows) {
  var groupCols = parsed.groupBy;
  var groupIndices = groupCols.map(function (name) {
    var idx = headers.indexOf(name);
    if (idx === -1) throw new Error('GROUP BY: column "' + name + '" not found');
    return idx;
  });

  // Build groups
  var groups = new Map();
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = groupIndices.map(function (idx) { return String(row[idx]); }).join('\x00');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  // Build output columns
  var outHeaders = [];
  var extractors = [];

  parsed.columns.forEach(function (c) {
    if (c.type === 'col') {
      var idx = headers.indexOf(c.name);
      if (idx === -1) throw new Error('Column "' + c.name + '" not found');
      outHeaders.push(c.alias);
      extractors.push(function (groupRows) { return groupRows[0][idx]; });
    } else if (c.type === 'agg') {
      outHeaders.push(c.alias);
      var aggIdx = c.arg === '*' ? -1 : headers.indexOf(c.arg);
      if (aggIdx === -1 && c.arg !== '*') throw new Error('Column "' + c.arg + '" not found');
      var fn = c.func;
      extractors.push(function (groupRows) {
        if (fn === 'count') return groupRows.length;
        var vals = groupRows.map(function (r) { return r[aggIdx]; });
        switch (fn) {
          case 'sum': return vals.reduce(function (s, v) { var n = Number(v); return s + (isNaN(n) ? 0 : n); }, 0);
          case 'avg': var nums = vals.filter(function (v) { return !isNaN(Number(v)); }); return nums.length ? nums.reduce(function (s, v) { return s + Number(v); }, 0) / nums.length : 0;
          case 'min': return Math.min.apply(null, vals.map(Number).filter(function (n) { return !isNaN(n); }));
          case 'max': return Math.max.apply(null, vals.map(Number).filter(function (n) { return !isNaN(n); }));
          default: return groupRows.length;
        }
      });
    } else if (c.type === 'star') {
      // In grouped query, * expands to group columns only
      groupCols.forEach(function (name) {
        var idx = headers.indexOf(name);
        outHeaders.push(name);
        extractors.push(function (groupRows) { return groupRows[0][idx]; });
      });
    }
  });

  var outRows = [];
  groups.forEach(function (groupRows) {
    outRows.push(extractors.map(function (ex) { return ex(groupRows); }));
  });

  // ORDER BY
  if (parsed.orderBy.length > 0) {
    outRows = applyOrderBy(outRows, parsed.orderBy, outHeaders);
  }

  // LIMIT
  if (parsed.limit !== null) {
    outRows = outRows.slice(0, parsed.limit);
  }

  return { headers: outHeaders, rows: outRows };
}

// ─── Window Functions ─────────────────────────────────────────────────

/**
 * Apply window function expressions to a set of rows (already filtered/ordered).
 * Returns { headers: string[], columns: any[][] } where each entry in columns
 * is an array of values (one per row) for that window expression.
 *
 * @param {any[][]} rows - source rows
 * @param {string[]} headers - source column headers
 * @param {object[]} windowExprs - parsed window column specs (type === 'window')
 * @returns {{ headers: string[], columns: any[][] }}
 */
function applyWindowFunctions(rows, headers, windowExprs) {
  var outHeaders = [];
  var outColumns = [];

  windowExprs.forEach(function (expr) {
    outHeaders.push(expr.alias);

    var colIdx = expr.args.length > 0 && expr.args[0] !== '*'
      ? headers.indexOf(expr.args[0])
      : -1;
    if (colIdx === -1 && ['lag', 'lead', 'sum', 'avg'].indexOf(expr.func) >= 0 && expr.func !== 'count') {
      if (expr.args[0] && expr.args[0] !== '*') {
        throw new Error('Window function: column "' + expr.args[0] + '" not found');
      }
    }

    // Resolve partition-by and order-by column indices
    var partIdxs = expr.partitionBy.map(function (name) {
      var idx = headers.indexOf(name);
      if (idx === -1) throw new Error('PARTITION BY: column "' + name + '" not found');
      return idx;
    });
    var orderSpecs = expr.orderBy.map(function (o) {
      var idx = headers.indexOf(o.column);
      if (idx === -1) throw new Error('OVER ORDER BY: column "' + o.column + '" not found');
      return { idx: idx, asc: o.dir === 'asc' };
    });

    // Assign each row its partition key
    function partitionKey(row) {
      if (partIdxs.length === 0) return '__all__';
      return partIdxs.map(function (i) { return String(row[i]); }).join('\x00');
    }

    // Group row indices by partition key, preserving original order
    var partitions = new Map();
    for (var ri = 0; ri < rows.length; ri++) {
      var key = partitionKey(rows[ri]);
      if (!partitions.has(key)) partitions.set(key, []);
      partitions.get(key).push(ri);
    }

    // For each partition, sort indices by the OVER ORDER BY if specified
    function sortedIndices(idxList) {
      if (orderSpecs.length === 0) return idxList.slice();
      return idxList.slice().sort(function (a, b) {
        for (var s = 0; s < orderSpecs.length; s++) {
          var spec = orderSpecs[s];
          var va = rows[a][spec.idx], vb = rows[b][spec.idx];
          var na = Number(va), nb = Number(vb);
          if (!isNaN(na) && !isNaN(nb)) { va = na; vb = nb; }
          if (va < vb) return spec.asc ? -1 : 1;
          if (va > vb) return spec.asc ? 1 : -1;
        }
        return 0;
      });
    }

    // Compare two rows for ORDER BY equality (for RANK)
    function orderEqual(rowA, rowB) {
      for (var s = 0; s < orderSpecs.length; s++) {
        var spec = orderSpecs[s];
        var va = rowA[spec.idx], vb = rowB[spec.idx];
        var na = Number(va), nb = Number(vb);
        if (!isNaN(na) && !isNaN(nb)) { if (na !== nb) return false; }
        else { if (String(va) !== String(vb)) return false; }
      }
      return true;
    }

    // Build result array indexed by original row position
    var values = new Array(rows.length);

    partitions.forEach(function (idxList) {
      var sorted = sortedIndices(idxList);

      switch (expr.func) {
        case 'row_number':
          sorted.forEach(function (origIdx, rank) {
            values[origIdx] = rank + 1;
          });
          break;

        case 'rank':
          var rankVal = 1;
          sorted.forEach(function (origIdx, pos) {
            if (pos === 0) {
              values[origIdx] = 1;
            } else {
              if (!orderEqual(rows[sorted[pos - 1]], rows[origIdx])) {
                rankVal = pos + 1;
              }
              values[origIdx] = rankVal;
            }
          });
          break;

        case 'lag': {
          var lagOffset = expr.args.length >= 2 ? parseInt(expr.args[1], 10) : 1;
          var lagDefault = expr.args.length >= 3 ? expr.args[2] : null;
          if (isNaN(lagOffset)) lagOffset = 1;
          sorted.forEach(function (origIdx, pos) {
            var srcPos = pos - lagOffset;
            if (srcPos >= 0) {
              values[origIdx] = rows[sorted[srcPos]][colIdx];
            } else {
              values[origIdx] = lagDefault;
            }
          });
          break;
        }

        case 'lead': {
          var leadOffset = expr.args.length >= 2 ? parseInt(expr.args[1], 10) : 1;
          var leadDefault = expr.args.length >= 3 ? expr.args[2] : null;
          if (isNaN(leadOffset)) leadOffset = 1;
          sorted.forEach(function (origIdx, pos) {
            var srcPos = pos + leadOffset;
            if (srcPos < sorted.length) {
              values[origIdx] = rows[sorted[srcPos]][colIdx];
            } else {
              values[origIdx] = leadDefault;
            }
          });
          break;
        }

        case 'sum': {
          // Running/cumulative sum when ORDER BY present; total when not
          if (orderSpecs.length > 0) {
            var runSum = 0;
            sorted.forEach(function (origIdx) {
              var v = Number(rows[origIdx][colIdx]);
              runSum += isNaN(v) ? 0 : v;
              values[origIdx] = runSum;
            });
          } else {
            var total = 0;
            sorted.forEach(function (origIdx) {
              var v = Number(rows[origIdx][colIdx]);
              total += isNaN(v) ? 0 : v;
            });
            sorted.forEach(function (origIdx) { values[origIdx] = total; });
          }
          break;
        }

        case 'avg': {
          var nums = sorted.map(function (i) { return Number(rows[i][colIdx]); }).filter(function (n) { return !isNaN(n); });
          var avgVal = nums.length ? nums.reduce(function (s, v) { return s + v; }, 0) / nums.length : 0;
          sorted.forEach(function (origIdx) { values[origIdx] = avgVal; });
          break;
        }

        case 'count': {
          var cnt = sorted.length;
          sorted.forEach(function (origIdx) { values[origIdx] = cnt; });
          break;
        }

        default:
          throw new Error('Unknown window function: ' + expr.func);
      }
    });

    outColumns.push(values);
  });

  return { headers: outHeaders, columns: outColumns };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { execSQL: execSQL, parseSelect: parseSelect, applyWindowFunctions: applyWindowFunctions };
}
