# WDK Architecture

> Diagram: `docs/diagrams/wdk-system-overview.txt`

## The four lanes

WDK is one toolkit organized as four mostly-independent lanes. You can use any lane on its own; the launcher (Lane D) is what stitches them into a workflow.

| Lane | What it does | When to use it |
|------|--------------|----------------|
| **A — Automator**  | Record / replay clicks, types, navigations on a single page. Imports Chrome DevTools Recorder JSON. Exports to Playwright / Selenium / Cypress. | Sites without a clean API — the data is only behind a UI flow, and the only way through is to click. |
| **B — Network Replay** | Capture every XHR / fetch with full request + response + initiator stack. Emit auth'd one-line bookmarklets that re-fire the request with credentials and auto-download. | Sites that **do** have an API — you want to skip the UI clicks and call the underlying endpoint directly. **The high-leverage path.** |
| **C — Transfer Pipeline** | SFTP (Python or PowerShell + OpenSSH), SharePoint network drive, web portal upload. | Moving the captured data from the local outbox to wherever it actually needs to go. |
| **D — Launcher** | `sites.json` config + multi-tab Chrome opener + per-site checklist + folder watcher → fires the transfer pipeline. | Daily / weekly recurring data pulls across several sites. |

## Module layout

```
wdk/
├── src/
│   ├── automator/          # Lane A engine
│   │   ├── recorder-import.js   DevTools Recorder JSON adapter
│   │   └── replay.js            in-page replay (synthetic events, waits)
│   ├── inspect/            # Lane B foundation
│   │   ├── network-interceptor.js  XHR + fetch capture (req/resp + initiator)
│   │   └── request-replay.js       toBookmarklet / toFetch / toCurl / reRun
│   ├── ui/
│   │   ├── automator-panel.js  Lane A UI tab in WDK panel
│   │   ├── debug-panel.js      Lane B Network tab + filter chips + per-row actions
│   │   ├── robo.js             record() + export-to-Playwright/Selenium/Cypress
│   │   └── ...                 other panels (REPL, Pivot, Notebook, Build, Debug)
│   └── ...
├── ps/                     # Lane C (Windows path)
│   ├── wiz-transfer.ps1        OpenSSH SFTP wrapper
│   ├── wiz-bridge.ps1          local HTTP bridge for cross-tier wiring
│   └── ...
├── launcher/               # Lane D
│   ├── wdk-launcher.bat        Windows entrypoint
│   ├── wdk-launcher.py         Python entrypoint + folder watcher
│   ├── sites.example.json      annotated config
│   └── sites.schema.json       JSON Schema
├── docs/
│   ├── automator-guide.md
│   ├── network-replay-guide.md
│   ├── launcher-guide.md
│   ├── architecture.md (this file)
│   └── diagrams/*.txt          ASCII diagrams
└── dist/                       built bundles (full / robo / inspect / data tiers)
```

## How the lanes interact

The lanes are decoupled — Lane A doesn't know about Lane C. The launcher (D) is the only piece that wires them.

A typical daily flow:

1. **Launcher (D)** opens Chrome to N sites and prints a checklist.
2. For each site, the operator either:
   - clicks a **Lane B bookmarklet** (auth'd fetch → auto-download), or
   - runs a **DevTools Recorder JSON** in DevTools (multi-page flows), or
   - opens **WDK Automator (A)** and replays a saved single-page flow.
3. Files land in `outbox/` from the browser's default downloads dir.
4. **Launcher's folder watcher** detects new files and fires `transfer.after_drop`.
5. **Lane C** (SFTP / SharePoint / portal) ships the files.

## Key invariants

- **Restricted environments first.** Every lane works in a browser without admin rights, without npm, without Docker. The Python pieces are stdlib-only.
- **No driver, no daemon.** WDK runs in the page. There is no Selenium WebDriver, no Puppeteer, no CDP. The Automator's replay engine is a synthetic-event dispatcher.
- **Credentials never leave the browser.** Lane B bookmarklets use `credentials: 'include'`; the cookies travel with the request, but the bookmarklet itself contains no auth tokens. Copy-as-fetch and copy-as-curl strip the auth headers explicitly so shared snippets don't leak.
- **Air-gap-friendly.** The full bundle (`dist/wdk.html`) is a single self-contained file. Bookmarklet tier is < 100KB after terser. Vendor libs are checked in (fflate / fzstd / snappyjs / hyparquet) — no CDN, no install.

## Build tiers

`build.js` produces several bundles. The right one depends on what the user can paste / load:

| Tier     | Modules                                            | Approx size | When to use |
|----------|----------------------------------------------------|-------------|-------------|
| `minimal`| Core shell only.                                   | ~20KB       | Quick smoke tests. |
| `inspect`| + Network interceptor + DOM scraper + Var discovery + Page explorer | ~71KB       | Lane B only.       |
| `data`   | inspect + parsers + table + REPL + file import     | ~85KB       | EDA without Robo.  |
| `robo`   | inspect + Robo + Automator (recorder import + replay) | ~110KB   | Lane A.            |
| `field`  | data + Robo + Automator + Classification           | ~125KB      | Standard field bundle. |
| `full`   | everything                                         | ~550KB      | Standalone HTML deployment. |

`node build.js --tier=field` builds a specific tier. Default is `full`.

## Naming

The recorder/replay component used to be called **Robo** internally. The user-facing name is **Automator** — same code path, less robotic-process-automation baggage. The internal `window.DK.robo` namespace stays stable for backward compat; new APIs land at `window.DK.automator.*`.
