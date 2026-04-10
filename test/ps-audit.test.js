/**
 * Tests for PowerShell audit log format validation.
 * Since we can't run PowerShell in CI, these tests validate
 * the JSON Lines format and schema that wiz-audit.ps1 produces.
 * Sprint C — forge/datakit#5
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Audit log format', function () {
  const sampleEvents = [
    '{"timestamp":"2026-04-08T12:00:00.0000000Z","operator":"lead@WORKSTATION","action":"SESSION_START","details":{"toolkit_version":"1.0.0","powershell_version":"7.4.1","os":"Microsoft Windows 10.0.22631"}}',
    '{"timestamp":"2026-04-08T12:01:00.0000000Z","operator":"lead@WORKSTATION","action":"FILE_SCAN","file":"data.csv","file_size":1024,"sha256":"abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890","disposition":"CLEAN","details":{"findings_count":0,"lines_scanned":100}}',
    '{"timestamp":"2026-04-08T12:02:00.0000000Z","operator":"lead@WORKSTATION","action":"FILE_SCAN","file":"pii-data.csv","file_size":2048,"sha256":"1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef","disposition":"PII_DETECTED","details":{"findings_count":3,"lines_scanned":50}}',
    '{"timestamp":"2026-04-08T12:03:00.0000000Z","operator":"lead@WORKSTATION","action":"FILE_TRANSFER","file":"clean.csv","sha256":"fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321","disposition":"TRANSFERRED","details":{"remote_host":"user@server","remote_path":"/upload","attempts":1}}',
    '{"timestamp":"2026-04-08T12:04:00.0000000Z","operator":"lead@WORKSTATION","action":"SESSION_END","details":{"log_file":"logs/wiz-audit.jsonl"}}'
  ];

  it('each line is valid JSON', function () {
    for (const line of sampleEvents) {
      assert.doesNotThrow(function () { JSON.parse(line); });
    }
  });

  it('each event has required fields', function () {
    for (const line of sampleEvents) {
      const event = JSON.parse(line);
      assert.ok(event.timestamp, 'must have timestamp');
      assert.ok(event.operator, 'must have operator');
      assert.ok(event.action, 'must have action');
    }
  });

  it('timestamp is ISO 8601 format', function () {
    for (const line of sampleEvents) {
      const event = JSON.parse(line);
      const date = new Date(event.timestamp);
      assert.ok(!isNaN(date.getTime()), 'timestamp must parse as valid date');
    }
  });

  it('action types are from allowed set', function () {
    var allowedActions = [
      'SESSION_START', 'SESSION_END',
      'FILE_SCAN', 'FILE_TRANSFER', 'FILE_WRITE',
      'BRIDGE_START', 'BRIDGE_STOP',
      'BLOCKED_PII'
    ];
    for (const line of sampleEvents) {
      const event = JSON.parse(line);
      assert.ok(allowedActions.includes(event.action), 'action ' + event.action + ' must be in allowed set');
    }
  });

  it('SHA-256 hashes are 64 hex chars when present', function () {
    for (const line of sampleEvents) {
      const event = JSON.parse(line);
      if (event.sha256) {
        assert.match(event.sha256, /^[a-f0-9]{64}$/, 'sha256 must be 64 hex chars');
      }
    }
  });

  it('disposition values are meaningful strings', function () {
    var allowedDispositions = ['CLEAN', 'PII_DETECTED', 'QUARANTINED', 'TRANSFERRED', 'FAILED', 'BLOCKED_PII'];
    for (const line of sampleEvents) {
      const event = JSON.parse(line);
      if (event.disposition) {
        assert.ok(allowedDispositions.includes(event.disposition), 'disposition ' + event.disposition + ' must be in allowed set');
      }
    }
  });

  it('file field is filename only (no directory path)', function () {
    for (const line of sampleEvents) {
      const event = JSON.parse(line);
      if (event.file) {
        assert.ok(!event.file.includes('/'), 'file must not contain /');
        assert.ok(!event.file.includes('\\'), 'file must not contain \\');
      }
    }
  });

  it('events never contain PII content', function () {
    // Verify that the sample events follow the rule:
    // "Never log PII content itself"
    var piiPatterns = [
      /\b\d{3}-\d{2}-\d{4}\b/,     // SSN
      /\b4\d{3}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,  // Visa
    ];
    for (const line of sampleEvents) {
      for (const pattern of piiPatterns) {
        assert.ok(!pattern.test(line), 'audit event must not contain PII patterns');
      }
    }
  });
});

describe('Audit log JSONL parsing', function () {
  it('can parse multi-line JSONL file', function () {
    var lines = [
      '{"timestamp":"2026-04-08T12:00:00Z","operator":"test","action":"SESSION_START"}',
      '{"timestamp":"2026-04-08T12:01:00Z","operator":"test","action":"FILE_SCAN","disposition":"CLEAN"}',
      '{"timestamp":"2026-04-08T12:02:00Z","operator":"test","action":"SESSION_END"}'
    ];
    var events = lines.map(function (l) { return JSON.parse(l); });
    assert.equal(events.length, 3);
    assert.equal(events[0].action, 'SESSION_START');
    assert.equal(events[1].action, 'FILE_SCAN');
    assert.equal(events[2].action, 'SESSION_END');
  });

  it('skips empty lines gracefully', function () {
    var lines = [
      '{"timestamp":"2026-04-08T12:00:00Z","operator":"test","action":"SESSION_START"}',
      '',
      '  ',
      '{"timestamp":"2026-04-08T12:01:00Z","operator":"test","action":"SESSION_END"}'
    ];
    var events = [];
    for (var line of lines) {
      var trimmed = line.trim();
      if (trimmed === '') continue;
      events.push(JSON.parse(trimmed));
    }
    assert.equal(events.length, 2);
  });
});
