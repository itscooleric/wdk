/**
 * SharePoint List Export
 * Full paginated export with $select/$filter/$orderby support.
 * Download as CSV or JSON.
 * Zero external dependencies.
 */

/* global spFetchWithRetry, spParseError, toCSV, toJSON, downloadBlob */

/**
 * Export all items from a SharePoint list with pagination.
 * Follows odata.nextLink until all items are retrieved.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {object} [options]
 * @param {string} [options.select] - Comma-separated field names
 * @param {string} [options.filter] - OData filter expression
 * @param {string} [options.orderby] - OData orderby expression
 * @param {number} [options.top=100] - Items per page
 * @param {function} [options.onProgress] - Callback: onProgress(loadedCount, estimatedTotal)
 * @returns {Promise<{headers: string[], rows: any[][]}>} DataFrame-compatible result
 */
export async function spExportList(siteUrl, listTitle, options) {
  options = options || {};
  var top = options.top || 100;
  var encodedTitle = encodeURIComponent(listTitle);

  var baseUrl = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items?$top=" + top;
  if (options.select) baseUrl += '&$select=' + options.select;
  if (options.filter) baseUrl += '&$filter=' + encodeURIComponent(options.filter);
  if (options.orderby) baseUrl += '&$orderby=' + encodeURIComponent(options.orderby);

  var allItems = [];
  var url = baseUrl;
  var headers = null;

  while (url) {
    var resp = await spFetchWithRetry(url, { siteUrl: siteUrl });
    if (!resp.ok) {
      var err = await spParseError(resp);
      throw new Error(err.message);
    }

    var data = await resp.json();
    var results = data.d ? data.d.results : data.value;

    if (results.length > 0 && !headers) {
      headers = Object.keys(results[0]).filter(function(k) {
        return k !== '__metadata' && k !== 'odata.type' && k !== 'odata.id' && k !== 'odata.editLink';
      });
    }

    allItems = allItems.concat(results);

    if (options.onProgress) {
      options.onProgress(allItems.length, null);
    }

    url = data.d ? (data.d.__next || null) : (data['odata.nextLink'] || null);
  }

  if (!headers && allItems.length > 0) {
    headers = Object.keys(allItems[0]).filter(function(k) {
      return k !== '__metadata';
    });
  }

  headers = headers || [];

  var rows = allItems.map(function(item) {
    return headers.map(function(h) {
      var val = item[h];
      if (val && typeof val === 'object') return JSON.stringify(val);
      return val;
    });
  });

  return { headers: headers, rows: rows };
}

/**
 * Render the export configuration UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {Array<{name: string, displayName: string, type: string}>} schema
 */
