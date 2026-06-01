#!/usr/bin/env node

/**
 * Bundle vendor libraries into browser-ready IIFE globals.
 * fflate and fzstd already have UMD builds; this bundles snappyjs and hyparquet.
 *
 * Output: vendor/ directory with browser-ready .js files
 * Usage: node scripts/bundle-vendor.js
 */

var esbuild = require('esbuild');
var fs = require('fs');
var path = require('path');

var VENDOR = path.join(__dirname, '..', 'vendor');

if (!fs.existsSync(VENDOR)) fs.mkdirSync(VENDOR);

// Copy existing UMD builds
fs.copyFileSync(
  path.join(__dirname, '..', 'node_modules', 'fflate', 'umd', 'index.js'),
  path.join(VENDOR, 'fflate.js')
);
console.log('  vendor/fflate.js (copied UMD)');

fs.copyFileSync(
  path.join(__dirname, '..', 'node_modules', 'fzstd', 'umd', 'index.js'),
  path.join(VENDOR, 'fzstd.js')
);
console.log('  vendor/fzstd.js (copied UMD)');

// Bundle snappyjs (CommonJS → IIFE)
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'node_modules', 'snappyjs', 'index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'SnappyJS',
  platform: 'browser',
  outfile: path.join(VENDOR, 'snappyjs.js'),
  minify: false,
});
console.log('  vendor/snappyjs.js (bundled IIFE)');

// Bundle hyparquet (ESM → IIFE)
esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'node_modules', 'hyparquet', 'src', 'index.js')],
  bundle: true,
  format: 'iife',
  globalName: 'hyparquet',
  platform: 'browser',
  outfile: path.join(VENDOR, 'hyparquet.js'),
  minify: false,
  // hyparquet is pure ESM with no Node.js deps
  conditions: ['browser', 'import'],
});
console.log('  vendor/hyparquet.js (bundled IIFE)');

// Print sizes
var files = ['fflate.js', 'fzstd.js', 'snappyjs.js', 'hyparquet.js'];
console.log('\nVendor bundle sizes:');
var total = 0;
files.forEach(function (f) {
  var size = fs.statSync(path.join(VENDOR, f)).size;
  total += size;
  console.log('  ' + f + ': ' + (size / 1024).toFixed(1) + ' KB');
});
console.log('  TOTAL: ' + (total / 1024).toFixed(1) + ' KB');
