# Module Reference

41 modules organized by category. All modules are zero-dependency, standalone JavaScript files.

## Parsers

| Module | File | Description |
|--------|------|-------------|
| CSV Parser | `src/parsers/csv.js` | RFC 4180 compliant CSV/TSV parser. Streaming for >100MB files. BOM handling, auto-delimiter detection. |
| JSON Parser | `src/parsers/json.js` | Nested object flattening with dot notation. Trailing comma recovery. Error recovery for malformed input. |
| XLSX Parser | `src/parsers/xlsx.js` | Excel OOXML SpreadsheetML reader. Shared strings, multi-sheet, date serial numbers, cell format handling. |
| ZIP Parser | `src/parsers/zip.js` | Zero-dependency zip reader using browser DecompressionStream API. Extracts and routes files to appropriate parsers. |

## Transforms

| Module | File | Description |
|--------|------|-------------|
| DataFrame | `src/transforms/data-model.js` | Core data model. Column/row operations, filter, sort, dedupe, toObjects. Headers + rows array structure. |
| Pipeline | `src/transforms/pipeline.js` | Undo/redo transform history. 50-state maximum. Chainable operations with state snapshots. |
| SQL Engine | `src/transforms/sql.js` | SQL SELECT parser and executor against DataFrames. Supports JOINs, GROUP BY, ORDER BY, LIMIT, UNPIVOT, FILL_DOWN, window functions. |
| SQL Functions | `src/transforms/sql-functions.js` | 61+ built-in SQL functions: string (17), date (10), math (8), type/null (6), conditional (1), advanced string (3). |
| Pivot Engine | `src/transforms/pivot.js` | groupBy, aggregate, and pivot operations. 9 aggregation functions: count, sum, avg, min, max, first, last, countDistinct, list. |
| Redaction | `src/transforms/redact.js` | Column-level data masking: blank, replace, mask (partial), hash (djb2). For sanitizing sensitive data before export. |
| PII Scanner | `src/transforms/pii-scanner.js` | Two-pass PII detection. Fast regex gate then validation (Luhn for credit cards, format check for SSNs). Pattern definitions in `pii-patterns.json`. |

## Export

| Module | File | Description |
|--------|------|-------------|
| Export | `src/export/export.js` | CSV and JSON export. Clipboard copy as TSV. File download via Blob URL. Configurable delimiters and formatting. |
| XLSX Writer | `src/export/xlsx-writer.js` | Zero-dependency XLSX generator. Builds OOXML ZIP archives with shared strings, styles, CRC32 checksums. STORE compression. |

## UI

| Module | File | Description |
|--------|------|-------------|
| App Shell | `src/ui/app-shell.js` | Full-page application shell. Tab navigation, file management, onboarding flow, Synthwave 84 theme, menu system. Detects bookmarklet vs standalone mode. |
| Table Renderer | `src/ui/table.js` | Virtual-scrolling table for 1M+ rows. Column sort (asc/desc/none), row selection, Shift+click range, TSV copy, null display. |
| REPL | `src/ui/repl.js` | Chrome DevTools-style console. Command history (up/down arrows), JSON tree expansion, multi-line input (Shift+Enter). Executes JS and SQL. |
| Notebook | `src/ui/notebook.js` | Multi-cell notebook with JS, SQL, and Markdown cell types. Drag-reorder cells. Stale detection (warns when upstream cells change). |
| File Import | `src/ui/file-import.js` | Drag-and-drop zone with auto format detection. Supports CSV, JSON, XLSX, TSV, ZIP. File picker fallback. Paste support. |
| Pivot Panel | `src/ui/pivot-panel.js` | Interactive pivot table controls. Select groupBy columns, aggregation functions, and pivot columns. |
| Command Palette | `src/ui/command-palette.js` | Ctrl+P fuzzy-search action launcher. Subsequence matching algorithm. Keyboard navigation (up/down/enter). |
| Build Config | `src/ui/build-config.js` | Interactive module selector. Size estimates per module. Tier calculator (minimal vs full). Generates custom build configurations. |
| Debug Panel | `src/ui/debug-panel.js` | Unified debug tab integrating Network, Console, Storage, and DOM inspector views. |
| Panel System | `src/ui/panel.js` | Draggable, resizable floating panel for bookmarklet injection mode. Handles positioning, z-index, minimize/close. |
| Help / Settings | (in `app-shell.js`) | F1 help modal. localStorage-backed user preferences. Theme toggle. |

