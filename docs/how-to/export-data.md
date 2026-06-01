# How to Export Data

WDK supports CSV, JSON, XLSX export, clipboard copy, and audit log download.

## CSV export

### From keyboard
Press **Ctrl+E** with data loaded. A `.csv` file downloads automatically.

### From REPL
```javascript
var csv = toCSV(currentTable);
downloadBlob(csv, 'export.csv', 'text/csv');
```

### Options
The CSV exporter accepts options:
- `delimiter` — field separator (default: `,`). Use `\t` for TSV.
- `includeHeaders` — include header row (default: `true`).

```javascript
var tsv = toCSV(currentTable, { delimiter: '\t' });
```

### Format details
- RFC 4180 compliant output.
- Fields containing the delimiter, quotes, or newlines are quoted.
- Embedded quotes are escaped as `""`.
- Null values export as empty strings.

## JSON export

```javascript
var json = toJSON(currentTable, { pretty: true, asArray: true });
downloadBlob(json, 'export.json', 'application/json');
```

### Options
- `pretty` — indent with 2 spaces (default: `false`).
- `asArray` — export as array of objects `[{col: val}, ...]` (default: `false`). When false, exports as `{headers: [...], rows: [[...]]}`.

### Array-of-objects format (asArray: true)
```json
[
  {"name": "Alice", "department": "Engineering", "salary": 95000},
  {"name": "Bob", "department": "Marketing", "salary": 72000}
]
```

### Headers-and-rows format (asArray: false)
```json
{
  "headers": ["name", "department", "salary"],
  "rows": [
    ["Alice", "Engineering", 95000],
    ["Bob", "Marketing", 72000]
  ]
}
```

## XLSX export

WDK generates valid Excel files with zero dependencies. The XLSX writer builds OOXML SpreadsheetML archives using a minimal ZIP writer with CRC32 checksums.

```javascript
var xlsx = toXLSX(currentTable);
downloadXLSX(xlsx, 'export.xlsx');
```

### What the XLSX includes
- Shared string table (deduplicates string values).
- Header row with bold styling.
- Proper cell types: strings are shared string references, numbers are numeric cells.
- Single worksheet named "Sheet1".

### Limitations
- No formulas in exported XLSX.
- No multi-sheet export (single sheet per file).
- No cell formatting beyond header bold.
- STORE compression (no deflate) — files are slightly larger than typical XLSX.

## Clipboard copy

### Copy selected rows as TSV
1. Click rows to select them (Shift+click for range).
2. Press **Ctrl+C**.
3. Data is copied as tab-separated values — paste directly into Excel or Google Sheets.

### Copy entire table
With no rows selected, **Ctrl+C** copies the entire visible table including headers.

## Audit log download

WDK maintains an append-only audit trail (NIST 800-53 AU family). Every import, export, query, transform, and redaction is logged.

### Download the audit log
```javascript
AuditLog.download();
```

This downloads a JSON Lines (`.jsonl`) file where each line is a JSON object:

```json
{"timestamp":"2026-04-19T14:30:00.000Z","session":"wdk-abc123","action":"import","details":{"filename":"employees.csv","rows":5,"columns":3}}
{"timestamp":"2026-04-19T14:30:15.000Z","session":"wdk-abc123","action":"query","details":{"sql":"SELECT * FROM data","resultRows":5}}
{"timestamp":"2026-04-19T14:30:20.000Z","session":"wdk-abc123","action":"export","details":{"format":"csv","rows":5}}
```

### Audit entry fields
- `timestamp` — ISO 8601 timestamp.
- `session` — unique session ID (generated on WDK load).
- `action` — one of: `import`, `export`, `query`, `transform`, `redact`, `clear`, `scrape`.
- `details` — action-specific metadata. Never contains PII — only row counts, column counts, hashes.

### Notes
- The audit log holds up to 10,000 entries per session.
- SHA-256 hashing (with FNV-1a fallback in environments without SubtleCrypto) is used for data fingerprinting.
- The log is in-memory only. It does not persist across page reloads unless you download it.
