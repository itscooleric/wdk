/**
 * WDK App Shell
 * Full-page standalone application shell for Tier 2 deployment.
 * Detects bookmarklet vs standalone mode and routes accordingly.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

/* global createPanel, createFileImport, renderTable, createREPL, createPivotPanel, createNotebook, createBuildConfig, aggregate, pivot, execSQL, toCSV, toJSON, downloadBlob */

var DK_SHELL_THEME = {
  bg: '#0a0a1a',
  bgLight: '#12122a',
  bgPanel: '#0d0d20',
  bgHover: '#1a1a3a',
  bgActive: '#1e1e40',
  cyan: '#00e5ff',
  pink: '#ff2975',
  purple: '#b967ff',
  yellow: '#f5e642',
  text: '#e0e0f0',
  textDim: '#8888aa',
  textMuted: '#555577',
  border: '#2a2a4a',
  borderBright: '#3a3a6a',
  shadow: 'rgba(0, 229, 255, 0.12)',
  shadowPink: 'rgba(255, 41, 117, 0.12)',
};

function injectShellStyles() {
  if (document.getElementById('dk-shell-styles')) return;
  var style = document.createElement('style');
  style.id = 'dk-shell-styles';
  style.textContent = [
    /* Reset */
    '*, *::before, *::after { box-sizing: border-box; }',
    'html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }',
    'body {',
    '  background: ' + DK_SHELL_THEME.bg + ';',
    '  color: ' + DK_SHELL_THEME.text + ';',
    '  font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;',
    '  font-size: 13px;',
    '}',

    /* Shell layout */
    '#dk-shell {',
    '  display: flex; flex-direction: column; height: 100vh;',
    '  min-width: 800px;',
    '}',

    /* Header */
    '#dk-shell-header {',
    '  display: flex; align-items: center; gap: 12px;',
    '  padding: 0 16px; height: 44px; flex-shrink: 0;',
    '  background: linear-gradient(135deg, ' + DK_SHELL_THEME.bgLight + ' 0%, ' + DK_SHELL_THEME.bg + ' 100%);',
    '  border-bottom: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  box-shadow: 0 2px 16px ' + DK_SHELL_THEME.shadow + ';',
    '}',
    '#dk-shell-wordmark {',
    '  font-size: 15px; font-weight: 700; letter-spacing: 2px;',
    '  background: linear-gradient(90deg, ' + DK_SHELL_THEME.cyan + ' 0%, ' + DK_SHELL_THEME.purple + ' 60%, ' + DK_SHELL_THEME.pink + ' 100%);',
    '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '  background-clip: text; user-select: none;',
    '}',
    '#dk-shell-tagline {',
    '  font-size: 11px; color: ' + DK_SHELL_THEME.textMuted + '; letter-spacing: 0.5px;',
    '  border-left: 1px solid ' + DK_SHELL_THEME.border + '; padding-left: 12px;',
    '}',
    '#dk-shell-header-spacer { flex: 1; }',

    /* Toolbar */
    '#dk-shell-toolbar {',
    '  display: flex; align-items: center; gap: 4px;',
    '  padding: 5px 12px; flex-shrink: 0;',
    '  background: ' + DK_SHELL_THEME.bgPanel + ';',
    '  border-bottom: 1px solid ' + DK_SHELL_THEME.border + ';',
    '}',
    '.dk-toolbar-btn {',
    '  display: flex; align-items: center; gap: 5px;',
    '  padding: 4px 10px; border: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  border-radius: 4px; background: ' + DK_SHELL_THEME.bgHover + ';',
    '  color: ' + DK_SHELL_THEME.text + '; cursor: pointer;',
    '  font-family: inherit; font-size: 12px;',
    '  transition: background 0.12s, border-color 0.12s, color 0.12s;',
    '  white-space: nowrap;',
    '}',
    '.dk-toolbar-btn:hover {',
    '  background: ' + DK_SHELL_THEME.bgActive + ';',
    '  border-color: ' + DK_SHELL_THEME.borderBright + ';',
    '  color: ' + DK_SHELL_THEME.cyan + ';',
    '}',
    '.dk-toolbar-btn:disabled {',
    '  opacity: 0.35; cursor: not-allowed;',
    '}',
    '.dk-toolbar-btn:disabled:hover {',
    '  background: ' + DK_SHELL_THEME.bgHover + ';',
    '  border-color: ' + DK_SHELL_THEME.border + ';',
    '  color: ' + DK_SHELL_THEME.text + ';',
    '}',
    '.dk-toolbar-btn-icon { font-size: 14px; }',
    '.dk-toolbar-sep {',
    '  width: 1px; height: 20px;',
    '  background: ' + DK_SHELL_THEME.border + ';',
    '  margin: 0 4px; flex-shrink: 0;',
    '}',
    '#dk-col-types {',
    '  display: flex; gap: 4px; align-items: center;',
    '  margin-left: 8px; overflow: hidden;',
    '}',
    '.dk-col-badge {',
    '  font-size: 10px; padding: 1px 5px; border-radius: 3px;',
    '  background: ' + DK_SHELL_THEME.bgActive + ';',
    '  border: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  color: ' + DK_SHELL_THEME.textDim + ';',
    '  white-space: nowrap;',
    '}',
    '.dk-col-badge-num { color: ' + DK_SHELL_THEME.cyan + '; border-color: ' + DK_SHELL_THEME.cyan + '44; }',
    '.dk-col-badge-str { color: ' + DK_SHELL_THEME.purple + '; border-color: ' + DK_SHELL_THEME.purple + '44; }',
    '.dk-col-badge-bool { color: ' + DK_SHELL_THEME.yellow + '; border-color: ' + DK_SHELL_THEME.yellow + '44; }',
    '.dk-col-badge-more { color: ' + DK_SHELL_THEME.textDim + '; }',

    /* Content zone */
    '#dk-shell-content {',
    '  flex: 1; display: flex; flex-direction: column; overflow: hidden;',
    '}',

    /* Welcome / import view */
    '#dk-shell-welcome {',
    '  flex: 1; display: flex; align-items: center; justify-content: center;',
    '  padding: 40px 24px;',
    '}',
    '#dk-shell-import-wrap {',
    '  width: 100%; max-width: 560px;',
    '}',
    '#dk-shell-welcome-title {',
    '  text-align: center; margin-bottom: 28px;',
    '}',
    '#dk-shell-welcome-title h2 {',
    '  margin: 0 0 8px; font-size: 22px; font-weight: 700;',
    '  background: linear-gradient(90deg, ' + DK_SHELL_THEME.cyan + ', ' + DK_SHELL_THEME.purple + ');',
    '  -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '  background-clip: text;',
    '}',
    '#dk-shell-welcome-title p {',
    '  margin: 0; font-size: 12px; color: ' + DK_SHELL_THEME.textDim + ';',
    '}',

    /* Data view: table + repl split */
    '#dk-shell-data-view {',
    '  flex: 1; display: flex; flex-direction: column; overflow: hidden;',
    '  display: none;',
    '}',
    '#dk-shell-data-view.dk-active { display: flex; }',
    '#dk-shell-table-pane {',
    '  flex: 1; overflow: auto; min-height: 120px;',
    '  border-bottom: 1px solid ' + DK_SHELL_THEME.border + ';',
    '}',
    '#dk-shell-split-handle {',
    '  height: 5px; flex-shrink: 0; cursor: ns-resize;',
    '  background: ' + DK_SHELL_THEME.border + ';',
    '  transition: background 0.12s;',
    '}',
    '#dk-shell-split-handle:hover { background: ' + DK_SHELL_THEME.purple + '; }',
    '#dk-shell-repl-pane {',
    '  height: 280px; min-height: 80px; flex-shrink: 0; overflow: hidden;',
    '  display: flex; flex-direction: column;',
    '}',

    /* Status bar */
    '#dk-shell-status {',
    '  display: flex; align-items: center; gap: 16px;',
    '  padding: 3px 14px; height: 24px; flex-shrink: 0;',
    '  background: ' + DK_SHELL_THEME.bgPanel + ';',
    '  border-top: 1px solid ' + DK_SHELL_THEME.border + ';',
    '  font-size: 11px; color: ' + DK_SHELL_THEME.textDim + ';',
    '}',
    '.dk-status-item { display: flex; align-items: center; gap: 4px; }',
    '.dk-status-val { color: ' + DK_SHELL_THEME.text + '; font-weight: 500; }',
    '#dk-status-filename { color: ' + DK_SHELL_THEME.cyan + '; }',
    '.dk-status-sep {',
    '  width: 1px; height: 12px; background: ' + DK_SHELL_THEME.border + ';',
    '}',
    '#dk-shell-kbd-hints {',
    '  margin-left: auto; color: ' + DK_SHELL_THEME.textMuted + '; font-size: 10px;',
    '  letter-spacing: 0.3px;',
    '}',

    /* Notification toast */
    '#dk-shell-toast {',
    '  position: fixed; bottom: 36px; left: 50%; transform: translateX(-50%);',
    '  padding: 7px 18px; border-radius: 5px;',
    '  background: ' + DK_SHELL_THEME.bgActive + ';',
    '  border: 1px solid ' + DK_SHELL_THEME.borderBright + ';',
    '  color: ' + DK_SHELL_THEME.text + '; font-size: 12px;',
    '  box-shadow: 0 4px 20px rgba(0,0,0,0.4);',
    '  opacity: 0; pointer-events: none;',
    '  transition: opacity 0.18s;',
    '  z-index: 9999;',
    '}',
    '#dk-shell-toast.dk-visible { opacity: 1; }',
  ].join('\n');
  document.head.appendChild(style);
}

