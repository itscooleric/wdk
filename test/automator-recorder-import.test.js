/**
 * Tests for WDK Automator — Chrome DevTools Recorder JSON adapter.
 * Covers selector picking, step conversion, and full import flow.
 */
'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

/* ------------------------------------------------------------------ */
/*  Load module with browser globals stubbed                           */
/* ------------------------------------------------------------------ */

global.window = global.window || { DK: {} };
global.FileReader = global.FileReader || function () {};
global.Blob = global.Blob || function () {};
global.Promise = global.Promise || Promise;

require('../src/automator/recorder-import.js');
var importRecorder = window.DK.automator.importRecorder;
var convertStep = window.DK.automator.convertStep;
var pickSelector = window.DK.automator.pickSelector;
var selectorToString = window.DK.automator.selectorToString;

/* ------------------------------------------------------------------ */
/*  pickSelector                                                       */
/* ------------------------------------------------------------------ */

describe('pickSelector', function () {
  it('prefers plain CSS over aria/text/xpath', function () {
    var s = pickSelector([
      ['xpath//html/body/div'],
      ['aria/Login'],
      ['#login-btn'],
      ['text/Login']
    ]);
    assert.deepEqual(s, { type: 'css', value: '#login-btn' });
  });

  it('falls back to aria when no plain CSS', function () {
    var s = pickSelector([
      ['xpath//html/body/div'],
      ['aria/Login'],
      ['text/Login']
    ]);
    assert.deepEqual(s, { type: 'aria', value: 'Login' });
  });

  it('falls back to text when only xpath and text', function () {
    var s = pickSelector([
      ['xpath//foo'],
      ['text/Hello']
    ]);
    assert.deepEqual(s, { type: 'text', value: 'Hello' });
  });

  it('returns null when only xpath/pierce', function () {
    var s = pickSelector([
      ['xpath//foo'],
      ['pierce/#shadow']
    ]);
    assert.equal(s, null);
  });

  it('collapses AND chain to last (innermost) target', function () {
    // Recorder gives [iframe-selector, target-inside-iframe]
    var s = pickSelector([
      ['iframe.embed', '#inside-iframe-btn']
    ]);
    assert.deepEqual(s, { type: 'css', value: '#inside-iframe-btn' });
  });

  it('returns null on empty input', function () {
    assert.equal(pickSelector([]), null);
    assert.equal(pickSelector(null), null);
    assert.equal(pickSelector(undefined), null);
  });
});

/* ------------------------------------------------------------------ */
/*  selectorToString                                                   */
/* ------------------------------------------------------------------ */

describe('selectorToString', function () {
  it('emits CSS as-is', function () {
    assert.equal(selectorToString({ type: 'css', value: '#btn' }), '#btn');
  });

  it('emits aria as [aria-label="..."]', function () {
    assert.equal(selectorToString({ type: 'aria', value: 'Login' }), '[aria-label="Login"]');
  });

  it('emits text as ::wdk-text("...") sentinel', function () {
    assert.equal(selectorToString({ type: 'text', value: 'Hello' }), '::wdk-text("Hello")');
  });

  it('escapes embedded quotes', function () {
    assert.equal(
      selectorToString({ type: 'aria', value: 'Say "hi"' }),
      '[aria-label="Say \\"hi\\""]'
    );
  });

  it('returns empty string for null/undefined', function () {
    assert.equal(selectorToString(null), '');
  });
});

/* ------------------------------------------------------------------ */
/*  convertStep                                                        */
/* ------------------------------------------------------------------ */

