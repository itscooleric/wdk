var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var { aggregate, pivot, AGG_FUNCS } = require('../src/transforms/pivot.js');

describe('aggregate', function () {
  var df = {
    _headers: ['dept', 'name', 'salary'],
    _rows: [
      ['eng', 'Alice', 100],
      ['eng', 'Bob', 150],
      ['sales', 'Carol', 120],
      ['sales', 'Dave', 80],
      ['sales', 'Eve', 90],
    ]
  };

  it('should group and sum', function () {
    var result = aggregate(df, ['dept'], [{ column: 'salary', func: 'sum' }]);
    assert.deepStrictEqual(result.headers, ['dept', 'salary_sum']);
    assert.equal(result.rows.length, 2);
    var eng = result.rows.find(function (r) { return r[0] === 'eng'; });
    var sales = result.rows.find(function (r) { return r[0] === 'sales'; });
    assert.equal(eng[1], 250);
    assert.equal(sales[1], 290);
  });

  it('should group and count', function () {
    var result = aggregate(df, ['dept'], [{ column: 'name', func: 'count' }]);
    var eng = result.rows.find(function (r) { return r[0] === 'eng'; });
    var sales = result.rows.find(function (r) { return r[0] === 'sales'; });
    assert.equal(eng[1], 2);
    assert.equal(sales[1], 3);
  });

  it('should group and avg', function () {
    var result = aggregate(df, ['dept'], [{ column: 'salary', func: 'avg' }]);
    var eng = result.rows.find(function (r) { return r[0] === 'eng'; });
    assert.equal(eng[1], 125);
  });

  it('should group and compute min/max', function () {
    var result = aggregate(df, ['dept'], [
      { column: 'salary', func: 'min' },
      { column: 'salary', func: 'max' }
    ]);
    var sales = result.rows.find(function (r) { return r[0] === 'sales'; });
    assert.equal(sales[1], 80);
    assert.equal(sales[2], 120);
  });

  it('should support distinct count', function () {
    var df2 = {
      _headers: ['color', 'size'],
      _rows: [['red', 'S'], ['red', 'M'], ['red', 'S'], ['blue', 'L']]
    };
    var result = aggregate(df2, ['color'], [{ column: 'size', func: 'distinct' }]);
    var red = result.rows.find(function (r) { return r[0] === 'red'; });
    assert.equal(red[1], 2);
  });

  it('should support multiple group columns', function () {
    var df2 = {
      _headers: ['dept', 'level', 'salary'],
      _rows: [
        ['eng', 'senior', 200],
        ['eng', 'junior', 100],
        ['eng', 'senior', 180],
        ['sales', 'junior', 90],
      ]
    };
    var result = aggregate(df2, ['dept', 'level'], [{ column: 'salary', func: 'avg' }]);
    assert.equal(result.rows.length, 3);
    var engSenior = result.rows.find(function (r) { return r[0] === 'eng' && r[1] === 'senior'; });
    assert.equal(engSenior[2], 190);
  });

  it('should support custom alias', function () {
    var result = aggregate(df, ['dept'], [{ column: 'salary', func: 'sum', alias: 'total_pay' }]);
    assert.equal(result.headers[1], 'total_pay');
  });
});

describe('pivot', function () {
  var df = {
    _headers: ['quarter', 'product', 'revenue'],
    _rows: [
      ['Q1', 'Widget', 100],
      ['Q1', 'Gadget', 200],
      ['Q2', 'Widget', 150],
      ['Q2', 'Gadget', 250],
      ['Q1', 'Widget', 50],
    ]
  };

  it('should pivot with sum', function () {
    var result = pivot(df, ['quarter'], 'product', 'revenue', 'sum');
    assert.deepStrictEqual(result.headers, ['quarter', 'Widget', 'Gadget']);
    assert.equal(result.rows.length, 2);
    var q1 = result.rows.find(function (r) { return r[0] === 'Q1'; });
    var q2 = result.rows.find(function (r) { return r[0] === 'Q2'; });
    assert.equal(q1[1], 150); // Widget Q1: 100+50
    assert.equal(q1[2], 200); // Gadget Q1
    assert.equal(q2[1], 150); // Widget Q2
    assert.equal(q2[2], 250); // Gadget Q2
  });

  it('should pivot with count', function () {
    var result = pivot(df, ['quarter'], 'product', 'revenue', 'count');
    var q1 = result.rows.find(function (r) { return r[0] === 'Q1'; });
    assert.equal(q1[1], 2); // Widget Q1: 2 rows
    assert.equal(q1[2], 1); // Gadget Q1: 1 row
  });

  it('should pivot with avg', function () {
    var result = pivot(df, ['quarter'], 'product', 'revenue', 'avg');
    var q1 = result.rows.find(function (r) { return r[0] === 'Q1'; });
    assert.equal(q1[1], 75); // Widget Q1: (100+50)/2
  });

  it('should handle missing combinations with empty string', function () {
    var df2 = {
      _headers: ['region', 'product', 'sales'],
      _rows: [
        ['East', 'A', 10],
        ['West', 'B', 20],
      ]
    };
    var result = pivot(df2, ['region'], 'product', 'sales', 'sum');
    assert.deepStrictEqual(result.headers, ['region', 'A', 'B']);
    var east = result.rows.find(function (r) { return r[0] === 'East'; });
    assert.equal(east[1], 10);
    assert.equal(east[2], ''); // no B in East
  });

  it('should throw on missing pivot column', function () {
    assert.throws(function () {
      pivot(df, ['quarter'], 'nonexistent', 'revenue', 'sum');
    }, /not found/);
  });
});

describe('AGG_FUNCS', function () {
  it('concat should deduplicate', function () {
    assert.equal(AGG_FUNCS.concat(['a', 'b', 'a', 'c']), 'a, b, c');
  });

  it('first and last', function () {
    assert.equal(AGG_FUNCS.first([10, 20, 30]), 10);
    assert.equal(AGG_FUNCS.last([10, 20, 30]), 30);
  });

  it('sum should handle string numbers', function () {
    assert.equal(AGG_FUNCS.sum(['10', '20', '30']), 60);
  });

  it('min/max should return empty for no numeric values', function () {
    assert.equal(AGG_FUNCS.min(['a', 'b']), '');
    assert.equal(AGG_FUNCS.max(['a', 'b']), '');
  });
});
