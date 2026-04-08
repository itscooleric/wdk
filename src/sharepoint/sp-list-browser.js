/**
 * SharePoint List Browser
 * Enumerate lists, view schema, paginated item read with 5000-item threshold handling.
 * Zero external dependencies.
 */

/* global spFetch, spFetchWithRetry, spGetODataHeaders, spParseError, spCreateErrorDisplay, renderTable, DataFrame */

/**
 * Get all non-hidden lists from a SharePoint site.
 *
 * @param {string} siteUrl - The SharePoint site URL
 * @returns {Promise<Array<{title: string, id: string, itemCount: number, lastModified: string, baseTemplate: number}>>}
 */
export async function spGetLists(siteUrl) {
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists?$filter=Hidden eq false&$select=Title,Id,ItemCount,LastItemModifiedDate,BaseTemplate&$orderby=Title",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;

  return results.map(function(list) {
    return {
      title: list.Title,
      id: list.Id || list.ID,
      itemCount: list.ItemCount,
      lastModified: list.LastItemModifiedDate,
      baseTemplate: list.BaseTemplate
    };
  });
}

/**
 * Get the field schema for a SharePoint list.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @returns {Promise<Array<{name: string, displayName: string, type: string, required: boolean, choices: string[]}>>}
 */
export async function spGetListSchema(siteUrl, listTitle) {
  var encodedTitle = encodeURIComponent(listTitle);
  var resp = await spFetchWithRetry(
    siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/fields?$filter=Hidden eq false and ReadOnlyField eq false&$select=InternalName,Title,TypeAsString,Required,Choices",
    { siteUrl: siteUrl }
  );

  if (!resp.ok) {
    var err = await spParseError(resp);
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;

  return results.map(function(field) {
    return {
      name: field.InternalName,
      displayName: field.Title,
      type: field.TypeAsString,
      required: field.Required,
      choices: field.Choices ? (field.Choices.results || field.Choices) : []
    };
  });
}

/**
 * Get list items with pagination support.
 *
 * @param {string} siteUrl
 * @param {string} listTitle
 * @param {object} [options]
 * @param {number} [options.top=100] - Items per page
 * @param {string} [options.select] - $select fields
 * @param {string} [options.filter] - $filter expression
 * @param {string} [options.orderby] - $orderby expression
 * @param {string} [options.nextLink] - OData next link for pagination
 * @returns {Promise<{items: object[], totalCount: number, hasMore: boolean, nextLink: string|null}>}
 */
export async function spGetListItems(siteUrl, listTitle, options) {
  options = options || {};
  var top = options.top || 100;

  var url;
  if (options.nextLink) {
    url = options.nextLink;
  } else {
    var encodedTitle = encodeURIComponent(listTitle);
    url = siteUrl + "/_api/web/lists/getbytitle('" + encodedTitle + "')/items?$top=" + top;
    if (options.select) url += '&$select=' + options.select;
    if (options.filter) url += '&$filter=' + encodeURIComponent(options.filter);
    if (options.orderby) url += '&$orderby=' + encodeURIComponent(options.orderby);
  }

  var resp = await spFetchWithRetry(url, { siteUrl: siteUrl });

  if (!resp.ok) {
    var err = await spParseError(resp);
    // Check for 5000-item threshold
    if (resp.status === 500 && err.message.indexOf('threshold') !== -1) {
      throw new Error('List view threshold exceeded (5000 items). Add a filter on an indexed column to reduce results.');
    }
    throw new Error(err.message);
  }

  var data = await resp.json();
  var results = data.d ? data.d.results : data.value;
  var nextLink = data.d ? (data.d.__next || null) : (data['odata.nextLink'] || null);

  return {
    items: results,
    totalCount: results.length,
    hasMore: !!nextLink,
    nextLink: nextLink
  };
}

/**
 * Render the list browser UI.
 *
 * @param {HTMLElement} container
 * @param {string} siteUrl
 */
export function spCreateListBrowserUI(container, siteUrl) {
  var cyan = '#00e5ff';
  var pink = '#ff2975';
  var purple = '#b967ff';
  var bg = '#12122a';
  var bgDark = '#0a0a1a';
  var border = '#2a2a4a';
  var text = '#e0e0f0';
  var textDim = '#8888aa';
  var yellow = '#f5e642';

  var wrapper = document.createElement('div');
  wrapper.style.cssText = 'padding:16px;';

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'font-size:14px;font-weight:700;color:' + cyan + ';margin-bottom:12px;letter-spacing:1px;';
  header.textContent = 'SharePoint Lists';
  wrapper.appendChild(header);

  // List selector row
  var selectorRow = document.createElement('div');
  selectorRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:12px;';

  var listSelect = document.createElement('select');
  listSelect.style.cssText = 'flex:1;padding:6px 10px;background:' + bgDark + ';border:1px solid ' + border + ';border-radius:4px;color:' + text + ';font-family:inherit;font-size:12px;';
  listSelect.innerHTML = '<option value="">Loading lists...</option>';
  selectorRow.appendChild(listSelect);

  var loadBtn = document.createElement('button');
  loadBtn.textContent = 'Load Items';
  loadBtn.style.cssText = 'padding:6px 14px;background:transparent;border:1px solid ' + cyan + ';border-radius:4px;color:' + cyan + ';font-family:inherit;font-size:12px;cursor:pointer;';
  selectorRow.appendChild(loadBtn);
  wrapper.appendChild(selectorRow);

  // Threshold warning (hidden by default)
  var thresholdBanner = document.createElement('div');
  thresholdBanner.style.cssText = 'display:none;padding:8px 12px;background:#1a1a00;border:1px solid #555500;border-radius:4px;color:' + yellow + ';font-size:11px;margin-bottom:8px;';
  thresholdBanner.textContent = '⚠ This list has over 5,000 items. Use a filter on an indexed column to avoid threshold errors.';
  wrapper.appendChild(thresholdBanner);

  // Schema panel
  var schemaPanel = document.createElement('div');
  schemaPanel.style.cssText = 'display:none;margin-bottom:12px;padding:10px;background:' + bg + ';border:1px solid ' + border + ';border-radius:6px;';
  wrapper.appendChild(schemaPanel);

  // Table container
  var tableContainer = document.createElement('div');
  wrapper.appendChild(tableContainer);

  // Pagination row
  var pagRow = document.createElement('div');
  pagRow.style.cssText = 'display:none;margin-top:8px;display:flex;gap:8px;align-items:center;';

  var prevBtn = document.createElement('button');
  prevBtn.textContent = '← Previous';
  prevBtn.style.cssText = 'padding:4px 12px;background:transparent;border:1px solid ' + border + ';border-radius:4px;color:' + textDim + ';font-family:inherit;font-size:11px;cursor:pointer;';
  prevBtn.disabled = true;
  pagRow.appendChild(prevBtn);

  var pageInfo = document.createElement('span');
  pageInfo.style.cssText = 'font-size:11px;color:' + textDim + ';';
  pagRow.appendChild(pageInfo);

  var nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next →';
  nextBtn.style.cssText = 'padding:4px 12px;background:transparent;border:1px solid ' + border + ';border-radius:4px;color:' + textDim + ';font-family:inherit;font-size:11px;cursor:pointer;';
  nextBtn.disabled = true;
  pagRow.appendChild(nextBtn);
  wrapper.appendChild(pagRow);

  // Error container
  var errorContainer = document.createElement('div');
  wrapper.appendChild(errorContainer);

  // State
  var allLists = [];
  var pageHistory = [];
  var currentNextLink = null;

  // Load lists
  spGetLists(siteUrl).then(function(lists) {
    allLists = lists;
    listSelect.innerHTML = '<option value="">— Select a list (' + lists.length + ' available) —</option>';
    lists.forEach(function(list) {
      var opt = document.createElement('option');
      opt.value = list.title;
      opt.textContent = list.title + ' (' + list.itemCount + ' items)';
      listSelect.appendChild(opt);
    });
  }).catch(function(err) {
    listSelect.innerHTML = '<option value="">Error loading lists</option>';
    spCreateErrorDisplay(errorContainer, { message: err.message });
  });

  // On list selection — show schema
  listSelect.addEventListener('change', function() {
    var title = listSelect.value;
    schemaPanel.style.display = 'none';
    thresholdBanner.style.display = 'none';
    if (!title) return;

    // Check threshold
    var selectedList = allLists.find(function(l) { return l.title === title; });
    if (selectedList && selectedList.itemCount > 5000) {
      thresholdBanner.style.display = 'block';
    }

    schemaPanel.style.display = 'block';
    schemaPanel.innerHTML = '<div style="color:' + textDim + ';font-size:11px;">Loading schema...</div>';

    spGetListSchema(siteUrl, title).then(function(fields) {
      var html = '<div style="font-size:12px;font-weight:600;color:' + purple + ';margin-bottom:6px;">Columns (' + fields.length + ')</div>';
      html += '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:2px 12px;font-size:11px;">';
      html += '<div style="color:' + textDim + ';font-weight:600;">Name</div><div style="color:' + textDim + ';font-weight:600;">Type</div><div style="color:' + textDim + ';font-weight:600;">Req</div>';
      fields.forEach(function(f) {
        html += '<div style="color:' + text + ';">' + f.displayName + '</div>';
        html += '<div style="color:' + textDim + ';">' + f.type + '</div>';
        html += '<div style="color:' + (f.required ? pink : textDim) + ';">' + (f.required ? '●' : '○') + '</div>';
      });
      html += '</div>';
      schemaPanel.innerHTML = html;
    }).catch(function(err) {
      schemaPanel.innerHTML = '<div style="color:' + pink + ';font-size:11px;">Error: ' + err.message + '</div>';
    });
  });

  // Load items
  function loadItems(nextLink) {
    var title = listSelect.value;
    if (!title) return;

    tableContainer.innerHTML = '<div style="color:' + textDim + ';font-size:12px;padding:8px;">Loading items...</div>';

    var opts = nextLink ? { nextLink: nextLink } : {};

    spGetListItems(siteUrl, title, opts).then(function(result) {
      if (result.items.length === 0) {
        tableContainer.innerHTML = '<div style="color:' + textDim + ';font-size:12px;padding:8px;">No items found.</div>';
        return;
      }

      // Convert to DataFrame-compatible format
      var firstItem = result.items[0];
      var headers = Object.keys(firstItem).filter(function(k) {
        return k !== '__metadata' && k !== 'odata.type' && k !== 'odata.id' && k !== 'odata.editLink';
      });
      var rows = result.items.map(function(item) {
        return headers.map(function(h) {
          var val = item[h];
          if (val && typeof val === 'object') return JSON.stringify(val);
          return val;
        });
      });

      tableContainer.innerHTML = '';
      if (typeof renderTable === 'function') {
        var df = (typeof DataFrame === 'function')
          ? new DataFrame(headers, rows)
          : { headers: headers, rows: rows, _headers: headers, _rows: rows };
        renderTable(tableContainer, df);
      }

      // Pagination
      currentNextLink = result.nextLink;
      pagRow.style.display = 'flex';
      prevBtn.disabled = pageHistory.length === 0;
      nextBtn.disabled = !result.hasMore;
      pageInfo.textContent = 'Page ' + (pageHistory.length + 1) + ' · ' + result.items.length + ' items';

    }).catch(function(err) {
      tableContainer.innerHTML = '';
      spCreateErrorDisplay(errorContainer, { message: err.message });
    });
  }

  loadBtn.addEventListener('click', function() {
    pageHistory = [];
    loadItems(null);
  });

  nextBtn.addEventListener('click', function() {
    if (currentNextLink) {
      pageHistory.push(currentNextLink);
      loadItems(currentNextLink);
    }
  });

  prevBtn.addEventListener('click', function() {
    if (pageHistory.length > 0) {
      pageHistory.pop();
      var prev = pageHistory.length > 0 ? pageHistory[pageHistory.length - 1] : null;
      loadItems(prev);
    }
  });

  container.appendChild(wrapper);
}
