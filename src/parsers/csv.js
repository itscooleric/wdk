/**
 * Lightweight CSV parser (RFC 4180 compliant).
 * Zero dependencies. Handles quoted fields, embedded newlines, BOM.
 */

function parseCSV(text, options) {
  var delimiter = (options && options.delimiter) || ',';
  var hasHeader = options && options.hasHeader !== undefined ? options.hasHeader : true;

  // Strip BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  // Strip trailing newlines
  text = text.replace(/[\r\n]+$/, '');

  var rows = [];
  var row = [];
  var field = '';
  var inQuotes = false;
  var i = 0;
  var len = text.length;

  while (i < len) {
    var ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < len && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else if (ch === '"') {
      inQuotes = true;
      i++;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      if (i < len && text[i] === '\n') i++;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += ch;
      i++;
    }
  }

  // Push last field/row
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  if (hasHeader && rows.length > 0) {
    return { headers: rows[0], rows: rows.slice(1) };
  }
  return { headers: [], rows: rows };
}

function parseCSVFile(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(parseCSV(reader.result)); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsText(file);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCSV: parseCSV, parseCSVFile: parseCSVFile };
}
