# DataKit

Tiered browser-based data engineering toolkit for restricted environments. Sanitize, transform, and inspect data without transferring applications.

## Stack
- Pure JavaScript, zero external dependencies
- 3 deployment tiers: bookmarklet (<100KB), single HTML file, localhost server
- Synthwave 84 dark theme

## Build
```bash
node build.js    # outputs dist/datakit.js, dist/datakit-bookmarklet.txt, dist/datakit.html
```

## Architecture
```
src/parsers/     — CSV, JSON, TSV parsers
src/transforms/  — DataTable model, pipeline (undo/redo), redaction
src/export/      — CSV/JSON export, clipboard, download
src/ui/          — Panel, table renderer, file import, REPL
src/util/        — Type detection, column profiling
```

## Tiers
- **Tier 1 (Bookmarklet):** Inject into any page. Paste `javascript:` URI from dist/datakit-bookmarklet.txt
- **Tier 2 (Static HTML):** Open dist/datakit.html locally. XLSX support planned.
- **Tier 3 (Localhost):** Serve with any HTTP server. DuckDB-WASM, Parquet planned.
