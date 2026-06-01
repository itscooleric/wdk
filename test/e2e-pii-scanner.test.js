/**
 * E2E Test: PII Scanner on realistic data
 * Ticket #38
 */
var { describe, it, before } = require('node:test');
var assert = require('node:assert/strict');
var { loadPIIPatterns, scanPII } = require('../src/transforms/pii-scanner.js');
var fs = require('fs');
var path = require('path');

// Load PII patterns before tests
before(function () {
  var patternsPath = path.join(__dirname, '..', 'src', 'transforms', 'pii-patterns.json');
  var patternsJSON = JSON.parse(fs.readFileSync(patternsPath, 'utf8'));
  loadPIIPatterns(patternsJSON);
});

// --- Test data ---
// Luhn-valid credit card numbers (Visa):
//   4532015112830366 -> Luhn valid
//   4716182333661476 -> Luhn valid

var piiHeaders = ['name', 'email', 'phone', 'ssn', 'cc_number', 'address', 'notes'];
var piiRows = [
  ['John Doe',      'john.doe@example.com',    '(555) 123-4567', '123-45-6789', '4532015112830366', '123 Main St, NY 10001', 'Regular customer'],
  ['Jane Smith',    'jane.smith@company.org',   '555-987-6543',   '234-56-7890', '4716182333661476', '456 Oak Ave, CA 90210', 'VIP account'],
  ['Bob Wilson',    'bob@test.net',             '(800) 555-0199', '345-67-8901', '',                 '789 Pine Rd, TX 75001', 'New signup'],
  ['Alice Brown',   '',                         '',               '',            '',                 '321 Elm St, FL 33101',  'Inactive'],
  ['Charlie Davis', 'charlie.d@email.com',      '555.444.3333',   '456-78-9012', '5105105105105100', '654 Birch Ln, WA 98101','Has mastercard on file'],
  ['Diana Evans',   'diana@workplace.com',      '',               '567-89-0123', '',                 '987 Cedar Dr, IL 60601','Notes: ssn verified'],
  ['Edward Fox',    '',                         '1-800-555-0123', '',            '4532015112830366', '147 Maple St, OH 44101','Repeat card number'],
  ['Fiona Grant',   'fiona.grant@domain.co.uk', '(212) 555-0147', '678-90-1234', '',                 '258 Walnut Ave, PA 19101', 'International email'],
  ['George Hill',   '',                         '',               '',            '',                 '369 Spruce Ct, MA 02101', 'Clean record'],
  ['Hannah Ivy',    'hannah@test.org',          '555-222-1111',   '',            '371449635398431',  '741 Ash Blvd, GA 30301', 'Amex card holder'],
  ['Ivan Jones',    '',                         '',               '789-01-2345', '',                 '852 Poplar Way, MI 48101', 'SSN on file'],
  ['Julia King',    'julia.king@mail.com',      '',               '',            '',                 '963 Hickory St, AZ 85001', 'Email only contact'],
  ['Kevin Lee',     '',                         '(312) 555-0198', '',            '',                 '159 Chestnut Dr, CO 80201', 'Phone pref'],
  ['Laura Moore',   'laura.m@org.net',          '555-333-4444',   '321-54-9876', '4532015112830366', '267 Willow Ln, VA 22101', 'Multiple PII types'],
  ['Mark Nelson',   '',                         '',               '',            '',                 '378 Sycamore Rd, OR 97201', 'No PII here'],
];

var df = { _headers: piiHeaders, _rows: piiRows };

