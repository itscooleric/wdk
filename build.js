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

// Tier A: Inspect — DevTools replacement (~45KB)
var INSPECT_FILES = [
  'ui/panel.js',
  'ui/debug-panel.js',
  'inspect/dom-scraper.js',
  'inspect/network-interceptor.js',
  'inspect/storage-viewer.js',
  'inspect/console-capture.js',
  'inspect/page-explorer.js',
  'inspect/var-discovery.js'
];

// Tier B: Inspect + REPL (~60KB)
var REPL_FILES = INSPECT_FILES.concat([
  'ui/repl.js'
]);

// Tier C: Inspect + Data (~85KB)
var DATA_FILES = REPL_FILES.concat([
  'parsers/csv.js',
  'transforms/data-model.js',
  'util/detect-types.js',
  'export/export.js',
  'ui/table.js',
  'ui/file-import.js'
]);

// Tier D: Inspect + Robo (~80KB)
var ROBO_FILES = REPL_FILES.concat([
  'ui/robo.js'
]);

// Tier E: Field Kit (~95KB) — Inspect + Data + Robo + Classification
var FIELD_FILES = DATA_FILES.concat([
  'ui/robo.js',
  'export/classification.js',
  'export/nipr-safe.js'
]);

// Tier name → file list mapping
var TIER_MAP = {
  minimal: MINIMAL_FILES,
  inspect: INSPECT_FILES,
  repl: REPL_FILES,
  data: DATA_FILES,
  robo: ROBO_FILES,
  field: FIELD_FILES,
  full: null  // uses SOURCE_FILES
};

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
  'export/classification.js',
  'export/nipr-safe.js',
  'parsers/docx-reader.js',
  'ui/robo.js'
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
  // Use terser for proper AST-based minification
  var Terser = require('terser');
  var result = Terser.minify_sync(code, {
    compress: {
      dead_code: true,
      drop_console: true,
      passes: 2
    },
    mangle: false,  // keep variable names readable for debugging
    output: {
      ascii_only: false,
      semicolons: true
    }
  });
  if (result.error) {
    console.error('Terser error:', result.error.message);
    console.error('  at line:', result.error.line, 'col:', result.error.col);
    // Fall back to simple whitespace removal
    return code.replace(/\/\*[\s\S]*?\*\//g, '')
               .replace(/(^|[^:])\/\/(?!\/).*$/gm, '$1')
               .replace(/^\s*[\r\n]+/gm, '')
               .replace(/^[ \t]+/gm, '')
               .trim();
  }
  return result.code;
}

// --- Build ---

var tier = 'full';
var encodeMode = null;
var asciiMode = false;
for (var a = 2; a < process.argv.length; a++) {
  var match = process.argv[a].match(/^--tier=(.+)$/);
  if (match) {
    tier = match[1];
  }
  if (process.argv[a].match(/^--encode=(.+)$/)) {
    encodeMode = process.argv[a].split('=')[1];
  }
  if (process.argv[a] === '--ascii') {
    asciiMode = true;
  }
}

if (tier !== 'full' && !TIER_MAP[tier]) {
  console.error('Unknown tier: ' + tier);
  console.error('Available tiers: ' + Object.keys(TIER_MAP).join(', '));
  process.exit(1);
}

var sourceList = (tier === 'full') ? SOURCE_FILES : TIER_MAP[tier];
var isMinified = (tier !== 'full');

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

// Apply minification for non-full tiers (JS and HTML stay readable for full tier)
var minifiedIIFE = null;
if (isMinified) {
  iife = minifyJS(iife);
} else {
  // Full tier: keep iife readable for .js/.html, but minify separately for bookmarklet
  minifiedIIFE = minifyJS(iife);
}

