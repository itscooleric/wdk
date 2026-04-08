/**
 * SharePoint List Import
 * CSV → SharePoint list with column mapping, sequential and batch POST modes.
 * Zero external dependencies.
 */

/* global spFetch, spFetchWithRetry, spGetDigest, spGetLists, spGetListSchema, spParseError, spCreateErrorDisplay, spSupportsFeature, parseCSV */

/**
 * Get the ListItemEntityTypeFullName for a list.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @returns {Promise<string>}
 */
export async function spGetEntityType(siteUrl, listTitle) {
  var encodedTitle = encodeURIComponent(listTitle);
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')?$select=ListItemEntityTypeFullName",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  return data.d ? data.d.ListItemEntityTypeFullName : data.ListItemEntityTypeFullName;
}

/**
 * Import items into a SharePoint list.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {object[]} items - Array of objects with field:value pairs
 * @param {object} [options]
 * @param {string} [options.mode='sequential'] - 'sequential' or 'batch'
 * @param {function} [options.onProgress] - Callback: onProgress(importedCount, totalCount)
 * @returns {Promise<{success: number, failed: number, errors: Array<{index: number, error: string}>}>}
 */
export async function spImportItems(siteUrl, listTitle, items, options) {
  options = options || {};
  var mode = options.mode || 'sequential';
  var encodedTitle = encodeURIComponent(listTitle);
  var entityType = await spGetEntityType(siteUrl, listTitle);

  var result = { success: 0, failed: 0, errors: [] };

  if (mode === 'batch') {
    result = await _importBatch(siteUrl, listTitle, encodedTitle, entityType, items, options);
  } else {
    result = await _importSequential(siteUrl, listTitle, encodedTitle, entityType, items, options);
  }

  return result;
}

/**
 * Sequential import — one item at a time.
 */
async function _importSequential(siteUrl, listTitle, encodedTitle, entityType, items, options) {
  var result = { success: 0, failed: 0, errors: [] };
  var url = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items";

  for (var i = 0; i < items.length; i++) {
    var body = Object.assign({}, items[i]);
    body['__metadata'] = { type: entityType };

    try {
      var resp = await spFetchWithRetry(url, {
        method: 'POST',
        siteUrl: siteUrl,
        body: body,
        headers: {
          'Content-Type': 'application/json;odata=verbose',
          'Accept': 'application/json;odata=verbose'
        }
      });

      if (resp.ok) {
        result.success++;
      } else {
        var err = await spParseError(resp);
        result.failed++;
        result.errors.push({ index: i, error: err.message });
      }
    } catch (e) {
      result.failed++;
      result.errors.push({ index: i, error: e.message });
    }

    if (options.onProgress) {
      options.onProgress(result.success + result.failed, items.length);
    }
  }

  return result;
}

/**
 * Batch import — multiple items per $batch request (SP 2016+/SPO).
 */
