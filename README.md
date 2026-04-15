# WDK — Wizard's Data Engineering Kit

```
  wizard's data engineering kit        v2
  ──────────────────────────────────────

  csv/json/xlsx ──► transform ──► export
  drag-drop     ──► sql/pivot ──► clipboard

  ┌────────────────────────────────────┐
  │  parsers    csv, json, xlsx, zip   │
  │  transforms dataframe, sql, pivot  │
  │  functions  61 string/date/math    │
  │  export     csv, json, tsv, file   │
  │  ui         table, repl, notebook  │
  │  inspect    dom, network, storage  │
  └────────────────────────────────────┘
       bookmarklet | standalone html
  ──────────────────────────────────────
  zero dependencies. single file. <200KB.
  works offline. works air-gapped.
```

Browser-based data engineering workbench for **restricted environments** — government networks, air-gapped systems, locked-down enterprise. No install, no build step, no dependencies, no network required. Drag a CSV onto a single HTML file and start working.

## Why

Every restricted industry converges on the same unmet need: portable data analysis that works within compliance boundaries without installation. The 100,000+ Advana users on DoD networks, 30+ million Chromebook students, and countless hospital/banking analysts working in locked-down environments all face the same gap: "I have a CSV and I need answers, but I can't install anything."

WDK fills that gap.

## Modules

| Module | Size | Description |
|---|---|---|
| **CSV Parser** | 2.0 KB | RFC 4180 compliant, streaming for >100MB files |
| **JSON Parser** | 4.4 KB | Nested object flattening, array handling |
| **ZIP Parser** | 3.3 KB | Pure JS zip extraction (for XLSX) |
| **XLSX Parser** | 18.6 KB | Excel file reading via zip+xml, no deps |
| **DataFrame** | 2.8 KB | Core data model with dedupe, filter, sort |
| **Pipeline** | 3.5 KB | Undo/redo transform history |
| **SQL Engine** | 27.3 KB | SELECT, JOIN, WHERE, GROUP BY, ORDER BY, LIMIT, window functions |
| **SQL Functions** | 7.5 KB | 61 built-in functions (string, date, math, type, conditional) |
| **Pivot Engine** | 6.8 KB | groupBy, aggregate, pivot with 9 agg functions |
| **Type Detection** | 3.2 KB | Auto-detect column types |
| **Redaction** | 2.1 KB | Hash and mask sensitive values |
| **Export** | 3.4 KB | CSV, JSON, clipboard, file download |
| **Table Renderer** | 8.3 KB | Virtual scroll, sort, copy TSV, null display, row selection |
| **File Import** | 8.7 KB | Drag-drop with format detection |
| **REPL** | 6.3 KB | Interactive JS console with DataFrame context |
| **Command Palette** | 3.5 KB | Ctrl+P fuzzy-search action launcher |
| **Pivot Panel** | 6.7 KB | Aggregate/pivot UI with multi-select |
| **Notebook** | 9.6 KB | JS + SQL + Markdown cells, drag reorder, stale warnings |
| **Debug Panel** | 5.0 KB | Unified Network/Console/Storage/DOM inspector |
| **Build Config** | 5.0 KB | Module selector with size estimates |
| **App Shell** | 29.7 KB | Tab navigation, file management, onboarding, theme |
| **Panel System** | 9.3 KB | Draggable floating panel (bookmarklet mode) |
| **DOM Scraper** | 5.6 KB | Extract tables/data from any page |
| **Network Interceptor** | 4.5 KB | Capture XHR/fetch responses |
| **Storage Viewer** | 2.3 KB | Browse localStorage/sessionStorage |
| **Console Capture** | 2.0 KB | Intercept console.log output |

**Total: 26 modules, ~200 KB, zero dependencies.**

## SQL

Full analytical SQL against in-memory DataFrames:

```sql
-- JOINs
SELECT a.name, b.department
FROM employees AS a
INNER JOIN departments AS b ON a.dept_id = b.id
WHERE a.salary > 50000

-- Window functions
SELECT name, salary,
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dept_rank,
  SUM(salary) OVER (PARTITION BY department) AS dept_total
FROM employees

-- 61 built-in functions
SELECT UPPER(name), YEAR(hire_date), ROUND(salary * 1.1, 2),
  COALESCE(phone, email, 'N/A') AS contact
FROM employees
WHERE LENGTH(name) > 5 AND DATEDIFF(hire_date, TODAY()) > 365
```