// ASCII sanitization — replace all non-ASCII chars with ASCII equivalents
if (asciiMode || encodeMode) {
  var UNICODE_MAP = {
    '\u2500': '-', '\u2502': '|', '\u250C': '+', '\u2510': '+',
    '\u2514': '+', '\u2518': '+', '\u251C': '+', '\u2524': '+',
    '\u252C': '+', '\u2534': '+', '\u253C': '+',
    '\u2014': '--', '\u2013': '-', '\u2192': '->', '\u2190': '<-',
    '\u2022': '*', '\u25CF': '*', '\u25CB': 'o',
    '\u2715': 'x', '\u2717': 'x', '\u2713': 'v',
    '\u26A0': '!', '\u00B7': '.', '\u2699': '*',
    '\u201C': '"', '\u201D': '"', '\u2018': "'", '\u2019': "'",
    '\u2026': '...',
    '\u25b6': '>', '\u25bc': 'v', '\u25b2': '^',
    '\u2696': '=',
  };
  // Also map escape sequences in source code (e.g. '\u26a0' as literal text)
  var ESCAPE_MAP = {};
  var escKeys = Object.keys(UNICODE_MAP);
  for (var ek = 0; ek < escKeys.length; ek++) {
    var cp = escKeys[ek].codePointAt(0).toString(16);
    while (cp.length < 4) cp = '0' + cp;
    ESCAPE_MAP['\\u' + cp] = UNICODE_MAP[escKeys[ek]];
    ESCAPE_MAP['\\u' + cp.toUpperCase()] = UNICODE_MAP[escKeys[ek]];
  }
  // Replace Unicode escape sequences in source strings first
  function replaceEscapes(text) {
    return text.replace(/\\u[0-9a-fA-F]{4}/g, function(m) {
      return ESCAPE_MAP[m.toLowerCase()] || ESCAPE_MAP[m] || m;
    });
  }
  iife = replaceEscapes(iife);
  var asciiResult = '';
  for (var ci = 0; ci < iife.length; ci++) {
    var ch = iife[ci];
    var code = iife.charCodeAt(ci);
    if (code > 127) {
      asciiResult += UNICODE_MAP[ch] || '?';
    } else {
      asciiResult += ch;
    }
  }
  iife = asciiResult;
  // Also sanitize the minified version if it exists
  if (minifiedIIFE) {
    minifiedIIFE = replaceEscapes(minifiedIIFE);
    var asciiMin = '';
    for (var mi = 0; mi < minifiedIIFE.length; mi++) {
      var mch = minifiedIIFE[mi];
      var mcode = minifiedIIFE.charCodeAt(mi);
      if (mcode > 127) {
        asciiMin += UNICODE_MAP[mch] || '?';
      } else {
        asciiMin += mch;
      }
    }
    minifiedIIFE = asciiMin;
  }
  if (asciiMode) {
    console.log('  ASCII sanitized: all non-ASCII chars replaced');
  }
}

// Ensure dist/ exists
if (!fs.existsSync(DIST)) {
  fs.mkdirSync(DIST, { recursive: true });
}

var suffix = (tier === 'full') ? '' : '-' + tier;
var jsPath = path.join(DIST, 'wdk' + suffix + '.js');
fs.writeFileSync(jsPath, iife, 'utf8');
console.log('  -> ' + jsPath + ' (' + iife.length + ' bytes)');

var bookmarkletSource = minifiedIIFE || iife;  // Always use minified for bookmarklet
var bookmarklet = 'javascript:' + encodeURIComponent(bookmarkletSource);
var bmPath = path.join(DIST, 'wdk' + suffix + '-bookmarklet.txt');
fs.writeFileSync(bmPath, bookmarklet, 'utf8');
console.log('  -> ' + bmPath + ' (' + bookmarklet.length + ' bytes)');

console.log('  Bookmarklet size: ' + bookmarklet.length + ' bytes (' + (bookmarklet.length / 1024).toFixed(1) + ' KB)');
if (bookmarklet.length > 100 * 1024) {
  console.log('  WARNING: bookmarklet exceeds 100KB — may not work in all browsers');
  console.log('  TIP: use --tier=inspect (71KB) or the loader bookmarklet instead');
} else {
  console.log('  OK: bookmarklet under 100KB target');
}

