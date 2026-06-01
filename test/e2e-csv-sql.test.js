/**
 * E2E Test: CSV Import -> SQL Queries -> Export round-trip
 * Ticket #36
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var { parseCSV } = require('../src/parsers/csv.js');
var { execSQL } = require('../src/transforms/sql.js');

// Dynamic import for ESM export module
var toCSV;
before(async function () {
  var mod = await import('../src/export/export.js');
  toCSV = mod.toCSV;
});

// --- Test data generation ---

var DEPARTMENTS = ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR'];

var employeeRows = [
  ['Alice Johnson',   'Engineering', '120000', '2020-03-15', 'true'],
  ['Bob Smith',       'Engineering', '95000',  '2019-07-01', 'true'],
  ['Carol White',     'Sales',       '88000',  '2021-01-10', 'true'],
  ['Dave Brown',      'Sales',       '92000',  '2018-11-20', 'false'],
  ['Eve Davis',       'Marketing',   '78000',  '2022-06-01', 'true'],
  ['Frank Miller',    'Marketing',   '82000',  '2020-09-15', 'true'],
  ['Grace Lee',       'Finance',     '105000', '2017-04-01', 'true'],
  ['Hank Wilson',     'Finance',     '98000',  '2019-02-14', 'true'],
  ['Ivy Chen',        'HR',          '72000',  '2023-01-05', 'true'],
  ['Jack Taylor',     'HR',          '68000',  '2021-08-20', 'false'],
  ['Karen Moore',     'Engineering', '130000', '2016-05-10', 'true'],
  ['Leo Garcia',      'Sales',       '85000',  '2022-03-25', 'true'],
  ['Mia Robinson',    'Marketing',   '91000',  '2020-12-01', 'true'],
  ['Nick Clark',      'Finance',     '110000', '2018-06-15', 'true'],
  ['Olivia Lewis',    'Engineering', '140000', '2015-09-01', 'true'],
  ['Paul Hall',       'Sales',       '79000',  '2023-02-10', 'true'],
  ['Quinn Adams',     'HR',          '75000',  '2019-10-30', 'true'],
  ['Rita King',       'Finance',     '102000', '2021-07-14', 'false'],
  ['Sam Wright',      'Marketing',   '87000',  '2020-04-22', 'true'],
  ['Tina Scott',      'Engineering', '115000', '2017-11-08', 'true'],
];

var employeeCSV = 'name,department,salary,hire_date,active\n' +
  employeeRows.map(function (r) { return r.join(','); }).join('\n');

var deptRows = [
  ['Engineering', 'Engineering', '500000'],
  ['Sales',       'Sales',       '300000'],
  ['Marketing',   'Marketing',   '250000'],
  ['Finance',     'Finance',     '400000'],
  ['HR',          'HR',          '200000'],
];

var deptCSV = 'id,name,budget\n' +
  deptRows.map(function (r) { return r.join(','); }).join('\n');

// --- Tests ---

describe('E2E: CSV Import -> SQL -> Verify', function () {

  it('1. Parse employees CSV - verify row count and headers', function () {
    var result = parseCSV(employeeCSV);
    assert.deepStrictEqual(result.headers, ['name', 'department', 'salary', 'hire_date', 'active']);
    assert.equal(result.rows.length, 20);
  });

  it('2. SELECT WHERE salary > 80000 - verify filtered count', function () {
    var parsed = parseCSV(employeeCSV);
    var tables = { df: { _headers: parsed.headers, _rows: parsed.rows } };
    var r = execSQL('SELECT * FROM df WHERE salary > 80000', tables);
    // Count employees with salary > 80000
    var expected = employeeRows.filter(function (row) { return Number(row[2]) > 80000; }).length;
    assert.equal(r.rows.length, expected);
    assert.ok(r.rows.length > 0, 'Should have some results');
    // Every row should have salary > 80000
    var salIdx = r.headers.indexOf('salary');
    r.rows.forEach(function (row) {
      assert.ok(Number(row[salIdx]) > 80000, 'Salary should be > 80000 but got ' + row[salIdx]);
    });
  });

  it('3. GROUP BY department with COUNT and AVG', function () {
    var parsed = parseCSV(employeeCSV);
    var tables = { df: { _headers: parsed.headers, _rows: parsed.rows } };
    var r = execSQL(
      'SELECT department, COUNT(*) AS cnt, AVG(salary) AS avg_sal FROM df GROUP BY department',
      tables
    );
    assert.equal(r.headers.length, 3);
    assert.deepStrictEqual(r.headers, ['department', 'cnt', 'avg_sal']);
    // Should have 5 departments
    assert.equal(r.rows.length, 5);
    // Verify Engineering group
    var engRow = r.rows.find(function (row) { return row[0] === 'Engineering'; });
    assert.ok(engRow, 'Engineering group should exist');
    assert.equal(engRow[1], 5); // 5 engineering employees
    // AVG of 120000, 95000, 130000, 140000, 115000 = 600000/5 = 120000
    assert.equal(engRow[2], 120000);
  });

  it('4. RANK() OVER (ORDER BY salary DESC) - verify ranking', function () {
    var parsed = parseCSV(employeeCSV);
    var tables = { df: { _headers: parsed.headers, _rows: parsed.rows } };
    var r = execSQL(
      'SELECT name, salary, RANK() OVER (ORDER BY salary DESC) AS rnk FROM df',
      tables
    );
    assert.ok(r.headers.indexOf('rnk') >= 0, 'Should have rnk column');
    // Find the rank column index
    var rnkIdx = r.headers.indexOf('rnk');
    // Rank 1 should be the highest salary (140000 - Olivia Lewis)
    var rank1Rows = r.rows.filter(function (row) { return row[rnkIdx] === 1; });
    assert.equal(rank1Rows.length, 1);
    var nameIdx = r.headers.indexOf('name');
    assert.equal(rank1Rows[0][nameIdx], 'Olivia Lewis');
  });

  it('5. ORDER BY salary DESC LIMIT 5 - verify top 5', function () {
    var parsed = parseCSV(employeeCSV);
    var tables = { df: { _headers: parsed.headers, _rows: parsed.rows } };
    var r = execSQL('SELECT * FROM df ORDER BY salary DESC LIMIT 5', tables);
    assert.equal(r.rows.length, 5);
    var salIdx = r.headers.indexOf('salary');
    // Verify descending order
    for (var i = 1; i < r.rows.length; i++) {
      assert.ok(
        Number(r.rows[i - 1][salIdx]) >= Number(r.rows[i][salIdx]),
        'Should be in descending salary order'
      );
    }
    // Top salary should be 140000
    assert.equal(r.rows[0][salIdx], '140000');
  });

  it('6. SELECT specific columns with aliases - verify projection', function () {
    var parsed = parseCSV(employeeCSV);
    var tables = { df: { _headers: parsed.headers, _rows: parsed.rows } };
    var r = execSQL('SELECT name AS employee_name, salary AS compensation, department AS dept FROM df', tables);
    assert.deepStrictEqual(r.headers, ['employee_name', 'compensation', 'dept']);
    assert.equal(r.rows.length, 20);
    // First row should match
    assert.equal(r.rows[0][0], 'Alice Johnson');
    assert.equal(r.rows[0][1], '120000');
    assert.equal(r.rows[0][2], 'Engineering');
  });

  it('7. JOIN employees with departments', function () {
    var empParsed = parseCSV(employeeCSV);
    var deptParsed = parseCSV(deptCSV);
    var tables = {
      employees: { _headers: empParsed.headers, _rows: empParsed.rows },
      departments: { _headers: deptParsed.headers, _rows: deptParsed.rows }
    };
    var r = execSQL(
      'SELECT e.name, d.name AS dept_name FROM employees AS e INNER JOIN departments AS d ON e.department = d.id',
      tables
    );
    assert.ok(r.headers.indexOf('e.name') >= 0 || r.headers.indexOf('dept_name') >= 0,
      'Should have joined column headers');
    // Every employee should match a department (20 rows)
    assert.equal(r.rows.length, 20);
  });

  it('8. Export as CSV -> re-parse -> verify round-trip', function () {
    var parsed = parseCSV(employeeCSV);
    var tables = { df: { _headers: parsed.headers, _rows: parsed.rows } };
    var r = execSQL('SELECT * FROM df ORDER BY salary DESC LIMIT 10', tables);

    // Export to CSV
    var csvOut = toCSV({ headers: r.headers, rows: r.rows });

    // Re-parse the exported CSV
    var reparsed = parseCSV(csvOut);
    assert.deepStrictEqual(reparsed.headers, r.headers);
    assert.equal(reparsed.rows.length, r.rows.length);
    // Verify content matches
    for (var i = 0; i < r.rows.length; i++) {
      assert.deepStrictEqual(reparsed.rows[i], r.rows[i].map(String));
    }
  });
});