async function _importBatch(siteUrl, listTitle, encodedTitle, entityType, items, options) {
  var result = { success: 0, failed: 0, errors: [] };
  var batchSize = 100;
  var url = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items";
  var batchUrl = siteUrl + '/_api/$batch';

  for (var start = 0; start < items.length; start += batchSize) {
    var chunk = items.slice(start, start + batchSize);
    var batchId = 'batch_' + Math.random().toString(36).substr(2, 9);
    var changesetId = 'changeset_' + Math.random().toString(36).substr(2, 9);

    var batchBody = '--' + batchId + '\r\n';
    batchBody += 'Content-Type: multipart/mixed; boundary=' + changesetId + '\r\n\r\n';

    chunk.forEach(function(item) {
      var itemBody = Object.assign({}, item);
      itemBody['__metadata'] = { type: entityType };

      batchBody += '--' + changesetId + '\r\n';
      batchBody += 'Content-Type: application/http\r\n';
      batchBody += 'Content-Transfer-Encoding: binary\r\n\r\n';
      batchBody += 'POST ' + url + ' HTTP/1.1\r\n';
      batchBody += 'Content-Type: application/json;odata=verbose\r\n';
      batchBody += 'Accept: application/json;odata=verbose\r\n\r\n';
      batchBody += JSON.stringify(itemBody) + '\r\n';
    });

    batchBody += '--' + changesetId + '--\r\n';
    batchBody += '--' + batchId + '--\r\n';

    try {
      var digest = await spGetDigest(siteUrl);
      var resp = await fetch(batchUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/mixed; boundary=' + batchId,
          'Accept': 'application/json;odata=verbose',
          'X-RequestDigest': digest
        },
        credentials: 'include',
        body: batchBody
      });

      if (resp.ok) {
        result.success += chunk.length;
      } else {
        // Fallback: count entire batch as failed
        result.failed += chunk.length;
        var err = await spParseError(resp);
        chunk.forEach(function(_, idx) {
          result.errors.push({ index: start + idx, error: err.message });
        });
      }
    } catch (e) {
      result.failed += chunk.length;
      chunk.forEach(function(_, idx) {
        result.errors.push({ index: start + idx, error: e.message });
      });
    }

    if (options.onProgress) {
      options.onProgress(result.success + result.failed, items.length);
    }
  }

  return result;
}

/**
 * Render the import UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 */