var html = buildHTML(iife);
var htmlPath = path.join(DIST, 'wdk' + suffix + '.html');
fs.writeFileSync(htmlPath, html, 'utf8');
console.log('  -> ' + htmlPath + ' (' + html.length + ' bytes)');

// Generate loader bookmarklet (always, for full tier)
if (tier === 'full') {
  var loader = "javascript:void(document.head.appendChild(Object.assign(document.createElement('script'),{src:prompt('WDK URL:','https://stash.edge.wubi.dev/raw/wdk.txt')})))";
  var loaderPath = path.join(DIST, 'wdk-loader-bookmarklet.txt');
  fs.writeFileSync(loaderPath, loader, 'utf8');
  console.log('  -> ' + loaderPath + ' (' + loader.length + ' bytes)');
}

// Charcode encoding for CDS transfer
if (encodeMode === 'charcode') {
  var codes = [];
  for (var ei = 0; ei < iife.length; ei++) {
    codes.push(iife.charCodeAt(ei));
  }
  var jsonEncoded = JSON.stringify(codes);
  var encodedPath = path.join(DIST, 'wdk' + suffix + '-encoded.json');
  fs.writeFileSync(encodedPath, jsonEncoded, 'utf8');
  console.log('  -> ' + encodedPath + ' (' + jsonEncoded.length + ' bytes, ' + (jsonEncoded.length / 1024).toFixed(1) + ' KB)');

  // Generate PowerShell decoder
  var psDecoder = [
    '# WDK Decoder — run on receiving side',
    '# Usage: powershell -File decode-wdk.ps1',
    '$codes = Get-Content "wdk' + suffix + '-encoded.json" | ConvertFrom-Json',
    '$js = -join ($codes | ForEach-Object { [char]$_ })',
    '$js | Out-File -Encoding UTF8 "wdk' + suffix + '.js"',
    'Write-Host "Decoded $($codes.Count) chars to wdk' + suffix + '.js"',
  ].join('\r\n');
  var psPath = path.join(DIST, 'decode-wdk' + suffix + '.ps1');
  fs.writeFileSync(psPath, psDecoder, 'utf8');
  console.log('  -> ' + psPath);

  // Generate self-extracting HTML decoder
  var htmlDecoder = [
    '<!DOCTYPE html>',
    '<html><head><meta charset="UTF-8"><title>WDK Loader</title></head>',
    '<body style="background:#0a0a1a;color:#e0e0f0;font-family:monospace;padding:20px">',
    '<h2>WDK Loader</h2>',
    '<p>Loading WDK from encoded data...</p>',
    '<script>',
    'var x=new XMLHttpRequest();',
    'x.open("GET","wdk' + suffix + '-encoded.json",true);',
    'x.onload=function(){',
    '  var codes=JSON.parse(x.responseText);',
    '  var js="";for(var i=0;i<codes.length;i++)js+=String.fromCharCode(codes[i]);',
    '  var s=document.createElement("script");s.textContent=js;document.head.appendChild(s);',
    '  document.body.innerHTML="<h2>WDK loaded ("+codes.length+" chars)</h2>";',
    '};',
    'x.onerror=function(){document.body.innerHTML+="<p style=color:red>Failed to load encoded file. Place wdk' + suffix + '-encoded.json in the same directory.</p>"};',
    'x.send();',
    '</script>',
    '</body></html>',
  ].join('\n');
  var htmlDecoderPath = path.join(DIST, 'wdk' + suffix + '-loader.html');
  fs.writeFileSync(htmlDecoderPath, htmlDecoder, 'utf8');
  console.log('  -> ' + htmlDecoderPath);
}

console.log('Done. ' + found + ' modules included, ' + skipped + ' skipped.');
if (tier !== 'full') {
  console.log('Tier: ' + tier + ' (' + found + ' modules)');
}
console.log('Available tiers: ' + Object.keys(TIER_MAP).join(', '));
if (encodeMode) {
  console.log('Encoding: ' + encodeMode);
}
if (asciiMode) {
  console.log('ASCII mode: enabled');
}