/**
 * Detect if we are running as a full standalone page or injected into another page.
 * Standalone: the document body has no pre-existing meaningful content,
 * or the page URL ends in datakit.html / is a file:// origin.
 * @returns {boolean}
 */
function isStandaloneMode() {
  var loc = window.location;
  // file:// protocol — always standalone
  if (loc.protocol === 'file:') return true;
  // URL pathname ends with datakit.html
  if (loc.pathname && /datakit\.html?$/i.test(loc.pathname)) return true;
  // Body has no children at all yet (freshly opened page)
  if (document.body && document.body.children.length === 0) return true;
  return false;
}

/**
 * Guess a type classification for a column's values.
 * Returns 'num', 'bool', or 'str'.
 * @param {any[]} values
 * @returns {string}
 */
function guessColType(values) {
  var sample = values.slice(0, 50).filter(function (v) { return v !== null && v !== undefined && v !== ''; });
  if (sample.length === 0) return 'str';
  var numCount = 0;
  var boolCount = 0;
  for (var i = 0; i < sample.length; i++) {
    var s = String(sample[i]).trim().toLowerCase();
    if (s === 'true' || s === 'false') { boolCount++; continue; }
    if (!isNaN(s) && s !== '') numCount++;
  }
  if (numCount >= sample.length * 0.8) return 'num';
  if (boolCount >= sample.length * 0.8) return 'bool';
  return 'str';
}

