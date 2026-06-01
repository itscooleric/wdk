/**
 * Tests for SQL functions module (string, date, math, type functions).
 */

var fns = require('../src/transforms/sql-functions');
var evalFn = fns.evalSQLFunction;
var isFn = fns.isSQLFunction;

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error('  FAIL: ' + msg);
  }
}

function eq(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.0001;
  return false;
}

console.log('sql-functions.test.js');
console.log('');

// --- String functions ---
console.log('String functions:');
assert(evalFn('UPPER', ['hello']) === 'HELLO', 'UPPER');
assert(evalFn('lower', ['HELLO']) === 'hello', 'LOWER');
assert(evalFn('TRIM', ['  hi  ']) === 'hi', 'TRIM');
assert(evalFn('LTRIM', ['  hi  ']) === 'hi  ', 'LTRIM');
assert(evalFn('RTRIM', ['  hi  ']) === '  hi', 'RTRIM');
assert(evalFn('LENGTH', ['hello']) === 5, 'LENGTH');
assert(evalFn('LEN', ['hello']) === 5, 'LEN alias');
assert(evalFn('SUBSTR', ['hello world', 7]) === 'world', 'SUBSTR start');
assert(evalFn('SUBSTR', ['hello world', 1, 5]) === 'hello', 'SUBSTR start+len');
assert(evalFn('REPLACE', ['hello world', 'world', 'there']) === 'hello there', 'REPLACE');
assert(evalFn('CONCAT', ['hello', ' ', 'world']) === 'hello world', 'CONCAT');
assert(evalFn('LEFT', ['hello', 3]) === 'hel', 'LEFT');
assert(evalFn('RIGHT', ['hello', 3]) === 'llo', 'RIGHT');
assert(evalFn('INSTR', ['hello world', 'world']) === 7, 'INSTR found');
assert(evalFn('INSTR', ['hello', 'xyz']) === 0, 'INSTR not found');
assert(evalFn('REVERSE', ['hello']) === 'olleh', 'REVERSE');
assert(evalFn('REPEAT', ['ab', 3]) === 'ababab', 'REPEAT');
assert(evalFn('LPAD', ['42', 5, '0']) === '00042', 'LPAD');
assert(evalFn('RPAD', ['hi', 5, '.']) === 'hi...', 'RPAD');
// Null handling
assert(evalFn('UPPER', [null]) === '', 'UPPER null');
assert(evalFn('LENGTH', [null]) === 0, 'LENGTH null');
console.log('');

// --- Date functions ---
console.log('Date functions:');
assert(evalFn('YEAR', ['2026-04-03']) === 2026, 'YEAR');
assert(evalFn('MONTH', ['2026-04-03']) === 4, 'MONTH');
assert(evalFn('DAY', ['2026-04-03']) === 3, 'DAY');
assert(evalFn('DATE', ['2026-04-03T15:30:00Z']) === '2026-04-03', 'DATE from datetime');
assert(evalFn('DATEDIFF', ['2026-01-01', '2026-01-31']) === 30, 'DATEDIFF');
assert(evalFn('DATEADD', ['2026-01-01', 10]) === '2026-01-11', 'DATEADD');
assert(evalFn('YEAR', [null]) === null, 'YEAR null');
assert(evalFn('YEAR', ['not a date']) === null, 'YEAR invalid');
// NOW and TODAY return strings (just check they're truthy)
assert(typeof evalFn('NOW', []) === 'string', 'NOW returns string');
assert(typeof evalFn('TODAY', []) === 'string', 'TODAY returns string');
console.log('');

// --- Math functions ---
console.log('Math functions:');
assert(evalFn('ABS', [-5]) === 5, 'ABS');
assert(evalFn('ROUND', [3.14159, 2]) === 3.14, 'ROUND 2 decimals');
assert(evalFn('ROUND', [3.5]) === 4, 'ROUND 0 decimals');
assert(evalFn('CEIL', [3.2]) === 4, 'CEIL');
assert(evalFn('CEILING', [3.2]) === 4, 'CEILING alias');
assert(evalFn('FLOOR', [3.8]) === 3, 'FLOOR');
assert(eq(evalFn('SQRT', [9]), 3), 'SQRT');
assert(evalFn('POWER', [2, 3]) === 8, 'POWER');
assert(evalFn('MOD', [10, 3]) === 1, 'MOD');
assert(evalFn('SQRT', [-1]) === null, 'SQRT negative → null');
console.log('');

// --- Type / null functions ---
console.log('Type/null functions:');
assert(evalFn('COALESCE', [null, '', 'hello', 'world']) === 'hello', 'COALESCE');
assert(evalFn('COALESCE', [null, null]) === null, 'COALESCE all null');
assert(evalFn('IFNULL', [null, 'default']) === 'default', 'IFNULL');
assert(evalFn('NULLIF', [5, 5]) === null, 'NULLIF equal');
assert(evalFn('NULLIF', [5, 3]) === 5, 'NULLIF not equal');
assert(evalFn('CAST_INT', ['42']) === 42, 'CAST_INT');
assert(evalFn('CAST_INT', ['abc']) === null, 'CAST_INT invalid');
assert(evalFn('CAST_FLOAT', ['3.14']) === 3.14, 'CAST_FLOAT');
assert(evalFn('TYPEOF', ['hello']) === 'text', 'TYPEOF text');
assert(evalFn('TYPEOF', ['42']) === 'integer', 'TYPEOF integer');
assert(evalFn('TYPEOF', ['3.14']) === 'real', 'TYPEOF real');
assert(evalFn('TYPEOF', [null]) === 'null', 'TYPEOF null');
console.log('');

// --- Conditional ---
console.log('Conditional functions:');
assert(evalFn('IIF', [true, 'yes', 'no']) === 'yes', 'IIF true');
assert(evalFn('IIF', [false, 'yes', 'no']) === 'no', 'IIF false');
assert(evalFn('IIF', [null, 'yes', 'no']) === 'no', 'IIF null');
console.log('');

// --- isSQLFunction ---
console.log('Function detection:');
assert(isFn('UPPER') === true, 'isSQLFunction UPPER');
assert(isFn('lower') === true, 'isSQLFunction lower');
assert(isFn('NOTAFUNCTION') === false, 'isSQLFunction unknown');
assert(isFn('year') === true, 'isSQLFunction year');
assert(isFn('ROUND') === true, 'isSQLFunction ROUND');
console.log('');

// --- Summary ---
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
