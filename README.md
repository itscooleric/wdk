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
  │  export     csv, json, xlsx, file  │
  │  ui         table, repl, notebook  │
  │  inspect    dom, network, storage  │
  │  scanner    preflight, pii, audit  │
  │  sharepoint lists, docs, upload    │
  └────────────────────────────────────┘
       bookmarklet | standalone html
  ──────────────────────────────────────
  zero dependencies. single file. <200KB.
  works offline. works air-gapped.
```

Browser-based data engineering workbench for **restricted environments** — government networks, air-gapped systems, locked-down enterprise. No install, no build step, no dependencies, no network required. Drag a CSV onto a single HTML file and start working.

**41 modules · 14,230 lines · 344 tests · zero dependencies**

## Why

Every restricted industry converges on the same unmet need: portable data analysis that works within compliance boundaries without installation. The 100,000+ Advana users on DoD networks, 30+ million Chromebook students, and countless hospital/banking analysts working in locked-down environments all face the same gap: "I have a CSV and I need answers, but I can't install anything."

WDK fills that gap.

## Modules

### Parsers (4 modules)

| Module | Description |
|---|---|
| **CSV Parser** | RFC 4180 compliant, streaming for >100MB files, BOM handling |
| **JSON Parser** | Nested object flattening, trailing comma recovery, error recovery |
| **ZIP Parser** | Zero-dep zip reader using DecompressionStream API |
| **XLSX Parser** | Excel OOXML: shared strings, multi-sheet, date handling, cell formats |

### Transforms (7 modules)

| Module | Description |
|---|---|
| **DataFrame** | Core data model — column/row ops, filter, sort, dedupe, toObjects |
| **Pipeline** | Undo/redo transform history (50-state max), chainable operations |
| **SQL Engine** | Full SELECT/JOIN/WHERE/GROUP BY/ORDER BY/LIMIT, window functions |
| **SQL Functions** | 61 built-in functions (string, date, math, type, conditional) |
| **Pivot Engine** | groupBy, aggregate, pivot with 9 aggregation functions |
| **Redaction** | Blank, replace, mask, hash columns (djb2) for sensitive data |
| **PII Scanner** | Two-pass detection: fast regex gate + Luhn/SSN validation |

### Export (2 modules)

| Module | Description |
|---|---|
| **Export** | CSV/JSON export, clipboard copy (TSV), file download |
| **XLSX Writer** | Zero-dep XLSX generator: OOXML ZIP with shared strings, styles, CRC32 |

### UI (11 modules)

| Module | Description |
|---|---|
| **App Shell** | Tab navigation, file management, onboarding, theme toggle, menu |
| **Table Renderer** | Virtual scrolling (1M+ rows), sort, row selection, TSV copy, null display |
| **REPL** | Chrome DevTools-style console: command history, JSON tree expansion |
| **Notebook** | JS + SQL + Markdown cells, drag-reorder, stale detection |
| **File Import** | Drag-drop with auto format detection (CSV/JSON/XLSX/TSV) |
| **Pivot Panel** | Interactive groupBy/aggregate/pivot controls |
| **Command Palette** | Ctrl+P fuzzy-search action launcher with subsequence matching |
| **Build Config** | Interactive module selector with size estimates and tier calculator |
| **Debug Panel** | Network/Console/Storage/DOM inspector (unified debug tab) |
| **Panel System** | Draggable floating panel for bookmarklet injection |
| **Help / Settings** | F1 help modal, localStorage-backed preferences |

### Inspect (4 modules)

| Module | Description |
|---|---|
| **DOM Scraper** | Click-to-select HTML table extraction with CSS selector lookup |
| **Network Interceptor** | Monkeypatch XHR/fetch, capture all requests (500-entry log) |
| **Storage Viewer** | Browse cookies, localStorage, sessionStorage as DataFrames |
| **Console Capture** | Intercept console.log/warn/error/info with argument stringify |

### Scanner (1 module)

| Module | Description |
|---|---|
| **Preflight Scanner** | File sanitization: base64 blobs, script tags, binary bytes, formula injection, entropy analysis, PII gate, manifest generation |

### SharePoint (10 modules)

| Module | Description |
|---|---|
| **SP Auth** | Digest-based auth via contextinfo, spFetch wrapper |
| **SP Compat** | Version detection (2013/2016/2019/SPO) with feature matrix |
| **SP Errors** | Error parsing, exponential backoff, throttle recovery, digest refresh |
| **SP List Browser** | Enumerate lists, view item count/schema, 5000-item threshold handling |
| **SP List Export** | Paginated export with $select/$filter/$orderby OData support |
| **SP List Import** | CSV to list: column mapping, entity type resolution, batch POST |
| **SP Doc Browser** | Document library: folder navigation, file preview, download |
| **SP File Upload** | Chunked upload (10MB chunks, 250MB threshold), special char handling |
| **SP SPFx** | Web part manifest generation, component packaging guide |
| **SP ASPX** | Application page template for 2013+ farm deployments via _layouts |

### Utility (2 modules)

| Module | Description |
|---|---|
| **Type Detection** | Auto-detect column types: date (15 patterns), boolean, numeric, null |
| **Audit Log** | Append-only audit trail per NIST 800-53 AU family, SHA-256, JSON Lines |

**Total: 41 modules · 14,230 LOC · zero dependencies**

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
# ... serve wdk.html
```

