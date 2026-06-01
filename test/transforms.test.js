const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { Pipeline } = require('../src/transforms/pipeline.js');
const { detectColumnType, profileColumn } = require('../src/util/detect-types.js');

// Redact module uses ESM exports — load via dynamic import
let blankColumn, replaceColumn, regexRedact, hashColumn, djb2;
before(async () => {
  const mod = await import('../src/transforms/redact.js');
  blankColumn = mod.blankColumn;
  replaceColumn = mod.replaceColumn;
  regexRedact = mod.regexRedact;
  hashColumn = mod.hashColumn;
  djb2 = mod.djb2;
});

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------
describe('Pipeline', () => {
  it('should initialize with a deep clone of initial data', () => {
    const data = { headers: ['a'], rows: [['1']] };
    const p = new Pipeline(data);
    data.headers.push('b');
    assert.deepStrictEqual(p.current.headers, ['a']);
  });

  it('apply should transform current state', () => {
    const p = new Pipeline({ value: 1 });
    const result = p.apply((d) => ({ value: d.value + 1 }), 'increment');
    assert.strictEqual(result.value, 2);
    assert.strictEqual(p.current.value, 2);
  });

  it('undo should revert to previous state', () => {
    const p = new Pipeline({ value: 1 });
    p.apply((d) => ({ value: d.value + 10 }), 'add 10');
    assert.strictEqual(p.current.value, 11);
    const undone = p.undo();
    assert.strictEqual(undone.value, 1);
    assert.strictEqual(p.current.value, 1);
  });

  it('redo should re-apply undone transform', () => {
    const p = new Pipeline({ value: 1 });
    p.apply((d) => ({ value: d.value + 10 }), 'add 10');
    p.undo();
    const redone = p.redo();
    assert.strictEqual(redone.value, 11);
  });

  it('canUndo and canRedo should reflect state', () => {
    const p = new Pipeline({ value: 0 });
    assert.strictEqual(p.canUndo(), false);
    assert.strictEqual(p.canRedo(), false);

    p.apply((d) => ({ value: 1 }), 'set 1');
    assert.strictEqual(p.canUndo(), true);
    assert.strictEqual(p.canRedo(), false);

    p.undo();
    assert.strictEqual(p.canUndo(), false);
    assert.strictEqual(p.canRedo(), true);
  });

  it('undo should return null when nothing to undo', () => {
    const p = new Pipeline({ value: 0 });
    assert.strictEqual(p.undo(), null);
  });

  it('redo should return null when nothing to redo', () => {
    const p = new Pipeline({ value: 0 });
    assert.strictEqual(p.redo(), null);
  });

  it('apply should clear redo stack', () => {
    const p = new Pipeline({ value: 0 });
    p.apply((d) => ({ value: 1 }), 'set 1');
    p.undo();
    assert.strictEqual(p.canRedo(), true);
    p.apply((d) => ({ value: 2 }), 'set 2');
    assert.strictEqual(p.canRedo(), false);
  });

  it('preview should not modify state', () => {
    const p = new Pipeline({ value: 1 });
    const preview = p.preview((d) => ({ value: d.value * 100 }));
    assert.strictEqual(preview.value, 100);
    assert.strictEqual(p.current.value, 1);
    assert.strictEqual(p.canUndo(), false);
  });

  it('reset should restore original state and clear history', () => {
    const p = new Pipeline({ value: 1 });
    p.apply((d) => ({ value: 2 }), 'set 2');
    p.apply((d) => ({ value: 3 }), 'set 3');
    p.reset();
    assert.strictEqual(p.current.value, 1);
    assert.strictEqual(p.canUndo(), false);
    assert.strictEqual(p.canRedo(), false);
  });

  it('history should return descriptions and timestamps', () => {
    const p = new Pipeline({ value: 0 });
    p.apply((d) => ({ value: 1 }), 'first');
    p.apply((d) => ({ value: 2 }), 'second');
    const h = p.history();
    assert.strictEqual(h.length, 2);
    assert.strictEqual(h[0].description, 'first');
    assert.strictEqual(h[1].description, 'second');
    assert.ok(h[0].timestamp);
  });

  it('should enforce max 50 history entries', () => {
    const p = new Pipeline({ value: 0 });
    for (let i = 0; i < 55; i++) {
      p.apply((d) => ({ value: d.value + 1 }), `step ${i}`);
    }
    assert.strictEqual(p.history().length, 50);
    assert.strictEqual(p.current.value, 55);
  });
});

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------
describe('Redaction', () => {
  it('blankColumn should blank all values in a column', () => {
    const table = [
      { name: 'Alice', email: 'alice@test.com' },
      { name: 'Bob', email: 'bob@test.com' },
    ];
    blankColumn(table, 'email');
    assert.strictEqual(table[0].email, '');
    assert.strictEqual(table[1].email, '');
    assert.strictEqual(table[0].name, 'Alice');
  });

  it('replaceColumn should replace all values with a placeholder', () => {
    const table = [
      { name: 'Alice', ssn: '123-45-6789' },
      { name: 'Bob', ssn: '987-65-4321' },
    ];
    replaceColumn(table, 'ssn', '[REDACTED]');
    assert.strictEqual(table[0].ssn, '[REDACTED]');
    assert.strictEqual(table[1].ssn, '[REDACTED]');
  });

  it('regexRedact should redact matching patterns', () => {
    const table = [
      { text: 'Call me at 555-1234 or 555-5678' },
      { text: 'No numbers here' },
    ];
    regexRedact(table, 'text', /\d{3}-\d{4}/g, '***-****');
    assert.strictEqual(table[0].text, 'Call me at ***-**** or ***-****');
    assert.strictEqual(table[1].text, 'No numbers here');
  });

  it('regexRedact should accept string pattern', () => {
    const table = [{ val: 'abc123def456' }];
    regexRedact(table, 'val', '\\d+', 'NUM');
    assert.strictEqual(table[0].val, 'abcNUMdefNUM');
  });

  it('regexRedact should handle null values', () => {
    const table = [{ val: null }, { val: 'abc' }];
    regexRedact(table, 'val', /abc/, 'xyz');
    assert.strictEqual(table[0].val, null);
    assert.strictEqual(table[1].val, 'xyz');
  });

  it('hashColumn with fast method should use djb2', async () => {
    const table = [
      { name: 'Alice' },
      { name: 'Bob' },
    ];
    await hashColumn(table, 'name', 'fast');
    assert.strictEqual(table[0].name, djb2('Alice'));
    assert.strictEqual(table[1].name, djb2('Bob'));
  });

  it('djb2 should produce consistent hashes', () => {
    assert.strictEqual(djb2('hello'), djb2('hello'));
    assert.notStrictEqual(djb2('hello'), djb2('world'));
    assert.strictEqual(typeof djb2('test'), 'string');
  });

  it('hashColumn should skip null values', async () => {
    const table = [{ name: null }, { name: 'Bob' }];
    await hashColumn(table, 'name', 'fast');
    assert.strictEqual(table[0].name, null);
    assert.strictEqual(typeof table[1].name, 'string');
  });
});

