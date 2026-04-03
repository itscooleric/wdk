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

// ─── JOIN test data ───────────────────────────────────────────────────

var joinTables = {
  employees: {
    _headers: ['id', 'name', 'dept_id'],
    _rows: [
      [1, 'Alice', 10],
      [2, 'Bob', 10],
      [3, 'Carol', 20],
      [4, 'Dave', null],
    ]
  },
  departments: {
    _headers: ['id', 'dept_name'],
    _rows: [
      [10, 'Engineering'],
      [20, 'Sales'],
      [30, 'Marketing'],
    ]
  },
  salaries: {
    _headers: ['emp_id', 'amount'],
    _rows: [
      [1, 120],
      [2, 100],
      [3, 90],
    ]
  }
};

describe('JOIN', function () {
  it('INNER JOIN returns only matching rows', function () {
    var r = execSQL(
      'SELECT employees.name, departments.dept_name FROM employees JOIN departments ON employees.dept_id = departments.id',
      joinTables
    );
    assert.deepStrictEqual(r.headers, ['employees.name', 'departments.dept_name']);
    // Alice, Bob (dept 10), Carol (dept 20) all match; Dave (null) does not
    assert.equal(r.rows.length, 3);
    var names = r.rows.map(function (row) { return row[0]; }).sort();
    assert.deepStrictEqual(names, ['Alice', 'Bob', 'Carol']);
  });

  it('INNER JOIN (explicit INNER keyword) returns same as JOIN', function () {
    var r = execSQL(
      'SELECT employees.name FROM employees INNER JOIN departments ON employees.dept_id = departments.id',
      joinTables
    );
    assert.equal(r.rows.length, 3);
  });

  it('LEFT JOIN includes unmatched left rows with nulls on right', function () {
    var r = execSQL(
      'SELECT employees.name, departments.dept_name FROM employees LEFT JOIN departments ON employees.dept_id = departments.id',
      joinTables
    );
    // All 4 employees; Dave has no match so dept_name should be null
    assert.equal(r.rows.length, 4);
    var dave = r.rows.find(function (row) { return row[0] === 'Dave'; });
    assert.ok(dave, 'Dave should be present');
    assert.equal(dave[1], null);
  });

  it('RIGHT JOIN includes unmatched right rows with nulls on left', function () {
    var r = execSQL(
      'SELECT employees.name, departments.dept_name FROM employees RIGHT JOIN departments ON employees.dept_id = departments.id',
      joinTables
    );
    // Marketing (id=30) has no employees, so name should be null
    assert.equal(r.rows.length, 4); // Alice, Bob, Carol + Marketing null row
    var marketing = r.rows.find(function (row) { return row[1] === 'Marketing'; });
    assert.ok(marketing, 'Marketing row should be present');
    assert.equal(marketing[0], null);
  });

  it('CROSS JOIN returns cartesian product', function () {
    var small = {
      a: { _headers: ['x'], _rows: [[1], [2]] },
      b: { _headers: ['y'], _rows: [['p'], ['q'], ['r']] }
    };
    var r = execSQL('SELECT a.x, b.y FROM a CROSS JOIN b', small);
    assert.equal(r.rows.length, 6); // 2 * 3
  });

  it('JOIN with table aliases', function () {
    var r = execSQL(
      'SELECT e.name, d.dept_name FROM employees AS e JOIN departments AS d ON e.dept_id = d.id',
      joinTables
    );
    assert.equal(r.rows.length, 3);
    var names = r.rows.map(function (row) { return row[0]; }).sort();
    assert.deepStrictEqual(names, ['Alice', 'Bob', 'Carol']);
  });

  it('JOIN with implicit aliases (no AS keyword)', function () {
    var r = execSQL(
      'SELECT e.name, d.dept_name FROM employees e JOIN departments d ON e.dept_id = d.id',
      joinTables
    );
    assert.equal(r.rows.length, 3);
  });

  it('JOIN with WHERE clause filters after join', function () {
    var r = execSQL(
      "SELECT e.name, d.dept_name FROM employees e JOIN departments d ON e.dept_id = d.id WHERE d.dept_name = 'Engineering'",
      joinTables
    );
    assert.equal(r.rows.length, 2); // Alice and Bob
    var names = r.rows.map(function (row) { return row[0]; }).sort();
    assert.deepStrictEqual(names, ['Alice', 'Bob']);
  });

  it('JOIN with multi-column ON condition (AND)', function () {
    var multiTables = {
      orders: {
        _headers: ['cust_id', 'prod_id', 'qty'],
        _rows: [
          [1, 'A', 5],
          [1, 'B', 3],
          [2, 'A', 1],
        ]
      },
      prices: {
        _headers: ['cust_id', 'prod_id', 'price'],
        _rows: [
          [1, 'A', 10],
          [1, 'B', 20],
          [2, 'A', 15],
          [2, 'B', 25],
        ]
      }
    };
    var r = execSQL(
      'SELECT orders.qty, prices.price FROM orders JOIN prices ON orders.cust_id = prices.cust_id AND orders.prod_id = prices.prod_id',
      multiTables
    );
    // Each order has exactly one matching price row (same cust+prod)
    assert.equal(r.rows.length, 3);
    // cust=1,prod=A: qty=5,price=10; cust=1,prod=B: qty=3,price=20; cust=2,prod=A: qty=1,price=15
    var sorted = r.rows.slice().sort(function (a, b) { return a[0] - b[0]; });
    assert.equal(sorted[0][1], 15); // qty=1, price=15
    assert.equal(sorted[1][1], 20); // qty=3, price=20
    assert.equal(sorted[2][1], 10); // qty=5, price=10
  });

  it('SELECT * from JOIN expands all qualified columns', function () {
    var r = execSQL(
      'SELECT * FROM employees AS e JOIN departments AS d ON e.dept_id = d.id',
      joinTables
    );
    // Headers should be all qualified columns from both tables
    assert.deepStrictEqual(r.headers, ['e.id', 'e.name', 'e.dept_id', 'd.id', 'd.dept_name']);
    assert.equal(r.rows.length, 3);
  });
});
