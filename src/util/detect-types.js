/**
 * Column type detection and profiling utilities.
 * Zero external dependencies.
 */

const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}$/,                          // 2024-01-15
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/,            // 2024-01-15T10:30:00
  /^\d{1,2}\/\d{1,2}\/\d{2,4}$/,                  // 1/15/2024 or 01/15/24
  /^\d{1,2}-\w{3}-\d{2,4}$/,                      // 15-Jan-2024
  /^\w{3,9}\s+\d{1,2},?\s+\d{4}$/,                // January 15, 2024
];

const BOOLEAN_VALUES = new Set([
  'true', 'false', 'yes', 'no', '1', '0', 't', 'f', 'y', 'n',
]);

function isNull(v) {
  return v === null || v === undefined || v === '' ||
    (typeof v === 'string' && v.trim().toLowerCase() === 'null');
}

function isNumeric(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed === '') return false;
  return !isNaN(Number(trimmed)) && isFinite(Number(trimmed));
}

function isDate(s) {
  if (typeof s !== 'string') return false;
  const trimmed = s.trim();
  if (trimmed === '') return false;
  if (DATE_PATTERNS.some((p) => p.test(trimmed))) {
    const d = new Date(trimmed);
    return !isNaN(d.getTime());
  }
  return false;
}

function isBoolean(s) {
  if (typeof s !== 'string') return false;
  return BOOLEAN_VALUES.has(s.trim().toLowerCase());
}

/**
 * Detect the most likely column type from an array of string values.
 * @param {Array<string|null|undefined>} values
 * @returns {'number'|'date'|'boolean'|'string'}
 */
function detectColumnType(values) {
  const nonNull = values.filter((v) => !isNull(v));
  if (nonNull.length === 0) return 'string';

  // Check each type — require all non-null values to match
  if (nonNull.every(isNumeric)) return 'number';
  if (nonNull.every(isBoolean)) return 'boolean';
  if (nonNull.every(isDate)) return 'date';
  return 'string';
}

/**
 * Profile a column: type, null count, unique count, min, max, samples.
 * @param {Array<string|null|undefined>} values
 * @returns {{ type: string, nullCount: number, uniqueCount: number, min: *, max: *, samples: Array }}
 */
function profileColumn(values) {
  const type = detectColumnType(values);
  const nullCount = values.filter(isNull).length;
  const nonNull = values.filter((v) => !isNull(v));

  const uniqueSet = new Set(nonNull.map((v) => String(v).trim()));
  const uniqueCount = uniqueSet.size;
  const samples = [...uniqueSet].slice(0, 5);

  let min = undefined;
  let max = undefined;

  if (nonNull.length > 0) {
    if (type === 'number') {
      const nums = nonNull.map((v) => Number(v));
      min = Math.min(...nums);
      max = Math.max(...nums);
    } else if (type === 'date') {
      const dates = nonNull.map((v) => new Date(v.trim()));
      const timestamps = dates.map((d) => d.getTime());
      min = new Date(Math.min(...timestamps)).toISOString();
      max = new Date(Math.max(...timestamps)).toISOString();
    } else {
      const sorted = [...nonNull].map((v) => String(v).trim()).sort();
      min = sorted[0];
      max = sorted[sorted.length - 1];
    }
  }

  return { type, nullCount, uniqueCount, min, max, samples };
}

module.exports = { detectColumnType, profileColumn };
