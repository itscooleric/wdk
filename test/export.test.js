const { describe, it, before } = require('node:test');
const assert = require('node:assert');

// Export module uses ESM exports — load via dynamic import
let toCSV, toJSON;
before(async () => {
  const mod = await import('../src/export/export.js');
  toCSV = mod.toCSV;
  toJSON = mod.toJSON;
});

// ---------------------------------------------------------------------------
// toCSV
// ---------------------------------------------------------------------------
describe('toCSV', () => {
  it('should export basic CSV', () => {
    const table = { headers: ['name', 'age'], rows: [['Alice', '30'], ['Bob', '25']] };
    const csv = toCSV(table);
    assert.strictEqual(csv, 'name,age\nAlice,30\nBob,25');
  });

  it('should support custom delimiter', () => {
    const table = { headers: ['a', 'b'], rows: [['1', '2']] };
    const csv = toCSV(table, { delimiter: '\t' });
    assert.strictEqual(csv, 'a\tb\n1\t2');
  });

  it('should support pipe delimiter', () => {
    const table = { headers: ['a', 'b'], rows: [['1', '2']] };
    const csv = toCSV(table, { delimiter: '|' });
    assert.strictEqual(csv, 'a|b\n1|2');
  });

  it('should export without headers when includeHeaders is false', () => {
    const table = { headers: ['a', 'b'], rows: [['1', '2'], ['3', '4']] };
    const csv = toCSV(table, { includeHeaders: false });
    assert.strictEqual(csv, '1,2\n3,4');
  });

  it('should escape fields containing quotes', () => {
    const table = { headers: ['val'], rows: [['say "hello"']] };
    const csv = toCSV(table);
    assert.strictEqual(csv, 'val\n"say ""hello"""');
  });

  it('should escape fields containing commas', () => {
    const table = { headers: ['val'], rows: [['a,b']] };
    const csv = toCSV(table);
    assert.strictEqual(csv, 'val\n"a,b"');
  });

  it('should escape fields containing newlines', () => {
    const table = { headers: ['val'], rows: [['line1\nline2']] };
    const csv = toCSV(table);
    assert.strictEqual(csv, 'val\n"line1\nline2"');
  });

  it('should handle null and undefined values', () => {
    const table = { headers: ['a', 'b'], rows: [[null, undefined]] };
    const csv = toCSV(table);
    assert.strictEqual(csv, 'a,b\n,');
  });

  it('should handle empty table', () => {
    const table = { headers: ['a', 'b'], rows: [] };
    const csv = toCSV(table);
    assert.strictEqual(csv, 'a,b');
  });
});

// ---------------------------------------------------------------------------
// toJSON
// ---------------------------------------------------------------------------
describe('toJSON', () => {
  it('should export as array of objects when asArray is true', () => {
    const table = { headers: ['name', 'age'], rows: [['Alice', 30], ['Bob', 25]] };
    const json = toJSON(table, { asArray: true });
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, [
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
  });

  it('should export as headers+rows by default', () => {
    const table = { headers: ['a', 'b'], rows: [['1', '2']] };
    const json = toJSON(table);
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, { headers: ['a', 'b'], rows: [['1', '2']] });
  });

  it('should pretty-print with indent when pretty is true', () => {
    const table = { headers: ['a'], rows: [['1']] };
    const json = toJSON(table, { pretty: true });
    assert.ok(json.includes('\n'));
    assert.ok(json.includes('  ')); // 2-space indent
    const parsed = JSON.parse(json);
    assert.deepStrictEqual(parsed, { headers: ['a'], rows: [['1']] });
  });

  it('should produce compact JSON by default', () => {
    const table = { headers: ['a'], rows: [['1']] };
    const json = toJSON(table);
    assert.ok(!json.includes('\n'));
  });

  it('should handle missing values with null in asArray mode', () => {
    const table = { headers: ['a', 'b', 'c'], rows: [['1']] };
    const json = toJSON(table, { asArray: true });
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed[0].b, null);
    assert.strictEqual(parsed[0].c, null);
  });

  it('should handle empty table', () => {
    const table = { headers: ['a'], rows: [] };
    const json = toJSON(table, { asArray: true });
    assert.strictEqual(json, '[]');
  });

  it('pretty print with asArray', () => {
    const table = { headers: ['x'], rows: [['1'], ['2']] };
    const json = toJSON(table, { asArray: true, pretty: true });
    assert.ok(json.includes('\n'));
    const parsed = JSON.parse(json);
    assert.strictEqual(parsed.length, 2);
  });
});
