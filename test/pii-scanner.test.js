/**
 * Tests for PII Scanner module.
 */

var scanner = require('../src/transforms/pii-scanner');
var patterns = require('../src/transforms/pii-patterns.json');

var passed = 0;
var failed = 0;

function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('  FAIL: ' + msg); }
}

// Load patterns
scanner.loadPIIPatterns(patterns);

console.log('pii-scanner.test.js');
console.log('');

// --- Luhn validator ---
console.log('Luhn validator:');
assert(scanner.validateLuhn('4111111111111111') === true, 'Valid Visa');
assert(scanner.validateLuhn('4111111111111112') === false, 'Invalid Visa');
assert(scanner.validateLuhn('5500000000000004') === true, 'Valid Mastercard');
assert(scanner.validateLuhn('371449635398431') === true, 'Valid Amex');
assert(scanner.validateLuhn('1234') === false, 'Too short');
assert(scanner.validateLuhn('4111-1111-1111-1111') === true, 'Visa with dashes');
console.log('');

// --- SSN validator ---
console.log('SSN validator:');
assert(scanner.validateSSN('123-45-6789') === true, 'Valid SSN');
assert(scanner.validateSSN('000-45-6789') === false, 'Invalid area 000');
assert(scanner.validateSSN('666-45-6789') === false, 'Invalid area 666');
assert(scanner.validateSSN('900-45-6789') === false, 'Invalid area 900+');
assert(scanner.validateSSN('123-00-6789') === false, 'Invalid group 00');
assert(scanner.validateSSN('123-45-0000') === false, 'Invalid serial 0000');
assert(scanner.validateSSN('111111111') === false, 'Reject all same digits');
assert(scanner.validateSSN('078051120') === true, 'Valid SSN without dashes');
console.log('');

// --- Full scan: SSN detection ---
console.log('SSN detection:');
var df1 = {
  _headers: ['name', 'ssn'],
  _rows: [
    ['Alice', '123-45-6789'],
    ['Bob', 'not-an-ssn'],
    ['Carol', '078-05-1120'],
  ]
};
var result1 = scanner.scanPII(df1);
assert(result1.total_findings >= 2, 'Found SSN matches (got ' + result1.total_findings + ')');
var ssnFindings = result1.findings.filter(function (f) { return f.entity_type === 'SSN'; });
assert(ssnFindings.length >= 2, 'SSN entity type count: ' + ssnFindings.length);
assert(ssnFindings[0].row === 0, 'First SSN in row 0');
console.log('');

// --- Full scan: Credit card detection ---
console.log('Credit card detection:');
var df2 = {
  _headers: ['name', 'card_number'],
  _rows: [
    ['Alice', '4111-1111-1111-1111'],
    ['Bob', '1234-5678-9012-3456'],
    ['Carol', '5500 0000 0000 0004'],
  ]
};
var result2 = scanner.scanPII(df2);
var ccFindings = result2.findings.filter(function (f) { return f.entity_type === 'CREDIT_CARD'; });
assert(ccFindings.length >= 2, 'Found valid CCs (Luhn pass): ' + ccFindings.length);
// Bob's card should fail Luhn
var bobCC = result2.findings.filter(function (f) { return f.row === 1 && f.entity_type === 'CREDIT_CARD'; });
assert(bobCC.length === 0, 'Bob invalid CC rejected by Luhn');
console.log('');

// --- Full scan: Email detection ---
console.log('Email detection:');
var df3 = {
  _headers: ['name', 'contact'],
  _rows: [
    ['Alice', 'alice@example.com'],
    ['Bob', 'not-an-email'],
    ['Carol', 'carol@gov.mil'],
  ]
};
var result3 = scanner.scanPII(df3);
var emailFindings = result3.findings.filter(function (f) { return f.entity_type === 'EMAIL'; });
assert(emailFindings.length === 2, 'Found 2 emails: ' + emailFindings.length);
console.log('');

// --- Full scan: Classification markings ---
console.log('Classification marking detection:');
var df4 = {
  _headers: ['para', 'text'],
  _rows: [
    ['1', '(U) This is unclassified'],
    ['2', 'TOP SECRET information here'],
    ['3', 'CUI//SP-CTI restricted data'],
    ['4', 'Nothing special here'],
    ['5', 'ITAR controlled technical data'],
  ]
};
var result4 = scanner.scanPII(df4);
var classFindings = result4.findings.filter(function (f) {
  return f.entity_type === 'CLASSIFICATION' || f.entity_type === 'EXPORT_CONTROL';
});
assert(classFindings.length >= 3, 'Found classification/export markings: ' + classFindings.length);
console.log('');

// --- Context scoring ---
console.log('Context scoring:');
var df5 = {
  _headers: ['label', 'value'],
  _rows: [
    ['ssn', '123-45-6789'],   // has context word "ssn"
    ['code', '078-05-1120'],   // no context word
  ]
};
var result5 = scanner.scanPII(df5, { minScore: 0 });
var ssnWithCtx = result5.findings.filter(function (f) { return f.row === 0 && f.entity_type === 'SSN'; });
var ssnNoCtx = result5.findings.filter(function (f) { return f.row === 1 && f.entity_type === 'SSN'; });
if (ssnWithCtx.length > 0 && ssnNoCtx.length > 0) {
  assert(ssnWithCtx[0].score > ssnNoCtx[0].score, 'Context word boosts score (' + ssnWithCtx[0].score + ' > ' + ssnNoCtx[0].score + ')');
} else {
  assert(false, 'Expected SSN findings in both rows');
}
console.log('');

// --- Report generation ---
console.log('Report generation:');
var report = scanner.piiReport(result1);
assert(report.indexOf('PII Scan Report') >= 0, 'Report has header');
assert(report.indexOf('Total findings:') >= 0, 'Report has total');
assert(report.indexOf('SSN') >= 0, 'Report mentions SSN');
console.log('');

// --- Severity filter ---
console.log('Severity filter:');
var result6 = scanner.scanPII(df4, { severities: ['CRITICAL'] });
var critFindings = result6.findings.filter(function (f) { return f.severity === 'CRITICAL'; });
assert(critFindings.length > 0, 'Found CRITICAL findings');
var nonCrit = result6.findings.filter(function (f) { return f.severity !== 'CRITICAL'; });
assert(nonCrit.length === 0, 'No non-CRITICAL findings when filtered');
console.log('');

// --- Empty dataset ---
console.log('Edge cases:');
var dfEmpty = { _headers: ['a'], _rows: [] };
var resultEmpty = scanner.scanPII(dfEmpty);
assert(resultEmpty.total_findings === 0, 'Empty dataset: 0 findings');
assert(resultEmpty.rows_scanned === 0, 'Empty dataset: 0 rows');

// Null/empty cells
var dfNulls = { _headers: ['a'], _rows: [[null], [''], [undefined]] };
var resultNulls = scanner.scanPII(dfNulls);
assert(resultNulls.total_findings === 0, 'Null/empty cells: 0 findings');
console.log('');

// --- Redaction ---
console.log('Redaction:');
var ssnFinding = result1.findings.find(function (f) { return f.entity_type === 'SSN'; });
if (ssnFinding) {
  assert(ssnFinding.match.indexOf('*') >= 0, 'SSN match is redacted');
  assert(ssnFinding.match.length > 0, 'Redacted match is not empty');
}
// Classification markings should NOT be redacted
var classFinding = result4.findings.find(function (f) { return f.entity_type === 'CLASSIFICATION'; });
if (classFinding) {
  assert(classFinding.match.indexOf('*') < 0, 'Classification marking is shown in full');
}
console.log('');

// --- Summary ---
console.log('Results: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
