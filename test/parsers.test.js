const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { parseCSV } = require('../src/parsers/csv.js');

// JSON parser uses ESM exports — load via dynamic import
let parseJSON;
before(async () => {
  const mod = await import('../src/parsers/json.js');
  parseJSON = mod.parseJSON;
});

// ---------------------------------------------------------------------------
// CSV Parser
// ---------------------------------------------------------------------------
describe('parseCSV', () => {
  it('should parse basic CSV with header', () => {
    const result = parseCSV('name,age\nAlice,30\nBob,25');
    assert.deepStrictEqual(result.headers, ['name', 'age']);
    assert.deepStrictEqual(result.rows, [['Alice', '30'], ['Bob', '25']]);
  });

  it('should handle quoted fields', () => {
    const result = parseCSV('name,bio\nAlice,"likes ""cats"""\nBob,"hello, world"');
    assert.deepStrictEqual(result.headers, ['name', 'bio']);
    assert.deepStrictEqual(result.rows[0], ['Alice', 'likes "cats"']);
    assert.deepStrictEqual(result.rows[1], ['Bob', 'hello, world']);
  });

  it('should handle newlines inside quoted fields', () => {
    const result = parseCSV('name,address\nAlice,"123 Main St\nApt 4"\nBob,nowhere');
    assert.deepStrictEqual(result.rows[0], ['Alice', '123 Main St\nApt 4']);
    assert.deepStrictEqual(result.rows[1], ['Bob', 'nowhere']);
  });

  it('should parse tab-delimited data', () => {
    const result = parseCSV('name\tage\nAlice\t30', { delimiter: '\t' });
    assert.deepStrictEqual(result.headers, ['name', 'age']);
    assert.deepStrictEqual(result.rows, [['Alice', '30']]);
  });

  it('should parse pipe-delimited data', () => {
    const result = parseCSV('name|age\nAlice|30', { delimiter: '|' });
    assert.deepStrictEqual(result.headers, ['name', 'age']);
    assert.deepStrictEqual(result.rows, [['Alice', '30']]);
  });

  it('should handle empty fields', () => {
    const result = parseCSV('a,b,c\n1,,3\n,,');
    assert.deepStrictEqual(result.rows[0], ['1', '', '3']);
    assert.deepStrictEqual(result.rows[1], ['', '', '']);
  });

  it('should strip UTF-8 BOM', () => {
    const bom = '\uFEFF';
    const result = parseCSV(bom + 'name,age\nAlice,30');
    assert.deepStrictEqual(result.headers, ['name', 'age']);
    assert.deepStrictEqual(result.rows, [['Alice', '30']]);
  });

  it('should handle CRLF line endings', () => {
    const result = parseCSV('name,age\r\nAlice,30\r\nBob,25');
    assert.deepStrictEqual(result.headers, ['name', 'age']);
    assert.deepStrictEqual(result.rows, [['Alice', '30'], ['Bob', '25']]);
  });

  it('should support no-header mode', () => {
    const result = parseCSV('Alice,30\nBob,25', { hasHeader: false });
    assert.deepStrictEqual(result.headers, []);
    assert.deepStrictEqual(result.rows, [['Alice', '30'], ['Bob', '25']]);
  });

  it('should handle single-column CSV', () => {
    const result = parseCSV('name\nAlice\nBob');
    assert.deepStrictEqual(result.headers, ['name']);
    assert.deepStrictEqual(result.rows, [['Alice'], ['Bob']]);
  });

  it('should handle large rows', () => {
    const cols = Array.from({ length: 100 }, (_, i) => `col${i}`);
    const vals = Array.from({ length: 100 }, (_, i) => `val${i}`);
    const csv = cols.join(',') + '\n' + vals.join(',');
    const result = parseCSV(csv);
    assert.strictEqual(result.headers.length, 100);
    assert.strictEqual(result.rows[0].length, 100);
    assert.strictEqual(result.rows[0][99], 'val99');
  });

  it('should handle trailing newlines', () => {
    const result = parseCSV('a,b\n1,2\n');
    assert.deepStrictEqual(result.rows, [['1', '2']]);
  });
});