export function spCreateImportUI(container, siteUrl) {
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
  title.textContent = 'Import CSV to SharePoint List';
  wrapper.appendChild(title);

  // List selector
  var listRow = document.createElement('div');
  listRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var listLabel = document.createElement('span');
  listLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  listLabel.textContent = 'Target list:';
  listRow.appendChild(listLabel);

  var listSelect = document.createElement('select');
  listSelect.style.cssText = 'flex:1;padding:6px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  listSelect.innerHTML = '<option value="">Loading...</option>';
  listRow.appendChild(listSelect);
  wrapper.appendChild(listRow);

  // File picker
  var fileRow = document.createElement('div');
  fileRow.style.cssText = 'margin-bottom:12px;';

  var fileLabel = document.createElement('div');
  fileLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  fileLabel.textContent = 'CSV File';
  fileRow.appendChild(fileLabel);

  var fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv';
  fileInput.style.cssText = 'font-family:inherit;font-size:11px;color:' + text + ';';
  fileRow.appendChild(fileInput);
  wrapper.appendChild(fileRow);

  // Column mapping (populated after file load)
  var mappingSection = document.createElement('div');
  mappingSection.style.cssText = 'display:none;margin-bottom:12px;';

  var mappingLabel = document.createElement('div');
  mappingLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  mappingLabel.textContent = 'Column Mapping';
  mappingSection.appendChild(mappingLabel);

  var mappingTable = document.createElement('div');
  mappingSection.appendChild(mappingTable);
  wrapper.appendChild(mappingSection);

  // Preview
  var previewSection = document.createElement('div');
  previewSection.style.cssText = 'display:none;margin-bottom:12px;';
  var previewLabel = document.createElement('div');
  previewLabel.style.cssText = 'font-size:12px;color:' + textDim + ';margin-bottom:4px;';
  previewLabel.textContent = 'Preview (first 5 rows)';
  previewSection.appendChild(previewLabel);
  var previewContainer = document.createElement('div');
  previewContainer.style.cssText = 'font-size:11px;overflow-x:auto;';
  previewSection.appendChild(previewContainer);
  wrapper.appendChild(previewSection);

  // Import mode
  var modeRow = document.createElement('div');
  modeRow.style.cssText = 'display:flex;gap:12px;align-items:center;margin-bottom:12px;';

  var modeLabel = document.createElement('span');
  modeLabel.style.cssText = 'font-size:12px;color:' + textDim + ';';
  modeLabel.textContent = 'Mode:';
  modeRow.appendChild(modeLabel);

  var seqRadio = document.createElement('input');
  seqRadio.type = 'radio';
  seqRadio.name = 'sp-import-mode';
  seqRadio.value = 'sequential';
  seqRadio.checked = true;
  seqRadio.id = 'sp-imp-seq';
  var seqLabel = document.createElement('label');
  seqLabel.htmlFor = 'sp-imp-seq';
  seqLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  seqLabel.textContent = ' Sequential';
  modeRow.appendChild(seqRadio);
  modeRow.appendChild(seqLabel);

  var batchRadio = document.createElement('input');
  batchRadio.type = 'radio';
  batchRadio.name = 'sp-import-mode';
  batchRadio.value = 'batch';
  batchRadio.id = 'sp-imp-batch';
  var batchLabel = document.createElement('label');
  batchLabel.htmlFor = 'sp-imp-batch';
  batchLabel.style.cssText = 'font-size:11px;color:' + text + ';cursor:pointer;';
  batchLabel.textContent = ' Batch (SP 2016+)';
  modeRow.appendChild(batchRadio);
  modeRow.appendChild(batchLabel);
  wrapper.appendChild(modeRow);

  // Import button
  var importBtn = document.createElement('button');
  importBtn.textContent = 'Import';
  importBtn.style.cssText = 'padding:6px 20px;background:linear-gradient(135deg,' + cyan + ',' + purple + ');border:none;border-radius:4px;color:#000;font-family:inherit;font-size:12px;font-weight:700;cursor:pointer;';
  importBtn.disabled = true;
  wrapper.appendChild(importBtn);

  // Progress
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

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var csvData = null;
  var spSchema = [];

  // Load lists
  spGetLists(siteUrl).then(function(lists) {
    listSelect.innerHTML = '<option value="">— Select target list —</option>';
    lists.forEach(function(list) {
      var opt = document.createElement('option');
      opt.value = list.title;
      opt.textContent = list.title;
      listSelect.appendChild(opt);
    });
  });

  // On list select — load schema for mapping
  listSelect.addEventListener('change', function() {
    if (!listSelect.value) { spSchema = []; return; }
    spGetListSchema(siteUrl, listSelect.value).then(function(fields) {
      spSchema = fields;
      if (csvData) buildMapping();
    });
  });

  // On file select — parse CSV
  fileInput.addEventListener('change', function() {
    var file = fileInput.files[0];
    if (!file) return;

    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      if (typeof parseCSV === 'function') {
        csvData = parseCSV(text);
      } else {
        // Simple fallback CSV parse
        var lines = text.split('\n').filter(function(l) { return l.trim(); });
        var headers = lines[0].split(',').map(function(h) { return h.trim().replace(/^"|"$/g, ''); });
        var rows = lines.slice(1).map(function(l) {
          return l.split(',').map(function(v) { return v.trim().replace(/^"|"$/g, ''); });
        });
        csvData = { headers: headers, rows: rows, _headers: headers, _rows: rows };
      }

      // Show preview
      previewSection.style.display = 'block';
      var previewHeaders = csvData.headers || csvData._headers;
      var previewRows = (csvData.rows || csvData._rows).slice(0, 5);
      var html = '<table style="border-collapse:collapse;width:100%;"><tr>';
      previewHeaders.forEach(function(h) {
        html += '<th style="padding:3px 8px;border:1px solid ' + border + ';color:' + cyan + ';font-size:10px;text-align:left;">' + h + '</th>';
      });
      html += '</tr>';
      previewRows.forEach(function(row) {
        html += '<tr>';
        row.forEach(function(v) {
          html += '<td style="padding:3px 8px;border:1px solid ' + border + ';color:' + text + ';font-size:10px;">' + (v || '') + '</td>';
        });
        html += '</tr>';
      });
      html += '</table>';
      previewContainer.innerHTML = html;

      if (spSchema.length > 0) buildMapping();
      importBtn.disabled = false;
    };
    reader.readAsText(file);
  });

  function buildMapping() {
    mappingSection.style.display = 'block';
    mappingTable.innerHTML = '';

    var csvHeaders = csvData.headers || csvData._headers;
    var grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:1fr auto 1fr;gap:4px 8px;align-items:center;';

    // Header row
    grid.innerHTML = '<div style="font-size:10px;color:' + textDim + ';font-weight:600;">CSV Column</div>'
      + '<div style="font-size:10px;color:' + textDim + ';">→</div>'
      + '<div style="font-size:10px;color:' + textDim + ';font-weight:600;">SP Field</div>';

    csvHeaders.forEach(function(csvCol) {
      var csvDiv = document.createElement('div');
      csvDiv.style.cssText = 'font-size:11px;color:' + text + ';';
      csvDiv.textContent = csvCol;
      grid.appendChild(csvDiv);

      var arrow = document.createElement('div');
      arrow.style.cssText = 'font-size:11px;color:' + textDim + ';text-align:center;';
      arrow.textContent = '→';
      grid.appendChild(arrow);

      var select = document.createElement('select');
      select.style.cssText = 'padding:3px 6px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:3px;color:' + text + ';font-size:11px;';
      select.dataset.csvCol = csvCol;
      select.innerHTML = '<option value="">(skip)</option>';
      spSchema.forEach(function(f) {
        var opt = document.createElement('option');
        opt.value = f.name;
        opt.textContent = f.displayName;
        // Auto-match by name (case-insensitive)
        if (f.name.toLowerCase() === csvCol.toLowerCase() || f.displayName.toLowerCase() === csvCol.toLowerCase()) {
          opt.selected = true;
        }
        select.appendChild(opt);
      });
      grid.appendChild(select);
    });

    mappingTable.appendChild(grid);
  }

  // Import action
  importBtn.addEventListener('click', async function() {
    if (!csvData || !listSelect.value) return;

    var csvHeaders = csvData.headers || csvData._headers;
    var csvRows = csvData.rows || csvData._rows;

    // Build mapping from UI
    var mapping = {};
    var selects = mappingTable.querySelectorAll('select');
    selects.forEach(function(sel) {
      if (sel.value) {
        mapping[sel.dataset.csvCol] = sel.value;
      }
    });

    // Convert rows to objects using mapping
    var items = csvRows.map(function(row) {
      var obj = {};
      csvHeaders.forEach(function(h, i) {
        if (mapping[h]) {
          obj[mapping[h]] = row[i];
        }
      });
      return obj;
    });

    var mode = batchRadio.checked ? 'batch' : 'sequential';

    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Starting import...';
    importBtn.disabled = true;

    try {
      var result = await spImportItems(siteUrl, listSelect.value, items, {
        mode: mode,
        onProgress: function(done, total) {
          var pct = Math.round((done / total) * 100);
          progressFill.style.width = pct + '%';
          progressText.textContent = done + ' / ' + total + ' items (' + pct + '%)';
        }
      });

      progressFill.style.width = '100%';
      var summary = result.success + ' imported';
      if (result.failed > 0) {
        summary += ', ' + result.failed + ' failed';
        progressText.style.color = pink;
      }
      progressText.textContent = summary;

      if (result.errors.length > 0) {
        var errSummary = result.errors.slice(0, 5).map(function(e) {
          return 'Row ' + (e.index + 1) + ': ' + e.error;
        }).join('\n');
        if (result.errors.length > 5) {
          errSummary += '\n... and ' + (result.errors.length - 5) + ' more errors';
        }
        spCreateErrorDisplay(errorContainer, { message: errSummary });
      }
    } catch (err) {
      progressText.style.color = pink;
      progressText.textContent = 'Error: ' + err.message;
    }

    importBtn.disabled = false;
  });

  container.appendChild(wrapper);
}