**Supported:** SELECT, FROM, JOIN (INNER/LEFT/RIGHT/CROSS), WHERE, GROUP BY, ORDER BY, LIMIT, aliases, *, COUNT/SUM/AVG/MIN/MAX, ROW_NUMBER, RANK, LAG, LEAD, LIKE, AND/OR.

**Functions:** UPPER, LOWER, TRIM, LTRIM, RTRIM, LENGTH, SUBSTR, REPLACE, CONCAT, LEFT, RIGHT, INSTR, REVERSE, REPEAT, LPAD, RPAD, YEAR, MONTH, DAY, HOUR, MINUTE, SECOND, DATE, DATEDIFF, DATEADD, NOW, TODAY, ABS, ROUND, CEIL, FLOOR, SQRT, POWER, MOD, LOG, COALESCE, IFNULL, NULLIF, IIF, TYPEOF, CAST_INT, CAST_FLOAT.

## Deployment

### Standalone HTML (recommended)
Open `dist/wdk.html` in any browser. Everything is inlined — no server, no network.

### Bookmarklet
Paste contents of `dist/wdk-bookmarklet.txt` as a bookmark URL. Click it on any page to inject WDK as a floating panel.

### SharePoint (government/enterprise)
- **SP 2019 / SPO:** Deploy as SPFx web part (`.sppkg` carries across air gap)
- **SP 2016 / 2013:** Upload `wdk.js` to a document library, inject via Script Editor Web Part
- **Any version:** Upload `wdk.html` to a document library and open directly

### localhost (full API access)
Serve via PowerShell HttpListener for proper HTTP origin (unlocks File System Access API, OPFS, Web Workers):
```powershell
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:8080/')
$l.Start()
# ... serve wiz.html
```

## Build

```bash
node build.js                  # full build (all modules)
node build.js --tier=minimal   # minimal bookmarklet (<100KB)
```

Outputs (full):
- `dist/wdk.js` — IIFE bundle (~200 KB)
- `dist/wdk.html` — standalone HTML with JS inlined
- `dist/wdk-bookmarklet.txt` — `javascript:` URI

Outputs (minimal):
- `dist/wdk-minimal.js` — core + REPL only (~80 KB)
- `dist/wdk-minimal.html` — standalone HTML
- `dist/wdk-minimal-bookmarklet.txt` — `javascript:` URI (<100 KB)

Build tiers are configurable via the Build Configurator tab.

## Tests

```bash
# Run all tests
for f in test/*.test.js; do node "$f"; done
```

9 test suites:
- `data-model.test.js` — DataFrame operations (34 tests)
- `export.test.js` — CSV/JSON export (16 tests)
- `parsers.test.js` — CSV/JSON parsing (23 tests)
- `pivot.test.js` — Pivot engine (16 tests)
- `sql.test.js` — SQL engine + JOINs (31 tests)
- `sql-functions.test.js` — SQL functions (61 tests)
- `window.test.js` — Window functions (18 tests)
- `transforms.test.js` — Pipeline transforms (35 tests)
- `xlsx.test.js` — XLSX parsing (32 tests)

## Architecture

```
src/
├── parsers/          CSV, JSON, ZIP, XLSX parsing
├── transforms/       DataFrame, Pipeline, SQL, Pivot, Redaction, SQL Functions
├── export/           CSV, JSON, clipboard, file download
├── ui/               Table, REPL, Notebook, Pivot Panel, Build Config, App Shell
└── inspect/          DOM Scraper, Network Interceptor, Storage Viewer, Console Capture
```

Zero dependencies. Zero build tools required (build.js is vanilla Node). Every module is a standalone JS file that works in browser or Node. The build script concatenates them into an IIFE.

## Keyboard Shortcuts

| Key | Action |
|---|---|
| Ctrl+P | Command palette (fuzzy search all actions) |
| Ctrl+I | Import file |
| Ctrl+E | Export as CSV |
| Ctrl+L | Clear data |
| F1 | Help panel |
| Shift+Enter | Multiline in REPL / run cell in Notebook |
| Click header | Sort column (asc → desc → none) |
| Click row | Select row (Shift+click for range) |

## Roadmap

- **Sprint C** — PowerShell SFTP transfer engine (SSH.NET, PII gate, audit logging)
- **Sprint E** — SharePoint REST integration (lists as tables, document libraries as folders)

## License

Private — [itscooleric](https://github.com/itscooleric)
