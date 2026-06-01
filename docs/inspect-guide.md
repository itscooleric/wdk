# DOM Scraper and Network Interceptor Guide

The Inspect modules let you extract data from web pages you can't export from directly — dashboards, internal admin panels, intranets, government portals. They work exclusively in **bookmarklet mode**: WDK is injected into the target page, giving it access to the page's DOM, network traffic, and browser storage.

## Prerequisites

You need the WDK bookmarklet installed in your browser. This is a one-time setup.

### Install the bookmarklet

1. Open `dist/wdk-bookmarklet.txt` in a text editor (or run `node build.js` to regenerate it).
2. Copy the entire contents — it starts with `javascript:`.
3. In your browser, create a new bookmark:
   - **Chrome/Edge:** Right-click the bookmarks bar → "Add page" → paste the `javascript:` URI as the URL.
   - **Firefox:** Bookmarks menu → "Manage Bookmarks" → New Bookmark → paste as Location.
4. Name the bookmark "WDK" or "DataKit".

### Activate WDK on a page

Navigate to any page. Click the WDK bookmark. A floating panel appears in the bottom-right corner with drag handle, resize grip, and the WDK tab interface.

The inspect tools appear in the **Inspect tab** of the floating panel.

---

## Debug Panel

The **Debug Panel** is a unified interface that consolidates the inspect modules into a single bottom-tab UI with four sub-tabs:

| Sub-tab | Description |
|---------|-------------|
| **Network** | Live request log — captures XHR and Fetch requests in real time |
| **Console** | Captured `console.log`/`warn`/`error`/`info` output from the host page |
| **Storage** | Cookie, localStorage, and sessionStorage viewer |
| **DOM** | Table scraper — click-to-select or CSS-selector extraction |

The Debug Panel (`src/ui/debug-panel.js`) provides a tabbed wrapper around the individual inspect modules described below. Instead of navigating to separate sections, you can switch between Network, Console, Storage, and DOM views in one place. Each sub-tab exposes the same functionality as the standalone module sections documented below.

---

## DOM Scraper

The DOM Scraper extracts data from HTML `<table>` elements on the host page into a WDK DataFrame.

### When to use it

- A web application shows data in a table but has no export button.
- A report renders as HTML in a browser but can't be copied cleanly.
- You need to cross-reference data from a web page with a CSV from another system.

### How to use: click-to-select mode

1. Activate WDK on the target page.
2. Go to the **Inspect tab** → **DOM Scraper** section.
3. Click **Start Scraper**.
4. Hover over the page. Tables highlight in blue as you move over them.
5. Click a highlighted table to extract it.
6. The data loads into WDK's Data tab as a DataFrame.

Once extracted, you can run SQL against it, export it as CSV, or join it with other loaded files.

### How to use: CSS selector mode

If the table is hard to click (e.g., it's behind a modal or inside an iframe's parent), use the selector input:

1. Open browser DevTools (`F12`), inspect the table element, and copy its CSS selector or ID.
2. In the Inspect tab, type the selector into the **Selector** input box.
3. Click **Extract by Selector**.

Examples:

```css
/* By ID */
#report-table

/* By class */
.data-grid table

/* nth table on the page */
table:nth-of-type(2)

/* By ARIA label */
table[aria-label="Results"]
```

### What gets extracted

- Column headers come from `<th>` cells in the first row. If no `<th>` cells exist, the first `<td>` row is used as headers.
- All subsequent `<tr>` rows become data rows.
- Cell text content is extracted (HTML tags stripped).
- If no headers are detected, columns are named `Column 1`, `Column 2`, etc.

### Limitations

- Only extracts `<table>` elements — not CSS grid layouts, `<div>`-based tables, or canvas-rendered grids.
- Does not handle paginated tables automatically. Scroll to load more data first, then scrape.
- Cross-origin iframes cannot be scraped (browser security boundary).

---

## Network Interceptor

The Network Interceptor captures all XHR and Fetch requests made by the host page after you activate it. This is useful when a page loads data via API calls — you can capture the JSON response and load it directly into WDK.

### When to use it

