/**
 * Wiz PII Scanner — two-pass regex-based PII detection.
 * Pass 1 (gate): fast regex scan for candidate matches.
 * Pass 2 (validate): Luhn checksum, SSN area validation, context scoring.
 * Consumes pii-patterns.json (shared with PowerShell scanner).
 * Zero dependencies.
 */

/* global DK_PII_PATTERNS */

// Inline patterns if not loaded externally
var DK_PII_PATTERNS = (typeof DK_PII_PATTERNS !== 'undefined') ? DK_PII_PATTERNS : null;

/**
 * Load patterns from JSON object.
 * @param {object} patternsJson - parsed pii-patterns.json
 */
function loadPIIPatterns(patternsJson) {
  DK_PII_PATTERNS = patternsJson.patterns.map(function (p) {
    return {
      name: p.name,
      entity_type: p.entity_type,
      severity: p.severity,
      regex: new RegExp(p.regex, 'gi'),
      score: p.score,
      context_words: p.context_words || [],
      context_score_boost: p.context_score_boost || 0,
      validation: p.validation,
      description: p.description
    };
  });
}

/**
 * Luhn checksum validator for credit card numbers.
 * @param {string} num - digits string (may include dashes/spaces)
 * @returns {boolean}
 */
function validateLuhn(num) {
  var digits = num.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  var sum = 0;
  var alt = false;
  for (var i = digits.length - 1; i >= 0; i--) {
    var d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return (sum % 10) === 0;
}

/**
 * SSN area number validation.
 * Rejects known invalid patterns: 000, 666, 900-999 area; 00 group; 0000 serial.
 * @param {string} ssn - SSN string (may include dashes/spaces)
 * @returns {boolean}
 */
function validateSSN(ssn) {
  var digits = ssn.replace(/\D/g, '');
  if (digits.length !== 9) return false;
  var area = parseInt(digits.substring(0, 3), 10);
  var group = parseInt(digits.substring(3, 5), 10);
  var serial = parseInt(digits.substring(5, 9), 10);
  if (area === 0 || area === 666 || area >= 900) return false;
  if (group === 0) return false;
  if (serial === 0) return false;
  // Reject obvious patterns (all same digit)
  if (/^(\d)\1{8}$/.test(digits)) return false;
  return true;
}

/**
 * Check for context words near a match to boost confidence.
 * @param {string} text - full text of the row/line
 * @param {string[]} contextWords - words to search for
 * @returns {boolean}
 */
function hasContextMatch(text, contextWords) {
  if (!contextWords || contextWords.length === 0) return false;
  var lower = text.toLowerCase();
  for (var i = 0; i < contextWords.length; i++) {
    if (lower.indexOf(contextWords[i]) >= 0) return true;
  }
  return false;
}

/**
 * Scan a DataFrame for PII.
 * Two-pass approach: fast regex gate, then validation + context scoring.
 *
 * @param {object} df - { _headers: string[], _rows: any[][] }
 * @param {object} [options]
 * @param {number} [options.minScore=0.5] - minimum confidence score to report
 * @param {string[]} [options.severities] - filter by severity (HIGH, MEDIUM, LOW, CRITICAL)
 * @returns {{ findings: object[], summary: object }}
 */
function scanPII(df, options) {
  if (!DK_PII_PATTERNS) throw new Error('PII patterns not loaded. Call loadPIIPatterns() first.');

  var opts = options || {};
  var minScore = opts.minScore != null ? opts.minScore : 0.5;
  var severityFilter = opts.severities || null;

  var findings = [];
  var summary = {};
  var headers = df._headers;
  var rows = df._rows;

  // Initialize summary counters
  DK_PII_PATTERNS.forEach(function (p) {
    summary[p.name] = { count: 0, severity: p.severity, entity_type: p.entity_type };
  });

  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    for (var c = 0; c < headers.length; c++) {
      var cellVal = row[c];
      if (cellVal == null || cellVal === '') continue;
      var cellStr = String(cellVal);

      // Pass 1: fast regex gate
      for (var p = 0; p < DK_PII_PATTERNS.length; p++) {
        var pattern = DK_PII_PATTERNS[p];

        // Severity filter
        if (severityFilter && severityFilter.indexOf(pattern.severity) < 0) continue;

        // Reset regex state (global flag)
        pattern.regex.lastIndex = 0;
        var match = pattern.regex.exec(cellStr);
        if (!match) continue;

        // Pass 2: validation
        var score = pattern.score;
        var valid = true;

        if (pattern.validation === 'luhn') {
          valid = validateLuhn(match[0]);
          if (!valid) continue;
          score += 0.15; // validated CC gets score boost
        } else if (pattern.validation === 'ssn_area_check') {
          valid = validateSSN(match[0]);
          if (!valid) continue;
          score += 0.10;
        }

        // Context scoring — check entire row text for context words
        var rowText = row.join(' ');
        if (hasContextMatch(rowText, pattern.context_words)) {
          score += pattern.context_score_boost;
        }

        // Apply minimum score filter
        score = Math.min(1.0, score);
        if (score < minScore) continue;

        findings.push({
          row: r,
          column: c,
          header: headers[c],
          pattern_name: pattern.name,
          entity_type: pattern.entity_type,
          severity: pattern.severity,
          match: _redactMatch(match[0], pattern.entity_type),
          score: Math.round(score * 100) / 100,
          description: pattern.description
        });

        summary[pattern.name].count++;
      }
    }
  }

  return {
    findings: findings,
    summary: summary,
    total_findings: findings.length,
    rows_scanned: rows.length,
    columns_scanned: headers.length
  };
}

