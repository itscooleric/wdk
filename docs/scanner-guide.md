# Scanner and PII Detection Guide

WDK includes two complementary scanning capabilities in the **Scanner tab**: the **Preflight Scanner** (file sanitization before transfer) and the **PII Scanner** (column-level detection of personal identifiable information in loaded data). Both run entirely in your browser — no data leaves your machine.

## When to use each tool

| Tool | Use case |
|------|----------|
| **Preflight Scanner** | You're about to transfer a file across an air gap, to a USB drive, or to a SharePoint site. Scan it first for embedded scripts, binary payloads, formula injection, and high-entropy secrets. |
| **PII Scanner** | You have a CSV or dataset and need to find columns containing SSNs, credit card numbers, email addresses, phone numbers, or other regulated data before sharing or publishing. |

---

## Preflight Scanner

The Preflight Scanner examines files for content that could be risky when transferred to another system or shared with others.

### What it checks

| Check | Severity | Description |
|-------|----------|-------------|
| `script_tag` | HIGH | `<script>` tags embedded in HTML or text files |
| `binary_bytes` | HIGH | Non-printable bytes indicating a binary or executable file disguised as text |
| `macro_ext` | HIGH | File extension associated with macros (`.xlsm`, `.docm`, `.vbs`, `.ps1`, `.hta`, etc.) |
| `base64_blob` | MEDIUM | Long base64-encoded strings that may encode hidden content |
| `data_uri` | MEDIUM | `data:` URIs embedded in files (can carry executable or binary payloads) |
| `formula_injection` | MEDIUM | Cells starting with `=`, `+`, `-`, or `@` that Excel may execute as formulas |
| `high_entropy` | MEDIUM | Text with high Shannon entropy — may indicate secrets, keys, or obfuscated content |
| `long_line` | LOW | Lines over 10,000 characters (unusual for normal text files) |
| `large_file` | LOW | Files exceeding 10 MB |

### File types accepted for scanning

`.txt`, `.md`, `.csv`, `.json`, `.js`, `.html`, `.xml`, `.ps1`, `.py`, `.sh`, `.bat`, `.yml`, `.yaml`, `.ini`, `.cfg`, `.conf`, `.log`, `.tsv`

Files with macro-associated extensions (`.xlsm`, `.docm`, `.vbs`, etc.) are flagged automatically regardless of content.

### How to use

1. Click the **Scanner tab** in WDK.
2. Drag one or more files onto the scan zone, or click to browse.
3. WDK scans each file and shows a result card with:
   - **PASS** — no issues found
   - **WARN** — one or more medium/low findings
   - **FAIL** — one or more high-severity findings
4. Each finding shows the severity, check type, and a brief description.

### Scan-and-convert mode

For files with formula injection findings, you can sanitize them:

1. After a scan, click **Convert** on the affected file.
2. WDK rewrites the file, prefixing formula-starting cells with a single quote (`'`) so they're treated as text in Excel.
3. Download the sanitized version.

### Manifest generation

After scanning, click **Download Manifest** to save a CSV manifest listing all scanned files, their SHA-256 hashes, sizes, and findings. This is useful for audit trails when transferring files across an air gap.

The manifest format:

```
filename,sha256,size_bytes,extension,result,checks_failed
report.csv,a3f8...,24830,csv,PASS,
macro-file.xlsm,b1c2...,81920,xlsm,FAIL,macro_ext
```

---

## PII Scanner

The PII Scanner analyzes a loaded DataFrame column by column, flagging cells that may contain personally identifiable information.

### Detected PII types

| Type | Detection method |
|------|-----------------|
| Social Security Number (SSN) | Regex pattern + area/group validation |
| Credit card number | Regex pattern + Luhn algorithm check |
| Email address | RFC 5322-compatible regex |
| US phone number | Regex covering `(555) 555-1234`, `555-555-1234`, `+1 555...` formats |
| IP address | IPv4 dotted-decimal regex |
| Date of birth | Contextual scoring — date-shaped values in columns named `dob`, `birth`, `birthday` |

