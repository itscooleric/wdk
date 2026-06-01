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

function parseCSVStreaming(file, options) {
  var chunkSize = (options && options.chunkSize) || (2 * 1024 * 1024);
  var delimiter = (options && options.delimiter) || ',';
  var hasHeader = options && options.hasHeader !== undefined ? options.hasHeader : true;
  var onChunk = (options && options.onChunk) || function () {};

  var fileSize = file.size;
  var offset = 0;
  var headers = null;
  var totalRows = 0;

  // State machine state persisted across chunks
  var inQuotes = false;
  var field = '';
  var row = [];
  var isFirstChunk = true;

  function parseChunkText(text, isLast) {
    var rows = [];
    var i = 0;
    var len = text.length;

    // Strip BOM on first chunk
    if (isFirstChunk && text.charCodeAt(0) === 0xFEFF) {
      i = 1;
    }
    isFirstChunk = false;

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

    // On last chunk, flush remaining field/row
    if (isLast && !inQuotes) {
      if (field !== '' || row.length > 0) {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      }
    }

    return rows;
  }

  function readNextChunk(resolve, reject) {
    if (offset >= fileSize) {
      resolve({ headers: headers || [], totalRows: totalRows });
      return;
    }

    var end = Math.min(offset + chunkSize, fileSize);
    var blob = file.slice(offset, end);
    var isLast = (end >= fileSize);
    var reader = new FileReader();

    reader.onerror = function () { reject(reader.error); };
    reader.onload = function () {
      var text = reader.result;
      var rows = parseChunkText(text, isLast);

      // Extract headers from first batch of rows
      if (headers === null && rows.length > 0 && hasHeader) {
        headers = rows.shift();
      }

      totalRows += rows.length;
      var progress = Math.min(end / fileSize, 1);
      onChunk(rows, progress);

      offset = end;
      readNextChunk(resolve, reject);
    };

    reader.readAsText(blob);
  }

  return new Promise(function (resolve, reject) {
    readNextChunk(resolve, reject);
  });
}

function parseCSVFile(file) {
  // Use streaming for files >50MB
  if (file && file.size && file.size > 50 * 1024 * 1024) {
    var allRows = [];
    return parseCSVStreaming(file, {
      onChunk: function (rows) {
        for (var i = 0; i < rows.length; i++) {
          allRows.push(rows[i]);
        }
      }
    }).then(function (result) {
      return { headers: result.headers, rows: allRows };
    });
  }
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () { resolve(parseCSV(reader.result)); };
    reader.onerror = function () { reject(reader.error); };
    reader.readAsText(file);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCSV: parseCSV, parseCSVFile: parseCSVFile, parseCSVStreaming: parseCSVStreaming };
}
