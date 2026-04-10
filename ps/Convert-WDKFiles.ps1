<#
.SYNOPSIS
    WDK File Sanitization & Preflight Scanner — batch conversion and safety audit.

.DESCRIPTION
    PowerShell backend for the WDK file sanitization pipeline. Traverses a source
    directory, scans files for risky content (base64 blobs, script tags, binary bytes,
    CSV injection, high-entropy lines, etc.), converts supported formats to safe output
    types, and produces a self-contained HTML scan report with manifest and undo script.

    Designed for Windows machines without network access (PowerShell 5.1+).
    Mirrors the checks performed by the browser-side WDK scanner.

.PARAMETER InputPath
    Source directory to scan and convert.

.PARAMETER OutputPath
    Destination directory for converted files and reports. Defaults to .\converted.

.PARAMETER Include
    Glob patterns for files to include. Defaults to common text/config formats.

.PARAMETER ScanOnly
    Report findings without performing any file conversions.

.PARAMETER Force
    Overwrite existing output directory without prompting.

.PARAMETER Verbose
    Show detailed progress and diagnostic output.

.EXAMPLE
    .\Convert-WDKFiles.ps1 -InputPath C:\data\export

.EXAMPLE
    .\Convert-WDKFiles.ps1 -InputPath .\raw -OutputPath .\clean -ScanOnly

.EXAMPLE
    .\Convert-WDKFiles.ps1 -InputPath .\incoming -Force -Verbose

.NOTES
    Ticket: forge/datakit#5
    Sprint: D (File sanitization & preflight scanner)
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InputPath,

    [string]$OutputPath = ".\converted",

    [string[]]$Include = @(
        "*.txt","*.md","*.csv","*.json","*.js","*.html","*.xml",
        "*.ps1","*.py","*.sh","*.yml","*.yaml","*.ini","*.cfg",
        "*.conf","*.log","*.tsv"
    ),

    [switch]$ScanOnly,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

$RISKY_EXTENSIONS = @('.xlsm','.docm','.pptm','.hta','.vbs','.wsf','.scr','.bat','.cmd','.ps1')
$MAX_FILE_SIZE    = 10 * 1024 * 1024   # 10 MB
$BASE64_MIN_LEN   = 256
$LONG_LINE_THRESH  = 10000
$BINARY_THRESHOLD  = 0.01              # 1% non-printable
$ENTROPY_THRESHOLD = 6.0

$SCRIPT_PATTERNS = @(
    '<script'
    '<iframe'
    'javascript:'
    '\bon\w+\s*='                       # event handlers: onclick=, onerror=, etc.
)

$CSV_INJECTION_RE = '^\s*[=+\-@]'

# Synthwave theme colors
$THEME = @{
    BG      = '#0a0a1a'
    TEXT    = '#e0e0f0'
    CYAN    = '#00e5ff'
    PINK    = '#ff2975'
    PURPLE  = '#b967ff'
    SURFACE = '#14142b'
    BORDER  = '#2a2a4a'
    GREEN   = '#00ff88'
    YELLOW  = '#ffe066'
    RED     = '#ff2975'
}

# ---------------------------------------------------------------------------
# Helper: Shannon entropy of a string
# ---------------------------------------------------------------------------
function Get-ShannonEntropy {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) { return 0.0 }
    $len = $Text.Length
    $freq = @{}
    foreach ($c in $Text.ToCharArray()) {
        $key = [string]$c
        if ($freq.ContainsKey($key)) { $freq[$key]++ } else { $freq[$key] = 1 }
    }
    $entropy = 0.0
    foreach ($count in $freq.Values) {
        $p = $count / $len
        if ($p -gt 0) {
            $entropy -= $p * [Math]::Log($p, 2)
        }
    }
    return $entropy
}

# ---------------------------------------------------------------------------
# Helper: Check binary content ratio
# ---------------------------------------------------------------------------
function Get-BinaryRatio {
    param([byte[]]$Bytes, [int]$SampleSize = 8192)
    if ($Bytes.Length -eq 0) { return 0.0 }
    $check = [Math]::Min($Bytes.Length, $SampleSize)
    $nonPrintable = 0
    for ($i = 0; $i -lt $check; $i++) {
        $b = $Bytes[$i]
        # Allow tab (9), LF (10), CR (13), and printable ASCII 32-126
        if ($b -lt 32 -and $b -ne 9 -and $b -ne 10 -and $b -ne 13) { $nonPrintable++ }
        elseif ($b -gt 126) { $nonPrintable++ }
    }
    return $nonPrintable / $check
}

