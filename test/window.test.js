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
  },
  scores: {
    _headers: ['player', 'game', 'score'],
    _rows: [
      ['Alice', 1, 50],
      ['Alice', 2, 70],
      ['Alice', 3, 60],
      ['Bob', 1, 80],
      ['Bob', 2, 40],
    ]
  }
};

describe('ROW_NUMBER', function () {
  it('should assign row numbers within partitions ordered by salary', function () {
    var r = execSQL(
      'SELECT name, dept, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary) AS rn FROM employees',
      tables
    );
    assert.deepStrictEqual(r.headers, ['name', 'dept', 'rn']);
    // Within eng: Bob=1(100), Alice=2(120), Eve=3(150)
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    assert.equal(byName['Bob'], 1);
    assert.equal(byName['Alice'], 2);
    assert.equal(byName['Eve'], 3);
    // Within sales: Dave=1(80), Carol=2(90)
    assert.equal(byName['Dave'], 1);
    assert.equal(byName['Carol'], 2);
  });

  it('should assign row numbers across entire result when no PARTITION BY', function () {
    var r = execSQL(
      'SELECT name, ROW_NUMBER() OVER (ORDER BY salary) AS rn FROM employees',
      tables
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[1]; });
    // Sorted by salary asc: Dave(80)=1, Carol(90)=2, Bob(100)=3, Alice(120)=4, Eve(150)=5
    assert.equal(byName['Dave'], 1);
    assert.equal(byName['Carol'], 2);
    assert.equal(byName['Bob'], 3);
    assert.equal(byName['Alice'], 4);
    assert.equal(byName['Eve'], 5);
  });

  it('should assign sequential numbers when no PARTITION BY and no ORDER BY', function () {
    var r = execSQL(
      'SELECT name, ROW_NUMBER() OVER () AS rn FROM employees',
      tables
    );
    var rnValues = r.rows.map(function (row) { return row[1]; }).sort(function (a, b) { return a - b; });
    assert.deepStrictEqual(rnValues, [1, 2, 3, 4, 5]);
  });
});

