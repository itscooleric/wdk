# SharePoint Integration Guide

WDK has built-in SharePoint integration for reading lists, exporting data, uploading files, and browsing document libraries — all from the browser, using your existing SharePoint session. No admin rights needed for most operations.

## Supported platforms

| Platform | Authentication | List read | List export | List import | Doc libraries | File upload |
|----------|---------------|-----------|-------------|-------------|--------------|-------------|
| SharePoint Online (SPO) | Session cookie / SPFx | Yes | Yes | Yes | Yes | Yes |
| SharePoint 2019 | Session cookie | Yes | Yes | Yes | Yes | Yes |
| SharePoint 2016 (FP2) | Session cookie | Yes | Yes | Yes | Yes | Yes |
| SharePoint 2013 | Session cookie | Yes | Yes | Limited | Yes | Yes |

---

## Connecting WDK to SharePoint

WDK connects to SharePoint using your existing browser session — no passwords, no API keys. You must be logged into SharePoint in the same browser before connecting.

### From the WDK app shell (standalone HTML)

1. Open `wdk.html` in your browser.
2. Click the **SharePoint tab**.
3. Enter your site URL in the **Site URL** field:
   ```
   https://your-org.sharepoint.com/sites/MySite
   ```
4. Click **Test Connection**. WDK verifies the connection by fetching your current user information.
5. If successful, you'll see your display name and email. You're ready to use the SharePoint features.

### When running as a bookmarklet (on a SharePoint page)

If you activate WDK via the bookmarklet while on a SharePoint page, it auto-detects the site URL from `_spPageContextInfo` and the `data-sp-pagecontext` attribute. The Site URL field is pre-filled. Click **Test Connection** to confirm.

### When running as an SPFx web part

WDK automatically detects the SPFx context and uses the provided `SPHttpClient`. No manual URL entry is needed.

---

## Browsing and exporting SharePoint lists

### Browse lists

1. In the SharePoint tab, after connecting, click **Lists**.
2. WDK fetches all lists on the site and shows them in a table: list name, item count, last modified.
3. Click a list name to view its schema (columns, types).

### Load a list into WDK

1. Browse to a list.
2. Click **Load into WDK**.
3. WDK pages through all items (handling the SharePoint 5,000-item threshold automatically) and loads the data as a DataFrame.
4. Switch to the SQL tab to query the data.

#### The 5,000-item limit

SharePoint enforces a 5,000-item threshold on list queries. WDK handles this automatically using paginated `$skiptoken` requests — you don't need to configure anything. For very large lists (100,000+ items), expect the load to take 30–60 seconds.

### Export a list to CSV or JSON

1. Browse to a list.
2. Click **Export → Download CSV** or **Export → Download JSON**.
3. WDK fetches all items in pages and streams them into a downloaded file.

You can filter the export with OData `$filter` syntax before downloading:

```
status eq 'Active' and year(Created) ge 2024
```

---

## Importing data into a SharePoint list

You can push CSV data from WDK into an existing SharePoint list.

### Steps

1. Load your CSV into WDK (drag-drop in the Data tab).
2. In the SharePoint tab, go to **Import**.
3. Select the target list from the dropdown.
4. WDK shows a column mapping UI: map your CSV columns to SharePoint list fields.
5. Choose the write mode:
   - **Sequential** — one item per request (safe, slower, works on all versions)
   - **Batch** — multiple items per request (faster, requires SP 2019 or SPO)
6. Click **Import**.

WDK shows a progress counter. Errors (e.g., field validation failures) are shown inline.

### Column mapping notes

- WDK auto-maps columns by name (case-insensitive).
- SharePoint internal field names differ from display names. If auto-mapping fails, check the list schema (browse the list first) and map manually.
- Lookup fields, Person fields, and Managed Metadata fields require the internal ID or key — plain text values will fail. Use the **Sequential** mode and consult the list schema for accepted values.
- Calculated fields and read-only fields (like `ID`, `Created`, `Modified`) are skipped automatically.

---

## Browsing document libraries

