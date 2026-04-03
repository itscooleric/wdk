var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var { execSQL } = require('../src/transforms/sql.js');

var tables = {
  employees: {
    _headers: ['name', 'dept', 'salary', 'age'],
    _rows: [
      ['Alice', 'eng', 120, 30],
      ['Bob', 'eng', 100, 25],
      ['Carol', 'sales', 90, 35],
      ['Dave', 'sales', 80, 28],
      ['Eve', 'eng', 150, 40],
    ]
  }
};

describe('SELECT basic', function () {
  it('should select all columns with *', function () {
    var r = execSQL('SELECT * FROM employees', tables);
    assert.deepStrictEqual(r.headers, ['name', 'dept', 'salary', 'age']);
    assert.equal(r.rows.length, 5);
  });

  it('should select specific columns', function () {
    var r = execSQL('SELECT name, salary FROM employees', tables);
    assert.deepStrictEqual(r.headers, ['name', 'salary']);
    assert.equal(r.rows[0][0], 'Alice');
    assert.equal(r.rows[0][1], 120);
  });

  it('should support column aliases', function () {
    var r = execSQL('SELECT name AS employee, salary AS pay FROM employees', tables);
    assert.deepStrictEqual(r.headers, ['employee', 'pay']);
  });

  it('should support LIMIT', function () {
    var r = execSQL('SELECT * FROM employees LIMIT 2', tables);
    assert.equal(r.rows.length, 2);
  });
});

describe('WHERE', function () {
  it('should filter with =', function () {
    var r = execSQL("SELECT name FROM employees WHERE dept = 'eng'", tables);
    assert.equal(r.rows.length, 3);
  });

  it('should filter with >', function () {
    var r = execSQL('SELECT name FROM employees WHERE salary > 100', tables);
    assert.equal(r.rows.length, 2); // Alice(120), Eve(150)
  });

  it('should filter with AND', function () {
    var r = execSQL("SELECT name FROM employees WHERE dept = 'eng' AND salary > 110", tables);
    assert.equal(r.rows.length, 2); // Alice, Eve
  });

  it('should filter with OR', function () {
    var r = execSQL("SELECT name FROM employees WHERE dept = 'sales' OR salary > 140", tables);
    assert.equal(r.rows.length, 3); // Carol, Dave, Eve
  });

  it('should support != operator', function () {
    var r = execSQL("SELECT name FROM employees WHERE dept != 'eng'", tables);
    assert.equal(r.rows.length, 2);
  });

  it('should support LIKE', function () {
    var r = execSQL("SELECT name FROM employees WHERE name LIKE 'A%'", tables);
    assert.equal(r.rows.length, 1);
    assert.equal(r.rows[0][0], 'Alice');
  });
});

describe('ORDER BY', function () {
  it('should sort ascending', function () {
    var r = execSQL('SELECT name, salary FROM employees ORDER BY salary', tables);
    assert.equal(r.rows[0][1], 80);
    assert.equal(r.rows[4][1], 150);
  });

  it('should sort descending', function () {
    var r = execSQL('SELECT name, salary FROM employees ORDER BY salary DESC', tables);
    assert.equal(r.rows[0][1], 150);
    assert.equal(r.rows[4][1], 80);
  });

  it('should combine ORDER BY with LIMIT', function () {
    var r = execSQL('SELECT name FROM employees ORDER BY salary DESC LIMIT 3', tables);
    assert.equal(r.rows.length, 3);
    assert.equal(r.rows[0][0], 'Eve');
  });
});

describe('GROUP BY with aggregates', function () {
  it('should count by group', function () {
    var r = execSQL('SELECT dept, COUNT(*) AS cnt FROM employees GROUP BY dept', tables);
    assert.deepStrictEqual(r.headers, ['dept', 'cnt']);
    var eng = r.rows.find(function (row) { return row[0] === 'eng'; });
    assert.equal(eng[1], 3);
  });

  it('should sum by group', function () {
    var r = execSQL('SELECT dept, SUM(salary) AS total FROM employees GROUP BY dept', tables);
    var eng = r.rows.find(function (row) { return row[0] === 'eng'; });
    assert.equal(eng[1], 370);
  });

  it('should avg by group', function () {
    var r = execSQL('SELECT dept, AVG(salary) AS avg_sal FROM employees GROUP BY dept', tables);
    var sales = r.rows.find(function (row) { return row[0] === 'sales'; });
    assert.equal(sales[1], 85);
  });

  it('should min/max by group', function () {
    var r = execSQL('SELECT dept, MIN(salary) AS lo, MAX(salary) AS hi FROM employees GROUP BY dept', tables);
    var eng = r.rows.find(function (row) { return row[0] === 'eng'; });
    assert.equal(eng[1], 100);
    assert.equal(eng[2], 150);
  });
});

describe('edge cases', function () {
  it('should throw on unknown table', function () {
    assert.throws(function () { execSQL('SELECT * FROM nonexistent', tables); }, /not found/);
  });

  it('should throw on unknown column in WHERE', function () {
    assert.throws(function () { execSQL("SELECT * FROM employees WHERE foo = 'bar'", tables); }, /not found/);
  });

  it('should handle semicolon at end', function () {
    var r = execSQL('SELECT name FROM employees LIMIT 1;', tables);
    assert.equal(r.rows.length, 1);
  });

  it('should be case-insensitive for keywords', function () {
    var r = execSQL('select name from employees limit 1', tables);
    assert.equal(r.rows.length, 1);
  });
});
