---
marp: true
theme: default
paginate: true
title: Chrome / Edge launch flags for WDK workflows
author: vendor
---

# Chrome / Edge launch flags for WDK workflows

What you can configure at browser-launch time to make WDK + DevTools Recorder iteration faster. Tested against Chrome 142+ and Edge 138+ on Windows + macOS. Cross-ref `(internal-tracker)` (Lane C.3 spike).

---

## The high-leverage flags

| Flag | What it does | Office use case |
|------|--------------|-----------------|
| `--auto-open-devtools-for-tabs` | DevTools opens on every new tab. | "Recorder available without F12" — paste a `.bat` and skip the manual step. |
| `--app=URL` | Chromeless single-URL window (no address bar, no tabs, no menus). | Replace a webapp icon — looks like a native app, no browser chrome to confuse users. |
| `--user-data-dir=PATH` | Isolated Chrome profile in `PATH`. Doesn't touch your main profile. | Run two Chromes side-by-side. Per-site profiles for SSO scenarios. |
| `--remote-debugging-port=N` | CDP open on `localhost:N`. | Drive Chrome from a script (`curl http://localhost:N/json/version`). Required if you want to attach Puppeteer/Playwright to an already-running browser. |
| `--disable-features=A,B,C` | Toggle Chromium feature flags off. | Disable problematic features (`IsolateOrigins,site-per-process` for legacy iframe scripting that breaks under same-origin policy). |
| `--enable-features=A,B,C` | Toggle on experimental features. | Test new APIs early. |
| `--no-first-run` | Skip the welcome wizard. | First-launch automation in fresh profiles. |
| `--no-default-browser-check` | Skip "set as default" prompt. | Same. |
| `--start-maximized` | Open fullscreen. | Consistent layout for Recorder captures. |
| `--window-size=W,H` | Specific viewport at launch. | Match the production resolution operators see. |

---

## Enterprise policy caveats

Many of these are silently blocked by enterprise Chrome policy. Check before scripting against them:

1. Open `chrome://policy/` on the target machine.
2. Search for any policy that mentions the flag family:
   - `URLAllowlist` / `URLBlocklist` → may block `--app=URL`
   - `ExtensionInstallForcelist` → unrelated, but tells you policy is active
   - `IncognitoModeAvailability` → may interact with `--user-data-dir`
   - `RemoteDebuggingAllowed` (Chrome 128+) → must be set to `1` for `--remote-debugging-port` to work

Recently (Chrome 136+, June 2025), `--remote-debugging-port` and `--remote-debugging-pipe` were locked off unless `--user-data-dir` points to a *non-default* profile or the `RemoteDebuggingAllowed` policy is explicitly enabled. So for office BI sites: always pair `--remote-debugging-port` with a custom `--user-data-dir`.

Widely permitted under default policy: `--auto-open-devtools-for-tabs`, `--app=`, `--start-maximized`, `--window-size`, `--no-first-run`, `--no-default-browser-check`.

Widely blocked / require policy whitelist: `--user-data-dir` to arbitrary paths, `--enable-features` for non-default values, `--disable-web-security`, `--allow-running-insecure-content`.

---

## `.bat` launcher patterns

### Daily "open BI tool with Recorder ready"

```bat
@echo off
REM Office launcher — open the BI tool with DevTools auto-open + Recorder ready.
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
"%CHROME%" ^
  --auto-open-devtools-for-tabs ^
  --start-maximized ^
  --user-data-dir="%USERPROFILE%\wdk-chrome-profile" ^
  --no-first-run ^
  --no-default-browser-check ^
  "https://data.bls.gov/dataQuery/search"
```

Drop the `.bat` on the desktop — one click and you're in Recorder-ready mode. The isolated `--user-data-dir` profile means you can log in once, get cookies, never affect your main browsing.

### Multi-site report flow

```bat
@echo off
set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
"%CHROME%" ^
  --auto-open-devtools-for-tabs ^
  --start-maximized ^
  --user-data-dir="%USERPROFILE%\wdk-chrome-profile" ^
  --no-first-run ^
  --no-default-browser-check ^
  "https://reports.example.com/q4" ^
  "https://reports.example.com/finance" ^
  "https://reports.example.com/ops"
```

Three tabs at once. Operator clicks through each Recorder export sequentially. Pair with the WDK launcher (`launcher/wdk-launcher.bat`) for the watcher half.

### App-style window for a single BI tool

```bat
"%CHROME%" --app="https://reports.example.com/q4" --user-data-dir="%USERPROFILE%\wdk-q4-profile"
```

Looks like a native app to the operator. No tabs, no URL bar. Useful for single-purpose data-entry tools.

### Driving Chrome from Puppeteer / Playwright

```bat
"%CHROME%" --remote-debugging-port=9222 --user-data-dir="%USERPROFILE%\wdk-debug-profile"
```

Then attach from a Node script:
```js
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.connect({
  browserURL: 'http://localhost:9222',
  defaultViewport: null,
});
```

Useful when you want to inspect the same browser session your operator is logged into.

---

## Edge equivalents

Edge takes most of the same flags. Replace the binary path:

```bat
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
"%EDGE%" --auto-open-devtools-for-tabs --start-maximized "https://..."
```

Two Edge-only adds worth knowing:

- `--inprivate` — Edge's incognito flag. Per-tab cookies clear on close. Useful for one-shot scrapes without polluting profiles.
- `--edge-collections` — surface the Collections feature. Not WDK-relevant but operators may want to bookmark report variations.

Edge's enterprise policies live at `edge://policy/`.

---

## Reference

- Chrome's complete flag list: `chrome://flags` (in-browser, no offline copy)
- Chromium switch source-of-truth: [chromeenum.com/](https://chromeenum.com/) (third-party but accurate)
- Official Chrome policy reference: <https://chromeenterprise.google/policies/>
- Edge policy: <https://learn.microsoft.com/en-us/deployedge/microsoft-edge-policies>
- `chrome://policy/` (in-browser) — shows what's actually enforced on the current machine

---

## Tested combinations

These exact `.bat` flag combinations have been tested in a clean Chrome 142 (no enterprise policy) profile:

| Combination | Result |
|---|---|
| `--auto-open-devtools-for-tabs --start-maximized` | ✅ DevTools opens automatically, fullscreen, panel ready |
| `--app=URL --user-data-dir=PATH --no-first-run` | ✅ Chromeless app window in an isolated profile |
| `--remote-debugging-port=9222 --user-data-dir=PATH` | ✅ CDP listening on 9222, Puppeteer attaches OK |
| `--auto-open-devtools-for-tabs URL1 URL2 URL3` | ✅ Three tabs open, DevTools on each |
| `--app=URL --auto-open-devtools-for-tabs` | ⚠️ App mode hides the DevTools toggle by default; F12 still works |

Under typical enterprise policy:

| Flag | Expected status |
|---|---|
| `--auto-open-devtools-for-tabs` | ✅ Usually allowed |
| `--app=URL` | ✅ Usually allowed |
| `--start-maximized` | ✅ Allowed (window manager respects) |
| `--no-first-run` | ✅ Allowed |
| `--user-data-dir=<arbitrary path>` | ⚠️ Often blocked or redirected; fallback profile used |
| `--remote-debugging-port=N` | ❌ Often blocked since Chrome 136 unless `RemoteDebuggingAllowed=1` policy is set AND non-default user-data-dir is used |
| `--disable-features=...` / `--enable-features=...` | ❌ Often blocked for non-default values |

---

Drafter: vendor, 2026-05-29. Closes `(internal-tracker)` (Lane C.3 spike).