## Inspect

| Module | File | Description |
|--------|------|-------------|
| DOM Scraper | `src/inspect/dom-scraper.js` | Click-to-select HTML table extraction. Highlights tables on hover. Converts `<table>` elements to DataFrames. Generates CSS selectors. |
| Network Interceptor | `src/inspect/network-interceptor.js` | Monkey-patches XMLHttpRequest and fetch. Captures method, URL, status, response body, size, timing. 500-entry rolling log. |
| Storage Viewer | `src/inspect/storage-viewer.js` | Reads cookies (`document.cookie`), localStorage, and sessionStorage. Outputs as key-value DataFrames. Handles SecurityError gracefully. |
| Console Capture | `src/inspect/console-capture.js` | Intercepts console.log/warn/error/info. Stringifies arguments (JSON for objects, stack traces for Errors). Forwards to original console. |
| Page Explorer | `src/inspect/page-explorer.js` | Mini DevTools: enumerates non-standard window globals, DOM structure summary, performance timing, event listeners, meta tags. |

## Scanner

| Module | File | Description |
|--------|------|-------------|
| Preflight Scanner | `src/scanner/preflight-scanner.js` | File sanitization checks: base64 blobs, embedded script tags, binary byte sequences, formula injection (`=`, `+`, `-`, `@`), Shannon entropy analysis, PII gate. Generates a pass/fail manifest. |

## SharePoint

| Module | File | Description |
|--------|------|-------------|
| SP Auth | `src/sharepoint/sp-auth.js` | Digest-based authentication via `_api/contextinfo`. `spFetch` wrapper for authenticated requests. |
| SP Compat | `src/sharepoint/sp-compat.js` | SharePoint version detection (2013/2016/2019/SPO). Feature matrix per version. |
| SP Errors | `src/sharepoint/sp-errors.js` | Error response parsing. Exponential backoff for throttled requests (429). Digest refresh on 403. |
| SP List Browser | `src/sharepoint/sp-list-browser.js` | Enumerate lists and libraries. View item count and schema. 5,000-item threshold handling with indexed column filtering. |
| SP List Export | `src/sharepoint/sp-list-export.js` | Paginated list export. OData `$select`, `$filter`, `$orderby` support. Handles large lists via `$skiptoken`. |
| SP List Import | `src/sharepoint/sp-list-import.js` | CSV to SharePoint list. Column mapping UI. Entity type resolution. Batch POST with digest auth. |
| SP Doc Browser | `src/sharepoint/sp-doc-browser.js` | Document library navigation. Folder tree traversal. File preview and download. |
| SP File Upload | `src/sharepoint/sp-file-upload.js` | Chunked upload (10MB chunks). Large file support up to 250MB threshold. Special character handling in filenames. |
| SP SPFx | `src/sharepoint/sp-spfx.js` | SPFx web part manifest generation. Component packaging guide for .sppkg deployment. |
| SP ASPX | `src/sharepoint/sp-aspx.js` | Application page template for SP 2013+ farm deployments via `_layouts` path. |

## Utility

| Module | File | Description |
|--------|------|-------------|
| Type Detection | `src/util/detect-types.js` | Auto-detect column types by sampling values. Recognizes: date (15 patterns), boolean, numeric, null/empty. Used by import and SQL. |
| Audit Log | `src/util/audit-log.js` | Append-only JSON Lines audit trail. NIST 800-53 AU family alignment. SHA-256 fingerprinting (FNV-1a fallback). Tracks imports, exports, queries, transforms, redactions. 10,000-entry max. |
