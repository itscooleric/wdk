# Architecture

## Tier system

WDK deploys in three tiers, each adding capabilities:

### Tier 1: Bookmarklet (<100KB)

A `javascript:` URI pasted as a bookmark. Click it on any page to inject WDK as a floating panel.

**Includes:** CSV parser, DataFrame, Export, Type Detection, Table, File Import, REPL, App Shell, Panel System (9 modules).

**Use case:** Quick data inspection on any page. Scrape tables, capture network traffic, run ad-hoc queries. No file access — works within the host page's security context.

**Constraints:** URL length limits vary by browser (~2MB in Chrome, ~65KB in older IE). The minimal build targets <100KB to stay safe. No XLSX, no SQL, no inspect tools in this tier.

### Tier 2: Static HTML (recommended)

A single `.html` file with all JavaScript inlined. Open from `file://` or any document library. No server required.

**Includes:** All 41 modules. Full SQL, XLSX read/write, PII scanner, SharePoint integration, inspect tools, notebook, command palette.

**Use case:** The primary deployment. Copy the file to a USB drive, email it, upload it to SharePoint. Works on air-gapped networks, locked-down laptops, Chromebooks. No install, no admin rights, no network.

**Constraints:** `file://` origin limits some browser APIs (no Service Workers, no OPFS). Drag-and-drop file import works everywhere. The File System Access API is unavailable on `file://`.

### Tier 3: Localhost

Serve `wdk.html` from a local HTTP server. Any HTTP server works — Python, PowerShell, Node, IIS.

**Includes:** Everything in Tier 2, plus access to APIs that require an HTTP origin: File System Access API, OPFS (Origin Private File System), Web Workers, Service Workers.

**Use case:** Power users who need persistent storage, background processing, or direct file system access. Future: DuckDB-WASM and Parquet support planned for this tier.

## Zero-dependency constraint

WDK has zero external dependencies. No npm, no bundlers, no CDN, no polyfills. Every module is a standalone JavaScript file that works in a browser or Node.js.

**Why:**
- **Air-gapped environments.** Government networks, classified systems, hospital IT — you cannot pull packages from the internet.
- **No install privilege.** Chromebook students, enterprise laptops, kiosk terminals — you cannot run `npm install`.
- **Auditability.** A single self-contained file is inspectable. Security reviewers can read every line. No supply-chain attack surface.
- **Longevity.** No dependency rot. WDK will work in a browser 10 years from now because it depends on nothing that can break.

**Practical implications:**
- The XLSX parser implements its own ZIP reader (using the browser's `DecompressionStream` API) and XML parser. No JSZip, no xlsx.js.
- The XLSX writer builds ZIP archives byte-by-byte with CRC32 checksums. No compression library.
- The SQL engine is a hand-written recursive-descent parser. No Chevrotain, no PEG.js.
- All code uses `var` declarations and ES5-compatible patterns for maximum browser compatibility. No transpiler needed.

## Build system

The build script is `build.js` — a single vanilla Node.js file with no dependencies.

### What it does

1. Reads source files from `src/` in dependency order (defined as an array in `build.js`).
2. Strips `module.exports` and `require()` statements (modules are concatenated, not bundled).
3. Wraps everything in an IIFE to avoid global namespace pollution.
4. Outputs:
   - `dist/wdk.js` — readable IIFE (~200KB for full build).
   - `dist/wdk.html` — standalone HTML with the JS inlined in a `<script>` tag.
   - `dist/wdk-bookmarklet.txt` — `javascript:` URI (URL-encoded).

### Build tiers

```bash
node build.js                # Full build (all 41 modules, ~200KB)
node build.js --tier=minimal # Minimal bookmarklet build (9 modules, <100KB)
```

### Dependency order

Modules are concatenated in a fixed order defined in `build.js`. The order matters because later modules reference functions defined in earlier ones:

```
parsers → transforms → export → util → ui → scanner → sharepoint → inspect
```

Within each category, dependencies are respected. For example, `sql.js` comes after `sql-functions.js` because the SQL engine calls `evalSQLFunction`.

### No tree shaking, no minification

The build system is intentionally simple. It concatenates files. There is no dead code elimination, no minification, no source maps. This keeps the build auditable — the output is human-readable and matches the source.

## How modules are loaded

### In the browser (built bundle)

All modules are concatenated into a single IIFE. Functions defined in one module are visible to all subsequent modules because they share the same function scope.

```javascript
(function() {
  // src/parsers/csv.js
  function parseCSV(text) { ... }

  // src/transforms/sql.js (can see parseCSV)
  function execSQL(sql, tables) { ... }

  // src/ui/app-shell.js (can see everything above)
  function initShell() { ... }
})();
```

### In Node.js (testing)

Each module file uses `module.exports` at the bottom for Node.js `require()`. The build script strips these lines during concatenation. Tests run individual modules via `require('./src/transforms/sql.js')`.

### Module registration

UI modules self-register with the app shell. The App Shell detects which modules are present and enables/disables tabs accordingly. For example, if the SQL engine is not included (minimal tier), the SQL tab does not appear.

## Synthwave 84 theme

WDK uses a Synthwave 84 dark color scheme throughout:

| Token | Hex | Usage |
|-------|-----|-------|
| Background | `#0a0a1a` | Page background |
| Background light | `#12122a` | Header, elevated surfaces |
| Panel background | `#0d0d20` | Panel bodies |
| Cyan | `#00e5ff` | Primary accent, links, highlights |
| Pink | `#ff2975` | Secondary accent, errors, destructive actions |
| Purple | `#b967ff` | Tertiary accent, icons, tags |
| Yellow | `#f5e642` | Warnings, attention |
| Text | `#e0e0f0` | Primary text |
| Text dim | `#8888aa` | Secondary text |
| Border | `#2a2a4a` | Default borders |

The theme is defined as a constant object (`DK_SHELL_THEME`) in `app-shell.js` and referenced by all UI modules. There is no theme engine or CSS variables — colors are inlined in JavaScript-generated styles for maximum compatibility with `file://` deployment.

The wordmark uses a CSS gradient from cyan through purple to pink:
```css
background: linear-gradient(90deg, #00e5ff 0%, #b967ff 60%, #ff2975 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
```

Font stack: SF Mono, Fira Code, Cascadia Code, Consolas, monospace.