// ---------------------------------------------------------------------------
// TSV via CSV parser
// ---------------------------------------------------------------------------
describe('TSV via parseCSV', () => {
  it('should parse tab-separated values using delimiter option', () => {
    const tsv = 'id\tname\tvalue\n1\tAlice\t100\n2\tBob\t200';
    const result = parseCSV(tsv, { delimiter: '\t' });
    assert.deepStrictEqual(result.headers, ['id', 'name', 'value']);
    assert.deepStrictEqual(result.rows[0], ['1', 'Alice', '100']);
    assert.deepStrictEqual(result.rows[1], ['2', 'Bob', '200']);
  });
});

// ---------------------------------------------------------------------------
// JSON Parser
// ---------------------------------------------------------------------------
describe('parseJSON', () => {
  it('should parse valid JSON object', () => {
    const result = parseJSON('{"name": "Alice", "age": 30}');
    assert.deepStrictEqual(result.data, { name: 'Alice', age: 30 });
    assert.strictEqual(result.tabular, null);
  });

  it('should convert array of objects to tabular form', () => {
    const input = JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', age: 25 },
    ]);
    const result = parseJSON(input);
    assert.deepStrictEqual(result.tabular.headers, ['name', 'age']);
    assert.deepStrictEqual(result.tabular.rows, [['Alice', 30], ['Bob', 25]]);
  });

  it('should handle nested objects without tabular extraction', () => {
    const input = JSON.stringify({ config: { debug: true, items: [1, 2] } });
    const result = parseJSON(input);
    assert.deepStrictEqual(result.data.config.debug, true);
    assert.strictEqual(result.tabular, null);
  });

  it('should recover from trailing commas', () => {
    const input = '{"a": 1, "b": 2, }';
    const result = parseJSON(input);
    assert.deepStrictEqual(result.data, { a: 1, b: 2 });
  });

  it('should recover from single quotes', () => {
    const input = "{'name': 'Alice', 'age': 30}";
    const result = parseJSON(input);
    assert.deepStrictEqual(result.data, { name: 'Alice', age: 30 });
  });

  it('should throw descriptive error for malformed input', () => {
    assert.throws(
      () => parseJSON('{not valid json at all!!!}'),
      (err) => {
        assert.ok(err.message.includes('JSON parse error'));
        return true;
      }
    );
  });

  it('should throw for empty string input', () => {
    assert.throws(
      () => parseJSON(''),
      (err) => {
        assert.ok(err instanceof Error);
        return true;
      }
    );
  });

  it('should throw for non-string input', () => {
    assert.throws(
      () => parseJSON(123),
      (err) => {
        assert.ok(err.message.includes('expects a string'));
        return true;
      }
    );
  });

  it('should handle array of objects with varying keys', () => {
    const input = JSON.stringify([
      { name: 'Alice', age: 30 },
      { name: 'Bob', city: 'NYC' },
    ]);
    const result = parseJSON(input);
    assert.ok(result.tabular);
    assert.ok(result.tabular.headers.includes('name'));
    assert.ok(result.tabular.headers.includes('age'));
    assert.ok(result.tabular.headers.includes('city'));
    // Missing values should be null
    const ageIdx = result.tabular.headers.indexOf('age');
    const cityIdx = result.tabular.headers.indexOf('city');
    assert.strictEqual(result.tabular.rows[1][ageIdx], null);
    assert.strictEqual(result.tabular.rows[0][cityIdx], null);
  });

  it('should parse valid JSON array of primitives', () => {
    const result = parseJSON('[1, 2, 3]');
    assert.deepStrictEqual(result.data, [1, 2, 3]);
    assert.strictEqual(result.tabular, null);
  });
});
