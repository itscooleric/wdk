# WDK Launcher Guide

Open N restricted-environment sites in Chrome, drop downloads in an outbox, fire the transfer pipeline.

> Diagram: `docs/diagrams/launcher-flow.txt`

## What it does

`launcher/wdk-launcher.bat` (Windows) and `launcher/wdk-launcher.py` (cross-platform, Python 3.8+) read a `sites.json` config, open every configured site in Chrome, print a per-site checklist (which DevTools Recorder JSON to run, which bookmarklet to paste), and optionally start a folder-watcher that fires `transfer.after_drop` whenever a new file lands in the outbox.

No external dependencies. Stdlib only on the Python side; PowerShell + cmd built-ins on the .bat side.

## Tutorial — first run

```cmd
cd launcher
copy sites.example.json sites.json
notepad sites.json                        :: edit URLs, scripts, transfer block
wdk-launcher.bat                          :: opens Chrome to all sites + prints checklist
```

For each site in the printed checklist, the launcher tells you exactly what to do:

```
  [1] Quarterly Reports      method=bookmarklet
      url:  https://reports.example.com/q4
      step: Paste the bookmarklet from scripts/q4-fetch.txt into the
            address bar and run it. The response will download to your
            default downloads folder.
      drop: move/save to ./outbox/q4-sales.csv
```

Then once you've collected the files in `outbox/`, fire the watcher:

```cmd
wdk-launcher.bat --watch
```

The watcher polls `outbox/` and runs `transfer.after_drop` on every new file. On Linux/macOS use the Python form:

```bash
python3 wdk-launcher.py --config sites.json --watch
```

## Reference — `sites.json` schema

JSON Schema at `launcher/sites.schema.json`. Annotated example:

```json
{
  "version": "1",
  "outbox": "./outbox",
  "transfer": {
    "method": "sftp",                                   // sftp | sharepoint | portal | manual
    "destination": "user@host:/inbox",
    "key": "./keys/wiz_transfer_key",
    "after_drop": "powershell -File ./ps/wiz-transfer.ps1 -OutboxDir ./outbox"
  },
  "sites": [
    {
      "name": "Quarterly Reports",
      "url": "https://reports.example.com/q4",
      "description": "Pull Q4 sales report via auth'd fetch bookmarklet",
      "method": "bookmarklet",                          // see methods table below
      "bookmarklet_file": "scripts/q4-fetch.txt",
      "filename_hint": "q4-sales.csv"
    }
  ]
}
```

### Site `method` values

| method               | What the launcher tells the user                                          | Where the data lands |
|----------------------|---------------------------------------------------------------------------|----------------------|
| `bookmarklet`        | Paste contents of `bookmarklet_file` into the address bar.                | Default downloads.   |
| `wdk-bookmarklet`    | Paste the WDK loader bookmarklet; use Network/Automator tab in the panel. | Wherever WDK saves it. |
| `devtools-recorder`  | Open DevTools → Recorder → Import `recorder_file` → Replay.                | Default downloads.   |
| `manual`             | "See the site description" — for ad-hoc steps.                            | Operator's choice.   |

### `transfer.method` values

`sftp` — SFTP push (PowerShell wraps OpenSSH `sftp.exe` for credential handling, or use Python's `paramiko` if installed). `sharepoint` — copy via mounted network drive or REST. `portal` — drag-drop blob upload to a web portal (research spike pending). `manual` — operator handles transfer themselves.

## Reference — CLI flags

```
wdk-launcher.bat [--config <path>] [--watch] [--no-open]
wdk-launcher.py  [--config <path>] [--watch] [--no-open] [--poll <seconds>]
```

| flag         | default       | meaning                                          |
|--------------|---------------|--------------------------------------------------|
| `--config`   | `sites.json`  | Path to your config file.                        |
| `--watch`    | off           | Start the outbox folder watcher.                 |
| `--no-open`  | off           | Skip opening Chrome — useful with `--watch`.     |
| `--poll`     | `2.0`         | (Python only) Watcher poll interval in seconds.  |

Set `CHROME_PATH` env var to override Chrome detection.

## How the watcher fires the transfer

The watcher polls the outbox directory at `--poll` seconds, tracks `(filename, mtime)`, and on any new or changed file fires `transfer.after_drop` via `subprocess.call(after_drop, shell=True, cwd=outbox.parent)`. Exit code is logged but not enforced — the watcher keeps running. Stop with Ctrl+C.

The `after_drop` command is responsible for handling all files in the outbox; the watcher passes no arguments. Typical PowerShell variant:

```powershell
# ps/wiz-transfer.ps1 — sketch
Get-ChildItem $OutboxDir -File | ForEach-Object {
    sftp.exe -i $KeyFile -b transfer.cmd $User@$Host
    Move-Item $_.FullName -Destination "$OutboxDir\sent\$($_.Name)"
}
```

Existing implementation lives at `ps/wiz-transfer.ps1` (key gen, retry, SHA-256 verification).

## Limits

- The launcher does not drive the browser — it only opens tabs. The actual recording / bookmarklet execution is manual (or via DevTools Recorder + WDK Automator).
- The .bat variant requires PowerShell to parse JSON. Vista+ has it; ultra-locked-down environments may need the Python launcher instead.
- `--watch` mode requires Python 3.8+ on PATH for the .bat shell-out path.
- Cross-tab coordination (e.g., "wait for site 1 to finish before site 2") is not modeled; it's a checklist for an operator, not a workflow engine.

## Troubleshooting

| Symptom                                           | Fix                                                       |
|--------------------------------------------------|-----------------------------------------------------------|
| `[error] config not found`                        | Copy `sites.example.json` to `sites.json` and edit it.    |
| `[warn] Chrome/Edge not found in standard paths` | Set `CHROME_PATH` env var to your Chrome executable path. |
| Watcher fires repeatedly on the same file        | The site re-saves with a new mtime; route to a `sent/` subdirectory in your `after_drop` to avoid re-firing. |
| `python` not on PATH on Windows                   | Either install Python 3.8+ from python.org or run `wdk-launcher.py` directly with the full path to `python.exe`. |