describe('RANK', function () {
  it('should assign rank with gaps for ties', function () {
    var tables2 = {
      t: {
        _headers: ['name', 'score'],
        _rows: [
          ['Alice', 100],
          ['Bob', 100],
          ['Carol', 90],
          ['Dave', 80],
        ]
      }
    };
    var r = execSQL(
      'SELECT name, score, RANK() OVER (ORDER BY score DESC) AS rnk FROM t',
      tables2
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    // Alice and Bob both rank 1, Carol ranks 3, Dave ranks 4
    assert.equal(byName['Alice'], 1);
    assert.equal(byName['Bob'], 1);
    assert.equal(byName['Carol'], 3);
    assert.equal(byName['Dave'], 4);
  });

  it('should rank without ties when all values differ', function () {
    var r = execSQL(
      'SELECT name, salary, RANK() OVER (ORDER BY salary DESC) AS rnk FROM employees',
      tables
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    assert.equal(byName['Eve'], 1);
    assert.equal(byName['Alice'], 2);
    assert.equal(byName['Bob'], 3);
    assert.equal(byName['Carol'], 4);
    assert.equal(byName['Dave'], 5);
  });
});

describe('LAG', function () {
  it('should return previous row value within partition', function () {
    var r = execSQL(
      'SELECT player, game, score, LAG(score, 1, 0) OVER (PARTITION BY player ORDER BY game) AS prev_score FROM scores',
      tables
    );
    assert.deepStrictEqual(r.headers, ['player', 'game', 'score', 'prev_score']);
    // Alice game=1 → prev=0 (default), game=2 → prev=50, game=3 → prev=70
    var aliceRows = r.rows.filter(function (row) { return row[0] === 'Alice'; });
    aliceRows.sort(function (a, b) { return a[1] - b[1]; });
    assert.equal(aliceRows[0][3], '0'); // game 1: no previous, use default '0' (string from tokenizer)
    assert.equal(aliceRows[1][3], 50);  // game 2: prev is game 1 score
    assert.equal(aliceRows[2][3], 70);  // game 3: prev is game 2 score
  });

  it('should default offset to 1', function () {
    var r = execSQL(
      'SELECT name, salary, LAG(salary) OVER (ORDER BY salary) AS prev FROM employees',
      tables
    );
    // Dave(80): no previous → null, Carol(90): prev=80, Bob(100): prev=90...
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    assert.equal(byName['Dave'], null);
    assert.equal(byName['Carol'], 80);
    assert.equal(byName['Bob'], 90);
  });
});

describe('LEAD', function () {
  it('should return next row value within partition', function () {
    var r = execSQL(
      'SELECT player, game, score, LEAD(score, 1, 0) OVER (PARTITION BY player ORDER BY game) AS next_score FROM scores',
      tables
    );
    // Alice game=1 → next=70, game=2 → next=60, game=3 → next=0 (default)
    var aliceRows = r.rows.filter(function (row) { return row[0] === 'Alice'; });
    aliceRows.sort(function (a, b) { return a[1] - b[1]; });
    assert.equal(aliceRows[0][3], 70);   // game 1: next is game 2
    assert.equal(aliceRows[1][3], 60);   // game 2: next is game 3
    assert.equal(aliceRows[2][3], '0');  // game 3: no next, use default
  });

  it('should default offset to 1', function () {
    var r = execSQL(
      'SELECT name, salary, LEAD(salary) OVER (ORDER BY salary) AS nxt FROM employees',
      tables
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    assert.equal(byName['Dave'], 90);    // next after 80 is 90
    assert.equal(byName['Carol'], 100);  // next after 90 is 100
    assert.equal(byName['Eve'], null);   // no next
  });
});

describe('SUM OVER (cumulative)', function () {
  it('should compute running sum within partition ordered by salary', function () {
    var r = execSQL(
      'SELECT name, dept, salary, SUM(salary) OVER (PARTITION BY dept ORDER BY salary) AS cum_sal FROM employees',
      tables
    );
    assert.deepStrictEqual(r.headers, ['name', 'dept', 'salary', 'cum_sal']);
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[3]; });
    // eng sorted by salary: Bob(100)→100, Alice(120)→220, Eve(150)→370
    assert.equal(byName['Bob'], 100);
    assert.equal(byName['Alice'], 220);
    assert.equal(byName['Eve'], 370);
    // sales sorted by salary: Dave(80)→80, Carol(90)→170
    assert.equal(byName['Dave'], 80);
    assert.equal(byName['Carol'], 170);
  });

  it('should compute total partition sum when no ORDER BY', function () {
    var r = execSQL(
      'SELECT name, dept, SUM(salary) OVER (PARTITION BY dept) AS dept_total FROM employees',
      tables
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    assert.equal(byName['Alice'], 370);
    assert.equal(byName['Bob'], 370);
    assert.equal(byName['Eve'], 370);
    assert.equal(byName['Carol'], 170);
    assert.equal(byName['Dave'], 170);
  });

  it('should compute grand total when no PARTITION BY and no ORDER BY', function () {
    var r = execSQL(
      'SELECT name, SUM(salary) OVER () AS grand_total FROM employees',
      tables
    );
    r.rows.forEach(function (row) {
      assert.equal(row[1], 540); // 120+100+90+80+150
    });
  });
});

describe('AVG OVER', function () {
  it('should compute partition average for each row', function () {
    var r = execSQL(
      'SELECT name, dept, AVG(salary) OVER (PARTITION BY dept) AS avg_sal FROM employees',
      tables
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    // eng avg: (120+100+150)/3 = 123.333...
    assert.ok(Math.abs(byName['Alice'] - 123.333) < 0.01);
    assert.ok(Math.abs(byName['Bob'] - 123.333) < 0.01);
    assert.ok(Math.abs(byName['Eve'] - 123.333) < 0.01);
    // sales avg: (90+80)/2 = 85
    assert.equal(byName['Carol'], 85);
    assert.equal(byName['Dave'], 85);
  });

  it('should compute grand average when no PARTITION BY', function () {
    var r = execSQL(
      'SELECT name, AVG(salary) OVER () AS grand_avg FROM employees',
      tables
    );
    r.rows.forEach(function (row) {
      assert.ok(Math.abs(row[1] - 108) < 0.001); // 540/5 = 108
    });
  });
});

describe('COUNT OVER', function () {
  it('should count rows in each partition', function () {
    var r = execSQL(
      'SELECT name, dept, COUNT(*) OVER (PARTITION BY dept) AS dept_cnt FROM employees',
      tables
    );
    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[2]; });
    assert.equal(byName['Alice'], 3);
    assert.equal(byName['Bob'], 3);
    assert.equal(byName['Eve'], 3);
    assert.equal(byName['Carol'], 2);
    assert.equal(byName['Dave'], 2);
  });

  it('should count all rows when no PARTITION BY', function () {
    var r = execSQL(
      'SELECT name, COUNT(*) OVER () AS total_cnt FROM employees',
      tables
    );
    r.rows.forEach(function (row) {
      assert.equal(row[1], 5);
    });
  });
});

describe('window function combined with WHERE', function () {
  it('should apply WHERE filter before window functions', function () {
    // Only eng employees; ROW_NUMBER should reflect the filtered set
    var r = execSQL(
      "SELECT name, ROW_NUMBER() OVER (ORDER BY salary) AS rn FROM employees WHERE dept = 'eng'",
      tables
    );
    assert.equal(r.rows.length, 3);
    // Row numbers should be 1,2,3 (not 1-5)
    var rnValues = r.rows.map(function (row) { return row[1]; }).sort(function (a, b) { return a - b; });
    assert.deepStrictEqual(rnValues, [1, 2, 3]);

    var byName = {};
    r.rows.forEach(function (row) { byName[row[0]] = row[1]; });
    assert.equal(byName['Bob'], 1);
    assert.equal(byName['Alice'], 2);
    assert.equal(byName['Eve'], 3);
  });

  it('should combine WHERE with COUNT OVER', function () {
    var r = execSQL(
      "SELECT name, COUNT(*) OVER () AS cnt FROM employees WHERE salary > 90",
      tables
    );
    // Alice(120), Bob(100), Eve(150) pass the filter
    assert.equal(r.rows.length, 3);
    r.rows.forEach(function (row) {
      assert.equal(row[1], 3);
    });
  });
});