describe('convertStep', function () {
  it('drops setViewport by default', function () {
    var a = convertStep({ type: 'setViewport', width: 1280, height: 720 });
    assert.equal(a, null);
  });

  it('keeps setViewport when ignoreViewport=false', function () {
    var a = convertStep({ type: 'setViewport', width: 1280, height: 720 }, { ignoreViewport: false });
    assert.deepEqual(a, { action: 'viewport', width: 1280, height: 720 });
  });

  it('converts navigate', function () {
    var a = convertStep({ type: 'navigate', url: 'https://example.com' });
    assert.deepEqual(a, { action: 'navigate', url: 'https://example.com' });
  });

  it('converts click with offsets', function () {
    var a = convertStep({
      type: 'click',
      selectors: [['#btn']],
      offsetX: 5,
      offsetY: 10
    });
    assert.deepEqual(a, { action: 'click', selector: '#btn', offsetX: 5, offsetY: 10 });
  });

  it('converts change to type', function () {
    var a = convertStep({
      type: 'change',
      selectors: [['#email']],
      value: 'a@b.com'
    });
    assert.deepEqual(a, { action: 'type', selector: '#email', value: 'a@b.com' });
  });

  it('coerces non-string change values', function () {
    var a = convertStep({
      type: 'change',
      selectors: [['#age']],
      value: 42
    });
    assert.equal(a.value, '42');
  });

  it('emits press for keyDown only (not keyUp)', function () {
    var down = convertStep({ type: 'keyDown', key: 'Enter' });
    assert.deepEqual(down, { action: 'press', key: 'Enter' });
    var up = convertStep({ type: 'keyUp', key: 'Enter' });
    assert.equal(up, null);
  });

  it('converts scroll without selector', function () {
    var a = convertStep({ type: 'scroll', x: 0, y: 500 });
    assert.deepEqual(a, { action: 'scroll', x: 0, y: 500 });
  });

  it('converts scroll with selector (element scroll)', function () {
    var a = convertStep({
      type: 'scroll',
      selectors: [['#pane']],
      x: 0,
      y: 100
    });
    assert.deepEqual(a, { action: 'scroll', x: 0, y: 100, selector: '#pane' });
  });

  it('converts hover', function () {
    var a = convertStep({ type: 'hover', selectors: [['#menu']] });
    assert.deepEqual(a, { action: 'hover', selector: '#menu' });
  });

  it('converts waitForElement with defaults', function () {
    var a = convertStep({ type: 'waitForElement', selectors: [['#result']] });
    assert.deepEqual(a, {
      action: 'wait', selector: '#result',
      operator: '>=', count: 1, timeout: 5000
    });
  });

  it('converts waitForElement with operator + count', function () {
    var a = convertStep({
      type: 'waitForElement',
      selectors: [['.row']],
      operator: '==',
      count: 5,
      timeout: 10000
    });
    assert.equal(a.operator, '==');
    assert.equal(a.count, 5);
    assert.equal(a.timeout, 10000);
  });

  it('converts waitForExpression', function () {
    var a = convertStep({
      type: 'waitForExpression',
      expression: 'window.ready === true',
      timeout: 3000
    });
    assert.deepEqual(a, {
      action: 'waitForExpression',
      expression: 'window.ready === true',
      timeout: 3000
    });
  });

  it('passes through customStep verbatim', function () {
    var a = convertStep({
      type: 'customStep',
      name: 'extractTable',
      parameters: { selector: '#data' }
    });
    assert.equal(a.action, 'custom');
    assert.equal(a.name, 'extractTable');
    assert.deepEqual(a.parameters, { selector: '#data' });
  });

  it('emits noop marker for unsupported types', function () {
    var a = convertStep({ type: 'emulateNetworkConditions' });
    assert.deepEqual(a, { action: 'noop', reason: 'emulateNetworkConditions' });
    var b = convertStep({ type: 'totally-unknown' });
    assert.deepEqual(b, { action: 'noop', reason: 'unsupported:totally-unknown' });
  });

  it('returns null on missing required fields', function () {
    assert.equal(convertStep({ type: 'navigate' }), null);
    assert.equal(convertStep({ type: 'click', selectors: [] }), null);
    assert.equal(convertStep({ type: 'keyDown' }), null);
    assert.equal(convertStep(null), null);
    assert.equal(convertStep({}), null);
  });
});

/* ------------------------------------------------------------------ */
/*  importRecorder                                                     */
/* ------------------------------------------------------------------ */

