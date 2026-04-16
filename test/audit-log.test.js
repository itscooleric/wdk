var { describe, it } = require('node:test');
var assert = require('node:assert');
var { AuditLog } = require('../src/util/audit-log.js');

describe('AuditLog', function() {

  // Each test suite gets a fresh AuditLog — but since it is a singleton IIFE,
  // we need to clear between tests.
  it('logImport creates entry with correct fields', function() {
    AuditLog.clear();
    var entry = AuditLog.logImport('test.csv', 100, 5, 2048, 'abc123');
    assert.strictEqual(entry.action, 'import');
    assert.strictEqual(entry.details.filename, 'test.csv');
    assert.strictEqual(entry.details.rows, 100);
    assert.strictEqual(entry.details.columns, 5);
    assert.strictEqual(entry.details.size, 2048);
    assert.strictEqual(entry.details.hash, 'abc123');
    assert.strictEqual(entry.details.disposition, 'loaded');
  });

  it('logExport creates entry with correct fields', function() {
    AuditLog.clear();
    var entry = AuditLog.logExport('output.csv', 'csv', 50);
    assert.strictEqual(entry.action, 'export');
    assert.strictEqual(entry.details.filename, 'output.csv');
    assert.strictEqual(entry.details.format, 'csv');
    assert.strictEqual(entry.details.rows, 50);
    assert.strictEqual(entry.details.disposition, 'exported');
  });

  it('logQuery creates entry', function() {
    AuditLog.clear();
    var entry = AuditLog.logQuery('sql', 'SELECT * FROM t', 10, 42);
    assert.strictEqual(entry.action, 'query');
    assert.strictEqual(entry.details.type, 'sql');
    assert.strictEqual(entry.details.resultRows, 10);
    assert.strictEqual(entry.details.elapsedMs, 42);
    assert.strictEqual(entry.details.disposition, 'executed');
  });

  it('logTransform creates entry', function() {
    AuditLog.clear();
    var entry = AuditLog.logTransform('pivot', 200, 3);
    assert.strictEqual(entry.action, 'transform');
    assert.strictEqual(entry.details.type, 'pivot');
    assert.strictEqual(entry.details.rows, 200);
    assert.strictEqual(entry.details.columns, 3);
    assert.strictEqual(entry.details.disposition, 'applied');
  });

  it('logRedact creates entry with method', function() {
    AuditLog.clear();
    var entry = AuditLog.logRedact(2, 500, 'hash');
    assert.strictEqual(entry.action, 'redact');
    assert.strictEqual(entry.details.columns, 2);
    assert.strictEqual(entry.details.cells, 500);
    assert.strictEqual(entry.details.method, 'hash');
    assert.strictEqual(entry.details.disposition, 'redacted');
  });

  it('logClear creates entry with disposition', function() {
    AuditLog.clear();
    var entry = AuditLog.logClear();
    assert.strictEqual(entry.action, 'clear');
    assert.strictEqual(entry.details.disposition, 'cleared');
  });

  it('toJSONLines returns valid JSON Lines (each line parseable)', function() {
    AuditLog.clear();
    AuditLog.logImport('a.csv', 1, 1, 10);
    AuditLog.logExport('b.csv', 'csv', 1);
    AuditLog.logQuery('sql', 'SELECT 1', 1, 1);
    var lines = AuditLog.toJSONLines().split('\n');
    // clear entry + 3 new entries = at least 4 lines
    assert.ok(lines.length >= 3, 'Expected at least 3 lines, got ' + lines.length);
    lines.forEach(function(line) {
      var parsed = JSON.parse(line);
      assert.ok(parsed.timestamp, 'Each entry should have a timestamp');
      assert.ok(parsed.action, 'Each entry should have an action');
      assert.ok(parsed.session, 'Each entry should have a session');
    });
  });

  it('getEntries returns array copy', function() {
    AuditLog.clear();
    AuditLog.logImport('x.csv', 1, 1, 1);
    var entries = AuditLog.getEntries();
    var len = entries.length;
    entries.push({ fake: true });
    assert.strictEqual(AuditLog.getEntries().length, len, 'Pushing to copy should not affect internal entries');
  });

  it('count returns correct number', function() {
    AuditLog.clear();
    // After clear, there is 1 entry (the audit-clear entry)
    var baseline = AuditLog.count();
    AuditLog.logImport('a.csv', 1, 1, 1);
    AuditLog.logExport('b.csv', 'csv', 1);
    assert.strictEqual(AuditLog.count(), baseline + 2);
  });

  it('clear keeps only the clear entry', function() {
    AuditLog.clear();
    AuditLog.logImport('a.csv', 1, 1, 1);
    AuditLog.logImport('b.csv', 2, 2, 2);
    AuditLog.logImport('c.csv', 3, 3, 3);
    assert.ok(AuditLog.count() >= 3);
    AuditLog.clear();
    assert.strictEqual(AuditLog.count(), 1, 'After clear, only the audit-clear entry should remain');
    var entries = AuditLog.getEntries();
    assert.strictEqual(entries[0].action, 'audit-clear');
  });

  it('sessionId is stable within instance', function() {
    var id1 = AuditLog.sessionId;
    var id2 = AuditLog.sessionId;
    assert.strictEqual(id1, id2);
    assert.ok(id1.startsWith('wdk-'), 'sessionId should start with wdk-');
  });

  it('entries have ISO timestamps', function() {
    AuditLog.clear();
    var entry = AuditLog.logImport('t.csv', 1, 1, 1);
    // ISO 8601 format check
    var isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    assert.ok(isoPattern.test(entry.timestamp), 'Timestamp should be ISO 8601 format, got: ' + entry.timestamp);
  });

  it('maxEntries cap works', function() {
    AuditLog.clear();
    // Log 10002 entries (1 from clear + 10001 new)
    for (var i = 0; i < 10001; i++) {
      AuditLog.log('test', { i: i });
    }
    assert.ok(AuditLog.count() <= 10000, 'Count should not exceed maxEntries (10000), got: ' + AuditLog.count());
  });
});
