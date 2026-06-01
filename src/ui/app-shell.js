/**
 * WDK App Shell
 * Full-page standalone application shell for Tier 2 deployment.
 * Detects bookmarklet vs standalone mode and routes accordingly.
 * Synthwave 84 dark theme. Zero external dependencies.
 */

/* global createPanel, createFileImport, renderTable, createREPL, createPivotPanel, createNotebook, createBuildConfig, createDebugPanel, createAutomatorPanel, aggregate, pivot, execSQL, toCSV, toJSON, downloadBlob, createCommandPalette, AuditLog, toXLSX, downloadXLSX */

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
    '  flex: 1; min-height: 80px; overflow: hidden;',
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

    /* Sheet tabs */
    '#dk-shell-sheet-tabs button:hover { color: ' + DK_SHELL_THEME.cyan + '; }',

    /* Focus-visible accessibility */
    '*:focus-visible {',
    '  outline: 2px solid #00e5ff;',
    '  outline-offset: 2px;',
    '}',
    '.dk-toolbar-btn:focus-visible {',
    '  outline: 2px solid #00e5ff;',
    '  outline-offset: 1px;',
    '  box-shadow: 0 0 8px rgba(0, 229, 255, 0.25);',
    '}',
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
  if (loc.pathname && /wdk\.html?$/i.test(loc.pathname)) return true;
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
  var currentSheets = null;
  var currentSheetIndex = 0;
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
  header.setAttribute('role', 'banner');

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
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Data tools');

  function makeToolbarBtn(icon, label, title, shortcut) {
    var btn = document.createElement('button');
    btn.className = 'dk-toolbar-btn';
    btn.title = title + (shortcut ? '  (' + shortcut + ')' : '');
    btn.setAttribute('aria-label', title + (shortcut ? ' (' + shortcut + ')' : ''));
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

  var btnImport = makeToolbarBtn('v', 'Import', 'Import a file', 'Ctrl+I');
  var btnExportCSV = makeToolbarBtn('^', 'CSV', 'Export as CSV', 'Ctrl+E');
  var btnExportJSON = makeToolbarBtn('^', 'JSON', 'Export as JSON');
  var btnExportXLSX = makeToolbarBtn('^', 'XLSX', 'Export as Excel');
  var btnClear = makeToolbarBtn('x', 'Clear', 'Clear loaded data', 'Ctrl+L');

  btnExportCSV.disabled = true;
  btnExportJSON.disabled = true;
  btnExportXLSX.disabled = true;
  btnClear.disabled = true;

  var colTypeContainer = document.createElement('div');
  colTypeContainer.id = 'dk-col-types';

  var btnScanner = makeToolbarBtn('!', 'Scanner', 'File preflight scanner');
  var btnHelp = makeToolbarBtn('?', 'Help', 'Keyboard shortcuts and usage guide', 'F1');
  var btnSettings = makeToolbarBtn('cfg', 'Settings', 'User preferences');

  toolbar.appendChild(btnImport);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnExportCSV);
  toolbar.appendChild(btnExportJSON);
  toolbar.appendChild(btnExportXLSX);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnScanner);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnClear);
  toolbar.appendChild(makeToolbarSep());
  toolbar.appendChild(btnHelp);
  toolbar.appendChild(btnSettings);

  var btnAudit = makeToolbarBtn('=', 'Audit', 'Download audit log (JSON Lines)');
  btnAudit.addEventListener('click', function() {
    if (typeof AuditLog !== 'undefined') {
      AuditLog.download();
      showToast('Audit log downloaded (' + AuditLog.count() + ' entries)');
    }
  });
  toolbar.appendChild(btnAudit);

  // Chunker button (split & combine large files)
  if (typeof wdkChunkCompress === 'function') {
    var btnChunker = makeToolbarBtn('Chunk', 'Chunker', 'Split & compress / combine & decompress large files');
    toolbar.appendChild(makeToolbarSep());
    toolbar.appendChild(btnChunker);
  }

  toolbar.appendChild(colTypeContainer);

  // Keyboard navigation for toolbar: arrow keys move between buttons
  toolbar.addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var btns = toolbar.querySelectorAll('.dk-toolbar-btn');
    var idx = -1;
    for (var i = 0; i < btns.length; i++) {
      if (btns[i] === document.activeElement) { idx = i; break; }
    }
    if (idx === -1) return;
    e.preventDefault();
    if (e.key === 'ArrowRight') {
      idx = (idx + 1) % btns.length;
    } else {
      idx = (idx - 1 + btns.length) % btns.length;
    }
    btns[idx].focus();
  });

  // Content area
  var content = document.createElement('div');
  content.id = 'dk-shell-content';
  content.setAttribute('role', 'main');

  // Welcome / import view
  var welcomeView = document.createElement('div');
  welcomeView.id = 'dk-shell-welcome';

  var welcomeTitleWrap = document.createElement('div');
  welcomeTitleWrap.id = 'dk-shell-welcome-title';

  var welcomeH2 = document.createElement('h2');
  welcomeH2.textContent = 'Open a data file';

  var welcomeP = document.createElement('p');
  welcomeP.textContent = 'Drop a .csv, .tsv, or .json file below - or click Browse to get started';

  welcomeTitleWrap.appendChild(welcomeH2);
  welcomeTitleWrap.appendChild(welcomeP);

  var importWrap = document.createElement('div');
  importWrap.id = 'dk-shell-import-wrap';
  importWrap.appendChild(welcomeTitleWrap);

  welcomeView.appendChild(importWrap);

  // Data view (table + REPL)
  var dataView = document.createElement('div');
  dataView.id = 'dk-shell-data-view';

  var sheetTabBar = document.createElement('div');
  sheetTabBar.id = 'dk-shell-sheet-tabs';
  sheetTabBar.style.cssText = 'display:none;gap:0;background:#0a0a1a;border-bottom:1px solid ' + DK_SHELL_THEME.border + ';flex-shrink:0;overflow-x:auto;white-space:nowrap;';
  sheetTabBar.setAttribute('role', 'tablist');
  sheetTabBar.setAttribute('aria-label', 'Spreadsheet sheets');

  var tablePane = document.createElement('div');
  tablePane.id = 'dk-shell-table-pane';

  var splitHandle = document.createElement('div');
  splitHandle.id = 'dk-shell-split-handle';

  var replPane = document.createElement('div');
  replPane.id = 'dk-shell-repl-pane';
  replPane.setAttribute('role', 'tabpanel');
  replPane.setAttribute('aria-label', 'REPL');

  var pivotPane = document.createElement('div');
  pivotPane.id = 'dk-shell-pivot-pane';
  pivotPane.setAttribute('role', 'tabpanel');
  pivotPane.setAttribute('aria-label', 'Pivot');
  pivotPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var notebookPane = document.createElement('div');
  notebookPane.id = 'dk-shell-notebook-pane';
  notebookPane.setAttribute('role', 'tabpanel');
  notebookPane.setAttribute('aria-label', 'Notebook');
  notebookPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  // ─── Empty state messages ──────────────────────────────────────────
  function _makeEmptyState(icon, msg) {
    var emptyEl = document.createElement('div');
    emptyEl.className = 'dk-empty-state';
    emptyEl.style.cssText = 'display:flex;align-items:center;justify-content:center;flex:1;padding:24px;text-align:center;color:' + DK_SHELL_THEME.textDim + ';font-style:italic;font-size:12px;opacity:0.7;';
    emptyEl.innerHTML = '<span style="font-size:18px;margin-right:8px;opacity:0.5;">' + icon + '</span> ' + msg;
    return emptyEl;
  }

  var pivotEmptyState = _makeEmptyState('', 'Load a data file to use pivot and aggregation tools');
  var notebookEmptyState = _makeEmptyState('', 'Load a data file to use the notebook. Supports JS, SQL, and Markdown cells.');
  pivotPane.appendChild(pivotEmptyState);
  notebookPane.appendChild(notebookEmptyState);

  var buildPane = document.createElement('div');
  buildPane.id = 'dk-shell-build-pane';
  buildPane.setAttribute('role', 'tabpanel');
  buildPane.setAttribute('aria-label', 'Build');
  buildPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var debugPane = document.createElement('div');
  debugPane.id = 'dk-shell-debug-pane';
  debugPane.setAttribute('role', 'tabpanel');
  debugPane.setAttribute('aria-label', 'Debug');
  debugPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;';

  var automatorPane = document.createElement('div');
  automatorPane.id = 'dk-shell-automator-pane';
  automatorPane.setAttribute('role', 'tabpanel');
  automatorPane.setAttribute('aria-label', 'Automator');
  automatorPane.style.cssText = 'flex:1;overflow:hidden;display:none;flex-direction:column;position:relative;';

  // Bottom panel tab bar
  var bottomTabBar = document.createElement('div');
  bottomTabBar.style.cssText = 'display:flex;gap:0;background:#0a0a1a;border-bottom:1px solid ' + DK_SHELL_THEME.border + ';flex-shrink:0;';
  bottomTabBar.setAttribute('role', 'tablist');
  bottomTabBar.setAttribute('aria-label', 'Bottom panels');
  var bottomPanes = { repl: replPane, pivot: pivotPane, notebook: notebookPane, build: buildPane, debug: debugPane, automator: automatorPane };
  function makeBottomTab(label, target) {
    var btn = document.createElement('button');
    btn.textContent = label;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.style.cssText = 'background:transparent;color:' + DK_SHELL_THEME.textDim + ';border:none;border-bottom:2px solid transparent;padding:4px 12px;cursor:pointer;font-family:inherit;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
    btn.addEventListener('click', function () {
      Object.keys(bottomPanes).forEach(function (k) { bottomPanes[k].style.display = k === target ? 'flex' : 'none'; });
      bottomTabBar.querySelectorAll('button').forEach(function (b) {
        b.style.color = DK_SHELL_THEME.textDim;
        b.style.borderBottomColor = 'transparent';
        b.setAttribute('aria-selected', 'false');
      });
      btn.style.color = DK_SHELL_THEME.cyan;
      btn.style.borderBottomColor = DK_SHELL_THEME.cyan;
      btn.setAttribute('aria-selected', 'true');
    });
    return btn;
  }
  var replTab = makeBottomTab('REPL', 'repl');
  var pivotTab = makeBottomTab('Pivot', 'pivot');
  var notebookTab = makeBottomTab('Notebook', 'notebook');
  replTab.style.color = DK_SHELL_THEME.cyan;
  replTab.style.borderBottomColor = DK_SHELL_THEME.cyan;
  replTab.setAttribute('aria-selected', 'true');
  var buildTab = makeBottomTab('Build', 'build');
  var debugTab = makeBottomTab('Debug', 'debug');
  var automatorTab = makeBottomTab('Automator', 'automator');
  bottomTabBar.appendChild(replTab);
  bottomTabBar.appendChild(pivotTab);
  bottomTabBar.appendChild(notebookTab);
  bottomTabBar.appendChild(buildTab);
  bottomTabBar.appendChild(debugTab);
  bottomTabBar.appendChild(automatorTab);

  // Bottom panel container
  var bottomPanel = document.createElement('div');
  bottomPanel.style.cssText = 'flex:1;min-height:200px;overflow:hidden;display:flex;flex-direction:column;';
  bottomPanel.appendChild(bottomTabBar);
  bottomPanel.appendChild(replPane);
  bottomPanel.appendChild(pivotPane);
  bottomPanel.appendChild(notebookPane);
  bottomPanel.appendChild(buildPane);
  bottomPanel.appendChild(debugPane);
  bottomPanel.appendChild(automatorPane);

  // Lazily init automator panel on first activation
  var automatorInitialized = false;
  automatorTab.addEventListener('click', function () {
    if (automatorInitialized) { return; }
    if (typeof createAutomatorPanel === 'function') {
      createAutomatorPanel(automatorPane);
      automatorInitialized = true;
    }
  });

  dataView.appendChild(sheetTabBar);
  dataView.appendChild(tablePane);

  // Scanner view (full-content, independent of data view)
  var scannerView = document.createElement('div');
  scannerView.id = 'dk-shell-scanner-view';
  scannerView.style.cssText = 'flex:1;overflow:auto;display:none;';

  var scannerInitialized = false;
  btnScanner.addEventListener('click', function () {
    var showing = scannerView.style.display !== 'none';
    if (showing) {
      scannerView.style.display = 'none';
      welcomeView.style.display = '';
      dataView.style.display = '';
      btnScanner.style.borderColor = DK_SHELL_THEME.border;
      btnScanner.style.color = DK_SHELL_THEME.text;
    } else {
      welcomeView.style.display = 'none';
      dataView.style.display = 'none';
      scannerView.style.display = 'flex';
      btnScanner.style.borderColor = DK_SHELL_THEME.cyan;
      btnScanner.style.color = DK_SHELL_THEME.cyan;
      if (!scannerInitialized && typeof createScannerPanel === 'function') {
        createScannerPanel(scannerView);
        scannerInitialized = true;
      }
    }
  });

  content.appendChild(welcomeView);
  content.appendChild(dataView);
  content.appendChild(scannerView);
  content.appendChild(splitHandle);
  content.appendChild(bottomPanel);

  // Init build configurator (doesn't need data)
  if (typeof createBuildConfig === 'function') {
    createBuildConfig(buildPane);
  }

  // Init debug panel (doesn't need data)
  var debugInstance = null;
  if (typeof createDebugPanel === 'function') {
    debugInstance = createDebugPanel(debugPane, onDataLoaded);
  }

  // Status bar
  var statusBar = document.createElement('div');
  statusBar.id = 'dk-shell-status';
  statusBar.setAttribute('role', 'contentinfo');

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
  kbdHints.textContent = 'Ctrl+I import | Ctrl+E export CSV | Ctrl+L clear';

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

  // ─── Initialize REPL immediately (always visible) ────────────────
  if (typeof createREPL === 'function') {
    replPane.innerHTML = '';
    replInstance = createREPL(replPane, getREPLContext);
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

  function renderSheetTabs() {
    sheetTabBar.innerHTML = '';
    if (!currentSheets || currentSheets.length <= 1) {
      sheetTabBar.style.display = 'none';
      return;
    }
    sheetTabBar.style.display = 'flex';
    currentSheets.forEach(function (sheet, idx) {
      var btn = document.createElement('button');
      btn.textContent = sheet.name;
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', idx === currentSheetIndex ? 'true' : 'false');
      btn.style.cssText = 'background:transparent;border:none;border-bottom:2px solid transparent;padding:5px 14px;cursor:pointer;font-family:inherit;font-size:11px;letter-spacing:0.3px;color:' + (idx === currentSheetIndex ? DK_SHELL_THEME.cyan : DK_SHELL_THEME.textDim) + ';' + (idx === currentSheetIndex ? 'border-bottom-color:' + DK_SHELL_THEME.cyan + ';' : '');
      btn.addEventListener('click', function () {
        currentSheetIndex = idx;
        var s = currentSheets[idx];
        var dt = new DataFrame(s.headers, s.rows);
        dt._xlsxSheets = currentSheets;
        currentDf = dt;
        tablePane.innerHTML = '';
        if (typeof renderTable === 'function') renderTable(tablePane, dt);
        updateColTypeBadges(dt);
        var rows = dt._rows || [];
        var headers = dt._headers || [];
        rowsItem.val.textContent = rows.length.toLocaleString();
        colsItem.val.textContent = headers.length.toLocaleString();
        sizeItem.val.textContent = formatBytes(JSON.stringify(rows).length);
        renderSheetTabs();
      });
      sheetTabBar.appendChild(btn);
    });
  }

  function onDataLoaded(table, filename) {
    currentDf = table;
    currentFilename = filename || 'data';

    // Track XLSX sheets
    currentSheets = table._xlsxSheets || null;
    currentSheetIndex = 0;
    renderSheetTabs();

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
      // First REPL use hint — listen for Enter key in REPL pane
      replPane.addEventListener('keydown', function _replHint(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          showHint('shift_enter', 'Tip: Use Shift+Enter for multiline in REPL');
          replPane.removeEventListener('keydown', _replHint);
        }
      });
    }

    // Create Pivot panel once, refresh columns on each load
    if (typeof createPivotPanel === 'function') {
      if (!pivotInstance) {
        pivotPane.innerHTML = '';
        pivotInstance = createPivotPanel(pivotPane, function () { return currentDf; });
      }
      pivotInstance.refresh();
    }

    // Create Notebook once, with welcome template
    if (typeof createNotebook === 'function' && !notebookInstance) {
      notebookPane.innerHTML = '';
      notebookInstance = createNotebook(notebookPane, getREPLContext);

      // Welcome cells
      var welcomeMD = notebookInstance.addCell('md');
      welcomeMD.setValue('# Welcome to WDK Notebook\n\nUse **JS**, **SQL**, or **Markdown** cells to explore your data.\nPress `Shift+Enter` to run a cell. Drag the ::: handle to reorder.');
      welcomeMD.run();

      var welcomeSQL = notebookInstance.addCell('sql');
      welcomeSQL.setValue('SELECT * FROM df LIMIT 10');

      var welcomeJS = notebookInstance.addCell('js');
      welcomeJS.setValue('// Try: data.filter(r => r.salary > 50000).length');
    }

    // Hide empty state messages
    // replEmptyState removed — REPL is always visible
    if (pivotEmptyState.parentNode) pivotEmptyState.parentNode.removeChild(pivotEmptyState);
    if (notebookEmptyState.parentNode) notebookEmptyState.parentNode.removeChild(notebookEmptyState);

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
    btnExportXLSX.disabled = false;
    btnClear.disabled = false;

    showToast('ok Loaded ' + currentFilename + ' - ' + rows.length.toLocaleString() + ' rows');
    if (typeof AuditLog !== 'undefined') { AuditLog.logImport(currentFilename, rows.length, headers.length, byteEst); }

    // First-load hint
    showHint('ctrl_p', 'Tip: Use Ctrl+P to open the command palette');
  }

  // ─── Tooltip hints (shown once per key, persisted in localStorage) ──
  var seenHints = {};
  try { seenHints = JSON.parse(localStorage.getItem('wdk_seen_hints') || '{}'); } catch(_) {}
  function showHint(key, msg) {
    if (seenHints[key]) return;
    seenHints[key] = true;
    try { localStorage.setItem('wdk_seen_hints', JSON.stringify(seenHints)); } catch(_) {}
    setTimeout(function() { showToast(msg, 4000); }, 1500);
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
      var truncName = ct.name.length > 10 ? ct.name.slice(0, 9) + '...' : ct.name;
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
    showToast('Exported ' + name);
    if (typeof AuditLog !== 'undefined') { AuditLog.logExport(name, 'csv', (currentDf._rows || []).length); }
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
    showToast('Exported ' + name);
    if (typeof AuditLog !== 'undefined') { AuditLog.logExport(name, 'json', (currentDf._rows || []).length); }
  }

  function exportXLSX() {
    if (!currentDf) return;
    if (typeof toXLSX !== 'function') {
      showToast('XLSX export not available');
      return;
    }
    var name = (currentFilename || 'export').replace(/\.[^.]+$/, '') + '.xlsx';
    downloadXLSX({ headers: currentDf._headers || [], rows: currentDf._rows || [] }, name);
    showToast('Exported ' + name);
    if (typeof AuditLog !== 'undefined') { AuditLog.logExport(name, 'xlsx', (currentDf._rows || []).length); }
  }

  // ─── Clear ────────────────────────────────────────────────────────

  function clearData() {
    if (typeof AuditLog !== 'undefined') { AuditLog.logClear(); }
    currentDf = null;
    currentFilename = null;
    currentSheets = null;
    currentSheetIndex = 0;
    replInstance = null;
    sheetTabBar.style.display = 'none';
    sheetTabBar.innerHTML = '';

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
    btnExportXLSX.disabled = true;
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
  btnExportXLSX.addEventListener('click', exportXLSX);
  btnClear.addEventListener('click', clearData);

  // ─── Help panel ──────────────────────────────────────────────────

  var helpOverlay = document.createElement('div');
  helpOverlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';

  var helpBox = document.createElement('div');
  helpBox.style.cssText = 'background:#12122a;border:1px solid #2a2a4e;border-radius:6px;padding:24px 32px;max-width:560px;max-height:80vh;overflow-y:auto;color:#e0e0f0;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;line-height:1.7;scrollbar-width:thin;scrollbar-color:#2a2a4e #12122a;';

  var helpSections = [
    '<h2 style="margin:0 0 12px;color:#00e5ff;font-size:16px;">WDK Help</h2>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Getting Started</h3>',
    '<p>Drop a <b>.csv</b>, <b>.tsv</b>, <b>.json</b>, or <b>.xlsx</b> file onto the import area, or click Browse. Files >100MB stream automatically.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Command Palette</h3>',
    '<p>Press <b>Ctrl+P</b> to open the command palette. Fuzzy-search any action (import, export, switch tabs, etc).</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Table Features</h3>',
    '<p>Click a <b>column header</b> to sort. Click a <b>row</b> to select it (Shift+click for range). Selected rows show SUM/AVG in the summary bar. Null values display as gray italic.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">REPL Console</h3>',
    '<p>The bottom REPL panel lets you script against loaded data:</p>',
    '<ul style="padding-left:18px;margin:4px 0;">',
    '<li><code style="color:#00e5ff;">data</code> - array of row objects</li>',
    '<li><code style="color:#00e5ff;">headers</code> - column names array</li>',
    '<li><code style="color:#00e5ff;">rows</code> - raw 2D array</li>',
    '<li><code style="color:#00e5ff;">meta</code> - { rowCount, columnCount }</li>',
    '</ul>',
    '<p>Enter executes, Shift+Enter for multiline. Results auto-display with export buttons.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Pivot / Aggregate</h3>',
    '<p>Switch to the <b>Pivot</b> tab to group and aggregate data. Supports: sum, count, avg, min, max, distinct, first, last, concat.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">SQL Queries</h3>',
    '<p>Use the <b>Notebook</b> tab to run SQL against loaded tables. Supports SELECT, WHERE, ORDER BY, GROUP BY, JOIN, window functions.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Notebook</h3>',
    '<p>Supports <b>JS</b>, <b>SQL</b>, and <b>Markdown</b> cells. Drag cells to reorder. Stale outputs are grayed out after edits. Shift+Enter runs a cell.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Debug Panel</h3>',
    '<p>The <b>Debug</b> tab provides: Network request log, Console capture, Storage viewer, and DOM table scraper in a unified dashboard.</p>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">Keyboard Shortcuts</h3>',
    '<table style="border-collapse:collapse;width:100%;margin:4px 0;">',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+P</td><td>Command palette</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+I</td><td>Import file</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+E</td><td>Export as CSV</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+L</td><td>Clear data</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">F1</td><td>Toggle help</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Click header</td><td>Sort asc/desc</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Click row</td><td>Select (Shift+click for range)</td></tr>',
    '</table>',
    '<h3 style="color:#b967ff;font-size:12px;margin:14px 0 6px;">REPL Shortcuts</h3>',
    '<table style="border-collapse:collapse;width:100%;margin:4px 0;">',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Enter</td><td>Execute</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Shift+Enter</td><td>New line</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Up/Down</td><td>Command history</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Ctrl+L</td><td>Clear REPL output</td></tr>',
    '<tr><td style="padding:2px 8px;color:#00e5ff;">Tab</td><td>Insert 2 spaces</td></tr>',
    '</table>',
    '<p style="margin-top:14px;color:#8888aa;font-size:11px;">Press Escape or click outside to close.</p>',
  ];
  helpBox.innerHTML = helpSections.join('\n');

  helpOverlay.appendChild(helpBox);
  document.body.appendChild(helpOverlay);

  function toggleHelp() {
    helpOverlay.style.display = helpOverlay.style.display === 'none' ? 'flex' : 'none';
  }

  btnHelp.addEventListener('click', toggleHelp);

  // Chunker toggle
  if (typeof wdkChunkCompress === 'function' && typeof createChunkerUI === 'function') {
    var chunkerInstance = null;
    btnChunker.addEventListener('click', function () {
      if (chunkerInstance) {
        chunkerInstance.destroy();
        chunkerInstance = null;
      } else {
        chunkerInstance = createChunkerUI(content);
      }
    });
  }
  helpOverlay.addEventListener('click', function (e) {
    if (e.target === helpOverlay) toggleHelp();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'F1') { e.preventDefault(); toggleHelp(); }
    if (e.key === 'Escape' && helpOverlay.style.display !== 'none') { toggleHelp(); }
    if (e.key === 'Escape' && settingsOverlay.style.display !== 'none') { toggleSettings(); }
  });

  // ─── Settings panel ─────────────────────────────────────────────

  var WDK_SETTINGS_DEFAULTS = {
    replEnterExec: true,
    defaultExport: 'csv',
    tablePageSize: 500,
  };

  function loadSettings() {
    try {
      var saved = localStorage.getItem('wdk_settings');
      if (saved) {
        var parsed = JSON.parse(saved);
        var merged = {};
        for (var k in WDK_SETTINGS_DEFAULTS) merged[k] = WDK_SETTINGS_DEFAULTS[k];
        for (var k2 in parsed) merged[k2] = parsed[k2];
        return merged;
      }
    } catch (_) {}
    var copy = {};
    for (var k3 in WDK_SETTINGS_DEFAULTS) copy[k3] = WDK_SETTINGS_DEFAULTS[k3];
    return copy;
  }

  function saveSettings(s) {
    try { localStorage.setItem('wdk_settings', JSON.stringify(s)); } catch (_) {}
  }

  var wdkSettings = loadSettings();

  var settingsOverlay = document.createElement('div');
  settingsOverlay.style.cssText = 'display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;align-items:center;justify-content:center;';

  var settingsBox = document.createElement('div');
  settingsBox.style.cssText = 'background:#12122a;border:1px solid #2a2a4e;border-radius:6px;padding:24px 32px;max-width:440px;color:#e0e0f0;font-family:"SF Mono","Fira Code","Consolas",monospace;font-size:12px;line-height:1.7;';

  function buildSettingsUI() {
    settingsBox.innerHTML = '';
    var title = document.createElement('h2');
    title.textContent = 'Settings';
    title.style.cssText = 'margin:0 0 16px;color:#00e5ff;font-size:16px;';
    settingsBox.appendChild(title);

    function addToggle(label, key) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:8px 0;';
      var lbl = document.createElement('span');
      lbl.textContent = label;
      var cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = wdkSettings[key];
      cb.addEventListener('change', function () {
        wdkSettings[key] = cb.checked;
        saveSettings(wdkSettings);
      });
      row.appendChild(lbl);
      row.appendChild(cb);
      settingsBox.appendChild(row);
    }

    function addSelect(label, key, options) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:8px 0;';
      var lbl = document.createElement('span');
      lbl.textContent = label;
      var sel = document.createElement('select');
      sel.style.cssText = 'background:#0a0a1a;color:#e0e0f0;border:1px solid #2a2a4e;padding:2px 6px;font-family:inherit;font-size:11px;';
      options.forEach(function (opt) {
        var o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (wdkSettings[key] === opt.value) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', function () {
        wdkSettings[key] = isNaN(Number(sel.value)) ? sel.value : Number(sel.value);
        saveSettings(wdkSettings);
      });
      row.appendChild(lbl);
      row.appendChild(sel);
      settingsBox.appendChild(row);
    }

    addToggle('Enter executes in REPL', 'replEnterExec');
    addSelect('Default export format', 'defaultExport', [
      { value: 'csv', label: 'CSV' },
      { value: 'json', label: 'JSON' },
    ]);
    addSelect('Table page size', 'tablePageSize', [
      { value: 100, label: '100 rows' },
      { value: 250, label: '250 rows' },
      { value: 500, label: '500 rows' },
      { value: 1000, label: '1000 rows' },
    ]);

    var note = document.createElement('p');
    note.style.cssText = 'margin-top:14px;color:#8888aa;font-size:11px;';
    note.textContent = 'Settings are saved in localStorage. Press Escape to close.';
    settingsBox.appendChild(note);
  }

  settingsOverlay.appendChild(settingsBox);
  document.body.appendChild(settingsOverlay);

  function toggleSettings() {
    if (settingsOverlay.style.display === 'none') buildSettingsUI();
    settingsOverlay.style.display = settingsOverlay.style.display === 'none' ? 'flex' : 'none';
  }

  btnSettings.addEventListener('click', toggleSettings);
  settingsOverlay.addEventListener('click', function (e) {
    if (e.target === settingsOverlay) toggleSettings();
  });

  // ─── Split handle drag ────────────────────────────────────────────

  var splitDragging = false;
  var splitStartY = 0;
  var splitStartReplH = 0;

  splitHandle.addEventListener('mousedown', function (e) {
    e.preventDefault();
    splitDragging = true;
    splitStartY = e.clientY;
    splitStartReplH = bottomPanel.offsetHeight;
  });

  document.addEventListener('mousemove', function (e) {
    if (!splitDragging) return;
    e.preventDefault();
    var delta = splitStartY - e.clientY; // drag up = bigger panel
    var newH = Math.max(80, Math.min(splitStartReplH + delta, window.innerHeight - 200));
    bottomPanel.style.flex = 'none';
    bottomPanel.style.height = newH + 'px';
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

  // ─── Command palette ─────────────────────────────────────────────

  if (typeof createCommandPalette === 'function') {
    var paletteActions = [
      { id: 'import', label: 'Import File', shortcut: 'Ctrl+I', icon: 'v', handler: function() { var fi = importWrap.querySelector('input[type="file"]'); if (fi) fi.click(); } },
      { id: 'export-csv', label: 'Export as CSV', shortcut: 'Ctrl+E', icon: '^', handler: exportCSV },
      { id: 'export-json', label: 'Export as JSON', icon: '^', handler: exportJSON },
      { id: 'export-xlsx', label: 'Export as XLSX', icon: '^', handler: exportXLSX },
      { id: 'clear', label: 'Clear Data', shortcut: 'Ctrl+L', icon: 'x', handler: clearData },
      { id: 'scanner', label: 'File Scanner', icon: '!', handler: function() { btnScanner.click(); } },
      { id: 'help', label: 'Help', shortcut: 'F1', icon: '?', handler: toggleHelp },
      { id: 'settings', label: 'Settings', icon: 'cfg', handler: toggleSettings },
      { id: 'tab-repl', label: 'Switch to REPL', icon: '>', handler: function() { replTab.click(); } },
      { id: 'tab-pivot', label: 'Switch to Pivot', icon: '>', handler: function() { pivotTab.click(); } },
      { id: 'tab-notebook', label: 'Switch to Notebook', icon: '>', handler: function() { notebookTab.click(); } },
      { id: 'tab-build', label: 'Switch to Build', icon: '>', handler: function() { buildTab.click(); } },
    ];
    var palette = createCommandPalette(paletteActions);
    document.addEventListener('keydown', function(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
        e.preventDefault();
        palette.toggle();
      }
    });
  }

  // ─── Public API ───────────────────────────────────────────────────

  return {
    shell: shell,
    loadData: onDataLoaded,
    clearData: clearData,
    exportCSV: exportCSV,
    exportJSON: exportJSON,
    exportXLSX: exportXLSX,
  };
}

