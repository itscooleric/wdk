# Getting Started with WDK

WDK (Wizard's Data Engineering Kit) is a zero-dependency, browser-based data engineering workbench that runs from a single HTML file. It parses CSV, JSON, XLSX, and ZIP files, runs SQL queries against in-memory data, and exports results — all without installing anything or touching a network. It works on air-gapped government networks, locked-down enterprise laptops, and Chromebooks.

## Install

You have three deployment options. Pick one.

### Option A: Standalone HTML (recommended)

1. Copy `dist/wdk.html` to your machine (USB, email, SharePoint — whatever your environment allows).
2. Double-click the file. It opens in your default browser. Done.

### Option B: Bookmarklet

1. Open `dist/wdk-bookmarklet.txt` and copy the entire contents.
2. In your browser, create a new bookmark.
3. Paste the copied text as the bookmark URL.
4. Navigate to any web page, then click the bookmark. WDK appears as a floating panel on top of the page.

### Option C: Localhost server

Serve `dist/wdk.html` from a local HTTP server. This unlocks advanced APIs (File System Access, OPFS, Web Workers).

PowerShell example:
```powershell
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add('http://localhost:8080/')
$l.Start()
while ($l.IsListening) {
  $c = $l.GetContext()
  $bytes = [IO.File]::ReadAllBytes('dist\wdk.html')
  $c.Response.ContentType = 'text/html'
  $c.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $c.Response.Close()
}
```

Python example:
```bash
python3 -m http.server 8080 --directory dist
```

Then open `http://localhost:8080/wdk.html`.

## Task 1: Import a CSV, query it, export results

### Step 1: Import a CSV file

1. Open WDK (standalone HTML or bookmarklet).
2. You see a drag-and-drop zone in the center of the screen.
3. Drag a `.csv` file onto the drop zone. Or click the zone to open a file picker.
4. WDK auto-detects the format and parses the file. The data appears in a table.

If you don't have a CSV handy, paste this into a text file and save it as `employees.csv`:

```csv
name,department,salary,hire_date
Alice,Engineering,95000,2021-03-15
Bob,Marketing,72000,2020-06-01
Carol,Engineering,105000,2019-11-20
Dave,Marketing,68000,2022-01-10
Eve,Engineering,88000,2023-05-01
```

### Step 2: View the data

The table view shows:
- Column headers (click a header to sort ascending, click again for descending, third click to clear sort).
- Row numbers on the left.
- Click a row to select it. Shift+click for range selection.

### Step 3: Run a SQL query

1. Click the **REPL** tab at the bottom of the screen.
2. Type a SQL query and press **Enter** (or **Shift+Enter** for multi-line):

```sql
SELECT department, COUNT(*) AS headcount, ROUND(AVG(salary), 0) AS avg_salary
FROM data
GROUP BY department
ORDER BY avg_salary DESC
```

3. The results appear as a new table. WDK names your imported data `data` by default.

Try another query:

```sql
SELECT name, salary,
  RANK() OVER (ORDER BY salary DESC) AS salary_rank
FROM data
WHERE department = 'Engineering'
```

### Step 4: Export results

1. With query results displayed, press **Ctrl+E** to export as CSV.
2. A file download starts automatically.

Alternatively:
- Click a result table and press **Ctrl+C** to copy as TSV (paste into Excel).
- Use the export menu for JSON or XLSX output.

## Task 2: Inspect a web page

This task requires the bookmarklet deployment. You must be on a live web page.

### Step 1: Activate WDK on a page

1. Navigate to any web page with data (a table, API calls, etc.).
2. Click your WDK bookmarklet. The floating panel appears.

### Step 2: Use the Explore tab

1. Click the **Explore** tab in the WDK panel.
2. You see sections for:
   - **Globals** — JavaScript variables the page has set on `window` (filtered to exclude standard browser globals).
   - **DOM Summary** — document structure, number of elements, forms, links.
   - **Performance** — page load timing.
   - **Event Listeners** — registered event handlers.

### Step 3: Scrape a table

1. Click the **DOM** tab.
2. Click **Select Table**. Your cursor changes to a crosshair.
3. Click any `<table>` element on the page. WDK highlights it.
4. The table data is extracted into a DataFrame. You can now query it with SQL or export it.

### Step 4: Capture network traffic

1. Click the **Network** tab.
2. Click **Start Capture**.
3. Interact with the page (click buttons, scroll, trigger API calls).
4. WDK logs all XHR and fetch requests with method, URL, status, and response size.
5. Click any entry to inspect the response body.

You now have the fundamentals. See the how-to guides for specific tasks and the reference docs for complete module and SQL documentation.
