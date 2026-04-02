/**
 * DataKit Export Module
 * Zero-dependency export to CSV, JSON, clipboard, and file download.
 */

/**
 * Escape a value for CSV output.
 * Wraps in quotes if the value contains the delimiter, quotes, or newlines.
 */
function escapeCSV(value, delimiter) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(delimiter) || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

/**
 * Convert a DataTable to a CSV string.
 *
 * @param {{ headers: string[], rows: any[][] }} table
 * @param {{ delimiter?: string, includeHeaders?: boolean }} [options]
 * @returns {string}
 */
export function toCSV(table, options = {}) {
  const delimiter = options.delimiter || ',';
  const includeHeaders = options.includeHeaders !== false;

  const lines = [];

  if (includeHeaders && table.headers) {
    lines.push(table.headers.map(h => escapeCSV(h, delimiter)).join(delimiter));
  }

  for (const row of table.rows) {
    lines.push(row.map(v => escapeCSV(v, delimiter)).join(delimiter));
  }

  return lines.join('\n');
}

/**
 * Convert a DataTable to a JSON string.
 *
 * @param {{ headers: string[], rows: any[][] }} table
 * @param {{ pretty?: boolean, asArray?: boolean }} [options]
 * @returns {string}
 */
export function toJSON(table, options = {}) {
  const indent = options.pretty ? 2 : undefined;

  if (options.asArray) {
    // Array of objects: [ { col: val, ... }, ... ]
    const objects = table.rows.map(row => {
      const obj = {};
      for (let i = 0; i < table.headers.length; i++) {
        obj[table.headers[i]] = i < row.length ? row[i] : null;
      }
      return obj;
    });
    return JSON.stringify(objects, null, indent);
  }

  // Default: array of arrays with headers as first element
  return JSON.stringify({ headers: table.headers, rows: table.rows }, null, indent);
}

/**
 * Trigger a file download in the browser by creating a temporary blob URL.
 *
 * @param {string} content - File content
 * @param {string} filename - Download filename
 * @param {string} [mimeType='text/plain'] - MIME type
 */
export function downloadBlob(content, filename, mimeType = 'text/plain') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Copy text to clipboard with fallback for older browsers.
 *
 * @param {string} text - Text to copy
 * @returns {Promise<void>}
 */
export function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text);
  }

  // Fallback: textarea + execCommand
  return new Promise((resolve, reject) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
      const ok = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (ok) resolve();
      else reject(new Error('execCommand copy failed'));
    } catch (err) {
      document.body.removeChild(textarea);
      reject(err);
    }
  });
}
