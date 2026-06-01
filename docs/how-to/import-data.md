# How to Import Data

WDK supports CSV, TSV, JSON, XLSX, and ZIP files. Data can enter through drag-and-drop, file picker, paste, URL, or DOM scraping.

## File import

### Drag-and-drop

Drag any supported file onto the WDK drop zone. WDK auto-detects the format by inspecting the file extension and content:

| Extension | Parser | Notes |
|-----------|--------|-------|
| `.csv` | CSV (RFC 4180) | Handles BOM, streaming for >100MB |
| `.tsv` | CSV with tab delimiter | Auto-detected from extension |
| `.json` | JSON | Flattens nested objects, recovers trailing commas |
| `.xlsx` | XLSX | Multi-sheet, shared strings, date handling |
| `.zip` | ZIP | Uses DecompressionStream API, extracts supported files |

### File picker

Click the drop zone to open the browser's native file picker. Select one or more files. Same format detection applies.

### Keyboard shortcut

Press **Ctrl+I** to trigger the file import dialog.

## Paste

You can paste tabular data directly:

1. Copy cells from Excel, Google Sheets, or any source.
2. Click in the WDK drop zone.
3. Press **Ctrl+V**.
4. WDK detects tab-delimited data and parses it as TSV.

This also works with comma-delimited text copied from a text editor.

## URL import

In the REPL, use JavaScript to fetch and import data from a URL:

```javascript
fetch('https://example.com/data.csv')
  .then(r => r.text())
  .then(text => {
    var df = parseCSV(text);
    renderTable(df);
  });
```

This requires network access and appropriate CORS headers. On restricted networks, prefer file-based import.

## DOM scraping (click-to-select tables)

When running as a bookmarklet on a web page:

1. Open the **DOM** tab in WDK.
2. Click **Select Table**. The cursor becomes a crosshair.
3. Hover over HTML tables on the page. Each table highlights with a blue outline.
4. Click a table to extract it.
5. WDK converts the `<table>` into a DataFrame using:
   - `<thead>` cells as column headers (falls back to first `<tr>` if no `<thead>`).
   - All subsequent `<tr>` elements as data rows.
   - Cell text content (stripped of HTML).
6. The extracted data appears in the table view, ready for SQL queries or export.

WDK also generates the CSS selector for the scraped table, so you can reference it in scripts.

## Multiple datasets

Each imported file becomes a named table. The first import is called `data`. Subsequent imports use the filename (without extension) as the table name. You can reference all tables in SQL:

```sql
SELECT a.name, b.total
FROM employees AS a
INNER JOIN invoices AS b ON a.id = b.employee_id
```

## Large files

- CSV files >100MB use streaming parsing to avoid memory pressure.
- XLSX parsing handles shared string tables and multi-sheet workbooks.
- The table renderer uses virtual scrolling, so even 1M+ rows render smoothly.

## Format-specific notes

### CSV
- RFC 4180 compliant: quoted fields, embedded newlines, escaped quotes (`""`).
- BOM (byte order mark) is stripped automatically.
- Auto-detects delimiter: comma, tab, semicolon, pipe.

### JSON
- Accepts arrays of objects (`[{...}, {...}]`) and nested structures.
- Nested objects are flattened with dot notation: `address.city` becomes a column.
- Recovers from trailing commas and minor syntax errors.

### XLSX
- Reads OOXML SpreadsheetML format (`.xlsx`, not legacy `.xls`).
- Handles shared string tables, date serial numbers, and cell formats.
- Multi-sheet workbooks: each sheet becomes a separate named table.

### ZIP
- Zero-dependency zip reader using the browser's DecompressionStream API.
- Extracts and parses all supported files inside the archive.