1. In the SharePoint tab, click **Documents**.
2. WDK lists all document libraries on the site.
3. Click a library to browse its folder structure.
4. Navigate into folders by clicking them.
5. Click a file to see its metadata (name, size, modified date, author, content type).
6. Click **Download** to download a file to your local machine.

---

## Uploading files to SharePoint

1. In the SharePoint tab, go to **Upload**.
2. Select a target library and folder path.
3. Drag a file onto the upload zone or click to browse.
4. Click **Upload**.

### Large file uploads

Files over 250 MB use SharePoint's chunked upload API automatically. The progress bar updates per chunk. Do not close the browser tab during a chunked upload.

### Special characters in filenames

SharePoint rejects filenames with `# % & * : < > ? / \ { | } ~`. WDK sanitizes the filename automatically and shows you the adjusted name before uploading.

---

## Version compatibility reference

WDK auto-detects your SharePoint version and adjusts API calls accordingly. You can check the detected version in the SharePoint tab status bar.

| Feature | SP 2013 | SP 2016 FP2 | SP 2019 | SPO |
|---------|---------|-------------|---------|-----|
| List read (REST) | Yes | Yes | Yes | Yes |
| List export (paginated) | Yes | Yes | Yes | Yes |
| List import (sequential) | Yes | Yes | Yes | Yes |
| List import (batch) | No | No | Yes | Yes |
| Document library browse | Yes | Yes | Yes | Yes |
| Chunked upload (>250 MB) | No | Yes | Yes | Yes |
| OData v4 (`odata=nometadata`) | No | No | Yes | Yes |

---

## Authentication details

WDK uses SharePoint's REST API with **form digest authentication** — the same mechanism the SharePoint page itself uses for write operations.

- **Read operations (GET):** No special auth token required. Your session cookie handles it.
- **Write operations (POST, PUT, DELETE):** WDK fetches a form digest from `/_api/contextinfo` and includes it in the `X-RequestDigest` header. Digests are cached and auto-refreshed before expiry.
- **403 errors:** WDK automatically clears the cached digest and retries once. If it fails again, check that your account has write access to the target list or library.
- **Throttling:** WDK uses exponential backoff when SharePoint returns `429 Too Many Requests`. Large exports will pause and resume automatically.

No credentials are stored or transmitted outside of your browser session.

---

## Deploying WDK to SharePoint (for team use)

See the [Deployment Guide](deployment-guide.md) for full details. Quick summary:

| Scenario | Method |
|----------|--------|
| Classic SharePoint page (SP 2013/2016/2019) | Upload `wdk.js` to Site Assets, add Script Editor Web Part |
| Modern SharePoint page (SP 2019 / SPO) | Build as SPFx web part, deploy `.sppkg` to App Catalog |
| Air-gapped SP environment | Build `.sppkg` offline, carry across air gap, deploy to App Catalog |
| On-prem farm admin | Deploy `wdk.aspx` to `_layouts/15/wdk/` as farm solution |
| Anyone on your site | Upload `wdk.html` to a document library, share the link |

---

## Troubleshooting

**"Failed to get digest: HTTP 403"**
You are not logged into SharePoint, your session has expired, or you do not have access to the site. Log in first, then reconnect.

**"HTTP 401 Unauthorized"**
WDK does not support username/password authentication. It relies on your browser session. If your organization uses ADFS, SAML, or Kerberos, open SharePoint in the same browser and sign in there first.

**"List item threshold exceeded" or "500 error on large lists"**
SharePoint enforces a 5,000-item query limit unless you use an indexed column for filtering. WDK paginates using `$skiptoken`, which should bypass this limit. If you still see errors, the list's indexed column may be missing — ask your SharePoint admin to add an index on a common filter column (e.g., `ID` or `Created`).

**Column values import as null**
The CSV column name may not match the SharePoint field's internal name. Browse the list first to see the schema, then re-map the column manually.

**Export stops mid-way**
SharePoint may have throttled the connection. WDK retries automatically, but very large exports on slow SharePoint instances may time out. Try exporting with a `$filter` to reduce the result set.
