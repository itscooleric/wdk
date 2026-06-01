/**
 * Tests for WDK request-replay (toBookmarklet, toFetchSnippet, toCurl,
 * applyEdits, safeHeaders, reRun).
 */
'use strict';

var { describe, it } = require('node:test');
var assert = require('node:assert/strict');

var R = require('../src/inspect/request-replay.js');

/* fixture: a captured GET fetching a JSON report */
function jsonGet() {
  return {
    type: 'fetch',
    url: 'https://app.example.com/api/reports/42?format=json',
    method: 'GET',
    status: 200,
    contentType: 'application/json; charset=utf-8',
    requestHeaders: {
      'accept': 'application/json',
      'authorization': 'Bearer abc123',
      'cookie': 'session=xyz',
      'x-custom': 'keep-me'
    },
    requestBody: '',
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: '{"a":1}',
    timestamp: '2026-05-09T01:00:00Z'
  };
}

/* fixture: a captured POST with JSON body */
function jsonPost() {
  return {
    type: 'fetch',
    url: 'https://app.example.com/api/jobs',
    method: 'POST',
    status: 201,
    contentType: 'application/json',
    requestHeaders: {
      'content-type': 'application/json',
      'authorization': 'Bearer abc123'
    },
    requestBody: '{"name":"job1"}',
    responseHeaders: {},
    responseBody: '{"id":"job-1"}',
    timestamp: '2026-05-09T01:00:00Z'
  };
}

/* ------------------------------------------------------------------ */
/*  safeHeaders                                                        */
/* ------------------------------------------------------------------ */

describe('safeHeaders', function () {
  it('drops cookie + authorization + csrf headers', function () {
    var safe = R.safeHeaders(jsonGet());
    assert.equal(safe.cookie, undefined);
    assert.equal(safe.authorization, undefined);
    assert.equal(safe.accept, 'application/json');
    assert.equal(safe['x-custom'], 'keep-me');
  });

  it('is case-insensitive on drop list', function () {
    var safe = R.safeHeaders({
      requestHeaders: { 'Cookie': 'a=b', 'AUTHORIZATION': 'tok', 'X-Y': 'z' }
    });
    assert.equal(safe.Cookie, undefined);
    assert.equal(safe.AUTHORIZATION, undefined);
    assert.equal(safe['X-Y'], 'z');
  });

  it('handles missing headers', function () {
    assert.deepEqual(R.safeHeaders({}), {});
    assert.deepEqual(R.safeHeaders(null), {});
  });
});

/* ------------------------------------------------------------------ */
/*  toBookmarklet                                                      */
/* ------------------------------------------------------------------ */

