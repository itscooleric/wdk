# WDK Automator Guide

Record, import, replay, and export web automation scripts — from the WDK panel.

> Diagram: `docs/diagrams/recorder-replay-flow.txt`

## What it does

The Automator tab in the WDK bottom panel lets you:

- **Record** a flow on the current page (clicks, typing, navigation) into a list of actions.
- **Import** a Chrome DevTools Recorder JSON export and replay it in WDK.
- **Replay** any action list in the current tab — synthetic events, selector waits, scroll-into-view, error reporting per step.
- **Export** to Playwright (.spec.js), Selenium (.py), Cypress (.cy.js), or raw JSON.
- **Save / Load** scripts to a per-browser library (localStorage).

Why both lanes? In environments **with** DevTools you record there (it's better, and it works across navigations); in environments **without** DevTools the WDK bookmarklet's recorder/replay is your fallback.

## Tutorial — capture and replay a single-page form

1. Open the page you want to automate.
2. Open WDK (full bundle or bookmarklet).
3. Click the **Automator** tab in the bottom panel.
4. Click **● Record**. Interact normally — fill fields, click buttons. The action list fills in real time.
5. Click **■ Stop recording**. The list now shows your steps.
6. Click **▶ Replay**. WDK plays the captured actions back in the same tab. Each step highlights as it runs; failures show in the status bar.

That's the whole loop. Edit the value column inline, reorder/delete steps with the arrows, and **Save** to keep the script around in this browser.

## Tutorial — DevTools Recorder → WDK

When you have a flow recorded in Chrome DevTools and need to run it elsewhere (or just a leaner replayer than DevTools provides):

1. In Chrome DevTools, open **Recorder**, run your flow, then **Export → JSON file**.
2. In WDK Automator, click **Import Recorder JSON** and pick the file.
3. WDK shows the converted action list (DevTools selectors → WDK CSS selectors; multi-selector arrays collapsed; xpath/pierce skipped).
4. **▶ Replay** to run it.

Skipped steps (xpath, pierce, unsupported types) are reported in the import status. Selectors are picked in this order: plain CSS > `aria/...` > `text/...`. The `text/...` form is rendered to a `::wdk-text("foo")` sentinel that the replay engine resolves by walking textContent.

## Reference — action shape

Each action is a flat object. The replay engine handles these types:

| action            | required fields                               | notes                            |
|-------------------|-----------------------------------------------|----------------------------------|
| `navigate`        | `url`                                         | Same-origin SPA; cross-origin reloads abort the loop. |
| `click`           | `selector`                                    | Optional `offsetX/offsetY`.      |
| `doubleClick`     | `selector`                                    |                                  |
| `type`            | `selector`, `value`                           | Sets value via prototype setter so React/Vue trackers fire. |
| `select`          | `selector`, `value`                           | Sets `<select>.value`.           |
| `press`           | `key`                                         | Keyboard event on activeElement. |
| `scroll`          | `x`, `y`                                      | Optional `selector` for element scroll. |
| `hover`           | `selector`                                    | Mouseover + enter + move.        |
| `wait`            | `selector`, `operator`, `count`, `timeout`    | Operator: `==` / `>=` / `>` etc. |
| `waitForExpression` | `expression`, `timeout`                     | `new Function('return ' + expr)` |
| `custom`          | `name`, `parameters`                          | Routes to `customHandlers[name]` |
| `viewport` / `noop` |                                             | Recorded metadata, no-op.        |

## Reference — `window.DK.automator`

```js
window.DK.automator.importRecorder(jsonOrFileOrString)        // -> Promise<{title, actions, skipped}>
window.DK.automator.replay(actions, opts)                     // -> { promise, stop() }
window.DK.automator.resolveOne(selector, root?)               // CSS or ::wdk-text(...) sentinel
window.DK.automator.waitForSelector(selector, opts)           // -> Promise<element>
window.DK.automator.waitForExpression(expr, timeoutMs)        // -> Promise<true>
```

`replay()` opts:

- `stepDelay` ms between steps (default 100)
- `timeout` per-step wait timeout (default 5000)
- `continueOnError` — keep going after a failed step (default false)
- `customHandlers` — `{ name: fn(parameters) }` for `action: 'custom'`
- `onStep(i, action, element)` / `onError(i, action, err)` / `onDone(results)`

The returned `{ stop }` aborts mid-flight.

## How it differs from Playwright / Cypress

WDK Automator runs **inside the page**, with no Node process and no driver. That means:

- No cross-origin navigation (the page reloads and the replay loop dies). Use DevTools Recorder for multi-page flows.
- No browser API features (network throttling, viewport emulation, real keyboard events).
- No CDP — selectors must work in the live DOM.

In return: zero install, runs in any restricted browser, and the action format exports cleanly to Playwright/Selenium/Cypress for the engineer who *can* run drivers.

## Limits

- Single-page only (multi-page = DevTools Recorder).
- Selectors are resolved at replay time, not record time — UI changes between record and replay can break things; be conservative with class names.
- `text/...` matching uses `textContent` exact-trim; localized strings or whitespace differences will miss.
- Replay does not pierce shadow DOM. Closed shadow roots are invisible.

## Troubleshooting

| Symptom                                       | Likely cause / fix                                  |
|----------------------------------------------|------------------------------------------------------|
| Action list empty after recording             | Page rebound `addEventListener`; record from a tab where the listeners are attached. |
| Replay stops at step N with "wait timeout"   | Selector picked at record time no longer matches; edit the selector inline. |
| Click fires but the page doesn't react        | Site listens on `pointerdown`/`touchstart` only; we send mousedown/up/click. File a ticket with the site URL. |
| `type` value is set but framework state stale | Site uses unusual binding; for React forms WDK's prototype-setter fix usually works — confirm devtools show the updated input. |
| Cross-origin nav during replay                | Use DevTools Recorder for multi-page; or split your flow into per-page bookmarklets. |