# ---------------------------------------------------------------------------
# Scanner: run all checks on a single file
# ---------------------------------------------------------------------------
function Invoke-FileScan {
    param(
        [string]$FilePath,
        [string]$RelativePath
    )

    $warnings = [System.Collections.ArrayList]::new()
    $fileInfo = Get-Item -LiteralPath $FilePath
    $ext = $fileInfo.Extension.ToLower()

    # --- Risky extension ---
    if ($RISKY_EXTENSIONS -contains $ext) {
        [void]$warnings.Add(@{
            Filename = $RelativePath; Line = 0; Check = 'risky-extension'
            Severity = 'high'; Detail = "Risky extension: $ext"
        })
    }

    # --- Large file ---
    if ($fileInfo.Length -gt $MAX_FILE_SIZE) {
        [void]$warnings.Add(@{
            Filename = $RelativePath; Line = 0; Check = 'large-file'
            Severity = 'medium'; Detail = "File size $([Math]::Round($fileInfo.Length / 1MB, 2)) MB exceeds 10 MB limit"
        })
    }

    # --- Binary content check (read first 8KB as bytes) ---
    $rawBytes = $null
    try {
        $stream = [System.IO.File]::OpenRead($FilePath)
        $buf = New-Object byte[] ([Math]::Min(8192, $fileInfo.Length))
        $bytesRead = $stream.Read($buf, 0, $buf.Length)
        $stream.Close()
        if ($bytesRead -gt 0) {
            $rawBytes = $buf[0..($bytesRead - 1)]
        }
    } catch {
        [void]$warnings.Add(@{
            Filename = $RelativePath; Line = 0; Check = 'unreadable'
            Severity = 'high'; Detail = "Could not read file: $_"
        })
        return $warnings
    }

    if ($rawBytes) {
        $binRatio = Get-BinaryRatio -Bytes $rawBytes
        if ($binRatio -gt $BINARY_THRESHOLD) {
            [void]$warnings.Add(@{
                Filename = $RelativePath; Line = 0; Check = 'binary-content'
                Severity = 'high'; Detail = "Binary content detected: $([Math]::Round($binRatio * 100, 1))% non-printable bytes"
            })
        }
    }

    # --- Line-level checks (text scan) ---
    $lines = $null
    try {
        $lines = [System.IO.File]::ReadAllLines($FilePath, [System.Text.Encoding]::UTF8)
    } catch {
        # Already reported as unreadable if byte read failed; skip line checks
        return $warnings
    }

    $isCsv = ($ext -eq '.csv' -or $ext -eq '.tsv')

    for ($lineNum = 0; $lineNum -lt $lines.Length; $lineNum++) {
        $line = $lines[$lineNum]
        $displayLine = $lineNum + 1

        # Long line
        if ($line.Length -gt $LONG_LINE_THRESH) {
            [void]$warnings.Add(@{
                Filename = $RelativePath; Line = $displayLine; Check = 'long-line'
                Severity = 'low'; Detail = "Line length $($line.Length) chars exceeds $LONG_LINE_THRESH"
            })
        }

        # Base64 blob
        if ($line.Length -gt $BASE64_MIN_LEN) {
            if ($line -match '[A-Za-z0-9+/=]{256,}') {
                [void]$warnings.Add(@{
                    Filename = $RelativePath; Line = $displayLine; Check = 'base64-blob'
                    Severity = 'medium'; Detail = "Potential base64 blob detected (${BASE64_MIN_LEN}+ chars)"
                })
            }
        }

        # data: URI
        if ($line -match 'data:[a-zA-Z0-9/+]+;') {
            [void]$warnings.Add(@{
                Filename = $RelativePath; Line = $displayLine; Check = 'data-uri'
                Severity = 'medium'; Detail = "data: URI detected"
            })
        }

        # Script / active content
        foreach ($pat in $SCRIPT_PATTERNS) {
            if ($line -match $pat) {
                [void]$warnings.Add(@{
                    Filename = $RelativePath; Line = $displayLine; Check = 'active-content'
                    Severity = 'high'; Detail = "Active content pattern: $pat"
                })
                break   # one hit per line is enough
            }
        }

        # CSV formula injection
        if ($isCsv -and ($line -match $CSV_INJECTION_RE)) {
            [void]$warnings.Add(@{
                Filename = $RelativePath; Line = $displayLine; Check = 'csv-injection'
                Severity = 'high'; Detail = "CSV formula injection: cell starts with $(($line.Trim())[0])"
            })
        }

        # Shannon entropy
        if ($line.Length -ge 64) {
            $ent = Get-ShannonEntropy -Text $line
            if ($ent -gt $ENTROPY_THRESHOLD) {
                [void]$warnings.Add(@{
                    Filename = $RelativePath; Line = $displayLine; Check = 'high-entropy'
                    Severity = 'low'; Detail = "Shannon entropy $([Math]::Round($ent, 2)) exceeds $ENTROPY_THRESHOLD"
                })
            }
        }
    }

    return $warnings
}

# ---------------------------------------------------------------------------
# Converters
# ---------------------------------------------------------------------------

function Convert-JsToTxt {
    param([string]$Source, [string]$Dest)
    Copy-Item -LiteralPath $Source -Destination $Dest -Force
}

