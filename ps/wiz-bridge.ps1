<#
.SYNOPSIS
    Wiz Bridge — PowerShell HttpListener localhost server.

.DESCRIPTION
    Serve wiz.html on localhost to unlock all browser APIs (File System Access,
    OPFS, Web Workers). Shared secret token auth. REST endpoints for filesystem
    ops. Optional WebSocket for real-time communication.

.NOTES
    Ticket: forge/datakit#2
    Sprint: C (PowerShell layer)
    No admin rights required (localhost binding only).
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Start-WizBridge {
    <#
    .SYNOPSIS
        Start the Wiz localhost HTTP server.
    .PARAMETER Port
        Port to listen on (default 8080).
    .PARAMETER WebRoot
        Directory to serve static files from. Defaults to dist/.
    .PARAMETER Token
        Shared secret for API authentication. Auto-generated if not provided.
    .PARAMETER OpenBrowser
        Open the default browser after starting.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$false)]
        [int]$Port = 8080,

        [Parameter(Mandatory=$false)]
        [string]$WebRoot,

        [Parameter(Mandatory=$false)]
        [string]$Token,

        [Parameter(Mandatory=$false)]
        [switch]$OpenBrowser
    )

    if (-not $WebRoot) {
        $WebRoot = Join-Path (Split-Path -Parent $scriptDir) 'dist'
    }

    if (-not (Test-Path $WebRoot)) {
        throw "Web root not found: $WebRoot. Run 'node build.js' first."
    }

    # Auto-generate token if not provided
    if (-not $Token) {
        $Token = [Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
        Write-Host "Generated auth token: $Token"
        Write-Host "(Pass this token to browser for API access)"
    }

    $prefix = "http://localhost:$Port/"

    # Check if port is available
    try {
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($prefix)
        $listener.Start()
    }
    catch {
        # Try next port
        $Port++
        $prefix = "http://localhost:$Port/"
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($prefix)
        $listener.Start()
    }

    Write-Host "Wiz Bridge running on $prefix"
    Write-Host "Web root: $WebRoot"
    Write-Host "Press Ctrl+C to stop."

    # Audit
    if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
        Write-AuditEvent -Action 'BRIDGE_START' -Details @{
            port = $Port
            web_root = $WebRoot
        }
    }

    if ($OpenBrowser) {
        Start-Process "${prefix}wiz.html?token=$Token"
    }

    $mimeTypes = @{
        '.html' = 'text/html'
        '.htm'  = 'text/html'
        '.js'   = 'application/javascript'
        '.css'  = 'text/css'
        '.json' = 'application/json'
        '.png'  = 'image/png'
        '.jpg'  = 'image/jpeg'
        '.gif'  = 'image/gif'
        '.svg'  = 'image/svg+xml'
        '.ico'  = 'image/x-icon'
        '.txt'  = 'text/plain'
        '.csv'  = 'text/csv'
        '.tsv'  = 'text/tab-separated-values'
        '.wasm' = 'application/wasm'
    }

    try {
        while ($listener.IsListening) {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $urlPath = $request.Url.LocalPath
            $method = $request.HttpMethod

            try {
                # CORS headers for browser API access
                $response.Headers.Add('Access-Control-Allow-Origin', '*')
                $response.Headers.Add('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
                $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type, Authorization')

                if ($method -eq 'OPTIONS') {
                    $response.StatusCode = 204
                    $response.Close()
                    continue
                }

                # Route: API endpoints
                if ($urlPath.StartsWith('/api/')) {
                    # Validate token
                    $authHeader = $request.Headers['Authorization']
                    $providedToken = if ($authHeader -and $authHeader.StartsWith('Bearer ')) {
                        $authHeader.Substring(7)
                    } else {
                        $request.QueryString['token']
                    }

                    if ($providedToken -ne $Token) {
                        Send-JsonResponse -Response $response -StatusCode 401 -Body @{ error = 'Unauthorized' }
                        continue
                    }

                    Handle-ApiRequest -Request $request -Response $response -WebRoot $WebRoot
                    continue
                }

                # Route: static files
                if ($urlPath -eq '/') { $urlPath = '/wiz.html' }
                $filePath = Join-Path $WebRoot ($urlPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar))

                if (Test-Path $filePath) {
                    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                    $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }
                    $response.ContentType = $contentType

                    $bytes = [System.IO.File]::ReadAllBytes($filePath)
                    $response.ContentLength64 = $bytes.Length
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } else {
                    $response.StatusCode = 404
                    $msg = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
                    $response.OutputStream.Write($msg, 0, $msg.Length)
                }
            }
            catch {
                $response.StatusCode = 500
                $errMsg = [System.Text.Encoding]::UTF8.GetBytes("Internal Server Error: $_")
                $response.OutputStream.Write($errMsg, 0, $errMsg.Length)
            }
            finally {
                $response.Close()
            }
        }
    }
    finally {
        $listener.Stop()
        $listener.Close()
        Write-Host "Wiz Bridge stopped."

        if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
            Write-AuditEvent -Action 'BRIDGE_STOP'
        }
    }
}

