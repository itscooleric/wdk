/**
 * Tests for INSPECT-007 — Page Explorer
 * Mocks browser globals (window, document, performance) to exercise
 * DK.pageExplorer in a Node.js environment.
 */
'use strict';

var { describe, it, beforeEach, afterEach } = require('node:test');
var assert = require('node:assert/strict');

/* ------------------------------------------------------------------ */
/*  Mock helpers                                                       */
/* ------------------------------------------------------------------ */

function makeElement(tag, opts) {
  opts = opts || {};
  return {
    tagName: tag.toUpperCase(),
    id: opts.id || '',
    className: opts.className || '',
    parentElement: opts.parentElement || null,
    shadowRoot: opts.shadowRoot || null,
    complete: opts.complete !== undefined ? opts.complete : true,
    naturalWidth: opts.naturalWidth !== undefined ? opts.naturalWidth : 100,
    src: opts.src || '',
    href: opts.href || '',
    action: opts.action || '',
    method: opts.method || 'GET',
    attributes: opts.attributes || [],
    getAttribute: function (name) {
      for (var i = 0; i < this.attributes.length; i++) {
        if (this.attributes[i].name === name) return this.attributes[i].value;
      }
      return null;
    },
    hasAttribute: function (name) {
      for (var i = 0; i < this.attributes.length; i++) {
        if (this.attributes[i].name === name) return true;
      }
      return false;
    }
  };
}

function setupBrowserMocks() {
  // --- document mock ---
  var html = makeElement('html');
  var body = makeElement('body', { parentElement: html });
  var div1 = makeElement('div', { id: 'app', parentElement: body, attributes: [{ name: 'data-version', value: '1.0' }] });
  var div2 = makeElement('div', { className: 'content', parentElement: div1 });
  var span = makeElement('span', { parentElement: div2 });
  var btn = makeElement('button', { id: 'submit-btn', parentElement: div1 });
  btn.onclick = function () {};
  var input = makeElement('input', { parentElement: div1 });
  var link = makeElement('a', { href: '/test', parentElement: div1 });
  var form = makeElement('form', { action: '/submit', method: 'POST', parentElement: body });
  var img = makeElement('img', { src: 'logo.png', parentElement: body });
  var brokenImg = makeElement('img', { src: 'broken.png', parentElement: body, naturalWidth: 0 });
  var script = makeElement('script', { src: 'app.js', parentElement: body });
  var stylesheet = makeElement('link', { href: 'style.css', parentElement: body });
  stylesheet.getAttribute = function (n) { return n === 'rel' ? 'stylesheet' : null; };
  var iframe = makeElement('iframe', { src: 'https://embed.example.com', parentElement: body });

  var allElements = [html, body, div1, div2, span, btn, input, link, form, img, brokenImg, script, iframe, stylesheet];

  var metaCharset = makeElement('meta', {
    attributes: [{ name: 'charset', value: 'utf-8' }]
  });
  var metaDesc = makeElement('meta', {
    attributes: [{ name: 'name', value: 'description' }, { name: 'content', value: 'Test page' }]
  });
  var metaOG = makeElement('meta', {
    attributes: [{ name: 'property', value: 'og:title' }, { name: 'content', value: 'My Page' }]
  });

  var linkCanonical = makeElement('link', {
    href: 'https://example.com/page',
    attributes: [{ name: 'rel', value: 'canonical' }]
  });
  linkCanonical.getAttribute = function (n) { return n === 'rel' ? 'canonical' : null; };

  var cspMeta = makeElement('meta', {
    attributes: [{ name: 'http-equiv', value: 'Content-Security-Policy' }, { name: 'content', value: "default-src 'self'" }]
  });

  var queryMap = {
    '*': allElements,
    'iframe': [iframe],
    'img': [img, brokenImg],
    'script[src]': [script],
    'link[rel="stylesheet"]': [stylesheet],
    'form': [form],
    'meta[name], meta[property], meta[charset]': [metaCharset, metaDesc, metaOG],
    'link[rel]': [linkCanonical],
    'button, a, input, select, textarea, form, [role="button"], [tabindex]': [btn, input, link, form]
  };

  global.document = {
    title: 'Test Page Title',
    characterSet: 'UTF-8',
    doctype: { name: 'html', publicId: '', systemId: '' },
    querySelectorAll: function (sel) {
      var result = queryMap[sel] || [];
      result.length = result.length; // ensure .length works
      return result;
    },
    querySelector: function (sel) {
      if (sel === 'meta[http-equiv="Content-Security-Policy"]') return cspMeta;
      return null;
    }
  };

  // --- performance mock ---
  global.performance = {
    memory: {
      usedJSHeapSize: 10 * 1048576,   // 10 MB
      totalJSHeapSize: 20 * 1048576,   // 20 MB
      jsHeapSizeLimit: 100 * 1048576   // 100 MB
    },
    getEntriesByType: function (type) {
      if (type === 'navigation') {
        return [{
          requestStart: 100,
          responseStart: 250,
          domContentLoadedEventEnd: 800,
          startTime: 0,
          loadEventEnd: 1200
        }];
      }
      if (type === 'resource') {
        return [
          { initiatorType: 'script', transferSize: 50000 },
          { initiatorType: 'script', transferSize: 30000 },
          { initiatorType: 'css', transferSize: 10000 },
          { initiatorType: 'img', transferSize: 200000 }
        ];
      }
      return [];
    },
    now: function () { return Date.now(); }
  };

  // --- location mock ---
  global.location = { href: 'https://example.com/test?q=1' };

  // --- window mock ---
  global.window = global;
  // Simulate app-specific globals
  global.myApp = { version: '2.0' };
  global.API_KEY = 'test-key-123';
  global._analytics = [1, 2, 3];
  global.DK = undefined; // will be set by module

  // requestAnimationFrame mock for fps function
  global.requestAnimationFrame = function (cb) { return setTimeout(cb, 16); };
}