function Convert-JsonToPrettyTxt {
    param([string]$Source, [string]$Dest)
    try {
        $raw = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
        $obj = $raw | ConvertFrom-Json
        $pretty = $obj | ConvertTo-Json -Depth 20
        [System.IO.File]::WriteAllText($Dest, $pretty, [System.Text.Encoding]::UTF8)
    } catch {
        # Fallback: copy as-is
        Copy-Item -LiteralPath $Source -Destination $Dest -Force
    }
}

function Convert-HtmlToTxt {
    param([string]$Source, [string]$Dest)
    $html = Get-Content -LiteralPath $Source -Raw -Encoding UTF8
    # Strip tags
    $text = $html -replace '<[^>]+>', ''
    # Decode common entities
    $text = $text -replace '&amp;', '&'
    $text = $text -replace '&lt;', '<'
    $text = $text -replace '&gt;', '>'
    $text = $text -replace '&quot;', '"'
    $text = $text -replace '&#39;', "'"
    $text = $text -replace '&nbsp;', ' '
    [System.IO.File]::WriteAllText($Dest, $text, [System.Text.Encoding]::UTF8)
}

function Convert-CsvToHtml {
    param([string]$Source, [string]$Dest)
    $lines = [System.IO.File]::ReadAllLines($Source, [System.Text.Encoding]::UTF8)

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('<!DOCTYPE html>')
    [void]$sb.AppendLine('<html lang="en"><head><meta charset="utf-8">')
    [void]$sb.AppendLine('<style>')
    [void]$sb.AppendLine("body{background:$($THEME.BG);color:$($THEME.TEXT);font-family:'Consolas','Courier New',monospace;padding:20px;margin:0}")
    [void]$sb.AppendLine("h1{color:$($THEME.CYAN);font-size:1.4em}")
    [void]$sb.AppendLine("table{border-collapse:collapse;width:100%;margin-top:12px}")
    [void]$sb.AppendLine("th{background:$($THEME.SURFACE);color:$($THEME.PINK);padding:8px 12px;border:1px solid $($THEME.BORDER);text-align:left}")
    [void]$sb.AppendLine("td{padding:6px 12px;border:1px solid $($THEME.BORDER)}")
    [void]$sb.AppendLine("tr:nth-child(even){background:$($THEME.SURFACE)}")
    [void]$sb.AppendLine("tr:hover{background:#1e1e3a}")
    [void]$sb.AppendLine('.wdk-footer{margin-top:24px;color:#666;font-size:0.85em;text-align:center}')
    [void]$sb.AppendLine('</style></head><body>')
    [void]$sb.AppendLine("<h1>$(Split-Path $Source -Leaf)</h1>")
    [void]$sb.AppendLine('<table>')

    # Naive CSV parse (handles quoted fields with commas)
    function Split-CsvLine {
        param([string]$Line)
        $fields = [System.Collections.ArrayList]::new()
        $current = [System.Text.StringBuilder]::new()
        $inQuote = $false
        for ($i = 0; $i -lt $Line.Length; $i++) {
            $ch = $Line[$i]
            if ($inQuote) {
                if ($ch -eq '"') {
                    if (($i + 1) -lt $Line.Length -and $Line[$i + 1] -eq '"') {
                        [void]$current.Append('"')
                        $i++
                    } else {
                        $inQuote = $false
                    }
                } else {
                    [void]$current.Append($ch)
                }
            } else {
                if ($ch -eq '"') {
                    $inQuote = $true
                } elseif ($ch -eq ',') {
                    [void]$fields.Add($current.ToString())
                    $current = [System.Text.StringBuilder]::new()
                } else {
                    [void]$current.Append($ch)
                }
            }
        }
        [void]$fields.Add($current.ToString())
        return ,$fields.ToArray()
    }

    function HtmlEncode {
        param([string]$s)
        return $s.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;').Replace('"','&quot;')
    }

    $isHeader = $true
    foreach ($line in $lines) {
        if ([string]::IsNullOrWhiteSpace($line)) { continue }
        $cells = Split-CsvLine -Line $line
        $tag = if ($isHeader) { 'th' } else { 'td' }
        [void]$sb.Append('<tr>')
        foreach ($cell in $cells) {
            [void]$sb.Append("<$tag>$(HtmlEncode $cell)</$tag>")
        }
        [void]$sb.AppendLine('</tr>')
        $isHeader = $false
    }

    [void]$sb.AppendLine('</table>')
    [void]$sb.AppendLine("<div class='wdk-footer'>Converted by WDK &mdash; Wizard's Data Engineering Kit</div>")
    [void]$sb.AppendLine('</body></html>')
    [System.IO.File]::WriteAllText($Dest, $sb.ToString(), [System.Text.Encoding]::UTF8)
}

