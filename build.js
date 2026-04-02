#!/usr/bin/env node

/**
 * DataKit Build Script
 * Concatenates source modules into a single IIFE bundle.
 *
 * Outputs:
 *   dist/datakit.js            — readable IIFE
 *   dist/datakit-bookmarklet.txt — javascript: URI (URL-encoded)
 *   dist/datakit.html          — standalone HTML with JS inlined
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
  'transforms/data-model.js',
  'transforms/pipeline.js',
  'transforms/redact.js',
  'export/export.js',
  'util/detect-types.js',
  'ui/panel.js',
  'ui/table.js',
  'ui/file-import.js',
  'ui/repl.js'
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
  // main() wires everything together after modules are loaded
  return [
    'function main() {',
    '  // --- Create panel shell ---',
    '  if (typeof createPanel !== "function") {',
    '    console.error("DataKit: createPanel not available. Build may be incomplete.");',
    '    return;',
    '  }',
    '',
    '  var panel = createPanel();',
    '  var contentArea = panel.content || panel;',
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
    '',
    '    // Render table',
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
    '',
    '    // Enable REPL',
    '    if (typeof createREPL === "function" && !replInstance) {',
    '      var replContainer = document.createElement("div");',
    '      replContainer.className = "dk-repl-container";',
    '      replContainer.style.cssText = "margin-top:12px;height:300px;";',
    '      contentArea.appendChild(replContainer);',
    '      replInstance = createREPL(replContainer, getREPLContext);',
    '    }',
    '  }',
    '',
    '  // Set up file import',
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
    '<title>DataKit</title>',
    '<style>',
    '  * { box-sizing: border-box; }',
    '  body { margin: 0; padding: 0; background: #0e0e24; color: #e0e0ff; font-family: system-ui, sans-serif; }',
    '</style>',
    '</head>',
    '<body>',
    '<script>',
    jsContent,
    '</script>',
    '</body>',
    '</html>'
  ].join('\n');
}

// --- Build ---

console.log('DataKit build');
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
var jsPath = path.join(DIST, 'datakit.js');
fs.writeFileSync(jsPath, iife, 'utf8');
console.log('  -> ' + jsPath + ' (' + iife.length + ' bytes)');

var bookmarklet = 'javascript:' + encodeURIComponent(iife);
var bmPath = path.join(DIST, 'datakit-bookmarklet.txt');
fs.writeFileSync(bmPath, bookmarklet, 'utf8');
console.log('  -> ' + bmPath + ' (' + bookmarklet.length + ' bytes)');

var html = buildHTML(iife);
var htmlPath = path.join(DIST, 'datakit.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('  -> ' + htmlPath + ' (' + html.length + ' bytes)');

console.log('Done. ' + found + ' modules included, ' + skipped + ' skipped.');