export function spCreateExportUI(container, siteUrl, listTitle, schema) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';

  var title = document.createElement('div');
  title.style.cssText = 'font-size:14px;font-weight:700;color:' + purple + ';margin-bottom:12px;';
  title.textContent = 'Export: ' + listTitle;
  wrapper.appendChild(title);

  // --- Field selection ---
  var fieldSection = document.createElement('div');
  fieldSection.style.cssText = 'margin-bottom:12px;';

  var fieldLabel = document.createElement('div');
  fieldLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  fieldLabel.textContent = 'Fields';
  fieldSection.appendChild(fieldLabel);

  var selectAllRow = document.createElement('div');
  selectAllRow.style.cssText = 'margin-bottom:4px;';
  var selectAllBtn = document.createElement('button');
  selectAllBtn.textContent = 'Select All';
  selectAllBtn.style.cssText = 'padding:2px 8px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-size:10px;cursor:pointer;margin-right:4px;';
  var selectNoneBtn = document.createElement('button');
  selectNoneBtn.textContent = 'Select None';
  selectNoneBtn.style.cssText = selectAllBtn.style.cssText;
  selectAllRow.appendChild(selectAllBtn);
  selectAllRow.appendChild(selectNoneBtn);
  fieldSection.appendChild(selectAllRow);

  var fieldChecks = [];
  var fieldGrid = document.createElement('div');
  fieldGrid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:2px;max-height:120px;overflow-y:auto;';

  schema.forEach(function(field) {
    var label = document.createElement('label');
    label.style.cssText = 'display:flex;align-items:center;gap:4px;font-size:11px;color:' + text + ';cursor:pointer;padding:2px 0;';
    var cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = true;
    cb.dataset.fieldName = field.name;
    fieldChecks.push(cb);
    label.appendChild(cb);
    label.appendChild(document.createTextNode(field.displayName));
    fieldGrid.appendChild(label);
  });
  fieldSection.appendChild(fieldGrid);
  wrapper.appendChild(fieldSection);

  selectAllBtn.addEventListener('click', function() { fieldChecks.forEach(function(cb) { cb.checked = true; }); });
  selectNoneBtn.addEventListener('click', function() { fieldChecks.forEach(function(cb) { cb.checked = false; }); });

  // --- Filter builder ---
  var filterSection = document.createElement('div');
  filterSection.style.cssText = 'margin-bottom:12px;';

  var filterLabel = document.createElement('div');
  filterLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  filterLabel.textContent = 'Filters';
  filterSection.appendChild(filterLabel);

  var filterRows = document.createElement('div');
  filterSection.appendChild(filterRows);

  var addFilterBtn = document.createElement('button');
  addFilterBtn.textContent = '+ Add Filter';
  addFilterBtn.style.cssText = 'padding:3px 10px;background:transparent;border:1px solid ' + border + ';border-radius:3px;color:' + textDim + ';font-size:10px;cursor:pointer;margin-top:4px;';
  filterSection.appendChild(addFilterBtn);
  wrapper.appendChild(filterSection);

  var operators = [
    { value: 'eq', label: 'equals' },
    { value: 'ne', label: 'not equals' },
    { value: 'gt', label: 'greater than' },
    { value: 'lt', label: 'less than' },
    { value: 'ge', label: 'greater or equal' },
    { value: 'le', label: 'less or equal' },
    { value: 'substringof', label: 'contains' },
    { value: 'startswith', label: 'starts with' }
  ];

  function addFilterRow() {
    var row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:4px;';

    var colSelect = document.createElement('select');
    colSelect.style.cssText = 'padding:4px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
    schema.forEach(function(f) {
      var opt = document.createElement('option');
      opt.value = f.name;
      opt.textContent = f.displayName;
      colSelect.appendChild(opt);
    });
    row.appendChild(colSelect);

    var opSelect = document.createElement('select');
    opSelect.style.cssText = colSelect.style.cssText;
    operators.forEach(function(op) {
      var opt = document.createElement('option');
      opt.value = op.value;
      opt.textContent = op.label;
      opSelect.appendChild(opt);
    });
    row.appendChild(opSelect);

    var valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.placeholder = 'value';
    valInput.style.cssText = 'flex:1;padding:4px 8px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
    row.appendChild(valInput);

    var removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.cssText = 'padding:2px 6px;background:transparent;border:none;color:' + pink + ';font-size:12px;cursor:pointer;';
    removeBtn.addEventListener('click', function() { row.remove(); });
    row.appendChild(removeBtn);

    filterRows.appendChild(row);
  }

  addFilterBtn.addEventListener('click', addFilterRow);

  // --- Sort ---
  var sortSection = document.createElement('div');
  sortSection.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var sortLabel = document.createElement('span');
  sortLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  sortLabel.textContent = 'Sort by';
  sortSection.appendChild(sortLabel);

  var sortSelect = document.createElement('select');
  sortSelect.style.cssText = 'padding:4px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
  var noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none)';
  sortSelect.appendChild(noneOpt);
  schema.forEach(function(f) {
    var opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.displayName;
    sortSelect.appendChild(opt);
  });
  sortSection.appendChild(sortSelect);

  var sortDirSelect = document.createElement('select');
  sortDirSelect.style.cssText = sortSelect.style.cssText;
  sortDirSelect.innerHTML = '<option value="asc">Ascending</option><option value="desc">Descending</option>';
  sortSection.appendChild(sortDirSelect);
  wrapper.appendChild(sortSection);

  // --- Format + Export button ---
  var exportRow = document.createElement('div');
  exportRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:8px;';

  var fmtLabel = document.createElement('span');
  fmtLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  fmtLabel.textContent = 'Format:';
  exportRow.appendChild(fmtLabel);

  var csvRadio = document.createElement('input');
  csvRadio.type = 'radio';
  csvRadio.name = 'sp-export-fmt';
  csvRadio.value = 'csv';
  csvRadio.checked = true;
  csvRadio.id = 'sp-exp-csv';
  var csvLabel = document.createElement('label');
  csvLabel.htmlFor = 'sp-exp-csv';
  csvLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  csvLabel.textContent = ' CSV';
  exportRow.appendChild(csvRadio);
  exportRow.appendChild(csvLabel);

  var jsonRadio = document.createElement('input');
  jsonRadio.type = 'radio';
  jsonRadio.name = 'sp-export-fmt';
  jsonRadio.value = 'json';
  jsonRadio.id = 'sp-exp-json';
  var jsonLabel = document.createElement('label');
  jsonLabel.htmlFor = 'sp-exp-json';
  jsonLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  jsonLabel.textContent = ' JSON';
  exportRow.appendChild(jsonRadio);
  exportRow.appendChild(jsonLabel);

  var exportBtn = document.createElement('button');
  exportBtn.textContent = 'Export';
  exportBtn.style.cssText = 'padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;margin-left:auto;';
  exportRow.appendChild(exportBtn);
  wrapper.appendChild(exportRow);

  // Progress bar
  var progressContainer = document.createElement('div');
  progressContainer.style.cssText = 'display:none;margin-top:8px;';
  var progressBar = document.createElement('div');
  progressBar.style.cssText = 'height:4px;background:' + border + ';border-radius:2px;overflow:hidden;';
  var progressFill = document.createElement('div');
  progressFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,' + cyan + ',' + purple + ');transition:width 0.3s;';
  progressBar.appendChild(progressFill);
  progressContainer.appendChild(progressBar);
  var progressText = document.createElement('div');
  progressText.style.cssText = 'font-size:10px;color:' + textDim + ';margin-top:2px;';
  progressContainer.appendChild(progressText);
  wrapper.appendChild(progressContainer);

  // Export action
  exportBtn.addEventListener('click', async function() {
    var selectedFields = fieldChecks
      .filter(function(cb) { return cb.checked; })
      .map(function(cb) { return cb.dataset.fieldName; });

    if (selectedFields.length === 0) return;

    // Build filter
    var filterParts = [];
    var fRows = filterRows.querySelectorAll('div');
    fRows.forEach(function(row) {
      var col = row.querySelector('select:first-child');
      var op = row.querySelectorAll('select')[1];
      var val = row.querySelector('input');
      if (col && op && val && val.value) {
        var v = val.value;
        if (op.value === 'substringof') {
          filterParts.push("substringof('" + v + "'," + col.value + ")");
        } else if (op.value === 'startswith') {
          filterParts.push("startswith(" + col.value + ",'" + v + "')");
        } else {
          filterParts.push(col.value + " " + op.value + " '" + v + "'");
        }
      }
    });

    var opts = {
      select: selectedFields.join(','),
      filter: filterParts.length > 0 ? filterParts.join(' and ') : undefined,
      orderby: sortSelect.value ? (sortSelect.value + ' ' + sortDirSelect.value) : undefined,
      onProgress: function(loaded) {
        progressFill.style.width = '50%'; // Indeterminate since we don't know total
        progressText.textContent = loaded + ' items loaded...';
      }
    };

    progressContainer.style.display = 'block';
    progressFill.style.width = '10%';
    progressText.textContent = 'Starting export...';
    exportBtn.disabled = true;

    try {
      var result = await spExportList(siteUrl, listTitle, opts);
      progressFill.style.width = '100%';
      progressText.textContent = result.rows.length + ' items exported.';

      // Download
      var fmt = csvRadio.checked ? 'csv' : 'json';
      var content, mimeType, ext;
      if (fmt === 'csv') {
        content = typeof toCSV === 'function' ? toCSV(result) : _fallbackCSV(result);
        mimeType = 'text/csv';
        ext = 'csv';
      } else {
        content = typeof toJSON === 'function' ? toJSON(result, { pretty: true, asArray: true }) : JSON.stringify(result.rows, null, 2);
        mimeType = 'application/json';
        ext = 'json';
      }

      var blob = new Blob([content], { type: mimeType });
      if (typeof downloadBlob === 'function') {
        downloadBlob(blob, listTitle + '.' + ext);
      } else {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = listTitle + '.' + ext;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    } catch (err) {
      progressText.style.color = pink;
      progressText.textContent = 'Error: ' + err.message;
    }

    exportBtn.disabled = false;
  });

  container.appendChild(wrapper);
}

/**
 * Fallback CSV generation if toCSV is not available.
 * @param {{headers: string[], rows: any[][]}} table
 * @returns {string}
 */
function _fallbackCSV(table) {
  var lines = [table.headers.join(',')];
  table.rows.forEach(function(row) {
    lines.push(row.map(function(v) {
      if (v === null || v === undefined) return '';
      var s = String(v);
      if (s.indexOf(',') !== -1 || s.indexOf('"') !== -1 || s.indexOf('\n') !== -1) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    }).join(','));
  });
  return lines.join('\n');
}