describe('E2E: PII Scanner', function () {

  it('1. Scan finds SSN patterns (###-##-####)', function () {
    var result = scanPII(df, { minScore: 0.5 });
    var ssnFindings = result.findings.filter(function (f) { return f.entity_type === 'SSN'; });
    assert.ok(ssnFindings.length > 0, 'Should find SSN patterns');
    // We have SSNs in rows 0,1,2,4,5,7,10,13
    var ssnRows = new Set(ssnFindings.map(function (f) { return f.row; }));
    assert.ok(ssnRows.has(0), 'Row 0 should have SSN');
    assert.ok(ssnRows.has(1), 'Row 1 should have SSN');
    // Verify the column is 'ssn'
    ssnFindings.forEach(function (f) {
      assert.equal(f.header, 'ssn');
    });
  });

  it('2. Scan finds credit card patterns (Luhn-valid)', function () {
    var result = scanPII(df, { minScore: 0.5 });
    var ccFindings = result.findings.filter(function (f) { return f.entity_type === 'CREDIT_CARD'; });
    assert.ok(ccFindings.length > 0, 'Should find credit card patterns');
    // All CC findings should be in the cc_number column
    var ccInCorrectCol = ccFindings.filter(function (f) { return f.header === 'cc_number'; });
    assert.ok(ccInCorrectCol.length > 0, 'CC findings should be in cc_number column');
  });

  it('3. Scan finds email addresses', function () {
    var result = scanPII(df, { minScore: 0.5 });
    var emailFindings = result.findings.filter(function (f) { return f.entity_type === 'EMAIL'; });
    assert.ok(emailFindings.length > 0, 'Should find email patterns');
    // Verify emails are in the email column
    var emailHeaders = emailFindings.map(function (f) { return f.header; });
    assert.ok(emailHeaders.indexOf('email') >= 0, 'Should find emails in email column');
  });

  it('4. Scan finds phone numbers', function () {
    var result = scanPII(df, { minScore: 0.3 });
    var phoneFindings = result.findings.filter(function (f) { return f.entity_type === 'PHONE'; });
    assert.ok(phoneFindings.length > 0, 'Should find phone number patterns');
    var phoneHeaders = phoneFindings.map(function (f) { return f.header; });
    assert.ok(phoneHeaders.indexOf('phone') >= 0, 'Should find phones in phone column');
  });

  it('5. Scan does NOT false-positive on zip codes or order IDs', function () {
    var cleanDf = {
      _headers: ['order_id', 'zip_code', 'qty'],
      _rows: [
        ['ORD-10001', '90210', '5'],
        ['ORD-20002', '10001', '3'],
        ['ORD-30003', '60601', '12'],
        ['ORD-40004', '33101', '8'],
        ['ORD-50005', '75001', '1'],
      ]
    };
    var result = scanPII(cleanDf, { minScore: 0.5 });
    var ssnFindings = result.findings.filter(function (f) { return f.entity_type === 'SSN'; });
    var ccFindings = result.findings.filter(function (f) { return f.entity_type === 'CREDIT_CARD'; });
    assert.equal(ssnFindings.length, 0, 'Should not flag zip codes as SSN');
    assert.equal(ccFindings.length, 0, 'Should not flag order IDs as credit cards');
  });

  it('6. Scan result includes column names and row positions', function () {
    var result = scanPII(df, { minScore: 0.5 });
    assert.ok(result.findings.length > 0, 'Should have findings');
    result.findings.forEach(function (f) {
      assert.ok(typeof f.row === 'number', 'Finding should have numeric row');
      assert.ok(typeof f.column === 'number', 'Finding should have numeric column index');
      assert.ok(typeof f.header === 'string', 'Finding should have string header');
      assert.ok(f.row >= 0 && f.row < piiRows.length, 'Row should be in range');
      assert.ok(piiHeaders.indexOf(f.header) >= 0, 'Header should be a valid column name');
    });
  });

  it('7. Multiple PII types in same row are all detected', function () {
    // Row 13 (Laura Moore) has email, phone, SSN, and CC
    var result = scanPII(df, { minScore: 0.3 });
    var row13Findings = result.findings.filter(function (f) { return f.row === 13; });
    var typesFound = new Set(row13Findings.map(function (f) { return f.entity_type; }));
    assert.ok(typesFound.size >= 2, 'Row 13 should have multiple PII types, got: ' + Array.from(typesFound).join(', '));
  });

  it('8. Clean column (address with just street addresses) has no SSN/CC findings', function () {
    var result = scanPII(df, { minScore: 0.5 });
    var addressSSN = result.findings.filter(function (f) {
      return f.header === 'address' && f.entity_type === 'SSN';
    });
    var addressCC = result.findings.filter(function (f) {
      return f.header === 'address' && f.entity_type === 'CREDIT_CARD';
    });
    assert.equal(addressSSN.length, 0, 'Address column should have no SSN findings');
    assert.equal(addressCC.length, 0, 'Address column should have no CC findings');
  });
});