/**
 * Build column type badges from a DataFrame.
 * Returns an array of { name, type } objects.
 * @param {object} df
 * @returns {Array}
 */
function buildColTypes(df) {
  var headers = df._headers || [];
  var rows = df._rows || [];
  return headers.map(function (h, i) {
    var values = rows.map(function (r) { return r[i]; });
    return { name: h, type: guessColType(values) };
  });
}

/**
 * Format a byte count as a human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

/**
 * Create and mount the full-page application shell.
 * Should be called once on DOMContentLoaded.
 */
function createAppShell() {
  injectShellStyles();

  var currentDf = null;
  var currentFilename = null;
  var replInstance = null;
  var pivotInstance = null;
  var notebookInstance = null;
  var toastTimer = null;

  // ─── Toast notification ──────────────────────────────────────────

  var toast = document.createElement('div');
  toast.id = 'dk-shell-toast';
  document.body.appendChild(toast);

  function showToast(msg, durationMs) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.add('dk-visible');
    toastTimer = setTimeout(function () {
      toast.classList.remove('dk-visible');
    }, durationMs || 2200);
  }

  // ─── Shell skeleton ───────────────────────────────────────────────

  var shell = document.createElement('div');
  shell.id = 'dk-shell';

  // Header
  var header = document.createElement('div');
  header.id = 'dk-shell-header';

  var wordmark = document.createElement('span');
  wordmark.id = 'dk-shell-wordmark';
  wordmark.textContent = 'WDK';

  var tagline = document.createElement('span');
  tagline.id = 'dk-shell-tagline';
  tagline.textContent = "Wizard's Data Engineering Kit";

  var headerSpacer = document.createElement('span');
  headerSpacer.id = 'dk-shell-header-spacer';

  header.appendChild(wordmark);
  header.appendChild(tagline);
  header.appendChild(headerSpacer);

  // Toolbar
  var toolbar = document.createElement('div');
  toolbar.id = 'dk-shell-toolbar';

  function makeToolbarBtn(icon, label, title, shortcut) {
    var btn = document.createElement('button');
    btn.className = 'dk-toolbar-btn';
    btn.title = title + (shortcut ? '  (' + shortcut + ')' : '');
    var iconSpan = document.createElement('span');
    iconSpan.className = 'dk-toolbar-btn-icon';
    iconSpan.textContent = icon;
    btn.appendChild(iconSpan);
    btn.appendChild(document.createTextNode(label));
    return btn;
  }

  function makeToolbarSep() {
    var sep = document.createElement('div');
    sep.className = 'dk-toolbar-sep';
    return sep;
  }

  var btnImport = makeToolbarBtn('\u2913', 'Import', 'Import a file', 'Ctrl+I');
  var btnExportCSV = makeToolbarBtn('\u2191', 'CSV', 'Export as CSV', 'Ctrl+E');
  var btnExportJSON = makeToolbarBtn('\u2191', 'JSON', 'Export as JSON');
  var btnClear = makeToolbarBtn('\u2715', 'Clear', 'Clear loaded data', 'Ctrl+L');

  btnExportCSV.disabled = true;
  btnExportJSON.disabled = true;
  btnClear.disabled = true;

  var colTypeContainer = document.createElement('div');
  colTypeContainer.id = 'dk-col-types';

  toolbar.appendChild(btnImport);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnExportCSV);
  toolbar.appendChild(btnExportJSON);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnClear);
  toolbar.appendChild(colTypeContainer);

  // Content area
  var content = document.createElement('div');
  content.id = 'dk-shell-content';

  // Welcome / import view
  var welcomeView = document.createElement('div');
  welcomeView.id = 'dk-shell-welcome';

  var welcomeTitleWrap = document.createElement('div');
  welcomeTitleWrap.id = 'dk-shell-welcome-title';

  var welcomeH2 = document.createElement('h2');
  welcomeH2.textContent = 'Open a data file';

  var welcomeP = document.createElement('p');
  welcomeP.textContent = 'Drop a .csv, .tsv, or .json file below — or click Browse to get started';

  welcomeTitleWrap.appendChild(welcomeH2);
  welcomeTitleWrap.appendChild(welcomeP);

  var importWrap = document.createElement('div');
  importWrap.id = 'dk-shell-import-wrap';
  importWrap.appendChild(welcomeTitleWrap);

  welcomeView.appendChild(importWrap);

  // Data view (table + REPL)
  var dataView = document.createElement('div');
  dataView.id = 'dk-shell-data-view';

  var tablePane = document.createElement('div');
  tablePane.id = 'dk-shell-table-pane';

  var splitHandle = document.createElement('div');
  splitHandle.id = 'dk-shell-split-handle';

  var replPane = document.createElement('div');
  replPane.id = 'dk-shell-repl-pane';

  var pivotPane = document.createElement('div');
  pivotPane.id = 'dk-shell-pivot-pane';
  pivotPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var notebookPane = document.createElement('div');
  notebookPane.id = 'dk-shell-notebook-pane';
  notebookPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var buildPane = document.createElement('div');
  buildPane.id = 'dk-shell-build-pane';
  buildPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  // Bottom panel tab bar
  var bottomTabBar = document.createElement('div');
  bottomTabBar.style.cssText = 'display:flex;gap:0;background:#0a0a1a;border-bottom:1px solid ' + DK_SHELL_THEME.border + ';flex-shrink:0;';
  var bottomPanes = { repl: replPane, pivot: pivotPane, notebook: notebookPane, build: buildPane };
  function makeBottomTab(label, target) {
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.style.cssText = 'background:transparent;color:' + DK_SHELL_THEME.textDim + ';border:none;border-bottom:2px solid transparent;padding:4px 12px;cursor:pointer;font-family:inherit;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
    btn.addEventListener('click', function () {
      Object.keys(bottomPanes).forEach(function (k) { bottomPanes[k].style.display = k === target ? 'flex' : 'none'; });
      bottomTabBar.querySelectorAll('button').forEach(function (b) {
        b.style.color = DK_SHELL_THEME.textDim;
        b.style.borderBottomColor = 'transparent';
      });
      btn.style.color = DK_SHELL_THEME.cyan;
      btn.style.borderBottomColor = DK_SHELL_THEME.cyan;
    });
    return btn;
  }
  var replTab = makeBottomTab('REPL', 'repl');
  var pivotTab = makeBottomTab('Pivot', 'pivot');
  var notebookTab = makeBottomTab('Notebook', 'notebook');
  replTab.style.color = DK_SHELL_THEME.cyan;
  replTab.style.borderBottomColor = DK_SHELL_THEME.cyan;
  var buildTab = makeBottomTab('Build', 'build');
  bottomTabBar.appendChild(replTab);
  bottomTabBar.appendChild(pivotTab);
  bottomTabBar.appendChild(notebookTab);
  bottomTabBar.appendChild(buildTab);

  // Bottom panel container
  var bottomPanel = document.createElement('div');
  bottomPanel.style.cssText = 'height:280px;min-height:80px;flex-shrink:0;overflow:hidden;display:flex;flex-direction:column;';
  bottomPanel.appendChild(bottomTabBar);
  bottomPanel.appendChild(replPane);
  bottomPanel.appendChild(pivotPane);
  bottomPanel.appendChild(notebookPane);
  bottomPanel.appendChild(buildPane);

  dataView.appendChild(tablePane);
  dataView.appendChild(splitHandle);
  dataView.appendChild(bottomPanel);

  content.appendChild(welcomeView);
  content.appendChild(dataView);

  // Init build configurator (doesn't need data)
  if (typeof createBuildConfig === 'function') {
    createBuildConfig(buildPane);
  }

  // Status bar
  var statusBar = document.createElement('div');
  statusBar.id = 'dk-shell-status';

  function makeStatusItem(id, label) {
    var item = document.createElement('span');
    item.className = 'dk-status-item';
    if (label) {
      var lbl = document.createElement('span');
      lbl.textContent = label;
      item.appendChild(lbl);
    }
    var val = document.createElement('span');
    val.className = 'dk-status-val';
    if (id) val.id = id;
    item.appendChild(val);
    return { item: item, val: val };
  }

  var filenameItem = makeStatusItem('dk-status-filename', '');
  filenameItem.val.id = 'dk-status-filename';
  var rowsItem = makeStatusItem('dk-status-rows', 'Rows:');
  var colsItem = makeStatusItem('dk-status-cols', 'Cols:');
  var sizeItem = makeStatusItem('dk-status-size', 'Size:');
  var statusSep1 = document.createElement('span');
  statusSep1.className = 'dk-status-sep';
  var statusSep2 = document.createElement('span');
  statusSep2.className = 'dk-status-sep';
  var statusSep3 = document.createElement('span');
  statusSep3.className = 'dk-status-sep';

  var kbdHints = document.createElement('span');
  kbdHints.id = 'dk-shell-kbd-hints';
  kbdHints.textContent = 'Ctrl+I import \u00b7 Ctrl+E export CSV \u00b7 Ctrl+L clear';

  statusBar.appendChild(filenameItem.item);
  statusBar.appendChild(statusSep1);
  statusBar.appendChild(rowsItem.item);
  statusBar.appendChild(statusSep2);
  statusBar.appendChild(colsItem.item);
  statusBar.appendChild(statusSep3);
  statusBar.appendChild(sizeItem.item);
  statusBar.appendChild(kbdHints);

  // Assemble shell
  shell.appendChild(header);
  shell.appendChild(toolbar);
  shell.appendChild(content);
  shell.appendChild(statusBar);

  document.body.appendChild(shell);

  // ─── File import widget ───────────────────────────────────────────

  if (typeof createFileImport === 'function') {
    createFileImport(importWrap, onDataLoaded);
  }

  // ─── REPL context factory ─────────────────────────────────────────

  function getREPLContext() {
    if (!currentDf) {
      return { data: [], rows: [], headers: [], meta: { rowCount: 0, columnCount: 0 } };
    }
    var headers = currentDf._headers || [];
    var rows = currentDf._rows || [];
    var data;
    if (typeof currentDf.toObjects === 'function') {
      data = currentDf.toObjects();
    } else {
      data = rows.map(function (row) {
        var obj = {};
        headers.forEach(function (h, i) { obj[h] = row[i]; });
        return obj;
      });
    }
    return {
      data: data,
      rows: rows,
      headers: headers,
      meta: { rowCount: rows.length, columnCount: headers.length }
    };
  }

  // ─── Data loaded callback ─────────────────────────────────────────

  function onDataLoaded(table, filename) {
    currentDf = table;
    currentFilename = filename || 'data';

    // Switch views
    welcomeView.style.display = 'none';
    dataView.classList.add('dk-active');

    // Render table
    if (typeof renderTable === 'function') {
      tablePane.innerHTML = '';
      renderTable(tablePane, table);
    }

    // Create REPL once
    if (typeof createREPL === 'function' && !replInstance) {
      replPane.innerHTML = '';
      replInstance = createREPL(replPane, getREPLContext);
    }

    // Create Pivot panel once, refresh columns on each load
    if (typeof createPivotPanel === 'function') {
      if (!pivotInstance) {
        pivotPane.innerHTML = '';
        pivotInstance = createPivotPanel(pivotPane, function () { return currentDf; });
      }
      pivotInstance.refresh();
    }

    // Create Notebook once
    if (typeof createNotebook === 'function' && !notebookInstance) {
      notebookPane.innerHTML = '';
      notebookInstance = createNotebook(notebookPane, getREPLContext);
    }

    // Update status bar
    var headers = table._headers || [];
    var rows = table._rows || [];
    var byteEst = JSON.stringify(rows).length;
    filenameItem.val.textContent = currentFilename;
    rowsItem.val.textContent = rows.length.toLocaleString();
    colsItem.val.textContent = headers.length.toLocaleString();
    sizeItem.val.textContent = formatBytes(byteEst);

    // Update column type badges
    updateColTypeBadges(table);

    // Enable export + clear
    btnExportCSV.disabled = false;
    btnExportJSON.disabled = false;
    btnClear.disabled = false;

    showToast('\u2713 Loaded ' + currentFilename + ' \u2014 ' + rows.length.toLocaleString() + ' rows');
  }

  // ─── Column type badges ───────────────────────────────────────────

  function updateColTypeBadges(table) {
    colTypeContainer.innerHTML = '';
    var colTypes = buildColTypes(table);
    var maxBadges = 6;
    var shown = Math.min(colTypes.length, maxBadges);

    for (var i = 0; i < shown; i++) {
      var ct = colTypes[i];
      var badge = document.createElement('span');
      badge.className = 'dk-col-badge dk-col-badge-' + ct.type;
      badge.title = ct.name + ' (' + ct.type + ')';
      var truncName = ct.name.length > 10 ? ct.name.slice(0, 9) + '\u2026' : ct.name;
      badge.textContent = truncName + ':' + ct.type;
      colTypeContainer.appendChild(badge);
    }

    if (colTypes.length > maxBadges) {
      var moreBadge = document.createElement('span');
      moreBadge.className = 'dk-col-badge dk-col-badge-more';
      moreBadge.textContent = '+' + (colTypes.length - maxBadges) + ' more';
      colTypeContainer.appendChild(moreBadge);
    }
  }

  // ─── Export helpers ───────────────────────────────────────────────

  function exportCSV() {
    if (!currentDf) return;
    if (typeof toCSV !== 'function' || typeof downloadBlob !== 'function') {
      showToast('Export functions not available');
      return;
    }
    var csvContent = toCSV({
      headers: currentDf._headers || [],
      rows: currentDf._rows || []
    });
    var name = (currentFilename || 'export').replace(/\.[^.]+$/, '') + '.csv';
    downloadBlob(csvContent, name, 'text/csv');
    showToast('\u2193 Exported ' + name);
  }

  function exportJSON() {
    if (!currentDf) return;
    if (typeof toJSON !== 'function' || typeof downloadBlob !== 'function') {
      showToast('Export functions not available');
      return;
    }
    var jsonContent = toJSON({
      headers: currentDf._headers || [],
      rows: currentDf._rows || []
    }, { pretty: true, asArray: true });
    var name = (currentFilename || 'export').replace(/\.[^.]+$/, '') + '.json';
    downloadBlob(jsonContent, name, 'application/json');
    showToast('\u2193 Exported ' + name);
  }

  // ─── Clear ────────────────────────────────────────────────────────

  function clearData() {
    currentDf = null;
    currentFilename = null;
    replInstance = null;

    dataView.classList.remove('dk-active');
    welcomeView.style.display = '';
    tablePane.innerHTML = '';
    replPane.innerHTML = '';
    colTypeContainer.innerHTML = '';

    filenameItem.val.textContent = '';
    rowsItem.val.textContent = '';
    colsItem.val.textContent = '';
    sizeItem.val.textContent = '';

    btnExportCSV.disabled = true;
    btnExportJSON.disabled = true;
    btnClear.disabled = true;
  }

  // ─── Toolbar events ───────────────────────────────────────────────

  btnImport.addEventListener('click', function () {
    // Trigger the hidden file input inside the import widget
    var fileInput = importWrap.querySelector('input[type="file"]');
    if (fileInput) fileInput.click();
  });

  btnExportCSV.addEventListener('click', exportCSV);
  btnExportJSON.addEventListener('click', exportJSON);
  btnClear.addEventListener('click', clearData);

  // ─── Split handle drag ────────────────────────────────────────────

  var splitDragging = false;
  var splitStartY = 0;
  var splitStartReplH = 0;

  splitHandle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    splitDragging = true;
    splitStartY = e.clientY;
    splitStartReplH = replPane.offsetHeight;
  });

  document.addEventListener('mousemove', function (e) {
    if (!splitDragging) return;
    e.preventDefault();
    var delta = splitStartY - e.clientY; // drag up = bigger repl
    var newH = Math.max(80, Math.min(splitStartReplH + delta, window.innerHeight - 200));
    replPane.style.height = newH + 'px';
  });

  document.addEventListener('mouseup', function () {
    splitDragging = false;
  });

  // ─── Keyboard shortcuts ───────────────────────────────────────────

  document.addEventListener('keydown', function (e) {
    if (!e.ctrlKey && !e.metaKey) return;

    if (e.key === 'i' || e.key === 'I') {
      // Don't intercept when typing in textarea/input
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) return;
      e.preventDefault();
      var fi = importWrap.querySelector('input[type="file"]');
      if (fi) fi.click();
    }

    if (e.key === 'e' || e.key === 'E') {
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) return;
      e.preventDefault();
      exportCSV();
    }

    if (e.key === 'l' || e.key === 'L') {
      if (document.activeElement && (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT')) return;
      e.preventDefault();
      clearData();
    }
  });

  // ─── Public API ───────────────────────────────────────────────────

  return {
    shell: shell,
    loadData: onDataLoaded,
    clearData: clearData,
    exportCSV: exportCSV,
    exportJSON: exportJSON,
  };
}

