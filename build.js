#!/usr/bin/env node

/**
 * DataKit Build Script
 * Concatenates source modules into a single IIFE bundle.
 *
 * Outputs:
 *   dist/wiz.js                — readable IIFE
 *   dist/wiz-bookmarklet.txt   — javascript: URI (URL-encoded)
 *   dist/wiz.html              — standalone HTML with JS inlined
 *
 * Usage: node build.js
 */

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, 'src');
var DIST = path.join(__dirname, 'dist');

// Source files in dependency order
var SOURCE_FILES = [
  'parsers/csv.js',
  'parsers/json.js',
  'parsers/zip.js',
  'parsers/xlsx.js',
  'transforms/data-model.js',
  'transforms/pipeline.js',
  'transforms/redact.js',
  'transforms/pivot.js',
  'transforms/sql.js',
  'export/export.js',
  'util/detect-types.js',
  'ui/panel.js',
  'ui/table.js',
  'ui/file-import.js',
  'ui/repl.js',
  'ui/pivot-panel.js',
  'ui/notebook.js',
  'ui/build-config.js',
  'ui/app-shell.js',
  'inspect/dom-scraper.js',
  'inspect/network-interceptor.js',
  'inspect/storage-viewer.js',
  'inspect/console-capture.js'
];

// --- Read and clean source files ---

function readSource(relPath) {
  var fullPath = path.join(SRC, relPath);
  if (!fs.existsSync(fullPath)) {
    console.warn('  SKIP (not found): ' + relPath);
    return null;
  }
  var code = fs.readFileSync(fullPath, 'utf8');

  // Strip module.exports and export statements for browser IIFE
  code = code.replace(/^module\.exports\s*=\s*\{[^}]*\};\s*$/m, '');
  code = code.replace(/^if\s*\(typeof module\b.*\n.*\n?\}$/m, '');
  code = code.replace(/^export\s+(function|class|const|let|var|async\s+function)\s/gm, '$1 ');
  code = code.replace(/^export\s*\{[^}]*\};\s*$/gm, '');

  return code.trim();
}

function buildMain() {
  // main() wires everything together after modules are loaded.
  // If app-shell is present (Tier 2 build) it delegates to initDataKit()
  // which handles standalone vs bookmarklet detection internally.
  // If app-shell is absent it falls back to the legacy createPanel() flow.
  return [
    'function main() {',
    '  // Prefer app-shell entry point (Tier 2)',
    '  if (typeof initDataKit === "function") {',
    '    initDataKit();',
    '    return;',
    '  }',
    '',
    '  // Legacy bookmarklet-only fallback',
    '  if (typeof createPanel !== "function") {',
    '    console.error("DataKit: createPanel not available. Build may be incomplete.");',
    '    return;',
    '  }',
    '',
    '  var panel = createPanel();',
    '  var contentArea = panel.contentArea || panel.content || panel;',
    '  var currentTable = null;',
    '  var replInstance = null;',
    '',
    '  function getREPLContext() {',
    '    if (!currentTable) {',
    '      return { data: [], rows: [], headers: [], meta: { rowCount: 0, columnCount: 0 } };',
    '    }',
    '    var headers = currentTable._headers || currentTable.headers || [];',
    '    var rows = currentTable._rows || currentTable.rows || [];',
    '    var data;',
    '    if (typeof currentTable.toObjects === "function") {',
    '      data = currentTable.toObjects();',
    '    } else {',
    '      data = rows.map(function (row) {',
    '        var obj = {};',
    '        headers.forEach(function (h, i) { obj[h] = row[i]; });',
    '        return obj;',
    '      });',
    '    }',
    '    return {',
    '      data: data,',
    '      rows: rows,',
    '      headers: headers,',
    '      meta: { rowCount: rows.length, columnCount: headers.length }',
    '    };',
    '  }',
    '',
    '  function onDataLoaded(table) {',
    '    currentTable = table;',
    '    if (typeof renderTable === "function") {',
    '      var tableContainer = contentArea.querySelector(".dk-table-container");',
    '      if (!tableContainer) {',
    '        tableContainer = document.createElement("div");',
    '        tableContainer.className = "dk-table-container";',
    '        contentArea.appendChild(tableContainer);',
    '      }',
    '      tableContainer.innerHTML = "";',
    '      renderTable(tableContainer, table);',
    '    }',
    '    if (typeof createREPL === "function" && !replInstance) {',
    '      var replContainer = document.createElement("div");',
    '      replContainer.className = "dk-repl-container";',
    '      replContainer.style.cssText = "margin-top:12px;height:300px;";',
    '      contentArea.appendChild(replContainer);',
    '      replInstance = createREPL(replContainer, getREPLContext);',
    '    }',
    '  }',
    '',
    '  if (typeof createFileImport === "function") {',
    '    createFileImport(contentArea, onDataLoaded);',
    '  }',
    '}',
    '',
    '// Auto-run',
    'if (document.readyState === "loading") {',
    '  document.addEventListener("DOMContentLoaded", main);',
    '} else {',
    '  main();',
    '}'
  ].join('\n');
}