function Convert-MdToHtml {
    param([string]$Source, [string]$Dest)
    $md = Get-Content -LiteralPath $Source -Raw -Encoding UTF8

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('<!DOCTYPE html>')
    [void]$sb.AppendLine('<html lang="en"><head><meta charset="utf-8">')
    [void]$sb.AppendLine('<style>')
    [void]$sb.AppendLine("body{background:$($THEME.BG);color:$($THEME.TEXT);font-family:'Segoe UI',sans-serif;padding:24px 32px;margin:0;max-width:900px;line-height:1.6}")
    [void]$sb.AppendLine("h1,h2,h3,h4,h5,h6{color:$($THEME.CYAN);margin-top:1.4em}")
    [void]$sb.AppendLine("code{background:$($THEME.SURFACE);padding:2px 6px;border-radius:3px;font-family:'Consolas',monospace;color:$($THEME.PINK)}")
    [void]$sb.AppendLine("pre{background:$($THEME.SURFACE);padding:16px;border-radius:6px;border:1px solid $($THEME.BORDER);overflow-x:auto}")
    [void]$sb.AppendLine("pre code{padding:0;background:none}")
    [void]$sb.AppendLine("a{color:$($THEME.PURPLE)}")
    [void]$sb.AppendLine("ul,ol{padding-left:1.8em}")
    [void]$sb.AppendLine("li{margin-bottom:0.3em}")
    [void]$sb.AppendLine('.wdk-footer{margin-top:32px;color:#666;font-size:0.85em;text-align:center}')
    [void]$sb.AppendLine('</style></head><body>')

    # Process markdown line by line
    $lines = $md -split "`n"
    $inCodeBlock = $false
    $inList = $false
    $listTag = ''

    foreach ($rawLine in $lines) {
        $line = $rawLine.TrimEnd("`r")

        # Fenced code blocks
        if ($line -match '^```') {
            if ($inCodeBlock) {
                [void]$sb.AppendLine('</code></pre>')
                $inCodeBlock = $false
            } else {
                if ($inList) { [void]$sb.AppendLine("</$listTag>"); $inList = $false }
                [void]$sb.AppendLine('<pre><code>')
                $inCodeBlock = $true
            }
            continue
        }
        if ($inCodeBlock) {
            [void]$sb.AppendLine([System.Web.HttpUtility]::HtmlEncode($line))
            continue
        }

        # Close list if line is not a list item
        if ($inList -and -not ($line -match '^\s*[-*+]\s' -or $line -match '^\s*\d+\.\s')) {
            [void]$sb.AppendLine("</$listTag>")
            $inList = $false
        }

        # Blank line
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        # Headers
        if ($line -match '^(#{1,6})\s+(.+)$') {
            $level = $Matches[1].Length
            $text = $Matches[2]
            [void]$sb.AppendLine("<h$level>$(ConvertFrom-MdInline $text)</h$level>")
            continue
        }

        # Unordered list
        if ($line -match '^\s*[-*+]\s+(.+)$') {
            if (-not $inList -or $listTag -ne 'ul') {
                if ($inList) { [void]$sb.AppendLine("</$listTag>") }
                [void]$sb.AppendLine('<ul>')
                $inList = $true; $listTag = 'ul'
            }
            [void]$sb.AppendLine("<li>$(ConvertFrom-MdInline $Matches[1])</li>")
            continue
        }

        # Ordered list
        if ($line -match '^\s*\d+\.\s+(.+)$') {
            if (-not $inList -or $listTag -ne 'ol') {
                if ($inList) { [void]$sb.AppendLine("</$listTag>") }
                [void]$sb.AppendLine('<ol>')
                $inList = $true; $listTag = 'ol'
            }
            [void]$sb.AppendLine("<li>$(ConvertFrom-MdInline $Matches[1])</li>")
            continue
        }

        # Paragraph
        [void]$sb.AppendLine("<p>$(ConvertFrom-MdInline $line)</p>")
    }

    if ($inCodeBlock) { [void]$sb.AppendLine('</code></pre>') }
    if ($inList) { [void]$sb.AppendLine("</$listTag>") }

    [void]$sb.AppendLine("<div class='wdk-footer'>Converted by WDK &mdash; Wizard's Data Engineering Kit</div>")
    [void]$sb.AppendLine('</body></html>')
    [System.IO.File]::WriteAllText($Dest, $sb.ToString(), [System.Text.Encoding]::UTF8)
}

function ConvertFrom-MdInline {
    param([string]$Text)
    # HTML-encode first
    $t = $Text.Replace('&','&amp;').Replace('<','&lt;').Replace('>','&gt;')
    # Bold (** or __)
    $t = [regex]::Replace($t, '\*\*(.+?)\*\*', '<strong>$1</strong>')
    $t = [regex]::Replace($t, '__(.+?)__', '<strong>$1</strong>')
    # Italic (* or _)
    $t = [regex]::Replace($t, '\*(.+?)\*', '<em>$1</em>')
    $t = [regex]::Replace($t, '(?<![_])_(.+?)_(?![_])', '<em>$1</em>')
    # Inline code
    $t = [regex]::Replace($t, '`([^`]+)`', '<code>$1</code>')
    # Links
    $t = [regex]::Replace($t, '\[([^\]]+)\]\(([^)]+)\)', '<a href="$2">$1</a>')
    return $t
}

