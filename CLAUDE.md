# WDK — Wizard's Data Engineering Kit

Tiered browser-based data engineering toolkit for restricted environments. Sanitize, transform, and inspect data without transferring applications.

## Stack
- Pure JavaScript, zero external dependencies
- 3 deployment tiers: bookmarklet (<100KB), single HTML file, localhost server
- Synthwave 84 dark theme

## Build
```bash
node build.js    # outputs dist/wdk.js, dist/wdk-bookmarklet.txt, dist/wdk.html
```

## Architecture
```
src/parsers/     — CSV, JSON, TSV, XLSX (zero-dep ZIP + XML) parsers
src/transforms/  — DataFrame model, pipeline (undo/redo), redaction
src/export/      — CSV/JSON export, clipboard, download
src/ui/          — Panel, table renderer, file import, REPL, app shell
src/util/        — Type detection, column profiling
src/inspect/     — DOM scraper, network interceptor, storage viewer, console capture
```

## Tiers
- **Tier 1 (Bookmarklet):** Inject into any page. Paste `javascript:` URI from dist/wdk-bookmarklet.txt
- **Tier 2 (Static HTML):** Open dist/wdk.html locally. Full WDK app shell with XLSX support.
- **Tier 3 (Localhost):** Serve with any HTTP server. DuckDB-WASM, Parquet planned.

## Standalone
- `/workspace/datakit-standalone/index.html` — single-file version (55KB), works with file:// on air-gapped machines