function teardownBrowserMocks() {
  delete global.document;
  delete global.performance;
  delete global.location;
  delete global.window;
  delete global.myApp;
  delete global.API_KEY;
  delete global._analytics;
  delete global.requestAnimationFrame;
  delete global.DK;
}

/* ------------------------------------------------------------------ */
/*  Load module once mocks are in place                                */
/* ------------------------------------------------------------------ */

describe('page-explorer', function () {
  beforeEach(function () {
    setupBrowserMocks();
    // Clear module cache so it re-evaluates with fresh mocks
    var modPath = require.resolve('../src/inspect/page-explorer.js');
    delete require.cache[modPath];
    require('../src/inspect/page-explorer.js');
  });

  afterEach(function () {
    var modPath = require.resolve('../src/inspect/page-explorer.js');
    delete require.cache[modPath];
    teardownBrowserMocks();
  });

  /* ------------------------------------------------------------ */
  /*  Module structure                                             */
  /* ------------------------------------------------------------ */
  describe('module shape', function () {
    it('DK.pageExplorer exists after loading', function () {
      assert.ok(DK, 'DK should be defined');
      assert.ok(DK.pageExplorer, 'DK.pageExplorer should be defined');
    });

    it('exposes all 6 public methods', function () {
      var methods = ['getGlobals', 'getDOMSummary', 'getEventListeners',
                     'getPerformance', 'getMetaInfo', 'explore'];
      methods.forEach(function (m) {
        assert.strictEqual(typeof DK.pageExplorer[m], 'function', m + ' should be a function');
      });
    });
  });

  /* ------------------------------------------------------------ */
  /*  getGlobals                                                   */
  /* ------------------------------------------------------------ */
  describe('getGlobals', function () {
    it('returns an array', function () {
      var result = DK.pageExplorer.getGlobals();
      assert.ok(Array.isArray(result));
    });

    it('includes app-specific globals', function () {
      var result = DK.pageExplorer.getGlobals();
      var names = result.map(function (r) { return r.name; });
      assert.ok(names.indexOf('myApp') !== -1, 'should include myApp');
      assert.ok(names.indexOf('API_KEY') !== -1, 'should include API_KEY');
      assert.ok(names.indexOf('_analytics') !== -1, 'should include _analytics');
    });

    it('filters out browser-default globals', function () {
      var result = DK.pageExplorer.getGlobals();
      var names = result.map(function (r) { return r.name; });
      assert.ok(names.indexOf('console') === -1, 'should filter console');
      assert.ok(names.indexOf('setTimeout') === -1, 'should filter setTimeout');
      assert.ok(names.indexOf('document') === -1, 'should filter document');
    });

    it('filters out DK itself', function () {
      var result = DK.pageExplorer.getGlobals();
      var names = result.map(function (r) { return r.name; });
      assert.ok(names.indexOf('DK') === -1, 'should filter DK');
    });

    it('each entry has name, type, and preview fields', function () {
      var result = DK.pageExplorer.getGlobals();
      assert.ok(result.length > 0, 'should have at least one entry');
      var entry = result.find(function (r) { return r.name === 'myApp'; });
      assert.ok(entry, 'myApp should be present');
      assert.strictEqual(entry.type, 'object');
      assert.ok(typeof entry.preview === 'string');
    });
  });

  /* ------------------------------------------------------------ */
  /*  getDOMSummary                                                */
  /* ------------------------------------------------------------ */
  describe('getDOMSummary', function () {
    it('returns expected structure', function () {
      var dom = DK.pageExplorer.getDOMSummary();
      assert.strictEqual(typeof dom.nodeCount, 'number');
      assert.strictEqual(typeof dom.depth, 'number');
      assert.ok(typeof dom.tagCounts === 'object');
      assert.ok(dom.iframes);
      assert.ok(dom.images);
      assert.ok(dom.scripts);
      assert.ok(dom.stylesheets);
      assert.ok(dom.forms);
      assert.strictEqual(typeof dom.shadowRoots, 'number');
      assert.strictEqual(typeof dom.dataAttributes, 'number');
    });

    it('nodeCount matches total elements', function () {
      var dom = DK.pageExplorer.getDOMSummary();
      assert.strictEqual(dom.nodeCount, 14); // html, body, div, div, span, btn, input, a, form, img, img, script, iframe, link
    });

    it('reports correct iframe count and src', function () {
      var dom = DK.pageExplorer.getDOMSummary();
      assert.strictEqual(dom.iframes.count, 1);
      assert.deepStrictEqual(dom.iframes.srcs, ['https://embed.example.com']);
    });

    it('detects broken images', function () {
      var dom = DK.pageExplorer.getDOMSummary();
      assert.strictEqual(dom.images.count, 2);
      assert.strictEqual(dom.images.broken.length, 1);
      assert.ok(dom.images.broken[0].indexOf('broken.png') !== -1);
    });

    it('counts data attributes', function () {
      var dom = DK.pageExplorer.getDOMSummary();
      assert.ok(dom.dataAttributes >= 1, 'should find at least 1 data attribute');
    });
  });

  /* ------------------------------------------------------------ */
  /*  getPerformance                                               */
  /* ------------------------------------------------------------ */
  describe('getPerformance', function () {
    it('returns memory stats in MB', function () {
      var perf = DK.pageExplorer.getPerformance();
      assert.ok(perf.memory);
      assert.strictEqual(perf.memory.usedJSHeapSize, 10);
      assert.strictEqual(perf.memory.totalJSHeapSize, 20);
      assert.strictEqual(perf.memory.jsHeapSizeLimit, 100);
      assert.strictEqual(perf.memory.unit, 'MB');
    });

    it('returns timing data from navigation entries', function () {
      var perf = DK.pageExplorer.getPerformance();
      assert.ok(perf.timing);
      assert.strictEqual(perf.timing.ttfb, 150);           // 250 - 100
      assert.strictEqual(perf.timing.domContentLoaded, 800); // 800 - 0
      assert.strictEqual(perf.timing.loadComplete, 1200);    // 1200 - 0
      assert.strictEqual(perf.timing.unit, 'ms');
    });

    it('returns resource breakdown', function () {
      var perf = DK.pageExplorer.getPerformance();
      assert.strictEqual(perf.resourceCount, 4);
      assert.strictEqual(perf.resources.script, 2);
      assert.strictEqual(perf.resources.css, 1);
      assert.strictEqual(perf.resources.img, 1);
    });

    it('computes total resource size in KB', function () {
      var perf = DK.pageExplorer.getPerformance();
      // (50000 + 30000 + 10000 + 200000) / 1024 ≈ 283.2 KB
      var expected = Math.round(290000 / 1024 * 100) / 100;
      assert.strictEqual(perf.resourceSize.total, expected);
      assert.strictEqual(perf.resourceSize.unit, 'KB');
    });

    it('fps is a function', function () {
      var perf = DK.pageExplorer.getPerformance();
      assert.strictEqual(typeof perf.fps, 'function');
    });
  });

  /* ------------------------------------------------------------ */
  /*  getMetaInfo                                                  */
  /* ------------------------------------------------------------ */
  describe('getMetaInfo', function () {
    it('returns page title and url', function () {
      var meta = DK.pageExplorer.getMetaInfo();
      assert.strictEqual(meta.title, 'Test Page Title');
      assert.strictEqual(meta.url, 'https://example.com/test?q=1');
    });

    it('returns charset', function () {
      var meta = DK.pageExplorer.getMetaInfo();
      assert.strictEqual(meta.charset, 'UTF-8');
    });

    it('returns doctype string', function () {
      var meta = DK.pageExplorer.getMetaInfo();
      assert.strictEqual(meta.doctype, '<!DOCTYPE html>');
    });

    it('returns meta tags from document', function () {
      var meta = DK.pageExplorer.getMetaInfo();
      assert.ok(Array.isArray(meta.metas));
      assert.ok(meta.metas.length >= 2, 'should have at least charset + description metas');
    });

    it('returns CSP from meta tag', function () {
      var meta = DK.pageExplorer.getMetaInfo();
      assert.strictEqual(meta.contentSecurityPolicy, "default-src 'self'");
    });
  });

  /* ------------------------------------------------------------ */
  /*  explore (combined)                                           */
  /* ------------------------------------------------------------ */
  describe('explore', function () {
    it('returns object with all five sections', function () {
      var result = DK.pageExplorer.explore();
      assert.ok(result.globals, 'should have globals');
      assert.ok(result.dom, 'should have dom');
      assert.ok(Array.isArray(result.eventListeners), 'should have eventListeners');
      assert.ok(result.performance, 'should have performance');
      assert.ok(result.meta, 'should have meta');
    });

    it('globals section matches getGlobals output', function () {
      var result = DK.pageExplorer.explore();
      var direct = DK.pageExplorer.getGlobals();
      assert.strictEqual(result.globals.length, direct.length);
    });
  });
});