function Convert-DefaultToTxt {
    param([string]$Source, [string]$Dest)
    Copy-Item -LiteralPath $Source -Destination $Dest -Force
}

# ---------------------------------------------------------------------------
# Get conversion type and output extension
# ---------------------------------------------------------------------------
function Get-ConversionInfo {
    param([string]$Extension)
    switch ($Extension.ToLower()) {
        '.js'   { return @{ Type = 'js-to-txt';   Ext = '.txt'  } }
        '.json' { return @{ Type = 'json-to-txt';  Ext = '.txt'  } }
        '.csv'  { return @{ Type = 'csv-to-html';  Ext = '.html' } }
        '.tsv'  { return @{ Type = 'csv-to-html';  Ext = '.html' } }
        '.md'   { return @{ Type = 'md-to-html';   Ext = '.html' } }
        '.html' { return @{ Type = 'html-to-txt';  Ext = '.txt'  } }
        '.htm'  { return @{ Type = 'html-to-txt';  Ext = '.txt'  } }
        default { return @{ Type = 'copy-to-txt';  Ext = '.txt'  } }
    }
}

# ---------------------------------------------------------------------------
# Report generator: scan-report.html
# ---------------------------------------------------------------------------
function New-ScanReport {
    param(
        [array]$ManifestRows,
        [array]$AllWarnings,
        [string]$InputPathResolved,
        [string]$ReportPath,
        [int]$TotalFiles,
        [long]$TotalSize,
        [bool]$WasScanOnly
    )

    $timestamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
    $cleanCount = ($ManifestRows | Where-Object { $_.warning_count -eq 0 }).Count
    $flaggedCount = $TotalFiles - $cleanCount

    # Warning breakdown by severity
    $highCount   = ($AllWarnings | Where-Object { $_.Severity -eq 'high' }).Count
    $mediumCount = ($AllWarnings | Where-Object { $_.Severity -eq 'medium' }).Count
    $lowCount    = ($AllWarnings | Where-Object { $_.Severity -eq 'low' }).Count

    # Warning breakdown by check type
    $checkGroups = $AllWarnings | Group-Object -Property Check | Sort-Object Count -Descending

    $sb = [System.Text.StringBuilder]::new()
    [void]$sb.AppendLine('<!DOCTYPE html>')
    [void]$sb.AppendLine('<html lang="en"><head><meta charset="utf-8">')
    [void]$sb.AppendLine("<title>WDK Scan Report &mdash; $timestamp</title>")
    [void]$sb.AppendLine('<style>')
    [void]$sb.AppendLine("*{box-sizing:border-box;margin:0;padding:0}")
    [void]$sb.AppendLine("body{background:$($THEME.BG);color:$($THEME.TEXT);font-family:'Segoe UI','Consolas',sans-serif;padding:24px 32px;line-height:1.5}")
    [void]$sb.AppendLine("h1{color:$($THEME.CYAN);font-size:1.6em;margin-bottom:4px}")
    [void]$sb.AppendLine("h2{color:$($THEME.PURPLE);font-size:1.2em;margin-top:28px;margin-bottom:8px;border-bottom:1px solid $($THEME.BORDER);padding-bottom:4px}")
    [void]$sb.AppendLine("h3{color:$($THEME.PINK);font-size:1em;margin-top:16px}")
    [void]$sb.AppendLine(".header-meta{color:#888;font-size:0.9em;margin-bottom:20px}")
    [void]$sb.AppendLine(".summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0}")
    [void]$sb.AppendLine(".stat-card{background:$($THEME.SURFACE);border:1px solid $($THEME.BORDER);border-radius:8px;padding:14px 16px;text-align:center}")
    [void]$sb.AppendLine(".stat-card .num{font-size:2em;font-weight:bold}")
    [void]$sb.AppendLine(".stat-card .label{font-size:0.85em;color:#aaa;margin-top:2px}")
    [void]$sb.AppendLine(".c-green{color:$($THEME.GREEN)}.c-yellow{color:$($THEME.YELLOW)}.c-red{color:$($THEME.RED)}.c-cyan{color:$($THEME.CYAN)}")
    [void]$sb.AppendLine("table{border-collapse:collapse;width:100%;margin:12px 0;font-size:0.9em}")
    [void]$sb.AppendLine("th{background:$($THEME.SURFACE);color:$($THEME.PINK);padding:8px 10px;border:1px solid $($THEME.BORDER);text-align:left}")
    [void]$sb.AppendLine("td{padding:6px 10px;border:1px solid $($THEME.BORDER)}")
    [void]$sb.AppendLine("tr:nth-child(even){background:$($THEME.SURFACE)}")
    [void]$sb.AppendLine("details{background:$($THEME.SURFACE);border:1px solid $($THEME.BORDER);border-radius:6px;margin:8px 0;padding:10px 14px}")
    [void]$sb.AppendLine("summary{cursor:pointer;font-weight:bold;color:$($THEME.CYAN)}")
    [void]$sb.AppendLine("summary:hover{color:$($THEME.PINK)}")
    [void]$sb.AppendLine(".sev-high{color:$($THEME.RED);font-weight:bold}.sev-medium{color:$($THEME.YELLOW)}.sev-low{color:#aaa}")
    [void]$sb.AppendLine(".footer{margin-top:40px;text-align:center;color:#555;font-size:0.8em;border-top:1px solid $($THEME.BORDER);padding-top:16px}")
    [void]$sb.AppendLine('.badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.8em;margin-left:6px}')
    [void]$sb.AppendLine(".badge-clean{background:#00ff8822;color:$($THEME.GREEN)}")
    [void]$sb.AppendLine(".badge-warn{background:#ff297522;color:$($THEME.PINK)}")
    [void]$sb.AppendLine('</style></head><body>')

    # Header
    $mode = if ($WasScanOnly) { 'Scan Only' } else { 'Scan + Convert' }
    [void]$sb.AppendLine("<h1>WDK Scan Report</h1>")
    [void]$sb.AppendLine("<div class='header-meta'>")
    [void]$sb.AppendLine("Timestamp: $timestamp<br>")
    [void]$sb.AppendLine("Input: <strong>$InputPathResolved</strong><br>")
    [void]$sb.AppendLine("Mode: $mode | Files: $TotalFiles | Total size: $([Math]::Round($TotalSize / 1KB, 1)) KB")
    [void]$sb.AppendLine('</div>')

    # Summary cards
    [void]$sb.AppendLine('<h2>Summary</h2>')
    [void]$sb.AppendLine('<div class="summary-grid">')
    [void]$sb.AppendLine("<div class='stat-card'><div class='num c-cyan'>$TotalFiles</div><div class='label'>Total Files</div></div>")
    [void]$sb.AppendLine("<div class='stat-card'><div class='num c-green'>$cleanCount</div><div class='label'>Clean</div></div>")
    [void]$sb.AppendLine("<div class='stat-card'><div class='num c-red'>$flaggedCount</div><div class='label'>Flagged</div></div>")
    [void]$sb.AppendLine("<div class='stat-card'><div class='num c-red'>$highCount</div><div class='label'>High Severity</div></div>")
    [void]$sb.AppendLine("<div class='stat-card'><div class='num c-yellow'>$mediumCount</div><div class='label'>Medium</div></div>")
    [void]$sb.AppendLine("<div class='stat-card'><div class='num'>$lowCount</div><div class='label'>Low</div></div>")
    [void]$sb.AppendLine('</div>')

    # Warning type breakdown
    if ($checkGroups.Count -gt 0) {
        [void]$sb.AppendLine('<h2>Warnings by Type</h2>')
        [void]$sb.AppendLine('<table><tr><th>Check</th><th>Count</th></tr>')
        foreach ($g in $checkGroups) {
            [void]$sb.AppendLine("<tr><td>$($g.Name)</td><td>$($g.Count)</td></tr>")
        }
        [void]$sb.AppendLine('</table>')
    }

    # Per-file sections
    [void]$sb.AppendLine('<h2>Per-File Details</h2>')
    foreach ($row in $ManifestRows) {
        $fileWarnings = @($AllWarnings | Where-Object { $_.Filename -eq $row.original_path })
        $badge = if ($fileWarnings.Count -eq 0) {
            "<span class='badge badge-clean'>clean</span>"
        } else {
            "<span class='badge badge-warn'>$($fileWarnings.Count) warnings</span>"
        }
        [void]$sb.AppendLine("<details>")
        [void]$sb.AppendLine("<summary>$($row.original_path) $badge</summary>")
        [void]$sb.AppendLine("<p>Size: $($row.size_bytes) bytes | SHA-256: <code>$($row.sha256)</code> | Conversion: $($row.conversion_type)</p>")
        if ($fileWarnings.Count -gt 0) {
            [void]$sb.AppendLine('<table><tr><th>Line</th><th>Check</th><th>Severity</th><th>Detail</th></tr>')
            foreach ($w in $fileWarnings) {
                $sevClass = "sev-$($w.Severity)"
                [void]$sb.AppendLine("<tr><td>$($w.Line)</td><td>$($w.Check)</td><td class='$sevClass'>$($w.Severity)</td><td>$($w.Detail)</td></tr>")
            }
            [void]$sb.AppendLine('</table>')
        }
        [void]$sb.AppendLine('</details>')
    }

    # Footer
    [void]$sb.AppendLine("<div class='footer'>")
    [void]$sb.AppendLine("WDK &mdash; Wizard's Data Engineering Kit | File Sanitization &amp; Preflight Scanner")
    [void]$sb.AppendLine('</div>')
    [void]$sb.AppendLine('</body></html>')

    [System.IO.File]::WriteAllText($ReportPath, $sb.ToString(), [System.Text.Encoding]::UTF8)
}

