/**
 * DataKit JSON Parser
 * Zero-dependency JSON parsing with error recovery.
 */

/**
 * Strip trailing commas from JSON text before parsing.
 * Handles commas before ] and } with optional whitespace.
 */
function stripTrailingCommas(text) {
  return text.replace(/,\s*([}\]])/g, '$1');
}

/**
 * Convert single-quoted strings to double-quoted strings.
 * Handles escaped single quotes inside strings and avoids
 * converting single quotes that appear inside double-quoted strings.
 */
function convertSingleQuotes(text) {
  let result = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      // skip double-quoted string entirely
      result += ch;
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') { result += text[i++]; }
        result += text[i++];
      }
      if (i < text.length) result += text[i++]; // closing "
    } else if (ch === "'") {
      // convert single-quoted string to double-quoted
      result += '"';
      i++;
      while (i < text.length && text[i] !== "'") {
        if (text[i] === '\\' && text[i + 1] === "'") {
          result += "'";
          i += 2;
        } else if (text[i] === '"') {
          result += '\\"';
          i++;
        } else {
          result += text[i++];
        }
      }
      result += '"';
      if (i < text.length) i++; // closing '
    } else {
      result += ch;
      i++;
    }
  }
  return result;
}

/**
 * Build a descriptive error message for JSON parse failures.
 */
function describeParseError(text, err) {
  const posMatch = err.message.match(/position\s+(\d+)/i);
  const pos = posMatch ? parseInt(posMatch[1], 10) : null;

  if (pos !== null) {
    const before = text.slice(0, pos);
    const line = (before.match(/\n/g) || []).length + 1;
    const col = pos - before.lastIndexOf('\n');
    const snippet = text.slice(Math.max(0, pos - 20), pos + 20);
    return `JSON parse error at line ${line}, column ${col}: ${err.message}\n  near: ...${snippet}...`;
  }

  // Check for truncated JSON
  const trimmed = text.trimEnd();
  const last = trimmed[trimmed.length - 1];
  if (last !== '}' && last !== ']' && last !== '"' && last !== 'e' && last !== 'l') {
    return `JSON appears truncated (ends at position ${trimmed.length}): ${err.message}`;
  }

  return `JSON parse error: ${err.message}`;
}

/**
 * Detect if parsed data is an array of objects and extract tabular form.
 */
function extractTabular(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  if (typeof data[0] !== 'object' || data[0] === null || Array.isArray(data[0])) return null;

  const headerSet = new Set();
  for (const row of data) {
    if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;
    for (const key of Object.keys(row)) headerSet.add(key);
  }

  const headers = Array.from(headerSet);
  const rows = data.map(obj => headers.map(h => obj[h] !== undefined ? obj[h] : null));
  return { headers, rows };
}

/**
 * Parse a JSON string with error recovery.
 * Handles trailing commas, single quotes, and provides descriptive errors.
 *
 * @param {string} text - Raw JSON text
 * @returns {{ data: any, tabular: { headers: string[], rows: any[][] } | null }}
 */
export function parseJSON(text) {
  if (typeof text !== 'string') {
    throw new Error('parseJSON expects a string argument');
  }

  let cleaned = text.trim();
  let data;

  // Try raw parse first
  try {
    data = JSON.parse(cleaned);
  } catch (firstErr) {
    // Apply recovery: trailing commas + single quotes
    cleaned = stripTrailingCommas(cleaned);
    cleaned = convertSingleQuotes(cleaned);
    try {
      data = JSON.parse(cleaned);
    } catch (secondErr) {
      throw new Error(describeParseError(text.trim(), secondErr));
    }
  }

  return {
    data,
    tabular: extractTabular(data),
  };
}

/**
 * Parse a JSON File object via FileReader.
 *
 * @param {File} file - File object to read
 * @returns {Promise<{ data: any, tabular: { headers: string[], rows: any[][] } | null }>}
 */
export function parseJSONFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(parseJSON(reader.result));
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
    reader.readAsText(file);
  });
}
