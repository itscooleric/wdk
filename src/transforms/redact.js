// Data redaction transforms — zero external dependencies
// All functions mutate in-place and return the table for chaining.

function djb2(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++)
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

function blankColumn(table, columnName) {
  for (const row of table) row[columnName] = '';
  return table;
}

function replaceColumn(table, columnName, placeholder) {
  for (const row of table) row[columnName] = placeholder;
  return table;
}

function regexRedact(table, columnName, pattern, replacement) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  for (const row of table) {
    if (row[columnName] != null) {
      row[columnName] = String(row[columnName]).replace(re, replacement);
    }
  }
  return table;
}

async function sha256(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashColumn(table, columnName, method) {
  if (method === 'fast') {
    for (const row of table) {
      if (row[columnName] != null) row[columnName] = djb2(String(row[columnName]));
    }
    return table;
  }

  if (method === 'sha256') {
    for (const row of table) {
      if (row[columnName] != null) row[columnName] = await sha256(String(row[columnName]));
    }
    return table;
  }

  // Auto-detect: try SHA-256, fall back to djb2
  try {
    const test = await sha256('probe');
    if (test) {
      for (const row of table) {
        if (row[columnName] != null) row[columnName] = await sha256(String(row[columnName]));
      }
      return table;
    }
  } catch (_) {
    // SHA-256 unavailable (e.g. insecure context) — fall back
  }

  for (const row of table) {
    if (row[columnName] != null) row[columnName] = djb2(String(row[columnName]));
  }
  return table;
}

export { blankColumn, replaceColumn, regexRedact, hashColumn, djb2 };
