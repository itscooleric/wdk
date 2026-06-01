# How to Inspect a Page

WDK's inspect tools are a mini DevTools for environments where real DevTools are unavailable (kiosk mode, managed Chromebooks, locked-down terminals). They require the bookmarklet deployment — you must inject WDK into a live page.

## Network tab: intercepting XHR/fetch

WDK monkey-patches `XMLHttpRequest` and `fetch` to capture all network requests.

1. Click the **Network** tab in WDK.
2. Click **Start Capture** to begin intercepting.
3. Interact with the page normally. Every XHR and fetch request is logged.
4. Each entry shows: method, URL, status code, response size, and timestamp.
5. Click an entry to view the full response body (JSON responses are pretty-printed).
6. The log holds up to 500 entries (oldest are evicted).

### Tips
- Start capture **before** triggering the action you want to observe.
- Click **Clear** to reset the log without stopping capture.
- Click **Stop** to restore the original XHR/fetch implementations.
- JSON responses are automatically detected by Content-Type header and parsed for display.

### Import captured data
Network log entries can be exported as a DataFrame. Click **Import to Table** to load the request log as queryable data:

```sql
SELECT method, url, status, size
FROM network_log
WHERE status >= 400
ORDER BY size DESC
```

## Console tab: capturing logs

WDK intercepts `console.log`, `console.warn`, `console.error`, and `console.info`.

1. Click the **Console** tab.
2. Click **Start Capture**.
3. All console output from the page is captured with:
   - Log level (log, warn, error, info)
   - Timestamp
   - Stringified arguments (objects are JSON-serialized, Errors show stack traces)
4. Original console output still goes to the browser console — WDK captures a copy.

### Filtering
Filter captured logs by level. Error and warn messages are highlighted.

## Storage tab: cookies, localStorage, sessionStorage

1. Click the **Storage** tab.
2. Three sections appear:
   - **Cookies** — parsed from `document.cookie` into key-value pairs.
   - **localStorage** — all entries enumerated.
   - **sessionStorage** — all entries enumerated.
3. Each section displays as a two-column table (key, value).
4. Click **Import to Table** on any section to load it as a DataFrame for querying.

### Notes
- Storage access may be blocked in cross-origin iframes (SecurityError). WDK handles this gracefully.
- Cookie values are shown as-is (URL-encoded). WDK does not decode them.

## DOM tab: scraping tables

See [How to Import Data](import-data.md) for the full DOM scraping workflow. Summary:

1. Click **Select Table** in the DOM tab.
2. Hover to highlight tables, click to extract.
3. WDK converts HTML `<table>` elements into DataFrames.
4. The CSS selector for the extracted table is shown for reference.

## Explore tab: page analysis

The Explore tab gives a read-only snapshot of the page's runtime state. It is implemented by the Page Explorer module.

### Globals
Lists all non-standard JavaScript variables on `window`. WDK filters out the ~200 standard browser globals and shows only application-specific ones. For each global:
- Name
- Type (`function`, `object`, `string`, `number`, etc.)
- Value preview (truncated for large objects)

This reveals: app configuration, feature flags, user session data, API endpoints, framework instances.

### DOM Summary
- Total element count
- Document title and URL
- Number of forms, links, images, scripts, stylesheets
- Meta tag contents

### Performance
- Page load timing (navigationStart, domContentLoaded, loadEvent)
- Resource count and total transfer size
- Memory usage (if available via `performance.memory`)

### Event Listeners
- Enumerates event listeners registered on key elements.
- Shows event type, target element, and whether the listener uses capture.

## Using inspect data for analysis

All inspect data can be imported into WDK's DataFrame system. A typical workflow:

1. Capture network traffic while using the page.
2. Import the network log as a table.
3. Query it with SQL to find patterns:

```sql
SELECT url, COUNT(*) AS calls, AVG(size) AS avg_size
FROM network_log
GROUP BY url
ORDER BY calls DESC
LIMIT 20
```

4. Combine with storage data:

```sql
SELECT s.key, s.value
FROM storage AS s
WHERE s.key LIKE '%token%' OR s.key LIKE '%session%'
```

5. Export findings as CSV or JSON.