describe('toBookmarklet', function () {
  it('GET: starts with javascript: and is URL-encoded', function () {
    var bm = R.toBookmarklet(jsonGet());
    assert.ok(bm.indexOf('javascript:') === 0);
    var decoded = decodeURIComponent(bm.slice('javascript:'.length));
    assert.match(decoded, /void\(fetch\(/);
    assert.match(decoded, /credentials.*include/);
    assert.match(decoded, /reports\/42/);
  });

  it('GET: omits body field', function () {
    var bm = R.toBookmarklet(jsonGet());
    var decoded = decodeURIComponent(bm.slice('javascript:'.length));
    assert.equal(decoded.indexOf('"body"'), -1);
  });

  it('POST: includes body', function () {
    var bm = R.toBookmarklet(jsonPost());
    var decoded = decodeURIComponent(bm.slice('javascript:'.length));
    assert.match(decoded, /"body":"\{\\"name\\":\\"job1\\"\}"/);
  });

  it('strips cookie and authorization from emitted headers', function () {
    var bm = R.toBookmarklet(jsonGet());
    var decoded = decodeURIComponent(bm.slice('javascript:'.length));
    assert.equal(decoded.indexOf('"cookie"'), -1);
    assert.equal(decoded.indexOf('"authorization"'), -1);
    assert.match(decoded, /"x-custom"/);
  });

  it('uses url-derived filename with extension from content-type', function () {
    var bm = R.toBookmarklet(jsonGet());
    var decoded = decodeURIComponent(bm.slice('javascript:'.length));
    assert.match(decoded, /a\.download='42\.json'/);
    var e = jsonGet();
    e.url = 'https://app.example.com/reports/q1';
    e.contentType = 'text/csv';
    var bm2 = R.toBookmarklet(e);
    var d2 = decodeURIComponent(bm2.slice('javascript:'.length));
    assert.match(d2, /a\.download='q1\.csv'/);
  });

  it('honors opts.filename', function () {
    var bm = R.toBookmarklet(jsonGet(), { filename: 'q1-report' });
    var decoded = decodeURIComponent(bm.slice('javascript:'.length));
    assert.match(decoded, /a\.download='q1-report\.json'/);
  });

  it('returns empty string on null entry', function () {
    assert.equal(R.toBookmarklet(null), '');
  });
});

/* ------------------------------------------------------------------ */
/*  toFetchSnippet                                                     */
/* ------------------------------------------------------------------ */

describe('toFetchSnippet', function () {
  it('produces parseable JS string', function () {
    var s = R.toFetchSnippet(jsonGet());
    assert.match(s, /^fetch\(/);
    assert.match(s, /credentials/);
    assert.match(s, /accept/);
  });

  it('includes body for POST', function () {
    var s = R.toFetchSnippet(jsonPost());
    assert.match(s, /"body"/);
    assert.match(s, /job1/);
  });

  it('strips creds', function () {
    var s = R.toFetchSnippet(jsonGet());
    assert.equal(s.indexOf('cookie'), -1);
    assert.equal(s.indexOf('authorization'), -1);
  });
});

/* ------------------------------------------------------------------ */
/*  toCurl                                                             */
/* ------------------------------------------------------------------ */

describe('toCurl', function () {
  it('emits curl URL', function () {
    var c = R.toCurl(jsonGet());
    assert.match(c, /^curl /);
    assert.match(c, /api\/reports\/42/);
  });

  it('GET omits -X', function () {
    var c = R.toCurl(jsonGet());
    assert.equal(c.indexOf('-X GET'), -1);
  });

  it('POST emits -X POST and --data', function () {
    var c = R.toCurl(jsonPost());
    assert.match(c, /-X POST/);
    assert.match(c, /--data/);
    assert.match(c, /job1/);
  });

  it('strips creds in headers', function () {
    var c = R.toCurl(jsonGet());
    assert.equal(c.indexOf('cookie'), -1);
    assert.equal(c.indexOf('authorization'), -1);
    assert.match(c, /x-custom/);
  });

  it('shell-escapes quotes in body', function () {
    var e = jsonPost();
    e.requestBody = '{"q":"name=\\"foo\\""}';
    var c = R.toCurl(e);
    // Body contains escaped quotes — exact backslash count is shell-
    // safe, just confirm content is there and not raw double-quoted.
    assert.ok(c.indexOf('foo') !== -1, 'body content present');
    assert.ok(c.indexOf('--data') !== -1, 'data flag present');
    // Original "foo" surrounded by raw quotes should NOT appear bare.
    assert.equal(c.indexOf('"foo"'), -1, 'no raw "foo" — quotes must be escaped');
  });

  it('appends --compressed by default', function () {
    var c = R.toCurl(jsonGet());
    assert.match(c, /--compressed$/);
  });

  it('omits --compressed when opts.compressed=false', function () {
    var c = R.toCurl(jsonGet(), { compressed: false });
    assert.equal(c.indexOf('--compressed'), -1);
  });
});

/* ------------------------------------------------------------------ */
/*  applyEdits                                                         */
/* ------------------------------------------------------------------ */

describe('applyEdits', function () {
  it('returns a copy when edits empty', function () {
    var e = jsonGet();
    var m = R.applyEdits(e, {});
    assert.notEqual(m, e);
    assert.equal(m.url, e.url);
  });

  it('overrides url + method', function () {
    var m = R.applyEdits(jsonGet(), {
      url: 'https://other.test/x',
      method: 'POST'
    });
    assert.equal(m.url, 'https://other.test/x');
    assert.equal(m.method, 'POST');
  });

  it('merges header patch by default', function () {
    var m = R.applyEdits(jsonGet(), {
      requestHeaders: { 'x-extra': 'yes' }
    });
    assert.equal(m.requestHeaders.accept, 'application/json');
    assert.equal(m.requestHeaders['x-extra'], 'yes');
  });

  it('replaces headers when replaceHeaders=true', function () {
    var m = R.applyEdits(jsonGet(), {
      requestHeaders: { 'x-only': 'yes' },
      replaceHeaders: true
    });
    assert.equal(m.requestHeaders['x-only'], 'yes');
    assert.equal(m.requestHeaders.accept, undefined);
  });

  it('overrides requestBody', function () {
    var m = R.applyEdits(jsonPost(), { requestBody: '{"new":1}' });
    assert.equal(m.requestBody, '{"new":1}');
  });

  it('handles null entry', function () {
    var m = R.applyEdits(null, { url: 'x' });
    assert.equal(m.url, 'x');
  });
});

/* ------------------------------------------------------------------ */
/*  reRun (integration)                                                */
/* ------------------------------------------------------------------ */

describe('reRun', function () {
  it('rejects when entry has no url', async function () {
    await assert.rejects(
      function () { return R.reRun({}); },
      /no url/
    );
  });

  it('fires fetch with merged init and parses JSON response', async function () {
    var calls = [];
    global.fetch = function (url, init) {
      calls.push({ url: url, init: init });
      return Promise.resolve({
        status: 200,
        text: function () { return Promise.resolve('{"ok":true}'); },
        headers: {
          get: function (k) { return k === 'content-type' ? 'application/json' : null; },
          forEach: function (cb) { cb('application/json', 'content-type'); }
        }
      });
    };
    var out = await R.reRun(jsonGet(), { url: 'https://x.test/y' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://x.test/y');
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(out.status, 200);
    assert.deepEqual(out.parsedJSON, { ok: true });
    assert.equal(out.contentType, 'application/json');
    assert.ok(out.timing >= 0);
  });

  it('omits body for GET even when present in entry', async function () {
    var capturedInit = null;
    global.fetch = function (url, init) {
      capturedInit = init;
      return Promise.resolve({
        status: 200,
        text: function () { return Promise.resolve(''); },
        headers: { get: function () { return ''; }, forEach: function () {} }
      });
    };
    var entry = jsonGet();
    entry.requestBody = 'should-not-be-sent';
    await R.reRun(entry);
    assert.equal(capturedInit.body, undefined);
  });

  it('sends body for POST', async function () {
    var capturedInit = null;
    global.fetch = function (url, init) {
      capturedInit = init;
      return Promise.resolve({
        status: 201,
        text: function () { return Promise.resolve('{}'); },
        headers: { get: function () { return 'application/json'; }, forEach: function () {} }
      });
    };
    await R.reRun(jsonPost());
    assert.equal(capturedInit.body, '{"name":"job1"}');
    assert.equal(capturedInit.method, 'POST');
  });
});

/* ------------------------------------------------------------------ */
/*  internal helpers                                                   */
/* ------------------------------------------------------------------ */

describe('_internal helpers', function () {
  it('fileNameFromUrl strips query and path', function () {
    var fn = R._internal.fileNameFromUrl;
    assert.equal(fn('https://x.test/a/b/report.csv?x=1'), 'report.csv');
    assert.equal(fn('https://x.test/a/'), 'a');
    assert.equal(fn(''), 'response');
  });

  it('extFromCT recognizes common types', function () {
    var ex = R._internal.extFromCT;
    assert.equal(ex('application/json'), '.json');
    assert.equal(ex('text/csv'), '.csv');
    assert.equal(ex('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), '.xlsx');
    assert.equal(ex('application/pdf'), '.pdf');
    assert.equal(ex(''), '');
  });

  it('jsString escapes quotes/newlines/backslashes', function () {
    var js = R._internal.jsString;
    assert.equal(js("a'b"), "'a\\'b'");
    assert.equal(js("a\\b"), "'a\\\\b'");
    assert.equal(js("a\nb"), "'a\\nb'");
  });

  it('shellQuote escapes dollar/backtick/quote', function () {
    var sh = R._internal.shellQuote;
    assert.equal(sh('a$b'), '"a\\$b"');
    assert.equal(sh('a`b'), '"a\\`b"');
    assert.equal(sh('a"b'), '"a\\"b"');
  });
});