// ---------------------------------------------------------------------------
// Type Detection
// ---------------------------------------------------------------------------
describe('detectColumnType', () => {
  it('should detect number columns', () => {
    assert.strictEqual(detectColumnType(['1', '2.5', '-3', '0']), 'number');
  });

  it('should detect date columns', () => {
    assert.strictEqual(detectColumnType(['2024-01-15', '2024-06-20']), 'date');
  });

  it('should detect boolean columns', () => {
    assert.strictEqual(detectColumnType(['true', 'false', 'yes', 'no']), 'boolean');
  });

  it('should detect string columns', () => {
    assert.strictEqual(detectColumnType(['hello', 'world']), 'string');
  });

  it('should detect mixed as string', () => {
    assert.strictEqual(detectColumnType(['1', 'hello', '2024-01-01']), 'string');
  });

  it('should return string for all-null values', () => {
    assert.strictEqual(detectColumnType([null, '', undefined]), 'string');
  });

  it('should ignore null values when detecting type', () => {
    assert.strictEqual(detectColumnType(['1', null, '3', '']), 'number');
  });

  it('should detect numbers with whitespace', () => {
    assert.strictEqual(detectColumnType([' 1 ', ' 2.5 ']), 'number');
  });

  it('should detect ISO datetime as date', () => {
    assert.strictEqual(detectColumnType(['2024-01-15T10:30:00']), 'date');
  });
});

describe('profileColumn', () => {
  it('should count nulls', () => {
    const profile = profileColumn(['a', null, '', 'b', 'null']);
    assert.strictEqual(profile.nullCount, 3);
  });

  it('should count unique values', () => {
    const profile = profileColumn(['a', 'b', 'a', 'c']);
    assert.strictEqual(profile.uniqueCount, 3);
  });

  it('should compute min/max for numbers', () => {
    const profile = profileColumn(['10', '2', '5']);
    assert.strictEqual(profile.type, 'number');
    assert.strictEqual(profile.min, 2);
    assert.strictEqual(profile.max, 10);
  });

  it('should compute min/max for strings', () => {
    const profile = profileColumn(['banana', 'apple', 'cherry']);
    assert.strictEqual(profile.type, 'string');
    assert.strictEqual(profile.min, 'apple');
    assert.strictEqual(profile.max, 'cherry');
  });

  it('should include samples', () => {
    const profile = profileColumn(['a', 'b', 'c', 'd', 'e', 'f']);
    assert.ok(Array.isArray(profile.samples));
    assert.ok(profile.samples.length <= 5);
  });

  it('should handle all-null input', () => {
    const profile = profileColumn([null, '', undefined]);
    assert.strictEqual(profile.type, 'string');
    assert.strictEqual(profile.nullCount, 3);
    assert.strictEqual(profile.uniqueCount, 0);
  });
});
