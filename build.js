#!/usr/bin/env node

/**
 * WDK Build Script
 * Concatenates source modules into a single IIFE bundle.
 *
 * Outputs:
 *   dist/wdk.js                — readable IIFE
 *   dist/wdk-bookmarklet.txt   — javascript: URI (URL-encoded)
 *   dist/wdk.html              — standalone HTML with JS inlined
 *
 * Usage: node build.js
 */

var fs = require('fs');
var path = require('path');

var SRC = path.join(__dirname, 'src');
var DIST = path.join(__dirname, 'dist');

// Minimal tier: core data pipeline only
var MINIMAL_FILES = [
  'parsers/csv.js',
  'transforms/data-model.js',
  'export/export.js',
  'util/detect-types.js',
  'ui/table.js',
  'ui/file-import.js',
  'ui/repl.js',
  'ui/app-shell.js',
  'ui/panel.js'
];

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
  'transforms/pii-scanner.js',
  'transforms/sql-functions.js',
  'transforms/sql.js',
  'export/export.js',
  'export/xlsx-writer.js',
  'util/detect-types.js',
  'util/audit-log.js',
  'ui/panel.js',
  'ui/table.js',
  'ui/file-import.js',
  'ui/repl.js',
  'ui/pivot-panel.js',
  'ui/notebook.js',
  'ui/command-palette.js',
  'ui/build-config.js',
  'ui/debug-panel.js',
  'ui/app-shell.js',
  'scanner/preflight-scanner.js',
  'sharepoint/sp-auth.js',
  'sharepoint/sp-compat.js',
  'sharepoint/sp-errors.js',
  'sharepoint/sp-list-browser.js',
  'sharepoint/sp-list-export.js',
  'sharepoint/sp-list-import.js',
  'sharepoint/sp-doc-browser.js',
  'sharepoint/sp-file-upload.js',
  'sharepoint/sp-spfx.js',
  'sharepoint/sp-aspx.js',
  'inspect/dom-scraper.js',
  'inspect/network-interceptor.js',
  'inspect/storage-viewer.js',
  'inspect/console-capture.js',
  'inspect/page-explorer.js',
  'inspect/var-discovery.js',
  'export/docx-writer.js',
  'export/classification.js'
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
  // If app-shell is present (Tier 2 build) it delegates to initWDK()
  // which handles standalone vs bookmarklet detection internally.
  // If app-shell is absent it falls back to the legacy createPanel() flow.
  return [
    'function main() {',
    '  // Prefer app-shell entry point (Tier 2)',
    '  if (typeof initWDK === "function") {',
    '    initWDK();',
    '    return;',
    '  }',
    '',
    '  // Legacy bookmarklet-only fallback',
    '  if (typeof createPanel !== "function") {',
    '    console.error("WDK: createPanel not available. Build may be incomplete.");',
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
  // Escape any </script> sequences in the JS content to prevent premature script tag closure
  var safeJS = jsContent.replace(/<\/script>/gi, '<\\/script>');
  jsContent = safeJS;
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="UTF-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="color-scheme" content="dark">',
    '<title>WDK</title>',
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
    '<div id="dk-boot"><span>WDK</span></div>',
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

function minifyJS(code) {
  // Strip block comments
  var result = code.replace(/\/\*[\s\S]*?\*\//g, '');
  // Strip single-line comments (but not URLs containing ://)
  result = result.replace(/(^|[^:])\/\/(?!\/).*$/gm, '$1');
  // Strip console.log and console.warn statements
  result = result.replace(/^\s*console\.(log|warn)\([^)]*\);?\s*$/gm, '');
  // Remove empty lines and trim leading whitespace
  result = result.replace(/^\s*[\r\n]+/gm, '');
  result = result.replace(/^[ \t]+/gm, '');
  // Collapse all whitespace (spaces, tabs, newlines) into single space
  result = result.replace(/\s+/g, ' ');
  // Remove spaces around operators/punctuation
  result = result.replace(/ ?([{};,=:+\-*/<>!&|?()\[\]]) ?/g, '$1');
  // Restore necessary keyword spaces
  result = result.replace(/\b(var|function|return|if|else|for|while|typeof|new|throw|catch|switch|case|break|void|delete|in|instanceof|do)\b/g, ' $1 ');
  // Clean up double spaces from keyword insertion
  result = result.replace(/ {2,}/g, ' ');
  // Remove spaces that are now redundant after punctuation+keyword fixes
  result = result.replace(/([{;,=(]) (var|function|return|if|for|while|typeof|new|throw|switch|do) /g, '$1$2 ');
  result = result.replace(/ ([{};,=:)\]>])/g, '$1');
  result = result.replace(/([({]) /g, '$1');
  // Fix else if / else {
  result = result.replace(/\} else /g, '}else ');
  result = result.replace(/\}else if /g, '}else if');
  result = result.replace(/else\{/g, 'else {');
  // Minify CSS and HTML inside string literals
  function minifyStringContent(inner) {
    var min = inner.replace(/\s+/g, ' ').replace(/ ?([{};:,>+~()]) ?/g, '$1');
    // Remove spaces around CSS operators within values
    min = min.replace(/:\s+/g, ':');
    min = min.replace(/\s*!important/g, '!important');
    return min;
  }
  result = result.replace(/'([^']{20,})'/g, function(match, inner) {
    // Skip regex-like strings
    if (inner[0] === '^' || inner[0] === '\\') return match;
    return "'" + minifyStringContent(inner) + "'";
  });
  result = result.replace(/"([^"]{20,})"/g, function(match, inner) {
    if (/\b(function|var|return|if)\b/.test(inner)) return match;
    if (inner[0] === '^' || inner[0] === '\\') return match;
    return '"' + minifyStringContent(inner) + '"';
  });
  // Strip section comment markers
  result = result.replace(/\/\/ ---[^-]*---/g, '');
  // Collapse CSS array joins: merge adjacent string literals separated by commas
  // Turn 'abc','def' into 'abcdef' when they're adjacent in an array
  var prevLen;
  do {
    prevLen = result.length;
    result = result.replace(/'([^']*)','([^']*)'/g, "'$1$2'");
  } while (result.length < prevLen);
  // Remove trailing commas before ]
  result = result.replace(/,\]/g, ']');
  // Remove empty strings in concatenation
  result = result.replace(/''\+/g, '');
  result = result.replace(/\+''/g, '');
  // CSS arrays don't need newline joins — use empty join
  result = result.replace(/\.join\('\\n'\)/g, ".join('')");
  // Simplify [singleString].join('') to just singleString
  result = result.replace(/\[('[^']*')\]\.join\(''\)/g, '$1');
  result = result.replace(/\[("[^"]*")\]\.join\(''\)/g, '$1');
  // Remove redundant semicolons (;;)
  result = result.replace(/;{2,}/g, ';');
  // Remove semicolons before closing braces
  result = result.replace(/;}/g, '}');
  // Shorten common DOM calls via aliases injected at top of IIFE
  // Replace document.createElement with _ce, document.getElementById with _gi, etc.
  var hasCreateElement = result.indexOf('document.createElement') !== -1;
  var hasGetById = result.indexOf('document.getElementById') !== -1;
  var hasGetByClass = result.indexOf('document.getElementsByClassName') !== -1;
  var hasQuerySelector = result.indexOf('document.querySelector') !== -1;
  var hasAddEventListener = result.indexOf('.addEventListener') !== -1;
  var aliases = '';
  if (hasCreateElement) {
    aliases += 'var _ce=document.createElement.bind(document);';
    result = result.replace(/document\.createElement/g, '_ce');
  }
  if (hasGetById) {
    aliases += 'var _gi=document.getElementById.bind(document);';
    result = result.replace(/document\.getElementById/g, '_gi');
  }
  if (hasQuerySelector) {
    // Only replace querySelector not querySelectorAll
    aliases += 'var _qs=document.querySelector.bind(document);';
    result = result.replace(/document\.querySelectorAll/g, '_qsa');
    result = result.replace(/document\.querySelector/g, '_qs');
    if (result.indexOf('_qsa') !== -1) {
      aliases = 'var _qsa=document.querySelectorAll.bind(document);' + aliases;
    }
  }
  // Shorten .appendChild calls via prototype alias
  if (result.indexOf('.appendChild') !== -1) {
    aliases += 'var _ac=function(p,c){return p.appendChild(c)};';
    // Replace el.appendChild(child) with _ac(el,child)
    result = result.replace(/(\w+)\.appendChild\(([^)]+)\)/g, '_ac($1,$2)');
  }
  // Shorten JSON.stringify
  if (result.indexOf('JSON.stringify') !== -1) {
    aliases += 'var _js=JSON.stringify;';
    result = result.replace(/JSON\.stringify/g, '_js');
  }
  // Shorten .addEventListener
  var aeCount = (result.match(/\.addEventListener/g) || []).length;
  if (aeCount > 5) {
    aliases += 'var _on=function(e,t,f){return e.addEventListener(t,f)};';
    result = result.replace(/(\w+)\.addEventListener\(/g, '_on($1,');
  }
  // Shorten document.body
  if (result.indexOf('document.body') !== -1) {
    aliases += 'var _db=document.body;';
    result = result.replace(/document\.body/g, '_db');
  }
  // Shorten theme object references
  if (result.indexOf('DK_SHELL_THEME') !== -1) {
    aliases += 'var _st=DK_SHELL_THEME;';
    result = result.replace(/DK_SHELL_THEME/g, '_st');
  }
  if (result.indexOf('DK_TABLE_THEME') !== -1) {
    aliases += 'var _tt=DK_TABLE_THEME;';
    result = result.replace(/DK_TABLE_THEME/g, '_tt');
  }
  if (result.indexOf('DK_IMPORT_THEME') !== -1) {
    aliases += 'var _it=DK_IMPORT_THEME;';
    result = result.replace(/DK_IMPORT_THEME/g, '_it');
  }
  if (result.indexOf('DK_REPL_THEME') !== -1) {
    aliases += 'var _rt=DK_REPL_THEME;';
    result = result.replace(/DK_REPL_THEME/g, '_rt');
  }
  // Shorten e.preventDefault()
  result = result.replace(/(\w+)\.preventDefault\(\)/g, '($1.returnValue=false)');
  // Shorten .style.cssText= via helper
  var cssTextCount = (result.match(/\.style\.cssText=/g) || []).length;
  if (cssTextCount > 10) {
    aliases += 'var _css=function(e,s){e.style.cssText=s};';
    result = result.replace(/(\w+)\.style\.cssText=([^;]+)/g, '_css($1,$2)');
  }
  // Shorten .innerHTML assignments via helper
  var innerCount = (result.match(/\.innerHTML=/g) || []).length;
  if (innerCount > 5) {
    aliases += 'var _ih=function(e,h){e.innerHTML=h};';
    result = result.replace(/(\w+)\.innerHTML=([^;]+)/g, '_ih($1,$2)');
  }
  // Shorten .className= assignments via helper
  var cnCount = (result.match(/\.className=/g) || []).length;
  if (cnCount > 10) {
    aliases += 'var _cn=function(e,c){e.className=c};';
    result = result.replace(/(\w+)\.className=([^;]+)/g, '_cn($1,$2)');
  }
  // Shorten navigator.clipboard.writeText
  if (result.indexOf('navigator.clipboard.writeText') !== -1) {
    aliases += 'var _cp=function(t){return navigator.clipboard.writeText(t)};';
    result = result.replace(/navigator\.clipboard\.writeText/g, '_cp');
  }
  // Shorten .textContent= via helper
  var tcCount = (result.match(/\.textContent=/g) || []).length;
  if (tcCount > 10) {
    aliases += 'var _tc=function(e,t){e.textContent=t};';
    result = result.replace(/(\w+)\.textContent=([^;]+)/g, '_tc($1,$2)');
  }
  // Shorten .setAttribute via helper
  var saCount = (result.match(/\.setAttribute\(/g) || []).length;
  if (saCount > 10) {
    aliases += 'var _sa=function(e,k,v){e.setAttribute(k,v)};';
    result = result.replace(/(\w+)\.setAttribute\(/g, '_sa($1,');
  }
  // Shorten document.head
  if (result.indexOf('document.head') !== -1) {
    aliases += 'var _dh=document.head;';
    result = result.replace(/document\.head/g, '_dh');
  }
  // Shorten window.location
  if (result.indexOf('window.location') !== -1) {
    aliases += 'var _wl=window.location;';
    result = result.replace(/window\.location/g, '_wl');
  }
  // Strip long HTML help sections (replaced with shorter text in minimal builds)
  result = result.replace(/<h3 style="[^"]*">[^<]*<\/h3>/g, '');
  result = result.replace(/<table style="[^"]*">[\s\S]*?<\/table>/g, '');
  // Shorten common repeated strings
  result = result.replace(/'font-family:inherit'/g, "'font-family:inherit'");
  result = result.replace(/font-family:"SF Mono","Fira Code","Consolas",monospace/g, 'font-family:inherit');
  // Remove typeof checks for functions that will always exist in the bundle
  result = result.replace(/if\(typeof (\w+)==='function'&&/g, 'if(');
  result = result.replace(/if\(typeof (\w+)==="function"&&/g, 'if(');
  // Merge consecutive var declarations: var a=1;var b=2 -> var a=1,b=2
  result = result.replace(/;var /g, ',');
  if (aliases) {
    // Insert aliases after "use strict"
    result = result.replace('"use strict";', '"use strict";' + aliases);
  }
  // Final trim
  result = result.trim();
  return result;
}

// --- Build ---

var tier = 'full';
for (var a = 2; a < process.argv.length; a++) {
  if (process.argv[a] === '--tier=minimal') {
    tier = 'minimal';
  }
}

var sourceList = (tier === 'minimal') ? MINIMAL_FILES : SOURCE_FILES;

console.log('WDK build (' + tier + ' tier)');
console.log('Reading sources...');

var parts = [];
var found = 0;
var skipped = 0;

for (var i = 0; i < sourceList.length; i++) {
  var relPath = sourceList[i];
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

// Apply minification for minimal tier
if (tier === 'minimal') {
  iife = minifyJS(iife);
}

// Ensure dist/ exists
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

if (tier === 'minimal') {
  // Minimal tier outputs
  var jsPath = path.join(DIST, 'wdk-minimal.js');
  fs.writeFileSync(jsPath, iife, 'utf8');
  console.log('  -> ' + jsPath + ' (' + iife.length + ' bytes)');

  var bookmarklet = 'javascript:' + encodeURIComponent(iife);
  var bmPath = path.join(DIST, 'wdk-minimal-bookmarklet.txt');
  fs.writeFileSync(bmPath, bookmarklet, 'utf8');
  console.log('  -> ' + bmPath + ' (' + bookmarklet.length + ' bytes)');
  console.log('  Bookmarklet size: ' + bookmarklet.length + ' bytes (' + (bookmarklet.length / 1024).toFixed(1) + ' KB)');
  if (bookmarklet.length > 100 * 1024) {
    console.log('  WARNING: bookmarklet exceeds 100KB target');
  } else {
    console.log('  OK: bookmarklet under 100KB target');
  }

  var html = buildHTML(iife);
  var htmlPath = path.join(DIST, 'wdk-minimal.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('  -> ' + htmlPath + ' (' + html.length + ' bytes)');
} else {
  // Full tier outputs (original behavior)
  var jsPath = path.join(DIST, 'wdk.js');
  fs.writeFileSync(jsPath, iife, 'utf8');
  console.log('  -> ' + jsPath + ' (' + iife.length + ' bytes)');

  var bookmarklet = 'javascript:' + encodeURIComponent(iife);
  var bmPath = path.join(DIST, 'wdk-bookmarklet.txt');
  fs.writeFileSync(bmPath, bookmarklet, 'utf8');
  console.log('  -> ' + bmPath + ' (' + bookmarklet.length + ' bytes)');

  var html = buildHTML(iife);
  var htmlPath = path.join(DIST, 'wdk.html');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('  -> ' + htmlPath + ' (' + html.length + ' bytes)');
}

console.log('Done. ' + found + ' modules included, ' + skipped + ' skipped.');
