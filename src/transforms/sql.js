/**
 * Wiz SQL engine — lightweight SQL SELECT parser + executor against DataFrames.
 * Supports: SELECT, FROM, WHERE, GROUP BY, ORDER BY, LIMIT, aliases, *, COUNT/SUM/AVG/MIN/MAX.
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

  var headers = df._headers;
  var rows = df._rows;

  // WHERE
  if (parsed.where) {
    var whereFn = compileWhere(parsed.where, headers);
    rows = rows.filter(whereFn);
  }

  // GROUP BY
  if (parsed.groupBy.length > 0 || hasAggregates(parsed.columns)) {
    return execGrouped(parsed, headers, rows);
  }

  // SELECT columns
  var colSpecs = resolveColumns(parsed.columns, headers);

  // ORDER BY
  if (parsed.orderBy.length > 0) {
    rows = applyOrderBy(rows, parsed.orderBy, headers);
  }

  // Project
  var outHeaders = colSpecs.map(function (c) { return c.alias; });
  var outRows = rows.map(function (row) {
    return colSpecs.map(function (c) { return row[c.idx]; });
  });

  // LIMIT
  if (parsed.limit !== null) {
    outRows = outRows.slice(0, parsed.limit);
  }

  return { headers: outHeaders, rows: outRows };
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

  return { columns: columns, from: from, where: where, groupBy: groupBy, orderBy: orderBy, limit: limit };

  function parseColumnExpr() {
    var tok = peek();
    // Check for aggregate: COUNT(col), SUM(col), etc.
    if (['COUNT', 'SUM', 'AVG', 'MIN', 'MAX'].indexOf(tok) >= 0) {
      var fn = next();
      expect('(');
      var arg = next(); // column name or *
      expect(')');
      var alias = fn.toLowerCase() + '_' + arg.toLowerCase();
      if (peek() === 'AS') { next(); alias = next(); }
      return { type: 'agg', func: fn.toLowerCase(), arg: arg, alias: alias };
    }
    // Star
    if (tok === '*') {
      next();
      return { type: 'star' };
    }
    // Plain column, possibly aliased
    var name = next();
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
    // Special chars
    if ('(),*'.indexOf(sql[i]) >= 0) {
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
    while (i < sql.length && !/[\s(),<>=!,]/.test(sql[i]) && sql[i] !== "'") i++;
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { execSQL: execSQL, parseSelect: parseSelect };
}