describe('importRecorder', function () {
  it('imports a full recording from object input', async function () {
    var recording = {
      title: 'Login Flow',
      steps: [
        { type: 'setViewport', width: 1280, height: 720 },
        { type: 'navigate', url: 'https://example.com/login' },
        { type: 'click', selectors: [['#email']] },
        { type: 'change', selectors: [['#email']], value: 'a@b.com' },
        { type: 'click', selectors: [['#password']] },
        { type: 'change', selectors: [['#password']], value: 'secret' },
        { type: 'click', selectors: [['button[type=submit]']] },
        { type: 'waitForElement', selectors: [['.dashboard']] }
      ]
    };

    var script = await importRecorder(recording);
    assert.equal(script.title, 'Login Flow');
    assert.equal(script.sourceFormat, 'devtools-recorder');
    assert.ok(Array.isArray(script.actions));

    // setViewport dropped → 7 actions
    assert.equal(script.actions.length, 7);
    assert.equal(script.actions[0].action, 'navigate');
    assert.equal(script.actions[6].action, 'wait');
  });

  it('imports from JSON string input', async function () {
    var json = JSON.stringify({
      title: 'Quick',
      steps: [{ type: 'navigate', url: 'https://x.test' }]
    });
    var script = await importRecorder(json);
    assert.equal(script.actions.length, 1);
    assert.equal(script.actions[0].url, 'https://x.test');
  });

  it('rejects on invalid JSON string', async function () {
    await assert.rejects(
      function () { return importRecorder('not json'); },
      /Invalid JSON string/
    );
  });

  it('rejects on missing steps array', async function () {
    await assert.rejects(
      function () { return importRecorder({ title: 'oops' }); },
      /missing steps array/
    );
  });

  it('rejects on null input', async function () {
    await assert.rejects(
      function () { return importRecorder(null); },
      /No input provided/
    );
  });

  it('records skipped steps with reasons', async function () {
    var script = await importRecorder({
      steps: [
        { type: 'navigate', url: 'https://x.test' },
        { type: 'navigate' }, // missing url -> skipped
        { type: 'click' },    // missing selectors -> skipped
        { type: 'click', selectors: [['#ok']] }
      ]
    });
    assert.equal(script.actions.length, 2);
    assert.equal(script.skipped.length, 2);
    assert.equal(script.skipped[0].index, 1);
    assert.equal(script.skipped[1].index, 2);
  });

  it('drops noop markers when dropNoops=true', async function () {
    var script = await importRecorder({
      steps: [
        { type: 'navigate', url: 'https://x.test' },
        { type: 'screenshot' },
        { type: 'navigate', url: 'https://y.test' }
      ]
    }, { dropNoops: true });
    assert.equal(script.actions.length, 2);
    assert.equal(script.skipped.length, 1);
    assert.equal(script.skipped[0].reason, 'noop');
  });

  it('preserves selector preference: CSS over aria over text', async function () {
    var script = await importRecorder({
      steps: [
        {
          type: 'click',
          selectors: [
            ['xpath//body/btn'],
            ['aria/Submit'],
            ['#submit'],
            ['text/Submit']
          ]
        }
      ]
    });
    assert.equal(script.actions[0].selector, '#submit');
  });

  it('handles iframe-scoped selectors via AND chain', async function () {
    var script = await importRecorder({
      steps: [
        {
          type: 'click',
          selectors: [
            ['iframe.embed >>> aria/Login'],
            ['iframe.embed', '#login-btn']
          ]
        }
      ]
    });
    assert.equal(script.actions[0].selector, '#login-btn');
  });

  it('round-trips title and importedAt', async function () {
    var t0 = Date.now();
    var script = await importRecorder({
      title: 'My Flow',
      steps: [{ type: 'navigate', url: 'https://x.test' }]
    });
    assert.equal(script.title, 'My Flow');
    var t = new Date(script.importedAt).getTime();
    assert.ok(t >= t0);
  });

  it('uses default title when missing', async function () {
    var script = await importRecorder({ steps: [] });
    assert.equal(script.title, 'Imported Recording');
  });
});