function buildHTML(jsContent) {
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="color-scheme" content="dark">',
    '<title>Wiz</title>',
    '<style>',
    '  /* Pre-paint baseline — prevents white flash before JS runs */',
    '  html { background: #0a0a1a; }',
    '  html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }',
    '  body {',
    '    background: #0a0a1a; color: #e0e0f0;',
    '    font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;',
    '    font-size: 13px;',
    '  }',
    '  /* Loading screen shown before JS initialises */',
    '  #dk-boot {',
    '    display: flex; align-items: center; justify-content: center;',
    '    height: 100vh;',
    '    font-family: "SF Mono", "Fira Code", "Consolas", monospace;',
    '    font-size: 14px;',
    '    background: linear-gradient(135deg, #0a0a1a 0%, #12122a 100%);',
    '    color: #8888aa; letter-spacing: 2px;',
    '  }',
    '  #dk-boot span {',
    '    background: linear-gradient(90deg, #00e5ff, #b967ff, #ff2975);',
    '    -webkit-background-clip: text; -webkit-text-fill-color: transparent;',
    '    background-clip: text;',
    '    font-weight: 700; font-size: 18px; letter-spacing: 3px;',
    '  }',
    '</style>',
    '</head>',
    '<body>',
    '<div id="dk-boot"><span>WIZARD</span></div>',
    '<script>',
    '// Remove boot screen once shell is ready',
    '(function removeBoot() {',
    '  var remove = function() {',
    '    var b = document.getElementById("dk-boot");',
    '    if (b && b.parentNode) b.parentNode.removeChild(b);',
    '  };',
    '  if (document.readyState === "loading") {',
    '    document.addEventListener("DOMContentLoaded", remove);',
    '  } else {',
    '    remove();',
    '  }',
    '})();',
    '</script>',
    '<script>',
    jsContent,
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');
}

// --- Build ---

console.log('Wiz build');
console.log('Reading sources...');

var parts = [];
var found = 0;
var skipped = 0;

for (var i = 0; i < SOURCE_FILES.length; i++) {
  var relPath = SOURCE_FILES[i];
  var code = readSource(relPath);
  if (code !== null) {
    parts.push('// --- ' + relPath + ' ---\n\n' + code);
    found++;
  } else {
    skipped++;
  }
}

// Append main() wiring
parts.push('// --- main ---\n\n' + buildMain());

// Wrap in IIFE
var iife = '(function () {\n"use strict";\n\n' + parts.join('\n\n') + '\n\n})();\n';

// Ensure dist/ exists
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

// Write outputs
var jsPath = path.join(DIST, 'wiz.js');
fs.writeFileSync(jsPath, iife, 'utf8');
console.log('  -> ' + jsPath + ' (' + iife.length + ' bytes)');

var bookmarklet = 'javascript:' + encodeURIComponent(iife);
var bmPath = path.join(DIST, 'wiz-bookmarklet.txt');
fs.writeFileSync(bmPath, bookmarklet, 'utf8');
console.log('  -> ' + bmPath + ' (' + bookmarklet.length + ' bytes)');

var html = buildHTML(iife);
var htmlPath = path.join(DIST, 'wiz.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('  -> ' + htmlPath + ' (' + html.length + ' bytes)');

console.log('Done. ' + found + ' modules included, ' + skipped + ' skipped.');