/**
 * Entry point — detects mode and initialises accordingly.
 * Called by main() in build.js when app-shell is present.
 */
function initWDK() {
  if (isStandaloneMode()) {
    var app = createAppShell();
    if (app) { window.WDK = app; }
  } else {
    // Bookmarklet / injected mode — fall back to floating panel
    if (typeof createPanel === 'function') {
      var panel = createPanel();
      var contentArea = panel.contentArea || panel.content || panel;
      var currentDf = null;
      var drawerReplInstance = null;   // the ONE REPL instance (lives in the bottom console drawer)
      var drawerCollapsed = false;     // collapse-chevron state
      var lastDrawerH = 220;           // remembered expanded drawer height (px)

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
        // REPL is eager-mounted once in the bottom console drawer; getREPLContext
        // reads currentDf live on every runScript, so there is nothing to mount
        // here when data loads later.
      }

      // Tab strip for the injected floating panel — exposes the same
      // panels operators get in standalone mode, lazily mounted on
      // first activation. The REPL/console is NOT a tab here: it lives in
      // the always-visible bottom drawer (built below), DevTools-style, so
      // the prompt + dk.help() stay accessible no matter which tab is active.
      var tabStrip = document.createElement('div');
      tabStrip.className = 'dk-floating-tab-strip';
      tabStrip.style.cssText = 'display:flex;gap:0;border-bottom:1px solid #2a2a4e;background:#0a0a1a;flex-shrink:0;';

      var panes = {};
      function _makePane(name) {
        var p = document.createElement('div');
        p.className = 'dk-pane-' + name;
        // min-width:0 enables flex-wrap inside (without it, children push
        // the pane wider than its parent and wrap is suppressed). flex:1
        // makes the pane fill the available vertical space inside the
        // tab container — no fixed-height crop that pushed the REPL off
        // the bottom of small panels. flex-direction:column makes the pane a
        // vertical flex box once _activate sets display:flex, so its single
        // child panel STRETCHES to full width (align-items:stretch default)
        // instead of shrinking to its content width and leaving the right
        // half of the panel dead.
        p.style.cssText = 'display:none;flex-direction:column;overflow-y:auto;overflow-x:hidden;flex:1 1 auto;min-width:0;min-height:0;position:relative;';
        panes[name] = p;
        return p;
      }
      var paneContainer = document.createElement('div');
      paneContainer.style.cssText = 'flex:1 1 auto;display:flex;flex-direction:column;min-height:0;min-width:0;';
      paneContainer.appendChild(_makePane('notebook'));
      paneContainer.appendChild(_makePane('automator'));
      paneContainer.appendChild(_makePane('network'));
      paneContainer.appendChild(_makePane('import'));

      var initialized = {};
      var notebookInstance = null;
      var automatorInstance = null;
      var debugInstance = null;

      function _activate(name) {
        Object.keys(panes).forEach(function (k) { panes[k].style.display = (k === name ? 'flex' : 'none'); });
        Array.prototype.forEach.call(tabStrip.querySelectorAll('button'), function (b) {
          var active = (b.getAttribute('data-tab') === name);
          b.style.color = active ? '#00e5ff' : '#8888aa';
          b.style.borderBottomColor = active ? '#00e5ff' : 'transparent';
        });
        if (initialized[name]) { return; }
        initialized[name] = true;
        if (name === 'notebook' && typeof createNotebook === 'function' && !notebookInstance) {
          notebookInstance = createNotebook(panes.notebook, function () { return currentDf; });
        } else if (name === 'automator' && typeof createAutomatorPanel === 'function' && !automatorInstance) {
          automatorInstance = createAutomatorPanel(panes.automator);
        } else if (name === 'network' && typeof createDebugPanel === 'function' && !debugInstance) {
          debugInstance = createDebugPanel(panes.network, onDataLoaded);
        } else if (name === 'import' && typeof createFileImport === 'function') {
          createFileImport(panes.import, onDataLoaded);
        }
      }

      function _makeTab(label, name) {
        var b = document.createElement('button');
        b.textContent = label;
        b.setAttribute('data-tab', name);
        b.style.cssText = 'background:transparent;color:#8888aa;border:none;border-bottom:2px solid transparent;padding:6px 14px;cursor:pointer;font-family:inherit;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;';
        b.addEventListener('click', function () { _activate(name); });
        tabStrip.appendChild(b);
        return b;
      }
      _makeTab('Notebook', 'notebook');
      _makeTab('Automator', 'automator');
      _makeTab('Network', 'network');
      _makeTab('Import', 'import');

      // Replace the contentArea's existing structure: title bar / content
      // already exist; we insert tab strip + pane container into content.
      contentArea.appendChild(tabStrip);
      contentArea.appendChild(paneContainer);

      // ─── Persistent console drawer (DevTools-style) ──────────────────
      // The REPL lives in an always-visible bottom drawer appended to
      // contentArea AFTER paneContainer. It is NOT a member of panes{}, so
      // _activate()'s display-toggle loop can never hide it — it survives
      // every top-tab switch. Default-open at 220px, collapsible to a 26px
      // header bar, drag-resizable via a handle on its top edge.
      if (!document.getElementById('dk-console-drawer-styles')) {
        var drawerStyle = document.createElement('style');
        drawerStyle.id = 'dk-console-drawer-styles';
        drawerStyle.textContent = [
          '.dk-console-drawer { display:flex; flex-direction:column; border-top:1px solid #2a2a4e; background:#0a0a1a; min-height:0; }',
          '.dk-console-resize { height:5px; flex-shrink:0; cursor:ns-resize; background:#2a2a4e; transition:background 0.12s; }',
          '.dk-console-resize:hover { background:#b967ff; }',
          '.dk-console-header { display:flex; align-items:center; justify-content:space-between; height:26px; flex-shrink:0; padding:0 8px; background:#121228; border-bottom:1px solid #2a2a4e; cursor:pointer; }',
          '.dk-console-title { color:#8888aa; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; }',
          '.dk-console-collapse { background:transparent; color:#8888aa; border:none; cursor:pointer; font-size:11px; padding:0 4px; line-height:1; font-family:inherit; }',
          '.dk-console-collapse:hover { color:#00e5ff; }',
          '.dk-console-body { flex:1 1 auto; min-height:0; overflow:hidden; display:flex; flex-direction:column; }',
        ].join('\n');
        document.head.appendChild(drawerStyle);
      }

      var consoleDrawer = document.createElement('div');
      consoleDrawer.className = 'dk-console-drawer';
      var resizeHandle = document.createElement('div');
      resizeHandle.className = 'dk-console-resize';
      var drawerHeader = document.createElement('div');
      drawerHeader.className = 'dk-console-header';
      var drawerTitle = document.createElement('span');
      drawerTitle.className = 'dk-console-title';
      drawerTitle.textContent = 'CONSOLE';
      var collapseBtn = document.createElement('button');
      collapseBtn.className = 'dk-console-collapse';
      collapseBtn.setAttribute('aria-label', 'Collapse console');
      collapseBtn.textContent = 'v'; // collapse chevron (open)
      drawerHeader.appendChild(drawerTitle);
      drawerHeader.appendChild(collapseBtn);
      var drawerBody = document.createElement('div');
      drawerBody.className = 'dk-console-body';
      consoleDrawer.appendChild(resizeHandle);
      consoleDrawer.appendChild(drawerHeader);
      consoleDrawer.appendChild(drawerBody);
      consoleDrawer.style.flex = '0 0 ' + lastDrawerH + 'px';
      contentArea.appendChild(consoleDrawer);

      // Eager-mount the ONE REPL so the prompt + dk.help() welcome line show
      // the instant the snippet is pasted, before any data loads.
      if (typeof createREPL === 'function') {
        drawerReplInstance = createREPL(drawerBody, getREPLContext);
      }

      function setDrawerCollapsed(c) {
        drawerCollapsed = c;
        drawerBody.style.display = c ? 'none' : 'flex';
        resizeHandle.style.display = c ? 'none' : 'block';
        consoleDrawer.style.flex = c ? '0 0 26px' : ('0 0 ' + lastDrawerH + 'px');
        collapseBtn.textContent = c ? '>' : 'v'; // '>' collapsed / 'v' open
        collapseBtn.setAttribute('aria-label', c ? 'Expand console' : 'Collapse console');
      }
      // Click the header (or its chevron) toggles collapse.
      drawerHeader.addEventListener('click', function () { setDrawerCollapsed(!drawerCollapsed); });

      // Drag-resize — named handlers so they detach on mouseup (mirrors the
      // standalone split-drag math, but without leaking always-on listeners).
      var drawerDragStartY = 0, drawerDragStartH = 0;
      function onDrawerMove(ev) {
        ev.preventDefault();
        var delta = drawerDragStartY - ev.clientY; // drag UP = taller drawer
        var max = contentArea.clientHeight - 120;
        var newH = Math.max(80, Math.min(drawerDragStartH + delta, max));
        consoleDrawer.style.flex = '0 0 ' + newH + 'px';
        lastDrawerH = newH;
      }
      function onDrawerUp() {
        document.removeEventListener('mousemove', onDrawerMove);
        document.removeEventListener('mouseup', onDrawerUp);
      }
      resizeHandle.addEventListener('mousedown', function (e) {
        if (drawerCollapsed) { return; }
        e.preventDefault();
        drawerDragStartY = e.clientY;
        drawerDragStartH = consoleDrawer.offsetHeight;
        document.addEventListener('mousemove', onDrawerMove);
        document.addEventListener('mouseup', onDrawerUp);
      });

      // Esc toggles the drawer — SCOPED to the panel (not document) so it can
      // never hijack the host page's own Esc (modals, fullscreen, input cancel).
      if (panel.container) {
        panel.container.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') { e.stopPropagation(); setDrawerCollapsed(!drawerCollapsed); }
        });
      }

      // Default top tab is Notebook (REPL is now the always-visible drawer).
      _activate('notebook');

      // Focus the REPL prompt so typing works immediately on paste.
      if (drawerReplInstance && typeof drawerReplInstance.getTextarea === 'function') {
        drawerReplInstance.getTextarea().focus();
      }
    }
  }
}