Detection uses a two-pass approach:

1. **Regex gate** — fast pattern match to find candidate values
2. **Validation** — Luhn check for credit cards, area/group/serial check for SSNs
3. **Context scoring** — column name hints boost confidence (a column named `ssn` scores higher than one named `notes`)

### How to use

1. Load your dataset in the **Data tab** (CSV, JSON, or XLSX).
2. Click the **Scanner tab**.
3. Click **Scan for PII**.
4. WDK scans all columns and returns a report.

### Understanding the report

The report shows:

- **Column name** — which column was scanned
- **PII type detected** — the category (SSN, email, phone, etc.)
- **Confidence** — LOW / MEDIUM / HIGH based on pattern match quality and context scoring
- **Sample matches** — a few example values that triggered detection (first 4 characters + masked remainder)
- **Match count** — how many cells in the column matched

A HIGH confidence match means the regex pattern matched AND the value passed field-specific validation (Luhn for cards, area check for SSNs). A LOW confidence match means the pattern matched but could be a false positive.

### After finding PII

WDK does not automatically redact or remove PII — you decide what to do. Options:

**Option 1 — Redact from the Data tab:**
Use the column context menu (right-click a column header) to:
- **Blank** — replace all values with empty string
- **Hash** — replace with a one-way hash (SHA-256 or fast djb2)
- **Mask** — replace with `****` or a custom mask pattern
- **Regex redact** — replace matched patterns within cell values

**Option 2 — SQL transform:**
```sql
-- Replace SSN column with a hash placeholder
SELECT name, department, '***-**-****' AS ssn, salary
FROM employees
```

**Option 3 — Export without the column:**
```sql
-- Export everything except the PII column
SELECT name, department, salary, hire_date
FROM employees
```

Then use **Export → Download CSV** to save the de-identified result.

### False positives

Some columns will produce false positives — for example, a `phone_ext` column of 4-digit numbers may partially match phone patterns. Review each finding before acting.

To suppress a false positive finding, you can rename the column before scanning (column names influence context scoring) or simply ignore the LOW-confidence result.

---

## Redaction reference

WDK's redaction functions are available from both the UI and the REPL/Notebook.

### From the REPL

```javascript
// Hash a column (djb2 — fast, non-cryptographic)
hashColumn(df, 'ssn', 'djb2');

// Hash with SHA-256 (cryptographic, async)
hashColumn(df, 'credit_card', 'sha256').then(function(redacted) {
  console.log('Redacted:', redacted.rowCount, 'rows');
});

// Blank a column entirely
blankColumn(df, 'phone');

// Replace with a constant
replaceColumn(df, 'email', '[REDACTED]');

// Regex redact — replace matched pattern within each cell
regexRedact(df, 'notes', /\b\d{3}-\d{2}-\d{4}\b/g, '***-**-****');
```

### Available redaction functions

| Function | Description |
|----------|-------------|
| `blankColumn(df, col)` | Sets all values in `col` to empty string |
| `replaceColumn(df, col, value)` | Sets all values in `col` to `value` |
| `regexRedact(df, col, pattern, replacement)` | Applies regex substitution within each cell |
| `hashColumn(df, col, algo)` | Replaces each value with its hash. `algo` is `'djb2'` or `'sha256'`. SHA-256 returns a Promise. |

All functions return a new DataFrame — the original is not modified.

---

## Privacy and compliance notes

WDK scanning runs entirely in your browser. No data is sent to any server. SHA-256 hashing uses the browser's native `crypto.subtle` API — no third-party code.

WDK's PII detection is a **screening tool**, not a compliance system. It can help you find obvious PII quickly, but it does not guarantee complete detection of all regulated data. For formal compliance audits (HIPAA, PCI-DSS, GDPR), treat WDK's output as a starting point for human review.
