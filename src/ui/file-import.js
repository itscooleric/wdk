/**
 * WDK file import UI.
 * Drag-and-drop zone + file input for .csv, .json, .tsv files.
 * Parses files and returns DataFrame via callback.
 * Zero external dependencies.
 */

/* global parseCSV, parseJSON, parseXLSX, DataFrame */

var DK_IMPORT_THEME = {
  bg: '#0a0a1a',
  bgHover: '#12122a',
  bgActive: '#0d1a2a',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  text: '#e0e0f0',
  textDim: '#8888aa',
  border: '#2a2a4a',
  borderActive: '#00e5ff',
};

function injectImportStyles() {
  if (document.getElementById('dk-import-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-import-styles';
  style.textContent = [
    '.dk-import-zone {',
    '  border: 2px dashed ' + DK_IMPORT_THEME.border + ';',
    '  border-radius: 8px; padding: 24px 16px;',
    '  text-align: center; cursor: pointer;',
    '  transition: border-color 0.2s, background 0.2s;',
    '  background: ' + DK_IMPORT_THEME.bg + ';',
    '}',
    '.dk-import-zone.dk-dragover {',
    '  border-color: ' + DK_IMPORT_THEME.borderActive + ';',
    '  background: ' + DK_IMPORT_THEME.bgActive + ';',
    '  box-shadow: inset 0 0 20px rgba(0, 229, 255, 0.08);',
    '}',
    '.dk-import-icon {',
    '  font-size: 28px; margin-bottom: 8px;',
    '  color: ' + DK_IMPORT_THEME.purple + ';',
    '}',
    '.dk-import-label {',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 13px; color: ' + DK_IMPORT_THEME.text + ';',
    '  margin-bottom: 4px;',
    '}',
    '.dk-import-hint {',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 11px; color: ' + DK_IMPORT_THEME.textDim + ';',
    '}',
    '.dk-import-input { display: none; }',
    '.dk-import-btn {',
    '  display: inline-block; margin-top: 10px; padding: 5px 14px;',
    '  background: ' + DK_IMPORT_THEME.bgHover + ';',
    '  border: 1px solid ' + DK_IMPORT_THEME.border + ';',
    '  border-radius: 4px; color: ' + DK_IMPORT_THEME.cyan + ';',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 12px; cursor: pointer;',
    '  transition: background 0.15s, border-color 0.15s;',
    '}',
    '.dk-import-btn:hover {',
    '  background: ' + DK_IMPORT_THEME.border + ';',
    '  border-color: ' + DK_IMPORT_THEME.cyan + ';',
    '}',
    '.dk-import-error {',
    '  font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '  font-size: 11px; color: ' + DK_IMPORT_THEME.pink + ';',
    '  margin-top: 8px; word-break: break-word;',
    '}',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Detect file type from extension.
 * @param {string} filename
 * @returns {'csv'|'tsv'|'json'|null}
 */
function detectFileType(filename) {
  var ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'csv') return 'csv';
  if (ext === 'tsv') return 'tsv';
  if (ext === 'json') return 'json';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

/**
 * Parse file text into a DataFrame.
 * @param {string} text - File content
 * @param {string} type - 'csv', 'tsv', or 'json'
 * @returns {DataFrame}
 */
function parseFileText(text, type) {
  if (type === 'csv' || type === 'tsv') {
    var delimiter = type === 'tsv' ? '\t' : ',';
    var result = parseCSV(text, { delimiter: delimiter, hasHeader: true });
    return new DataFrame(result.headers, result.rows);
  }

  if (type === 'json') {
    var parsed = parseJSON(text);
    if (parsed.tabular) {
      return new DataFrame(parsed.tabular.headers, parsed.tabular.rows);
    }
    // Non-tabular JSON: show as single-column table
    var data = parsed.data;
    if (Array.isArray(data)) {
      return new DataFrame(['value'], data.map(function (v) { return [JSON.stringify(v)]; }));
    }
    // Single object: key-value table
    if (typeof data === 'object' && data !== null) {
      var keys = Object.keys(data);
      return new DataFrame(['key', 'value'], keys.map(function (k) {
        return [k, JSON.stringify(data[k])];
      }));
    }
    return new DataFrame(['value'], [[JSON.stringify(data)]]);
  }

  throw new Error('Unsupported file type: ' + type);
}

/**
 * Create a file import zone with drag-and-drop + file input.
 *
 * @param {HTMLElement} container - The element to render into
 * @param {Function} onData - Callback: onData(dataTable, filename)
 * @returns {{ destroy: Function }}
 */
function createFileImport(container, onData) {
  injectImportStyles();

  var zone = document.createElement('div');
  zone.className = 'dk-import-zone';
  zone.setAttribute('role', 'button');
  zone.setAttribute('tabindex', '0');
  zone.setAttribute('aria-label', 'Drop files here or click to browse');

  var icon = document.createElement('div');
  icon.className = 'dk-import-icon';
  icon.textContent = '\u2913'; // downwards arrow to bar

  var label = document.createElement('div');
  label.className = 'dk-import-label';
  label.textContent = 'Drop a file here';

  var hint = document.createElement('div');
  hint.className = 'dk-import-hint';
  hint.textContent = '.csv \u00b7 .tsv \u00b7 .json \u00b7 .xlsx';

  var btn = document.createElement('button');
  btn.className = 'dk-import-btn';
  btn.textContent = 'Browse files';

  var fileInput = document.createElement('input');
  fileInput.className = 'dk-import-input';
  fileInput.type = 'file';
  fileInput.accept = '.csv,.tsv,.json,.xlsx';

  var errorDiv = document.createElement('div');
  errorDiv.className = 'dk-import-error';
  errorDiv.style.display = 'none';

  zone.appendChild(icon);
  zone.appendChild(label);
  zone.appendChild(hint);
  zone.appendChild(btn);
  zone.appendChild(fileInput);
  zone.appendChild(errorDiv);
  container.appendChild(zone);

  function showError(msg) {
    errorDiv.textContent = msg;
    errorDiv.style.display = 'block';
  }

  function clearError() {
    errorDiv.textContent = '';
    errorDiv.style.display = 'none';
  }

  function handleFile(file) {
    clearError();
    var type = detectFileType(file.name);
    if (!type) {
      showError('Unsupported file type. Use .csv, .tsv, .json, or .xlsx');
      return;
    }

    if (type === 'xlsx') {
      var binReader = new FileReader();
      binReader.onload = function () {
        if (typeof parseXLSX !== 'function') {
          showError('XLSX parser not available in this build');
          return;
        }
        parseXLSX(binReader.result).then(function (result) {
          var dt = new DataFrame(result.headers, result.rows);
          onData(dt, file.name);
        }).catch(function (err) {
          showError('XLSX parse error: ' + err.message);
        });
      };
      binReader.onerror = function () {
        showError('Failed to read file: ' + file.name);
      };
      binReader.readAsArrayBuffer(file);
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var dt = parseFileText(reader.result, type);
        onData(dt, file.name);
      } catch (err) {
        showError('Parse error: ' + err.message);
      }
    };
    reader.onerror = function () {
      showError('Failed to read file: ' + file.name);
    };
    reader.readAsText(file);
  }

  // Drag events
  var dragCounter = 0;

  zone.addEventListener('dragenter', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    zone.classList.add('dk-dragover');
  });

  zone.addEventListener('dragleave', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      zone.classList.remove('dk-dragover');
    }
  });

  zone.addEventListener('dragover', function (e) {
    e.preventDefault();
    e.stopPropagation();
  });

  zone.addEventListener('drop', function (e) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    zone.classList.remove('dk-dragover');
    var files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFile(files[0]);
    }
  });

  // Click to browse
  btn.addEventListener('click', function (e) {
    e.stopPropagation();
    fileInput.click();
  });

  zone.addEventListener('click', function () {
    fileInput.click();
  });

  zone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', function () {
    if (fileInput.files && fileInput.files.length > 0) {
      handleFile(fileInput.files[0]);
      fileInput.value = ''; // reset so same file can be re-imported
    }
  });

  return {
    destroy: function () {
      if (zone.parentNode) zone.parentNode.removeChild(zone);
      var styleEl = document.getElementById('dk-import-styles');
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createFileImport: createFileImport };
}