- A dashboard loads data via an API but doesn't expose a download button.
- You can see data on screen but it comes from a JSON endpoint you want to query.
- You want to understand what APIs a page is calling.

### How to activate

1. Inject WDK via the bookmarklet.
2. Go to the **Inspect tab** → **Network** section.
3. Click **Start Intercepting**.
4. Interact with the page — click buttons, change filters, scroll to trigger data loads.
5. Captured requests appear in the log.

### What gets captured

Each captured request includes:

| Field | Description |
|-------|-------------|
| `type` | `xhr` or `fetch` |
| `method` | HTTP method (`GET`, `POST`, etc.) |
| `url` | Full request URL |
| `status` | HTTP response status code |
| `contentType` | Response Content-Type header |
| `size` | Response body size in bytes |
| `timing` | Round-trip time in milliseconds |
| `responseBody` | Raw response body text |
| `parsedJSON` | Parsed JSON object (if Content-Type is JSON) |
| `timestamp` | ISO timestamp of when the response was received |

### Using captured data

When a captured response contains JSON array data, click **Load** next to the entry to load it into WDK's DataFrame. WDK's JSON parser flattens nested objects into columns.

Alternatively, from the REPL:

```javascript
// Access all captured network entries
var log = WDK.startIntercepting().getLog();

// Find JSON responses
var jsonResponses = log.filter(e => e.parsedJSON && Array.isArray(e.parsedJSON));
console.log('JSON responses:', jsonResponses.length);

// Inspect the first one
console.log(JSON.stringify(jsonResponses[0].parsedJSON, null, 2));
```

### Stop intercepting

Click **Stop** in the Network section. This restores the original `XMLHttpRequest` and `fetch` implementations. Any requests made before you clicked Start are not in the log.

### Limitations

- Captures requests made **after** you start intercepting. Reload the page after clicking Start if you want to capture initial page load requests (you'll need to click the bookmarklet again after reload).
- Cannot capture requests made in Web Workers or Service Workers.
- Response bodies larger than a few MB are captured but may be slow to display.
- The log holds the last 500 entries (oldest are dropped when full).

---

## Storage Viewer

The Storage Viewer reads browser storage associated with the current page. Access it in the **Inspect tab** → **Storage** section.

It shows:

| Storage type | What it contains |
|--------------|-----------------|
| `localStorage` | Persistent key-value storage for the domain |
| `sessionStorage` | Session-scoped key-value storage |
| Cookies | All cookies accessible to the page |

Each storage type is presented as a two-column DataFrame (key / value) that you can load into WDK and run SQL against.

### Use cases

- Find session tokens or API keys stored in localStorage (for debugging your own applications).
- Extract preferences or cached data your app stores client-side.
- Audit what cookies a site is setting.

---

## Console Capture

The Console Capture intercepts `console.log`, `console.warn`, `console.error`, and `console.info` calls from the host page. Access it in the **Inspect tab** → **Console** section.

Click **Start Capture**, then interact with the page. Any console output the page produces (not just your own scripts) is captured and shown as a queryable log.

Useful for:

- Reading debug output from web applications that log internal state.
- Capturing error messages you want to export or analyze.

---

## Putting it all together: a complete scraping workflow

**Scenario:** You need data from an intranet report that shows a 200-row table but only lets you print the page.

1. Navigate to the report in your browser.
2. Click the **WDK bookmarklet**.
3. In the Inspect tab, click **Start Scraper**.
4. Hover over the table — it highlights blue.
5. Click to extract. WDK loads the 200 rows.
6. Switch to the **SQL tab** and run:
   ```sql
   SELECT department, SUM(budget) AS total_budget
   FROM data
   GROUP BY department
   ORDER BY total_budget DESC
   ```
7. Click **Export → Download CSV** to save the results.

**Scenario:** A dashboard loads data via an API.

1. Navigate to the dashboard.
2. Click the **WDK bookmarklet**.
3. Go to Inspect → Network → **Start Intercepting**.
4. Change a filter on the dashboard to trigger a data reload.
5. Find the response in the captured log (look for large JSON responses).
6. Click **Load** to bring it into WDK.
7. Query and export as needed.
