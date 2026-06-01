/**
 * WDK SQL Functions — string, date, math, and type functions for the SQL engine.
 * Evaluates function calls in SELECT and WHERE expressions.
 * Zero dependencies.
 */

var SQL_FUNCTIONS = {
  // String functions
  upper: function (args) { return String(args[0] == null ? '' : args[0]).toUpperCase(); },
  lower: function (args) { return String(args[0] == null ? '' : args[0]).toLowerCase(); },
  trim: function (args) { return String(args[0] == null ? '' : args[0]).trim(); },
  ltrim: function (args) { return String(args[0] == null ? '' : args[0]).replace(/^\s+/, ''); },
  rtrim: function (args) { return String(args[0] == null ? '' : args[0]).replace(/\s+$/, ''); },
  length: function (args) { return args[0] == null ? 0 : String(args[0]).length; },
  len: function (args) { return SQL_FUNCTIONS.length(args); },
  substr: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var start = Math.max(0, (Number(args[1]) || 1) - 1); // SQL is 1-indexed
    var len = args[2] != null ? Number(args[2]) : undefined;
    return len != null ? s.substr(start, len) : s.substr(start);
  },
  substring: function (args) { return SQL_FUNCTIONS.substr(args); },
  replace: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var find = String(args[1] == null ? '' : args[1]);
    var rep = String(args[2] == null ? '' : args[2]);
    return s.split(find).join(rep);
  },
  concat: function (args) {
    return args.map(function (a) { return a == null ? '' : String(a); }).join('');
  },
  left: function (args) {
    return String(args[0] == null ? '' : args[0]).substring(0, Number(args[1]) || 0);
  },
  right: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var n = Number(args[1]) || 0;
    return s.substring(Math.max(0, s.length - n));
  },
  instr: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var sub = String(args[1] == null ? '' : args[1]);
    var idx = s.indexOf(sub);
    return idx >= 0 ? idx + 1 : 0; // SQL is 1-indexed, 0 = not found
  },
  reverse: function (args) {
    return String(args[0] == null ? '' : args[0]).split('').reverse().join('');
  },
  repeat: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var n = Math.max(0, Math.floor(Number(args[1]) || 0));
    var out = '';
    for (var i = 0; i < n; i++) out += s;
    return out;
  },
  lpad: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var len = Number(args[1]) || 0;
    var pad = args[2] != null ? String(args[2]) : ' ';
    while (s.length < len) s = pad + s;
    return s.substring(s.length - len);
  },
  rpad: function (args) {
    var s = String(args[0] == null ? '' : args[0]);
    var len = Number(args[1]) || 0;
    var pad = args[2] != null ? String(args[2]) : ' ';
    while (s.length < len) s = s + pad;
    return s.substring(0, len);
  },

  // Date functions
  year: function (args) { var d = _parseDate(args[0]); return d ? d.getFullYear() : null; },
  month: function (args) { var d = _parseDate(args[0]); return d ? d.getMonth() + 1 : null; },
  day: function (args) { var d = _parseDate(args[0]); return d ? d.getDate() : null; },
  hour: function (args) { var d = _parseDate(args[0]); return d ? d.getHours() : null; },
  minute: function (args) { var d = _parseDate(args[0]); return d ? d.getMinutes() : null; },
  second: function (args) { var d = _parseDate(args[0]); return d ? d.getSeconds() : null; },
  now: function () { return new Date().toISOString(); },
  today: function () { return new Date().toISOString().substring(0, 10); },
  date: function (args) {
    var d = _parseDate(args[0]);
    return d ? d.toISOString().substring(0, 10) : null;
  },
  datediff: function (args) {
    // DATEDIFF(date1, date2) → days between
    var d1 = _parseDate(args[0]);
    var d2 = _parseDate(args[1]);
    if (!d1 || !d2) return null;
    return Math.round((d2 - d1) / 86400000);
  },
  dateadd: function (args) {
    // DATEADD(date, days)
    var d = _parseDate(args[0]);
    var days = Number(args[1]) || 0;
    if (!d) return null;
    var result = new Date(d.getTime() + days * 86400000);
    return result.toISOString().substring(0, 10);
  },

  // Math functions
  abs: function (args) { return Math.abs(Number(args[0]) || 0); },
  round: function (args) {
    var n = Number(args[0]) || 0;
    var decimals = Number(args[1]) || 0;
    var factor = Math.pow(10, decimals);
    return Math.round(n * factor) / factor;
  },
  ceil: function (args) { return Math.ceil(Number(args[0]) || 0); },
  ceiling: function (args) { return SQL_FUNCTIONS.ceil(args); },
  floor: function (args) { return Math.floor(Number(args[0]) || 0); },
  sqrt: function (args) { var n = Number(args[0]); if (isNaN(n) || n < 0) return null; return Math.sqrt(n); },
  power: function (args) { return Math.pow(Number(args[0]) || 0, Number(args[1]) || 0); },
  mod: function (args) { return (Number(args[0]) || 0) % (Number(args[1]) || 1); },
  log: function (args) { var n = Number(args[0]); return n > 0 ? Math.log(n) : null; },

  // Type / null functions
  coalesce: function (args) {
    for (var i = 0; i < args.length; i++) {
      if (args[i] != null && args[i] !== '' && args[i] !== 'null' && args[i] !== 'NULL') return args[i];
    }
    return null;
  },
  ifnull: function (args) { return SQL_FUNCTIONS.coalesce(args); },
  nullif: function (args) {
    return args[0] == args[1] ? null : args[0];
  },
  cast_int: function (args) {
    var n = parseInt(args[0], 10);
    return isNaN(n) ? null : n;
  },
  cast_float: function (args) {
    var n = parseFloat(args[0]);
    return isNaN(n) ? null : n;
  },
  typeof: function (args) {
    var v = args[0];
    if (v == null || v === '' || v === 'null' || v === 'NULL') return 'null';
    if (!isNaN(Number(v))) return Number(v) === Math.floor(Number(v)) ? 'integer' : 'real';
    if (_parseDate(v)) return 'date';
    return 'text';
  },

  // Advanced string functions
  split: function(args) {
    // SPLIT(string, delimiter, index)
    // Returns the nth element (0-based) after splitting string by delimiter
    var s = String(args[0] == null ? '' : args[0]);
    var delim = String(args[1] == null ? ',' : args[1]);
    var idx = Number(args[2]) || 0;
    var parts = s.split(delim);
    return idx >= 0 && idx < parts.length ? parts[idx] : null;
  },
  regex_extract: function(args) {
    // REGEX_EXTRACT(string, pattern, group?)
    // Returns the first match (or capture group) of pattern in string
    var s = String(args[0] == null ? '' : args[0]);
    var pattern = String(args[1] == null ? '' : args[1]);
    var group = Number(args[2]) || 0;
    try {
      var m = s.match(new RegExp(pattern));
      if (!m) return null;
      return group < m.length ? m[group] : null;
    } catch(e) { return null; }
  },
  regex_replace: function(args) {
    // REGEX_REPLACE(string, pattern, replacement)
    var s = String(args[0] == null ? '' : args[0]);
    var pattern = String(args[1] == null ? '' : args[1]);
    var rep = String(args[2] == null ? '' : args[2]);
    try {
      return s.replace(new RegExp(pattern, 'g'), rep);
    } catch(e) { return s; }
  },

  // Conditional
  iif: function (args) {
    return args[0] ? args[1] : (args[2] != null ? args[2] : null);
  },
};

/** Parse a date string, returning Date or null */
function _parseDate(val) {
  if (val == null || val === '') return null;
  if (val instanceof Date) return val;
  var s = String(val).trim();
  // ISO format
  var d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  // Try MM/DD/YYYY
  var parts = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (parts) {
    d = new Date(Number(parts[3]), Number(parts[1]) - 1, Number(parts[2]));
    if (!isNaN(d.getTime())) return d;
  }
  // Try YYYY-MM-DD
  parts = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (parts) {
    d = new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Evaluate a SQL function call.
 * @param {string} funcName
 * @param {any[]} args — resolved argument values
 * @returns {any}
 */
function evalSQLFunction(funcName, args) {
  var fn = SQL_FUNCTIONS[funcName.toLowerCase()];
  if (!fn) throw new Error('Unknown function: ' + funcName);
  return fn(args);
}

/**
 * Check if a token is a known SQL function name.
 * @param {string} name
 * @returns {boolean}
 */
function isSQLFunction(name) {
  return SQL_FUNCTIONS.hasOwnProperty(name.toLowerCase());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evalSQLFunction: evalSQLFunction, isSQLFunction: isSQLFunction, SQL_FUNCTIONS: SQL_FUNCTIONS };
}