function Handle-ApiRequest {
    <#
    .SYNOPSIS
        Handle REST API requests for filesystem operations.
    #>
    [CmdletBinding()]
    param(
        [System.Net.HttpListenerRequest]$Request,
        [System.Net.HttpListenerResponse]$Response,
        [string]$WebRoot
    )

    $path = $Request.Url.LocalPath
    $method = $Request.HttpMethod

    switch -Regex ($path) {
        '^/api/files$' {
            if ($method -eq 'GET') {
                # List files in a directory
                $dir = $Request.QueryString['dir']
                if (-not $dir) { $dir = $WebRoot }

                # Security: only allow access within web root
                $resolvedDir = [System.IO.Path]::GetFullPath($dir)
                if (-not $resolvedDir.StartsWith([System.IO.Path]::GetFullPath($WebRoot))) {
                    Send-JsonResponse -Response $Response -StatusCode 403 -Body @{ error = 'Access denied: path outside web root' }
                    return
                }

                if (Test-Path $resolvedDir) {
                    $items = Get-ChildItem -Path $resolvedDir | ForEach-Object {
                        @{
                            name = $_.Name
                            type = if ($_.PSIsContainer) { 'directory' } else { 'file' }
                            size = if ($_.PSIsContainer) { 0 } else { $_.Length }
                            modified = $_.LastWriteTimeUtc.ToString('o')
                        }
                    }
                    Send-JsonResponse -Response $Response -Body @{ files = @($items) }
                } else {
                    Send-JsonResponse -Response $Response -StatusCode 404 -Body @{ error = 'Directory not found' }
                }
            }
            elseif ($method -eq 'POST') {
                # Read uploaded file content
                $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Close()

                $filePath = $body.path
                $resolvedPath = [System.IO.Path]::GetFullPath($filePath)
                if (-not $resolvedPath.StartsWith([System.IO.Path]::GetFullPath($WebRoot))) {
                    Send-JsonResponse -Response $Response -StatusCode 403 -Body @{ error = 'Access denied' }
                    return
                }

                if (Test-Path $resolvedPath) {
                    $content = Get-Content -Path $resolvedPath -Raw -Encoding UTF8
                    Send-JsonResponse -Response $Response -Body @{ content = $content; path = $resolvedPath }
                } else {
                    Send-JsonResponse -Response $Response -StatusCode 404 -Body @{ error = 'File not found' }
                }
            }
        }

        '^/api/write$' {
            if ($method -eq 'POST') {
                $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Close()

                $filePath = $body.path
                $resolvedPath = [System.IO.Path]::GetFullPath($filePath)
                if (-not $resolvedPath.StartsWith([System.IO.Path]::GetFullPath($WebRoot))) {
                    Send-JsonResponse -Response $Response -StatusCode 403 -Body @{ error = 'Access denied' }
                    return
                }

                Set-Content -Path $resolvedPath -Value $body.content -Encoding UTF8

                if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
                    Write-AuditEvent -Action 'FILE_WRITE' -FilePath $resolvedPath
                }

                Send-JsonResponse -Response $Response -Body @{ written = $true; path = $resolvedPath }
            }
        }

        '^/api/hash$' {
            if ($method -eq 'POST') {
                $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Close()

                $filePath = $body.path
                if (Test-Path $filePath) {
                    $hash = Get-FileHashSHA256 -Path $filePath
                    Send-JsonResponse -Response $Response -Body @{ sha256 = $hash; path = $filePath }
                } else {
                    Send-JsonResponse -Response $Response -StatusCode 404 -Body @{ error = 'File not found' }
                }
            }
        }

        '^/api/scan$' {
            if ($method -eq 'POST') {
                $reader = New-Object System.IO.StreamReader($Request.InputStream, $Request.ContentEncoding)
                $body = $reader.ReadToEnd() | ConvertFrom-Json
                $reader.Close()

                $filePath = $body.path
                if (Test-Path $filePath) {
                    $patterns = Import-PIIPatterns
                    $result = Invoke-PIIScan -Path $filePath -Patterns $patterns
                    Send-JsonResponse -Response $Response -Body @{
                        file = $result.FileName
                        findings = $result.TotalFindings
                        details = $result.Findings
                    }
                } else {
                    Send-JsonResponse -Response $Response -StatusCode 404 -Body @{ error = 'File not found' }
                }
            }
        }

        '^/api/status$' {
            Send-JsonResponse -Response $Response -Body @{
                status = 'running'
                version = '1.0.0'
                uptime = [DateTime]::UtcNow.ToString('o')
            }
        }

        default {
            Send-JsonResponse -Response $Response -StatusCode 404 -Body @{ error = 'Unknown endpoint' }
        }
    }
}

function Send-JsonResponse {
    [CmdletBinding()]
    param(
        [System.Net.HttpListenerResponse]$Response,
        [hashtable]$Body,
        [int]$StatusCode = 200
    )

    $Response.StatusCode = $StatusCode
    $Response.ContentType = 'application/json'
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $Response.ContentLength64 = $bytes.Length
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
}
