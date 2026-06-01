# WDK Network Replay Guide

Capture, filter, and re-fire any browser request — turn an auth'd XHR into a one-line bookmarklet.

> Diagram: `docs/diagrams/network-replay-flow.txt`

## What it does

The Network tab in the WDK Debug panel intercepts every XHR and fetch the page makes, captures the full request + response (headers, body, initiator stack), and lets you:

- **Copy as bookmarklet** — emit a `javascript:void(fetch(...))` one-liner that re-fires the request with cookies/auth and auto-downloads the response. Paste in your bookmarks bar; click it next time you're logged in.
- **Copy as fetch()** — the same call as a `fetch()` JS snippet for pasting into a script. Credentials stripped.
- **Copy as curl** — a curl command with `-X`, `-H` headers, `--data`, `--compressed`. Credentials stripped.
- **Re-run** — fire the request again right now from the WDK page.
- **Edit & Re-run** — tweak URL / method / headers / body and fire it; see the response inline.

## Tutorial — make an auth'd-fetch bookmarklet

You're on a reporting site that gates everything behind login. You hate clicking through the menus to download Q4 sales every week. The site's "download report" button fires a JSON or CSV fetch under the hood.

1. Open the report site, log in normally.
2. Open WDK (full bundle or bookmarklet) and switch to the **Debug → Network** tab.
3. Click the actual download button. WDK captures the resulting fetch in the table.
4. Filter to **JSON** (or **Has body**) to find the data-bearing call quickly. The **URL contains…** field narrows further (e.g. `/api/q4`).
5. Click the row to expand. You'll see request headers, request body, response preview, and an **initiator** stack telling you which JS function fired the request.
6. Click **Copy as bookmarklet**. Paste into your bookmarks bar; name it "Q4 Report".
7. Next week: log in, click the bookmark. Browser auto-downloads `q4-sales.json`.

That bookmarklet uses `credentials: 'include'`, so as long as you're logged in, the cookies travel and the request succeeds.

## Tutorial — Edit & Re-run

The captured request hits `/api/reports/42/q4-sales`. You also want Q3 from the same endpoint.

1. Find the row, click **Edit & Re-run**.
2. Change `42` to `41` (or whatever the Q3 ID is) in the URL field.
3. Add or remove headers (one `Key: Value` per line).
4. Edit the body if applicable.
5. Click **Run with edits**. Status, timing, and a preview of the response body appear inline.
6. Once it works, copy that variation as a separate bookmarklet (export needs an extra capture; just re-run with the new URL and copy from the new captured row).

## Reference — what's captured

Each entry in the network log:

```js
{
  type:            'xhr' | 'fetch',
  url, method, status, contentType,
  size,            // response body length (chars)
  timing,          // ms
  duration,        // alias of timing
  requestHeaders:  { ... },
  requestBody:     '...',          // best-effort string for FormData/Blob/ArrayBuffer
  responseHeaders: { ... },
  responseBody:    '...',
  parsedJSON:      { ... } | undefined,
  timestamp:       ISO,
  initiator:       [{ fn, file, line, col }, ... ],   // top 8 frames
  initiatorRaw:    'Error stack as captured...'
}
```

## Reference — `window.WDK.requestReplay`

```js
WDK.requestReplay.toBookmarklet(entry, opts?)        // 'javascript:void(...)' string
WDK.requestReplay.toFetchSnippet(entry, opts?)       // pretty-printed fetch()
WDK.requestReplay.toCurl(entry, opts?)               // curl 'url' -X ... -H ... --data ... --compressed
WDK.requestReplay.reRun(entry, edits?)               // -> Promise<{status, body, headers, parsedJSON, timing, contentType}>
WDK.requestReplay.applyEdits(entry, edits)           // pure: returns merged entry
WDK.requestReplay.safeHeaders(entry)                 // headers with cookie/auth/csrf stripped
```

`edits` shape:

```js
{
  url:            string,
  method:         string,
  requestHeaders: { ... },
  replaceHeaders: boolean,    // false = patch, true = replace
  requestBody:    string,
}
```

The bookmarklet emit uses `credentials: 'include'` and infers a download filename from the URL last segment + content-type extension. The fetch and curl emits **strip** cookie / authorization / x-csrf-token / x-xsrf-token / host / content-length / accept-encoding / connection / origin / referer headers — copy-paste targets that you don't want carrying credentials.

## Limits

- The interceptor only sees XHR + fetch — not WebSocket, EventSource, or static asset loads.
- Maximum 500 entries kept (FIFO eviction). Increase by editing `MAX_ENTRIES` in `src/inspect/network-interceptor.js` if needed.
- Captured request body is best-effort: FormData and Blob get a stringified marker, not the actual bytes.
- The bookmarklet's auto-download only works for response bodies the browser can put in a Blob — typical reports work; streamed ETag-paginated APIs may not.

## Troubleshooting

| Symptom                                  | Likely cause / fix                                       |
|------------------------------------------|----------------------------------------------------------|
| Bookmarklet fails on next visit          | Session expired; log in again first.                     |
| Bookmarklet fails with CORS              | Original site requires same-origin; you must be on the site's domain to run it. |
| Initiator shows only a generic frame     | Source maps not loaded; the JS minifier hid the function. We capture the raw stack — open the file at the listed line. |
| Response body is empty                   | Site uses streaming with no body cloning; intercept caught only the headers. |
| Re-run hits 401                          | Cookies expired between capture and re-run.              |