# ---------------------------------------------------------------------------
# Undo script generator
# ---------------------------------------------------------------------------
function New-UndoScript {
    param(
        [string]$OutputDir,
        [string]$UndoPath
    )
    $lines = @(
        '<# WDK undo script — removes all generated output #>'
        "# Generated $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        ''
        '$outputDir = Split-Path -Parent $MyInvocation.MyCommand.Path'
        ''
        '# Files to remove'
        '$targets = @('
        '    (Join-Path $outputDir "manifest.csv")'
        '    (Join-Path $outputDir "warnings.csv")'
        '    (Join-Path $outputDir "scan-report.html")'
        '    (Join-Path $outputDir "undo.ps1")'
        ')'
        ''
        '$convertedDir = Join-Path $outputDir "converted"'
        ''
        'foreach ($f in $targets) {'
        '    if (Test-Path $f) { Remove-Item -LiteralPath $f -Force; Write-Host "Removed: $f" }'
        '}'
        ''
        'if (Test-Path $convertedDir) {'
        '    Remove-Item -LiteralPath $convertedDir -Recurse -Force'
        '    Write-Host "Removed: $convertedDir"'
        '}'
        ''
        'Write-Host "Undo complete."'
    )
    [System.IO.File]::WriteAllText($UndoPath, ($lines -join "`r`n"), [System.Text.Encoding]::UTF8)
}

