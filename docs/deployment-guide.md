# WDK Deployment Guide

## Deployment Options

WDK is designed to work in heavily restricted environments. Choose the deployment method that matches your constraints.

### Option 1: Standalone HTML File (simplest)

Open `dist/wdk.html` directly in a browser. Everything is inlined — no server, no network, no dependencies.

**Works in:** Any environment with a modern browser (Chrome, Edge, Firefox, Safari).

**Limitations:** `file://` protocol blocks some APIs (File System Access, OPFS, Web Workers with ES modules). For full functionality, use Option 3.

**Distribution:** Copy `wdk.html` to a USB drive, shared folder, or document library. 191 KB total.

### Option 2: Bookmarklet (inject into any page)

1. Copy contents of `dist/wdk-bookmarklet.txt`
2. Create a new bookmark in your browser
3. Paste the contents as the bookmark URL
4. Navigate to any page with data, click the bookmark

WDK injects as a floating panel with access to the page's DOM, network requests, and storage.

**Best for:** Extracting data from web applications (dashboards, admin panels, intranets).

### Option 3: localhost Server (full features)

Serve WDK from a local PowerShell HTTP server to unlock all browser APIs:

```powershell
# wdk-serve.ps1 — minimal localhost server
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8080/')
$listener.Start()
Write-Host "WDK running at http://localhost:8080/"
Start-Process "http://localhost:8080/wdk.html"

while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $file = $ctx.Request.Url.LocalPath.TrimStart('/')
    if (-not $file) { $file = 'wdk.html' }
    $path = Join-Path $root $file

    if (Test-Path $path) {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        $ext = [System.IO.Path]::GetExtension($path)
        $mime = switch ($ext) {
            '.html' { 'text/html' }
            '.js'   { 'application/javascript' }
            '.css'  { 'text/css' }
            '.json' { 'application/json' }
            default { 'application/octet-stream' }
        }
        $ctx.Response.ContentType = $mime
        $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    } else {
        $ctx.Response.StatusCode = 404
    }
    $ctx.Response.Close()
}
```

**Unlocks:** File System Access API, OPFS, full Web Worker support, clipboard API.

**No admin rights needed** — localhost binding is unprivileged on Windows.

### Option 4: SharePoint — Script Editor Web Part (SP 2013/2016/2019)

1. Upload `dist/wdk.js` to a SharePoint document library (e.g., `Site Assets`)
2. Edit a classic SharePoint page
3. Add a **Script Editor Web Part**
4. Paste:
   ```html
   <div id="wdk-root"></div>
   <script src="/sites/yoursite/SiteAssets/wdk.js"></script>
   ```
5. Save the page

WDK runs in the SharePoint page context with same-origin access to the REST API. No app catalog, no SPFx toolchain, no admin approval needed (if Script Editor is enabled).

**Note:** Script Editor Web Part is disabled by default on SPO modern sites. Use SPFx (Option 5) for modern pages.

### Option 5: SharePoint — SPFx Web Part (SP 2019 / SPO)

For modern SharePoint pages, deploy as an SPFx web part:

1. **Build (once, on a dev machine with Node.js):**
   - Scaffold SPFx project with "No framework" template
   - Import `wdk.js` as the web part's `render()` output
   - Run `gulp bundle --ship && gulp package-solution --ship`
   - Output: `sharepoint/solution/wdk.sppkg`

2. **Deploy (on the SharePoint environment):**
   - Upload `.sppkg` to the App Catalog
   - Add the web part to any modern page

**Air-gapped deployment:** Build the `.sppkg` on an internet-connected machine. Carry the file across the air gap. Upload to App Catalog. SPFx assets are bundled inside the `.sppkg` (set `includeClientSideAssets: true` in `package-solution.json`).

**Auth:** Automatic. SPFx provides `SPHttpClient` with session cookies. `fetch()` with `credentials: 'include'` also works for `/_api/` calls.

**Compatibility:**
| Platform | SPFx Version | Notes |
|---|---|---|
| SPO | v1.22+ | Full support, modern + classic pages |
| SP 2019 | v1.4.1 | Full support, modern + classic pages |
| SP 2016 + FP2 | v1.1 | Classic pages only |
| SP 2013 | Not supported | Use Script Editor (Option 4) |

### Option 6: SharePoint — Application Page (.aspx + C#)

For maximum control on on-premises SharePoint, deploy as a custom application page:

1. Create an `.aspx` file with C# code-behind:
   ```aspx
   <%@ Page Language="C#" MasterPageFile="~/_layouts/15/minimal.master"
     Inherits="Microsoft.SharePoint.WebPartPages.WebPartPage" %>
   <asp:Content ID="Main" ContentPlaceHolderID="PlaceHolderMain" runat="server">
     <div id="wdk-root"></div>
     <script src="/_layouts/15/wdk/wdk.js"></script>
   </asp:Content>
   ```

2. Deploy to `_layouts/15/wdk/` on the SharePoint server (farm solution or manual copy)

3. Access at `https://sharepoint/_layouts/15/wdk/wdk.aspx`

**Advantages:** Full server-side API access, no App Catalog needed, works on SP 2013+.

**Disadvantages:** Requires farm admin access to deploy to `_layouts`. Not available on SPO (cloud).

**Best for:** On-premises SP 2013/2016 environments where Script Editor is disabled and SPFx is not available.

## Choosing a Deployment Method

| Constraint | Recommended Option |
|---|---|
| No server at all | Option 1 (standalone HTML) |
| Need to scrape web pages | Option 2 (bookmarklet) |
| Want full browser API access | Option 3 (localhost) |
| SharePoint 2013, Script Editor enabled | Option 4 (SEWP) |
| SharePoint 2019 / SPO, modern pages | Option 5 (SPFx) |
| SharePoint on-prem, farm admin access | Option 6 (application page) |
| USB drive distribution | Option 1 (191 KB single file) |
| Chromebook / no PowerShell | Option 1 (standalone HTML) |
