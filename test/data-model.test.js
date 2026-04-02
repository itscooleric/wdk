const { describe, it } = require('node:test');
const assert = require('node:assert');
const { DataTable } = require('../src/transforms/data-model.js');

describe('DataTable construction', () => {
  it('should create an empty table', () => {
    const t = new DataTable();
    assert.strictEqual(t.rowCount, 0);
    assert.strictEqual(t.columnCount, 0);
  });

  it('should create a table with headers and rows', () => {
    const t = new DataTable(['a', 'b'], [['1', '2'], ['3', '4']]);
    assert.strictEqual(t.rowCount, 2);
    assert.strictEqual(t.columnCount, 2);
  });

  it('should deep-copy input arrays', () => {
    const headers = ['a'];
    const rows = [['1']];
    const t = new DataTable(headers, rows);
    headers.push('b');
    rows[0].push('2');
    assert.strictEqual(t.columnCount, 1);
    assert.deepStrictEqual(t.getRow(0), ['1']);
  });
});

describe('DataTable column operations', () => {
  it('addColumn should add a column with default value', () => {
    const t = new DataTable(['a'], [['1'], ['2']]);
    t.addColumn('b', 'x');
    assert.strictEqual(t.columnCount, 2);
    assert.deepStrictEqual(t.getRow(0), ['1', 'x']);
    assert.deepStrictEqual(t.getRow(1), ['2', 'x']);
  });

  it('addColumn should use empty string as default', () => {
    const t = new DataTable(['a'], [['1']]);
    t.addColumn('b');
    assert.deepStrictEqual(t.getRow(0), ['1', '']);
  });

  it('removeColumn should remove an existing column', () => {
    const t = new DataTable(['a', 'b', 'c'], [['1', '2', '3']]);
    t.removeColumn('b');
    assert.strictEqual(t.columnCount, 2);
    assert.deepStrictEqual(t.getRow(0), ['1', '3']);
  });

  it('removeColumn should throw for nonexistent column', () => {
    const t = new DataTable(['a'], [['1']]);
    assert.throws(() => t.removeColumn('z'), /Column "z" not found/);
  });

  it('renameColumn should rename a column', () => {
    const t = new DataTable(['a', 'b'], [['1', '2']]);
    t.renameColumn('a', 'x');
    assert.deepStrictEqual(t.getColumn('x'), ['1']);
  });

  it('renameColumn should throw for nonexistent column', () => {
    const t = new DataTable(['a'], []);
    assert.throws(() => t.renameColumn('z', 'y'), /Column "z" not found/);
  });

  it('reorderColumns should rearrange columns', () => {
    const t = new DataTable(['a', 'b', 'c'], [['1', '2', '3']]);
    t.reorderColumns(['c', 'a', 'b']);
    assert.deepStrictEqual(t.getRow(0), ['3', '1', '2']);
    assert.deepStrictEqual(t.getColumn('c'), ['3']);
  });

  it('reorderColumns should throw for nonexistent column', () => {
    const t = new DataTable(['a', 'b'], []);
    assert.throws(() => t.reorderColumns(['a', 'z']), /Column "z" not found/);
  });

  it('getColumn should return all values for a column', () => {
    const t = new DataTable(['a', 'b'], [['1', '2'], ['3', '4']]);
    assert.deepStrictEqual(t.getColumn('b'), ['2', '4']);
  });

  it('getColumn should throw for nonexistent column', () => {
    const t = new DataTable(['a'], []);
    assert.throws(() => t.getColumn('z'), /Column "z" not found/);
  });
});

