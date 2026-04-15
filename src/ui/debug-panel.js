/**
 * WDK Debug Panel
 * Unified debugging dashboard pulling together inspect modules
 * (network interceptor, console capture, storage viewer, DOM scraper)
 * into a single tabbed UI in the bottom panel.
 * Zero dependencies, var declarations, dk- prefixed CSS.
 */

/* global createDebugPanel */

var DK_DEBUG_THEME = {
  bg: '#0d0d22',
  cellBg: '#121228',
  border: '#2a2a4e',
  cyan: '#00e5ff',
  pink: '#ff2975',
  green: '#80d080',
  yellow: '#ffe066',
  text: '#e0e0f0',
  textDim: '#8888aa',
  error: '#ff4444',
};

function createDebugPanel(container, onDataLoaded) {
  var T = DK_DEBUG_THEME;

  // --- Inject styles ---
  if (!document.getElementById('dk-debug-panel-styles')) {
    var styleEl = document.createElement('style');
    styleEl.id = 'dk-debug-panel-styles';
    styleEl.textContent = [
      '.dk-debug-wrapper { display:flex; flex-direction:column; height:100%; font-family:"SF Mono","Fira Code","Consolas",monospace; font-size:12px; color:' + T.text + '; background:' + T.bg + '; }',
      '.dk-debug-tab-bar { display:flex; gap:0; background:' + T.bg + '; border-bottom:1px solid ' + T.border + '; flex-shrink:0; }',
      '.dk-debug-tab { background:transparent; color:' + T.textDim + '; border:none; border-bottom:2px solid transparent; padding:4px 12px; cursor:pointer; font-family:inherit; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; position:relative; }',
      '.dk-debug-tab.dk-active { color:' + T.cyan + '; border-bottom-color:' + T.cyan + '; }',
      '.dk-debug-tab .dk-debug-badge { position:absolute; top:1px; right:2px; background:' + T.pink + '; color:#fff; font-size:9px; padding:0 4px; border-radius:6px; min-width:14px; text-align:center; line-height:14px; }',
      '.dk-debug-content { flex:1; overflow:hidden; position:relative; }',
      '.dk-debug-pane { position:absolute; top:0; left:0; right:0; bottom:0; overflow-y:auto; padding:8px; display:none; }',
      '.dk-debug-pane.dk-active { display:block; }',
      '.dk-debug-btn { background:transparent; color:' + T.cyan + '; border:1px solid ' + T.border + '; padding:3px 10px; cursor:pointer; font-family:inherit; font-size:11px; border-radius:2px; margin-right:4px; }',
      '.dk-debug-btn:hover { border-color:' + T.cyan + '; }',
      '.dk-debug-btn-primary { background:' + T.cyan + '; color:#0a0a1a; border:none; font-weight:bold; }',
      '.dk-debug-table { width:100%; border-collapse:collapse; margin-top:6px; }',
      '.dk-debug-table th { text-align:left; padding:3px 6px; border-bottom:1px solid ' + T.border + '; color:' + T.textDim + '; font-size:10px; text-transform:uppercase; }',
      '.dk-debug-table td { padding:3px 6px; border-bottom:1px solid ' + T.border + '; font-size:11px; vertical-align:top; }',
      '.dk-debug-table tr:hover td { background:' + T.cellBg + '; }',
      '.dk-debug-table tr.dk-expandable { cursor:pointer; }',
      '.dk-debug-expand { padding:6px; background:' + T.cellBg + '; border:1px solid ' + T.border + '; border-radius:2px; margin:2px 0 6px; font-size:11px; white-space:pre-wrap; word-break:break-all; max-height:200px; overflow-y:auto; }',
      '.dk-debug-toolbar { display:flex; gap:4px; margin-bottom:6px; align-items:center; flex-wrap:wrap; }',
      '.dk-debug-status-2xx { color:' + T.green + '; }',
      '.dk-debug-status-4xx { color:' + T.yellow + '; }',
      '.dk-debug-status-5xx { color:' + T.error + '; }',
      '.dk-debug-level-log { background:#e0e0f0; color:#0a0a1a; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-level-warn { background:#ffe066; color:#0a0a1a; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-level-error { background:#ff4444; color:#fff; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-level-info { background:#00e5ff; color:#0a0a1a; padding:1px 5px; border-radius:2px; font-size:10px; }',
      '.dk-debug-input { background:' + T.cellBg + '; color:' + T.text + '; border:1px solid ' + T.border + '; padding:3px 8px; font-family:inherit; font-size:11px; border-radius:2px; flex:1; min-width:120px; }',
      '.dk-debug-input:focus { border-color:' + T.cyan + '; outline:none; }',
      '.dk-debug-msg { color:' + T.textDim + '; font-size:11px; padding:8px 0; }',
    ].join('\n');
    document.head.appendChild(styleEl);
  }

  // --- Wrapper ---
  var wrapper = document.createElement('div');
  wrapper.className = 'dk-debug-wrapper';

  // --- Tab bar ---
  var tabBar = document.createElement('div');
  tabBar.className = 'dk-debug-tab-bar';

  var panes = {};
  var tabs = {};
  var subTabNames = ['network', 'console', 'storage', 'dom'];
  var subTabLabels = { network: 'Network', console: 'Console', storage: 'Storage', dom: 'DOM' };

  var contentArea = document.createElement('div');
  contentArea.className = 'dk-debug-content';

  function switchTab(name) {
    subTabNames.forEach(function (k) {
      var isActive = k === name;
      if (panes[k]) {
        if (isActive) {
          panes[k].classList.add('dk-active');
        } else {
          panes[k].classList.remove('dk-active');
        }
      }
      if (tabs[k]) {
        if (isActive) {
          tabs[k].classList.add('dk-active');
        } else {
          tabs[k].classList.remove('dk-active');
        }
      }
    });
  }

  subTabNames.forEach(function (name) {
    var btn = document.createElement('button');
    btn.className = 'dk-debug-tab';
    btn.textContent = subTabLabels[name];
    btn.addEventListener('click', function () { switchTab(name); });
    tabs[name] = btn;
    tabBar.appendChild(btn);

    var pane = document.createElement('div');
    pane.className = 'dk-debug-pane';
    panes[name] = pane;
    contentArea.appendChild(pane);
  });

  wrapper.appendChild(tabBar);
  wrapper.appendChild(contentArea);
  container.appendChild(wrapper);

  // Badge helper
  function setBadge(tabName, count) {
    var tab = tabs[tabName];
    if (!tab) return;
    var badge = tab.querySelector('.dk-debug-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'dk-debug-badge';
        tab.appendChild(badge);
      }
      badge.textContent = count > 99 ? '99+' : String(count);
    } else if (badge) {
      tab.removeChild(badge);
    }
  }

  // Truncate helper
  function truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) + '...' : str;
  }

  // Format time
  function fmtTime(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    var s = d.getSeconds();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  // Status class helper
  function statusClass(code) {
    if (!code) return '';
    var n = parseInt(code, 10);
    if (n >= 200 && n < 300) return 'dk-debug-status-2xx';
    if (n >= 400 && n < 500) return 'dk-debug-status-4xx';
    if (n >= 500) return 'dk-debug-status-5xx';
    return '';
  }

  // =====================
  // NETWORK PANE
  // =====================
  var networkInterceptor = null;
  var networkExpandedRow = null;

  function initNetwork() {
    var pane = panes.network;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dk-debug-btn';
    clearBtn.textContent = 'Clear';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'dk-debug-btn';
    exportBtn.textContent = 'Export as CSV';

    toolbar.appendChild(clearBtn);
    toolbar.appendChild(exportBtn);
    pane.appendChild(toolbar);

    var tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;';
    pane.appendChild(tableWrap);

    function renderNetworkLog(log) {
      setBadge('network', log.length);
      var html = '<table class="dk-debug-table"><thead><tr>';
      html += '<th>Method</th><th>URL</th><th>Status</th><th>Size</th><th>Time</th>';
      html += '</tr></thead><tbody>';
      for (var i = 0; i < log.length; i++) {
        var entry = log[i];
        var sc = statusClass(entry.status);
        html += '<tr class="dk-expandable" data-idx="' + i + '">';
        html += '<td>' + (entry.method || 'GET') + '</td>';
        html += '<td title="' + (entry.url || '').replace(/"/g, '&quot;') + '">' + truncate(entry.url, 60) + '</td>';
        html += '<td class="' + sc + '">' + (entry.status || '-') + '</td>';
        html += '<td>' + (entry.size != null ? entry.size + 'B' : '-') + '</td>';
        html += '<td>' + (entry.duration != null ? entry.duration + 'ms' : '-') + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      tableWrap.innerHTML = html;

      // Click to expand
      var rows = tableWrap.querySelectorAll('tr.dk-expandable');
      for (var j = 0; j < rows.length; j++) {
        (function (row) {
          row.addEventListener('click', function () {
            var idx = parseInt(row.getAttribute('data-idx'), 10);
            var entry = log[idx];
            // Remove previous expand
            if (networkExpandedRow) {
              try { networkExpandedRow.parentNode.removeChild(networkExpandedRow); } catch (e) { /* ok */ }
              networkExpandedRow = null;
            }
            var detail = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = 5;
            var content = document.createElement('div');
            content.className = 'dk-debug-expand';
            var parts = [];
            parts.push('URL: ' + (entry.url || '-'));
            if (entry.requestHeaders) {
              parts.push('\nRequest Headers:\n' + formatHeaders(entry.requestHeaders));
            }
            if (entry.responseHeaders) {
              parts.push('\nResponse Headers:\n' + formatHeaders(entry.responseHeaders));
            }
            if (entry.responseBody) {
              parts.push('\nResponse Body (preview):\n' + truncate(entry.responseBody, 500));
            }
            content.textContent = parts.join('');
            td.appendChild(content);
            detail.appendChild(td);
            row.parentNode.insertBefore(detail, row.nextSibling);
            networkExpandedRow = detail;
          });
        })(rows[j]);
      }
    }

    function formatHeaders(headers) {
      if (typeof headers === 'string') return headers;
      if (!headers) return '';
      var result = '';
      var keys = Object.keys(headers);
      for (var i = 0; i < keys.length; i++) {
        result += '  ' + keys[i] + ': ' + headers[keys[i]] + '\n';
      }
      return result;
    }

    clearBtn.addEventListener('click', function () {
      if (networkInterceptor) networkInterceptor.clear();
      networkExpandedRow = null;
      tableWrap.innerHTML = '<p class="dk-debug-msg">Log cleared.</p>';
      setBadge('network', 0);
    });

    exportBtn.addEventListener('click', function () {
      if (!networkInterceptor) return;
      var log = networkInterceptor.getLog();
      if (!log.length) return;
      var headers = ['method', 'url', 'status', 'size', 'duration'];
      var rows = [];
      for (var i = 0; i < log.length; i++) {
        rows.push([
          log[i].method || 'GET',
          log[i].url || '',
          log[i].status != null ? String(log[i].status) : '',
          log[i].size != null ? String(log[i].size) : '',
          log[i].duration != null ? String(log[i].duration) : ''
        ]);
      }
      if (typeof onDataLoaded === 'function') {
        onDataLoaded({ _headers: headers, _rows: rows });
      }
    });

    // Auto-start
    if (window.WDK && typeof window.WDK.startIntercepting === 'function') {
      networkInterceptor = window.WDK.startIntercepting();
      networkInterceptor.onRequest(function () {
        renderNetworkLog(networkInterceptor.getLog());
      });
      // Also poll every 2s as fallback
      setInterval(function () {
        if (networkInterceptor) {
          renderNetworkLog(networkInterceptor.getLog());
        }
      }, 2000);
    } else {
      tableWrap.innerHTML = '<p class="dk-debug-msg">Network interceptor not available. Load inspect/network-interceptor.js first.</p>';
    }
  }

  // =====================
  // CONSOLE PANE
  // =====================
  var consoleCapture = null;

  function initConsole() {
    var pane = panes.console;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var clearBtn = document.createElement('button');
    clearBtn.className = 'dk-debug-btn';
    clearBtn.textContent = 'Clear';

    var exportBtn = document.createElement('button');
    exportBtn.className = 'dk-debug-btn';
    exportBtn.textContent = 'Export';

    toolbar.appendChild(clearBtn);
    toolbar.appendChild(exportBtn);
    pane.appendChild(toolbar);

    var logArea = document.createElement('div');
    logArea.style.cssText = 'overflow-y:auto;flex:1;';
    pane.appendChild(logArea);

    function renderConsoleLog(log) {
      var html = '';
      for (var i = 0; i < log.length; i++) {
        var entry = log[i];
        var ts = fmtTime(entry.timestamp || Date.now());
        var levelClass = 'dk-debug-level-' + (entry.level || 'log');
        html += '<div style="margin-bottom:2px;display:flex;gap:6px;align-items:baseline;">';
        html += '<span style="color:' + T.textDim + ';font-size:10px;flex-shrink:0;">' + ts + '</span>';
        html += '<span class="' + levelClass + '">' + (entry.level || 'log') + '</span>';
        html += '<span style="flex:1;word-break:break-all;">' + escapeHtml(entry.message || '') + '</span>';
        html += '</div>';
      }
      logArea.innerHTML = html || '<p class="dk-debug-msg">No console messages captured.</p>';
    }

    function escapeHtml(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    clearBtn.addEventListener('click', function () {
      if (consoleCapture) consoleCapture.clear();
      logArea.innerHTML = '<p class="dk-debug-msg">Log cleared.</p>';
    });

    exportBtn.addEventListener('click', function () {
      if (!consoleCapture) return;
      var log = consoleCapture.getLog();
      if (!log.length) return;
      var headers = ['timestamp', 'level', 'message'];
      var rows = [];
      for (var i = 0; i < log.length; i++) {
        rows.push([
          fmtTime(log[i].timestamp || Date.now()),
          log[i].level || 'log',
          log[i].message || ''
        ]);
      }
      if (typeof onDataLoaded === 'function') {
        onDataLoaded({ _headers: headers, _rows: rows });
      }
    });

    // Auto-start
    if (window.WDK && typeof window.WDK.startCapture === 'function') {
      consoleCapture = window.WDK.startCapture();
      // Poll to refresh display
      setInterval(function () {
        if (consoleCapture) {
          renderConsoleLog(consoleCapture.getLog());
        }
      }, 2000);
    } else {
      logArea.innerHTML = '<p class="dk-debug-msg">Console capture not available. Load inspect/console-capture.js first.</p>';
    }
  }

  // =====================
  // STORAGE PANE
  // =====================
  function initStorage() {
    var pane = panes.storage;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var captureBtn = document.createElement('button');
    captureBtn.className = 'dk-debug-btn dk-debug-btn-primary';
    captureBtn.textContent = 'Capture';

    var loadBtn = document.createElement('button');
    loadBtn.className = 'dk-debug-btn';
    loadBtn.textContent = 'Load as Table';
    loadBtn.style.display = 'none';

    toolbar.appendChild(captureBtn);
    toolbar.appendChild(loadBtn);
    pane.appendChild(toolbar);

    var tableWrap = document.createElement('div');
    tableWrap.style.cssText = 'overflow-y:auto;flex:1;';
    tableWrap.innerHTML = '<p class="dk-debug-msg">Click "Capture" to snapshot cookies, localStorage, and sessionStorage.</p>';
    pane.appendChild(tableWrap);

    var lastCapture = null;
    var storageExpandedRow = null;

    captureBtn.addEventListener('click', function () {
      if (!window.WDK || typeof window.WDK.captureStorage !== 'function') {
        tableWrap.innerHTML = '<p class="dk-debug-msg">Storage viewer not available. Load inspect/storage-viewer.js first.</p>';
        return;
      }
      lastCapture = window.WDK.captureStorage();
      loadBtn.style.display = '';
      renderStorageTable(lastCapture);
    });

    loadBtn.addEventListener('click', function () {
      if (!lastCapture || typeof onDataLoaded !== 'function') return;
      onDataLoaded({ _headers: lastCapture.headers, _rows: lastCapture.rows });
    });

    function renderStorageTable(data) {
      if (!data || !data.rows || !data.rows.length) {
        tableWrap.innerHTML = '<p class="dk-debug-msg">No storage data found.</p>';
        return;
      }
      var html = '<table class="dk-debug-table"><thead><tr>';
      for (var h = 0; h < data.headers.length; h++) {
        html += '<th>' + data.headers[h] + '</th>';
      }
      html += '</tr></thead><tbody>';
      for (var i = 0; i < data.rows.length; i++) {
        html += '<tr class="dk-expandable" data-idx="' + i + '">';
        for (var c = 0; c < data.rows[i].length; c++) {
          var val = String(data.rows[i][c] || '');
          html += '<td title="' + val.replace(/"/g, '&quot;') + '">' + truncate(val, 60) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      tableWrap.innerHTML = html;

      // Click to expand value
      var rows = tableWrap.querySelectorAll('tr.dk-expandable');
      for (var j = 0; j < rows.length; j++) {
        (function (row) {
          row.addEventListener('click', function () {
            var idx = parseInt(row.getAttribute('data-idx'), 10);
            if (storageExpandedRow) {
              try { storageExpandedRow.parentNode.removeChild(storageExpandedRow); } catch (e) { /* ok */ }
              storageExpandedRow = null;
            }
            var detail = document.createElement('tr');
            var td = document.createElement('td');
            td.colSpan = data.headers.length;
            var content = document.createElement('div');
            content.className = 'dk-debug-expand';
            content.textContent = data.rows[idx].join('\n');
            td.appendChild(content);
            detail.appendChild(td);
            row.parentNode.insertBefore(detail, row.nextSibling);
            storageExpandedRow = detail;
          });
        })(rows[j]);
      }
    }
  }

  // =====================
  // DOM PANE
  // =====================
  function initDOM() {
    var pane = panes.dom;
    var toolbar = document.createElement('div');
    toolbar.className = 'dk-debug-toolbar';

    var selectBtn = document.createElement('button');
    selectBtn.className = 'dk-debug-btn dk-debug-btn-primary';
    selectBtn.textContent = 'Select Table';

    var selectorInput = document.createElement('input');
    selectorInput.className = 'dk-debug-input';
    selectorInput.placeholder = 'CSS selector (e.g. table.data)';

    var extractBtn = document.createElement('button');
    extractBtn.className = 'dk-debug-btn';
    extractBtn.textContent = 'Extract by Selector';

    var loadBtn = document.createElement('button');
    loadBtn.className = 'dk-debug-btn';
    loadBtn.textContent = 'Load as Table';
    loadBtn.style.display = 'none';

    toolbar.appendChild(selectBtn);
    toolbar.appendChild(selectorInput);
    toolbar.appendChild(extractBtn);
    toolbar.appendChild(loadBtn);
    pane.appendChild(toolbar);

    var statusMsg = document.createElement('div');
    statusMsg.className = 'dk-debug-msg';
    statusMsg.textContent = 'Use "Select Table" to click a table on the page, or enter a CSS selector.';
    pane.appendChild(statusMsg);

    var previewWrap = document.createElement('div');
    previewWrap.style.cssText = 'overflow-y:auto;flex:1;';
    pane.appendChild(previewWrap);

    var lastExtraction = null;
    var scraper = null;

    function handleData(data) {
      if (!data || !data.headers || !data.rows) {
        statusMsg.textContent = 'No table data extracted.';
        return;
      }
      lastExtraction = data;
      loadBtn.style.display = '';
      statusMsg.textContent = 'Extracted ' + data.rows.length + ' rows, ' + data.headers.length + ' columns.';
      renderPreview(data);
    }

    function renderPreview(data) {
      var html = '<table class="dk-debug-table"><thead><tr>';
      for (var h = 0; h < data.headers.length; h++) {
        html += '<th>' + data.headers[h] + '</th>';
      }
      html += '</tr></thead><tbody>';
      var limit = Math.min(data.rows.length, 20);
      for (var i = 0; i < limit; i++) {
        html += '<tr>';
        for (var c = 0; c < data.rows[i].length; c++) {
          html += '<td>' + truncate(String(data.rows[i][c] || ''), 40) + '</td>';
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      if (data.rows.length > 20) {
        html += '<p class="dk-debug-msg">Showing first 20 of ' + data.rows.length + ' rows.</p>';
      }
      previewWrap.innerHTML = html;
    }

    selectBtn.addEventListener('click', function () {
      if (!window.WDK || typeof window.WDK.createDOMScraper !== 'function') {
        statusMsg.textContent = 'DOM scraper not available. Load inspect/dom-scraper.js first.';
        return;
      }
      if (!scraper) {
        scraper = window.WDK.createDOMScraper(function (data) {
          handleData(data);
        });
      }
      statusMsg.textContent = 'Click on a table in the page to extract it...';
      scraper.startSelect();
    });

    extractBtn.addEventListener('click', function () {
      var sel = selectorInput.value.trim();
      if (!sel) {
        statusMsg.textContent = 'Please enter a CSS selector.';
        return;
      }
      if (!window.WDK || typeof window.WDK.createDOMScraper !== 'function') {
        statusMsg.textContent = 'DOM scraper not available. Load inspect/dom-scraper.js first.';
        return;
      }
      if (!scraper) {
        scraper = window.WDK.createDOMScraper(function (data) {
          handleData(data);
        });
      }
      var data = scraper.extractBySelector(sel);
      handleData(data);
    });

    loadBtn.addEventListener('click', function () {
      if (!lastExtraction || typeof onDataLoaded !== 'function') return;
      onDataLoaded({ _headers: lastExtraction.headers, _rows: lastExtraction.rows });
    });
  }

  // --- Initialize all panes ---
  initNetwork();
  initConsole();
  initStorage();
  initDOM();

  // Activate first tab
  switchTab('network');

  return {
    switchTab: switchTab,
    getNetworkInterceptor: function () { return networkInterceptor; },
    getConsoleCapture: function () { return consoleCapture; }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createDebugPanel: createDebugPanel };
}