/**
 * Entry point — detects mode and initialises accordingly.
 * Called by main() in build.js when app-shell is present.
 */
function initWDK() {
  if (isStandaloneMode()) {
    createAppShell();
  } else {
    // Bookmarklet / injected mode — fall back to floating panel
    if (typeof createPanel === 'function') {
      var panel = createPanel();
      var contentArea = panel.contentArea || panel.content || panel;
      var currentDf = null;
      var replInstance = null;

      function getREPLContext() {
        if (!currentDf) {
          return { data: [], rows: [], headers: [], meta: { rowCount: 0, columnCount: 0 } };
        }
        var headers = currentDf._headers || currentDf.headers || [];
        var rows = currentDf._rows || currentDf.rows || [];
        var data;
        if (typeof currentDf.toObjects === 'function') {
          data = currentDf.toObjects();
        } else {
          data = rows.map(function (row) {
            var obj = {};
            headers.forEach(function (h, i) { obj[h] = row[i]; });
            return obj;
          });
        }
        return {
          data: data,
          rows: rows,
          headers: headers,
          meta: { rowCount: rows.length, columnCount: headers.length }
        };
      }

      function onDataLoaded(table) {
        currentDf = table;
        if (typeof renderTable === 'function') {
          var tableContainer = contentArea.querySelector('.dk-table-container');
          if (!tableContainer) {
            tableContainer = document.createElement('div');
            tableContainer.className = 'dk-table-container';
            contentArea.appendChild(tableContainer);
          }
          tableContainer.innerHTML = '';
          renderTable(tableContainer, table);
        }
        if (typeof createREPL === 'function' && !replInstance) {
          var replContainer = document.createElement('div');
          replContainer.className = 'dk-repl-container';
          replContainer.style.cssText = 'margin-top:12px;height:300px;';
          contentArea.appendChild(replContainer);
          replInstance = createREPL(replContainer, getREPLContext);
        }
      }

      if (typeof createFileImport === 'function') {
        createFileImport(contentArea, onDataLoaded);
      }
    }
  }
}