/**
 * Redact a matched value for safe display in reports.
 * Shows first 2 and last 2 chars, masks the rest.
 * @param {string} val
 * @param {string} entityType
 * @returns {string}
 */
function _redactMatch(val, entityType) {
  if (entityType === 'CLASSIFICATION' || entityType === 'EXPORT_CONTROL') {
    return val; // classification markings should be shown in full
  }
  if (val.length <= 4) return '****';
  return val.substring(0, 2) + val.substring(2, val.length - 2).replace(/[A-Za-z0-9]/g, '*') + val.substring(val.length - 2);
}

/**
 * Generate a text report from scan results.
 * @param {object} scanResult - output of scanPII()
 * @returns {string}
 */
function piiReport(scanResult) {
  var lines = [];
  lines.push('PII Scan Report');
  lines.push('===============');
  lines.push('Rows scanned: ' + scanResult.rows_scanned);
  lines.push('Columns scanned: ' + scanResult.columns_scanned);
  lines.push('Total findings: ' + scanResult.total_findings);
  lines.push('');

  // Summary by type
  lines.push('Summary:');
  var summary = scanResult.summary;
  var keys = Object.keys(summary);
  for (var i = 0; i < keys.length; i++) {
    var s = summary[keys[i]];
    if (s.count > 0) {
      lines.push('  ' + keys[i] + ': ' + s.count + ' (' + s.severity + ')');
    }
  }
  lines.push('');

  // Findings detail
  if (scanResult.findings.length > 0) {
    lines.push('Findings:');
    lines.push('Row\tColumn\tType\tSeverity\tScore\tMatch');
    for (var f = 0; f < scanResult.findings.length; f++) {
      var finding = scanResult.findings[f];
      lines.push(
        (finding.row + 1) + '\t' +
        finding.header + '\t' +
        finding.entity_type + '\t' +
        finding.severity + '\t' +
        finding.score + '\t' +
        finding.match
      );
    }
  } else {
    lines.push('No PII detected.');
  }

  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    loadPIIPatterns: loadPIIPatterns,
    scanPII: scanPII,
    piiReport: piiReport,
    validateLuhn: validateLuhn,
    validateSSN: validateSSN
  };
}