# ===========================================================================
# MAIN
# ===========================================================================

# Load System.Web for HtmlEncode (available in .NET Framework / PS 5.1)
try { Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue } catch {}

# --- Validate input ---
$InputPathResolved = (Resolve-Path -LiteralPath $InputPath -ErrorAction SilentlyContinue).Path
if (-not $InputPathResolved -or -not (Test-Path -LiteralPath $InputPathResolved -PathType Container)) {
    Write-Error "InputPath does not exist or is not a directory: $InputPath"
    exit 1
}

# --- Resolve output ---
$OutputPathResolved = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
if ((Test-Path -LiteralPath $OutputPathResolved) -and -not $Force -and -not $ScanOnly) {
    Write-Error "Output directory already exists: $OutputPathResolved  (use -Force to overwrite)"
    exit 1
}

if (-not $ScanOnly) {
    $convertedDir = Join-Path $OutputPathResolved 'converted'
    if (-not (Test-Path $convertedDir)) {
        New-Item -ItemType Directory -Path $convertedDir -Force | Out-Null
    }
}

# --- Collect files ---
Write-Host "Scanning: $InputPathResolved" -ForegroundColor Cyan

$allFiles = [System.Collections.ArrayList]::new()
foreach ($pattern in $Include) {
    $found = Get-ChildItem -LiteralPath $InputPathResolved -Filter $pattern -Recurse -File -ErrorAction SilentlyContinue
    foreach ($f in $found) {
        if (-not $allFiles.Contains($f.FullName)) {
            [void]$allFiles.Add($f.FullName)
        }
    }
}

# Deduplicate
$fileList = $allFiles | Sort-Object -Unique
$totalFiles = $fileList.Count
$totalSize = 0L

if ($totalFiles -eq 0) {
    Write-Warning "No matching files found in $InputPathResolved"
    exit 0
}

Write-Host "Found $totalFiles files to process." -ForegroundColor Cyan

# --- Process each file ---
$manifestRows  = [System.Collections.ArrayList]::new()
$allWarnings   = [System.Collections.ArrayList]::new()
$counter = 0

