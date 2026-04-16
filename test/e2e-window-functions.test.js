/**
 * E2E Test: SQL window functions and aggregation
 * Ticket #39
 */
var { describe, it } = require('node:test');
var assert = require('node:assert/strict');
var { parseCSV } = require('../src/parsers/csv.js');
var { execSQL } = require('../src/transforms/sql.js');

// --- Test data: 30 rows of sales data ---
var salesCSV = [
  'id,salesperson,region,quarter,amount',
  '1,Alice,North,Q1,15000',
  '2,Bob,North,Q1,12000',
  '3,Carol,South,Q1,18000',
  '4,Dave,South,Q1,11000',
  '5,Eve,East,Q1,20000',
  '6,Alice,North,Q2,17000',
  '7,Bob,North,Q2,13000',
  '8,Carol,South,Q2,16000',
  '9,Dave,South,Q2,14000',
  '10,Eve,East,Q2,22000',
  '11,Alice,North,Q3,19000',
  '12,Bob,North,Q3,11000',
  '13,Carol,South,Q3,21000',
  '14,Dave,South,Q3,13000',
  '15,Eve,East,Q3,25000',
  '16,Alice,North,Q4,16000',
  '17,Bob,North,Q4,14000',
  '18,Carol,South,Q4,20000',
  '19,Dave,South,Q4,12000',
  '20,Eve,East,Q4,23000',
  '21,Frank,West,Q1,9000',
  '22,Frank,West,Q2,11000',
  '23,Frank,West,Q3,10000',
  '24,Frank,West,Q4,12000',
  '25,Grace,East,Q1,17000',
  '26,Grace,East,Q2,19000',
  '27,Grace,East,Q3,18000',
  '28,Grace,East,Q4,21000',
  '29,Alice,North,Q1,15000',
  '30,Bob,North,Q2,13000',
].join('\n');

var parsed = parseCSV(salesCSV);
var tables = { sales: { _headers: parsed.headers, _rows: parsed.rows } };