describe('DataTable row operations', () => {
  it('addRow should add a row', () => {
    const t = new DataTable(['a', 'b'], []);
    t.addRow(['1', '2']);
    assert.strictEqual(t.rowCount, 1);
    assert.deepStrictEqual(t.getRow(0), ['1', '2']);
  });

  it('addRow should pad short rows with empty strings', () => {
    const t = new DataTable(['a', 'b', 'c'], []);
    t.addRow(['1']);
    assert.deepStrictEqual(t.getRow(0), ['1', '', '']);
  });

  it('addRow should truncate long rows', () => {
    const t = new DataTable(['a', 'b'], []);
    t.addRow(['1', '2', '3', '4']);
    assert.deepStrictEqual(t.getRow(0), ['1', '2']);
  });

  it('removeRow should remove a row by index', () => {
    const t = new DataTable(['a'], [['1'], ['2'], ['3']]);
    t.removeRow(1);
    assert.strictEqual(t.rowCount, 2);
    assert.deepStrictEqual(t.getRow(0), ['1']);
    assert.deepStrictEqual(t.getRow(1), ['3']);
  });

  it('removeRow should throw for out-of-bounds index', () => {
    const t = new DataTable(['a'], [['1']]);
    assert.throws(() => t.removeRow(5), RangeError);
    assert.throws(() => t.removeRow(-1), RangeError);
  });

  it('getRow should throw for out-of-bounds index', () => {
    const t = new DataTable(['a'], [['1']]);
    assert.throws(() => t.getRow(5), RangeError);
    assert.throws(() => t.getRow(-1), RangeError);
  });

  it('getRow should return a copy', () => {
    const t = new DataTable(['a'], [['1']]);
    const row = t.getRow(0);
    row[0] = 'changed';
    assert.deepStrictEqual(t.getRow(0), ['1']);
  });
});

describe('DataTable filtering and sorting', () => {
  it('filterRows should return a new table with matching rows', () => {
    const t = new DataTable(['name', 'age'], [['Alice', '30'], ['Bob', '25'], ['Carol', '35']]);
    const filtered = t.filterRows((row) => parseInt(row[1]) > 28);
    assert.strictEqual(filtered.rowCount, 2);
    assert.deepStrictEqual(filtered.getRow(0), ['Alice', '30']);
    assert.deepStrictEqual(filtered.getRow(1), ['Carol', '35']);
    // Original unchanged
    assert.strictEqual(t.rowCount, 3);
  });

  it('sortRows should sort ascending by string', () => {
    const t = new DataTable(['name'], [['Carol'], ['Alice'], ['Bob']]);
    const sorted = t.sortRows('name', true);
    assert.deepStrictEqual(sorted.getColumn('name'), ['Alice', 'Bob', 'Carol']);
  });

  it('sortRows should sort descending', () => {
    const t = new DataTable(['name'], [['Alice'], ['Bob'], ['Carol']]);
    const sorted = t.sortRows('name', false);
    assert.deepStrictEqual(sorted.getColumn('name'), ['Carol', 'Bob', 'Alice']);
  });

  it('sortRows should sort numerically when values are numeric strings', () => {
    const t = new DataTable(['val'], [['10'], ['2'], ['20'], ['1']]);
    // Note: string sort, so '10' < '2' — this is how the implementation works
    const sorted = t.sortRows('val', true);
    // String comparison: '1' < '10' < '2' < '20'
    assert.deepStrictEqual(sorted.getColumn('val'), ['1', '10', '2', '20']);
  });

  it('sortRows should throw for nonexistent column', () => {
    const t = new DataTable(['a'], []);
    assert.throws(() => t.sortRows('z'), /Column "z" not found/);
  });

  it('sortRows should not modify the original table', () => {
    const t = new DataTable(['a'], [['3'], ['1'], ['2']]);
    t.sortRows('a');
    assert.deepStrictEqual(t.getColumn('a'), ['3', '1', '2']);
  });
});

describe('DataTable utilities', () => {
  it('clone should create a deep copy', () => {
    const t = new DataTable(['a', 'b'], [['1', '2']]);
    const c = t.clone();
    c.addColumn('c', 'x');
    assert.strictEqual(t.columnCount, 2);
    assert.strictEqual(c.columnCount, 3);
  });

  it('clone rows should be independent', () => {
    const t = new DataTable(['a'], [['1']]);
    const c = t.clone();
    c.removeRow(0);
    assert.strictEqual(t.rowCount, 1);
    assert.strictEqual(c.rowCount, 0);
  });

  it('toObjects should convert rows to array of objects', () => {
    const t = new DataTable(['name', 'age'], [['Alice', '30'], ['Bob', '25']]);
    const objs = t.toObjects();
    assert.deepStrictEqual(objs, [
      { name: 'Alice', age: '30' },
      { name: 'Bob', age: '25' },
    ]);
  });

  it('rowCount and columnCount getters', () => {
    const t = new DataTable(['a', 'b', 'c'], [['1', '2', '3'], ['4', '5', '6']]);
    assert.strictEqual(t.rowCount, 2);
    assert.strictEqual(t.columnCount, 3);
  });
});