foreach ($filePath in $fileList) {
    $counter++
    $fileInfo = Get-Item -LiteralPath $filePath
    $totalSize += $fileInfo.Length

    # Relative path from input root
    $relativePath = $filePath.Substring($InputPathResolved.Length).TrimStart('\','/')
    if ([string]::IsNullOrEmpty($relativePath)) { $relativePath = $fileInfo.Name }

    # Progress
    $pct = [int](($counter / $totalFiles) * 100)
    Write-Progress -Activity "WDK Preflight Scanner" -Status "$relativePath" -PercentComplete $pct

    # SHA-256
    $hash = ''
    try {
        $hashResult = Get-FileHash -LiteralPath $filePath -Algorithm SHA256
        $hash = $hashResult.Hash
    } catch {
        $hash = 'ERROR'
    }

    # Scan
    $warnings = Invoke-FileScan -FilePath $filePath -RelativePath $relativePath
    $warningCount = 0
    $warningSummary = ''
    if ($warnings -and $warnings.Count -gt 0) {
        $warningCount = $warnings.Count
        $warningSummary = ($warnings | ForEach-Object { $_.Check } | Sort-Object -Unique) -join '; '
        foreach ($w in $warnings) {
            [void]$allWarnings.Add($w)
        }
    }

    # Conversion
    $ext = $fileInfo.Extension.ToLower()
    $convInfo = Get-ConversionInfo -Extension $ext
    $outputRelative = ''

    if (-not $ScanOnly) {
        $baseName = [System.IO.Path]::GetFileNameWithoutExtension($fileInfo.Name)
        $outputFileName = $baseName + $convInfo.Ext
        $relativeDir = Split-Path $relativePath -Parent
        $targetDir = Join-Path $convertedDir $relativeDir
        if ($relativeDir -and -not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        $destPath = Join-Path $targetDir $outputFileName
        $outputRelative = "converted/$($relativeDir.Replace('\','/'))$(if($relativeDir){'/'})$outputFileName"

        try {
            switch ($convInfo.Type) {
                'js-to-txt'    { Convert-JsToTxt -Source $filePath -Dest $destPath }
                'json-to-txt'  { Convert-JsonToPrettyTxt -Source $filePath -Dest $destPath }
                'csv-to-html'  { Convert-CsvToHtml -Source $filePath -Dest $destPath }
                'md-to-html'   { Convert-MdToHtml -Source $filePath -Dest $destPath }
                'html-to-txt'  { Convert-HtmlToTxt -Source $filePath -Dest $destPath }
                default        { Convert-DefaultToTxt -Source $filePath -Dest $destPath }
            }
        } catch {
            Write-Warning "Conversion failed for ${relativePath}: $_"
            $outputRelative = 'FAILED'
        }
    }

    [void]$manifestRows.Add([PSCustomObject]@{
        original_path    = $relativePath
        output_path      = $outputRelative
        size_bytes       = $fileInfo.Length
        sha256           = $hash
        conversion_type  = $convInfo.Type
        warning_count    = $warningCount
        warnings_summary = $warningSummary
    })
}

Write-Progress -Activity "WDK Preflight Scanner" -Completed

# --- Write manifest.csv ---
$manifestPath = Join-Path $OutputPathResolved 'manifest.csv'
if (-not (Test-Path $OutputPathResolved)) {
    New-Item -ItemType Directory -Path $OutputPathResolved -Force | Out-Null
}
$manifestRows | Export-Csv -LiteralPath $manifestPath -NoTypeInformation -Encoding UTF8
Write-Host "Manifest: $manifestPath" -ForegroundColor Green

# --- Write warnings.csv ---
$warningsPath = Join-Path $OutputPathResolved 'warnings.csv'
if ($allWarnings.Count -gt 0) {
    $allWarnings | ForEach-Object {
        [PSCustomObject]@{
            filename = $_.Filename
            line     = $_.Line
            check    = $_.Check
            severity = $_.Severity
            detail   = $_.Detail
        }
    } | Export-Csv -LiteralPath $warningsPath -NoTypeInformation -Encoding UTF8
} else {
    # Write header-only CSV
    [System.IO.File]::WriteAllText($warningsPath,
        '"filename","line","check","severity","detail"' + "`r`n",
        [System.Text.Encoding]::UTF8)
}
Write-Host "Warnings: $warningsPath ($($allWarnings.Count) total)" -ForegroundColor $(if ($allWarnings.Count -gt 0) { 'Yellow' } else { 'Green' })

# --- Write scan-report.html ---
$reportPath = Join-Path $OutputPathResolved 'scan-report.html'
New-ScanReport `
    -ManifestRows $manifestRows.ToArray() `
    -AllWarnings $allWarnings.ToArray() `
    -InputPathResolved $InputPathResolved `
    -ReportPath $reportPath `
    -TotalFiles $totalFiles `
    -TotalSize $totalSize `
    -WasScanOnly $ScanOnly.IsPresent
Write-Host "Report:   $reportPath" -ForegroundColor Green

# --- Write undo.ps1 ---
if (-not $ScanOnly) {
    $undoPath = Join-Path $OutputPathResolved 'undo.ps1'
    New-UndoScript -OutputDir $OutputPathResolved -UndoPath $undoPath
    Write-Host "Undo:     $undoPath" -ForegroundColor Green
}

# --- Summary ---
Write-Host ''
Write-Host '=== WDK Preflight Scan Complete ===' -ForegroundColor Cyan
Write-Host "Files scanned : $totalFiles"
Write-Host "Total size    : $([Math]::Round($totalSize / 1KB, 1)) KB"
Write-Host "Warnings      : $($allWarnings.Count)"
$cleanCount = ($manifestRows | Where-Object { $_.warning_count -eq 0 }).Count
Write-Host "Clean files   : $cleanCount / $totalFiles" -ForegroundColor Green
if (-not $ScanOnly) {
    Write-Host "Converted to  : $OutputPathResolved" -ForegroundColor Cyan
}