describe('E2E: SQL Window Functions and Aggregation', function () {

  it('1. ROW_NUMBER() OVER (ORDER BY amount DESC) - sequential numbering', function () {
    var r = execSQL(
      'SELECT id, amount, ROW_NUMBER() OVER (ORDER BY amount DESC) AS rn FROM sales',
      tables
    );
    var rnIdx = r.headers.indexOf('rn');
    assert.ok(rnIdx >= 0, 'Should have rn column');
    // Verify sequential 1..30
    var rnValues = r.rows.map(function (row) { return row[rnIdx]; });
    // ROW_NUMBER values depend on the order of original rows; check that
    // all values 1-30 appear exactly once
    var sorted = rnValues.slice().sort(function (a, b) { return a - b; });
    for (var i = 0; i < 30; i++) {
      assert.equal(sorted[i], i + 1, 'ROW_NUMBER should include ' + (i + 1));
    }
  });

  it('2. RANK() OVER (PARTITION BY region ORDER BY amount DESC) - rank with ties', function () {
    var r = execSQL(
      'SELECT id, salesperson, region, amount, RANK() OVER (PARTITION BY region ORDER BY amount DESC) AS rnk FROM sales',
      tables
    );
    var rnkIdx = r.headers.indexOf('rnk');
    var regIdx = r.headers.indexOf('region');
    var amtIdx = r.headers.indexOf('amount');
    assert.ok(rnkIdx >= 0, 'Should have rnk column');

    // All rank 1 rows should have the highest amount in their region
    var rank1Rows = r.rows.filter(function (row) { return row[rnkIdx] === 1; });
    assert.ok(rank1Rows.length > 0, 'Should have rank 1 rows');

    // Check East region: highest amount is 25000 (Eve Q3)
    var eastRank1 = rank1Rows.filter(function (row) { return row[regIdx] === 'East'; });
    assert.ok(eastRank1.length >= 1, 'East should have rank 1');
    assert.equal(Number(eastRank1[0][amtIdx]), 25000);

    // Verify ties: Alice has two rows with amount 15000 in North - they should get the same rank
    var northRows = r.rows.filter(function (row) { return row[regIdx] === 'North'; });
    var aliceNorth15k = northRows.filter(function (row) {
      return row[r.headers.indexOf('salesperson')] === 'Alice' && row[amtIdx] === '15000';
    });
    if (aliceNorth15k.length === 2) {
      assert.equal(aliceNorth15k[0][rnkIdx], aliceNorth15k[1][rnkIdx], 'Tied amounts should have same rank');
    }
  });

  it('3. SUM(amount) OVER (PARTITION BY region) - totals per region', function () {
    var r = execSQL(
      'SELECT id, region, amount, SUM(amount) OVER (PARTITION BY region) AS region_total FROM sales',
      tables
    );
    var totalIdx = r.headers.indexOf('region_total');
    var regIdx = r.headers.indexOf('region');
    assert.ok(totalIdx >= 0, 'Should have region_total column');

    // Calculate expected North total manually
    var northTotal = 0;
    parsed.rows.forEach(function (row) {
      if (row[parsed.headers.indexOf('region')] === 'North') {
        northTotal += Number(row[parsed.headers.indexOf('amount')]);
      }
    });

    // All North rows should have the same region_total
    var northRows = r.rows.filter(function (row) { return row[regIdx] === 'North'; });
    northRows.forEach(function (row) {
      assert.equal(row[totalIdx], northTotal, 'North region total should be consistent');
    });
  });

  it('4. AVG(amount) OVER (PARTITION BY salesperson) - per-person averages', function () {
    var r = execSQL(
      'SELECT id, salesperson, amount, AVG(amount) OVER (PARTITION BY salesperson) AS avg_amt FROM sales',
      tables
    );
    var avgIdx = r.headers.indexOf('avg_amt');
    var spIdx = r.headers.indexOf('salesperson');
    assert.ok(avgIdx >= 0, 'Should have avg_amt column');

    // Calculate expected Eve average: (20000+22000+25000+23000)/4 = 22500
    var eveRows = r.rows.filter(function (row) { return row[spIdx] === 'Eve'; });
    assert.ok(eveRows.length > 0, 'Should have Eve rows');
    assert.equal(eveRows[0][avgIdx], 22500, 'Eve average should be 22500');

    // All rows for same person should have same average
    eveRows.forEach(function (row) {
      assert.equal(row[avgIdx], eveRows[0][avgIdx], 'All Eve rows should have same avg');
    });
  });

  it('5. LAG(amount, 1) OVER (ORDER BY id) - previous row values', function () {
    var r = execSQL(
      'SELECT id, amount, LAG(amount, 1) OVER (ORDER BY id) AS prev_amount FROM sales',
      tables
    );
    var lagIdx = r.headers.indexOf('prev_amount');
    var idIdx = r.headers.indexOf('id');
    var amtIdx = r.headers.indexOf('amount');
    assert.ok(lagIdx >= 0, 'Should have prev_amount column');

    // Sort result by id to check LAG
    var byId = r.rows.slice().sort(function (a, b) { return Number(a[idIdx]) - Number(b[idIdx]); });

    // First row's LAG should be null
    assert.equal(byId[0][lagIdx], null, 'First row LAG should be null');

    // Second row's LAG should be first row's amount
    assert.equal(byId[1][lagIdx], byId[0][amtIdx], 'Second row LAG should equal first row amount');

    // Third row's LAG should be second row's amount
    assert.equal(byId[2][lagIdx], byId[1][amtIdx], 'Third row LAG should equal second row amount');
  });

  it('6. LEAD(amount, 1) OVER (ORDER BY id) - next row values', function () {
    var r = execSQL(
      'SELECT id, amount, LEAD(amount, 1) OVER (ORDER BY id) AS next_amount FROM sales',
      tables
    );
    var leadIdx = r.headers.indexOf('next_amount');
    var idIdx = r.headers.indexOf('id');
    var amtIdx = r.headers.indexOf('amount');
    assert.ok(leadIdx >= 0, 'Should have next_amount column');

    // Sort by id
    var byId = r.rows.slice().sort(function (a, b) { return Number(a[idIdx]) - Number(b[idIdx]); });

    // Last row's LEAD should be null
    assert.equal(byId[byId.length - 1][leadIdx], null, 'Last row LEAD should be null');

    // First row's LEAD should be second row's amount
    assert.equal(byId[0][leadIdx], byId[1][amtIdx], 'First row LEAD should equal second row amount');
  });

  it('7. COUNT(*) OVER (PARTITION BY quarter) - per-quarter counts', function () {
    var r = execSQL(
      'SELECT id, quarter, COUNT(*) OVER (PARTITION BY quarter) AS q_count FROM sales',
      tables
    );
    var cntIdx = r.headers.indexOf('q_count');
    var qIdx = r.headers.indexOf('quarter');
    assert.ok(cntIdx >= 0, 'Should have q_count column');

    // Count Q1 rows manually
    var q1Count = parsed.rows.filter(function (row) {
      return row[parsed.headers.indexOf('quarter')] === 'Q1';
    }).length;

    // All Q1 rows should have the same count
    var q1Rows = r.rows.filter(function (row) { return row[qIdx] === 'Q1'; });
    q1Rows.forEach(function (row) {
      assert.equal(row[cntIdx], q1Count, 'Q1 count should be ' + q1Count);
    });
  });

  it('8. RANK with GROUP BY equivalent - ranking grouped results', function () {
    // First group by region to get totals, then rank
    var r = execSQL(
      'SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY total DESC',
      tables
    );
    assert.ok(r.rows.length > 0, 'Should have grouped results');

    // Verify ordering is descending by total
    for (var i = 1; i < r.rows.length; i++) {
      assert.ok(
        Number(r.rows[i - 1][1]) >= Number(r.rows[i][1]),
        'Results should be ordered by total DESC'
      );
    }

    // East should have the highest total (Eve + Grace = large amounts)
    assert.equal(r.rows[0][0], 'East', 'East should have highest total');
  });

  it('9. Aggregate: GROUP BY region with SUM, COUNT, AVG, MIN, MAX', function () {
    var r = execSQL(
      'SELECT region, SUM(amount) AS total, COUNT(*) AS cnt, AVG(amount) AS avg_amt, MIN(amount) AS min_amt, MAX(amount) AS max_amt FROM sales GROUP BY region',
      tables
    );
    assert.deepStrictEqual(r.headers, ['region', 'total', 'cnt', 'avg_amt', 'min_amt', 'max_amt']);
    assert.ok(r.rows.length > 0, 'Should have results');

    // Verify West region (Frank only: 9000, 11000, 10000, 12000)
    var westRow = r.rows.find(function (row) { return row[0] === 'West'; });
    assert.ok(westRow, 'Should have West region');
    assert.equal(westRow[1], 42000); // SUM
    assert.equal(westRow[2], 4);     // COUNT
    assert.equal(westRow[3], 10500); // AVG
    assert.equal(westRow[4], 9000);  // MIN
    assert.equal(westRow[5], 12000); // MAX
  });

  it('10. Aggregate + WHERE filter (HAVING equivalent)', function () {
    // GROUP BY salesperson, then filter for those with total > 50000
    var grouped = execSQL(
      'SELECT salesperson, SUM(amount) AS total, COUNT(*) AS cnt FROM sales GROUP BY salesperson',
      tables
    );
    // Now filter: since execSQL doesn't support HAVING directly,
    // use the grouped result as a new table and apply WHERE
    var filteredTables = { grouped: { _headers: grouped.headers, _rows: grouped.rows } };
    var r = execSQL('SELECT * FROM grouped WHERE total > 50000', filteredTables);

    assert.ok(r.rows.length > 0, 'Should have results with total > 50000');
    var totalIdx = r.headers.indexOf('total');
    r.rows.forEach(function (row) {
      assert.ok(Number(row[totalIdx]) > 50000, 'Each result should have total > 50000, got ' + row[totalIdx]);
    });

    // Eve should be in results: 20000+22000+25000+23000 = 90000
    var spIdx = r.headers.indexOf('salesperson');
    var eveRow = r.rows.find(function (row) { return row[spIdx] === 'Eve'; });
    assert.ok(eveRow, 'Eve should have total > 50000');
    assert.equal(Number(eveRow[totalIdx]), 90000);
  });
});