## Build

```bash
node build.js                  # full build (all 41 modules)
node build.js --tier=minimal   # minimal bookmarklet (<100KB)
```

### Build tiers

| Tier | Modules | Size | Use case |
|---|---|---|---|
| **Minimal** | 9 core | <100KB | Bookmarklet injection — CSV parse, table, REPL, file import |
| **Full** | 41 all | ~200KB | Standalone app — all formats, SQL, pivot, PII, SharePoint, debug |

**Minimal tier includes:** CSV parser, DataFrame, Export, Type Detection, Table, File Import, REPL, App Shell, Panel System.

**Full tier adds:** JSON/ZIP/XLSX parsers, SQL engine + functions, Pivot, Redaction, PII scanner, XLSX writer, Audit log, Notebook, Command palette, Build config, Debug panel, Preflight scanner, all 10 SharePoint modules, all 4 Inspect modules.

Outputs:
- `dist/wdk.js` — IIFE bundle (~200 KB)
- `dist/wdk.html` — standalone HTML with JS inlined
- `dist/wdk-bookmarklet.txt` — `javascript:` URI

Minimal outputs:
- `dist/wdk-minimal.js` — core + REPL (~80 KB)
- `dist/wdk-minimal.html` — standalone HTML
- `dist/wdk-minimal-bookmarklet.txt` — `javascript:` URI (<100 KB)

## Tests

```bash
# Run all tests
for f in test/*.test.js; do node "$f"; done
```

17 test suites, **344 total tests:**

| Suite | Tests | Scope |
|---|---|---|
| `data-model.test.js` | 40 | DataFrame construction, column/row ops |
| `xlsx.test.js` | 40 | XLSX parsing, dates, formulas, multi-sheet |
| `transforms.test.js` | 39 | Pipeline, redaction, type detection |
| `sql.test.js` | 37 | SELECT, WHERE, JOINs, GROUP BY, ORDER BY |
| `xlsx-writer.test.js` | 35 | XLSX generation, shared strings, styles |
| `window.test.js` | 26 | Window function parsing and execution |
| `parsers.test.js` | 26 | CSV/JSON/XLSX parsing, error recovery, BOM |
| `pivot.test.js` | 19 | groupBy, aggregate, pivot operations |
| `export.test.js` | 18 | CSV/JSON export formatting, edge cases |
| `audit-log.test.js` | 14 | Audit trail, session IDs, NIST compliance |
| `ps-audit.test.js` | 12 | PowerShell audit integration |
| `e2e-window-functions.test.js` | 11 | E2E: ROW_NUMBER, RANK, LAG, LEAD |
| `e2e-csv-sql.test.js` | 9 | E2E: CSV parse → SQL query pipeline |
| `e2e-pii-scanner.test.js` | 9 | E2E: PII detection with false positives |
| `e2e-xlsx-roundtrip.test.js` | 9 | E2E: XLSX write → read roundtrip |
| `pii-scanner.test.js` | — | Integrated in e2e-pii-scanner |
| `sql-functions.test.js` | — | Integrated in sql.test.js |

## Architecture

```
src/
├── parsers/          CSV, JSON, ZIP, XLSX
├── transforms/       DataFrame, Pipeline, SQL, SQL Functions, Pivot, Redaction, PII Scanner
├── export/           CSV/JSON export, XLSX writer
├── ui/               Table, REPL, Notebook, Pivot Panel, Command Palette,
│                     Build Config, Debug Panel, App Shell, Panel, File Import
├── inspect/          DOM Scraper, Network Interceptor, Storage Viewer, Console Capture
├── scanner/          Preflight Scanner (base64, scripts, binary, formulas, entropy, PII)
├── sharepoint/       Auth, Compat, Errors, List Browser/Export/Import,
│                     Doc Browser, File Upload, SPFx, ASPX
└── util/             Type Detection, Audit Log
```

Zero dependencies. Zero build tools required (`build.js` is vanilla Node). Every module is a standalone JS file that works in browser or Node. The build script concatenates them into an IIFE.

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

## Docs

Detailed guides in `docs/`:
- [Getting Started](docs/getting-started.md)
- [Module Ontology](docs/module-ontology.md)
- [SQL Reference](docs/sql-reference.md)
- [REPL & Notebook](docs/repl-notebook-guide.md)
- [Inspect Tools](docs/inspect-guide.md)
- [Preflight Scanner](docs/scanner-guide.md)
- [SharePoint Integration](docs/sharepoint-guide.md)
- [Deployment Guide](docs/deployment-guide.md)

## License

Private — [itscooleric](https://github.com/itscooleric)
