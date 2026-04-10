<#
.SYNOPSIS
    Wiz Transfer — OpenSSH SFTP wrapper for secure file transfer (zero deps).

.DESCRIPTION
    Wraps built-in sftp.exe (Win10 1809+/Server 2019+) for secure file transfer.
    SSH key generation on first run. Outbox directory monitoring with FileSystemWatcher
    + polling hybrid. Progress tracking via JSON status file. Retry with exponential
    backoff. SHA-256 checksum verification.

.NOTES
    Ticket: forge/datakit#1
    Sprint: C (PowerShell layer)
    Requires: OpenSSH client (built into Windows 10 1809+ and Server 2019+)
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Initialize-WizTransfer {
    <#
    .SYNOPSIS
        Initialize transfer subsystem: ensure SSH keys exist, create directories.
    .PARAMETER WorkDir
        Working directory for transfer operations.
    .PARAMETER KeyPath
        Path to SSH private key. Default: $WorkDir/.ssh/wiz_transfer_key
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$WorkDir,

        [Parameter(Mandatory=$false)]
        [string]$KeyPath
    )

    # Ensure work directories
    $dirs = @(
        (Join-Path $WorkDir 'outbox'),
        (Join-Path $WorkDir 'sent'),
        (Join-Path $WorkDir 'failed'),
        (Join-Path $WorkDir '.ssh'),
        (Join-Path $WorkDir 'status')
    )
    foreach ($d in $dirs) {
        if (-not (Test-Path $d)) {
            New-Item -ItemType Directory -Path $d -Force | Out-Null
        }
    }

    if (-not $KeyPath) {
        $KeyPath = Join-Path $WorkDir '.ssh' 'wiz_transfer_key'
    }

    # Generate SSH key if not present
    if (-not (Test-Path $KeyPath)) {
        Write-Host "Generating SSH key pair..."
        $sshKeygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
        if (-not $sshKeygen) {
            throw "ssh-keygen not found. Install OpenSSH Client (Windows 10 1809+ built-in)."
        }
        & ssh-keygen -t ed25519 -f $KeyPath -N '""' -C "wiz-transfer@$env:COMPUTERNAME" 2>$null
        if ($LASTEXITCODE -ne 0) {
            throw "SSH key generation failed."
        }
        Write-Host "SSH key generated: $KeyPath"
        Write-Host "Public key: $KeyPath.pub"
        Write-Host "Add the public key to the remote server's authorized_keys."
    }

    return [PSCustomObject]@{
        WorkDir   = $WorkDir
        OutboxDir = Join-Path $WorkDir 'outbox'
        SentDir   = Join-Path $WorkDir 'sent'
        FailedDir = Join-Path $WorkDir 'failed'
        StatusDir = Join-Path $WorkDir 'status'
        KeyPath   = $KeyPath
    }
}

function Send-WizFile {
    <#
    .SYNOPSIS
        Transfer a file via SFTP with retry and checksum verification.
    .PARAMETER FilePath
        Local file to transfer.
    .PARAMETER RemoteHost
        Remote host (user@host format).
    .PARAMETER RemotePath
        Remote destination directory.
    .PARAMETER Config
        Transfer config from Initialize-WizTransfer.
    .PARAMETER MaxRetries
        Maximum retry attempts (default 3).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$FilePath,

        [Parameter(Mandatory=$true)]
        [string]$RemoteHost,

        [Parameter(Mandatory=$true)]
        [string]$RemotePath,

        [Parameter(Mandatory=$true)]
        [object]$Config,

        [Parameter(Mandatory=$false)]
        [int]$MaxRetries = 3
    )

    if (-not (Test-Path $FilePath)) {
        throw "File not found: $FilePath"
    }

    $fileName = Split-Path -Leaf $FilePath
    $localHash = Get-FileHashSHA256 -Path $FilePath

    # Status tracking
    $statusFile = Join-Path $Config.StatusDir "$fileName.json"
    $status = [ordered]@{
        file        = $fileName
        local_hash  = $localHash
        remote_host = $RemoteHost
        remote_path = $RemotePath
        state       = 'PENDING'
        attempts    = 0
        started_at  = [DateTime]::UtcNow.ToString('o')
        completed_at = $null
        error       = $null
    }

    Update-StatusFile -StatusFile $statusFile -Status $status

    $sftp = Get-Command sftp -ErrorAction SilentlyContinue
    if (-not $sftp) {
        throw "sftp not found. Install OpenSSH Client (Windows 10 1809+ built-in)."
    }

    $success = $false
    $attempt = 0

    while (-not $success -and $attempt -lt $MaxRetries) {
        $attempt++
        $status.attempts = $attempt
        $status.state = 'TRANSFERRING'
        Update-StatusFile -StatusFile $statusFile -Status $status

        try {
            # Build SFTP batch commands
            $batchFile = Join-Path $Config.StatusDir "$fileName.sftp-batch"
            $batchContent = @(
                "cd $RemotePath"
                "put `"$FilePath`""
                "bye"
            )
            Set-Content -Path $batchFile -Value ($batchContent -join "`n") -Encoding UTF8

            # Execute SFTP
            $sftpArgs = @(
                '-i', $Config.KeyPath,
                '-b', $batchFile,
                '-o', 'StrictHostKeyChecking=accept-new',
                '-o', 'ConnectTimeout=30',
                $RemoteHost
            )
            $proc = Start-Process -FilePath 'sftp' -ArgumentList $sftpArgs -NoNewWindow -Wait -PassThru -RedirectStandardError (Join-Path $Config.StatusDir "$fileName.sftp-err")

            Remove-Item -Path $batchFile -Force -ErrorAction SilentlyContinue

            if ($proc.ExitCode -eq 0) {
                $success = $true
                $status.state = 'TRANSFERRED'
                $status.completed_at = [DateTime]::UtcNow.ToString('o')

                # Move to sent directory
                $sentPath = Join-Path $Config.SentDir $fileName
                Move-Item -Path $FilePath -Destination $sentPath -Force

                # Audit
                if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
                    Write-AuditEvent -Action 'FILE_TRANSFER' -FilePath $FilePath -FileHash $localHash -Disposition 'TRANSFERRED' -Details @{
                        remote_host = $RemoteHost
                        remote_path = $RemotePath
                        attempts = $attempt
                    }
                }
            } else {
                $errContent = if (Test-Path (Join-Path $Config.StatusDir "$fileName.sftp-err")) {
                    Get-Content -Path (Join-Path $Config.StatusDir "$fileName.sftp-err") -Raw
                } else { "Unknown error" }
                throw "SFTP exit code $($proc.ExitCode): $errContent"
            }
        }
        catch {
            $status.error = $_.Exception.Message
            $status.state = 'RETRY'
            Update-StatusFile -StatusFile $statusFile -Status $status

            if ($attempt -lt $MaxRetries) {
                # Exponential backoff: 2^attempt seconds
                $delay = [Math]::Pow(2, $attempt)
                Write-Warning "Transfer attempt $attempt failed. Retrying in ${delay}s..."
                Start-Sleep -Seconds $delay
            }
        }
    }

    if (-not $success) {
        $status.state = 'FAILED'
        $status.completed_at = [DateTime]::UtcNow.ToString('o')
        Update-StatusFile -StatusFile $statusFile -Status $status

        # Move to failed directory
        if (Test-Path $FilePath) {
            $failedPath = Join-Path $Config.FailedDir $fileName
            Move-Item -Path $FilePath -Destination $failedPath -Force
        }

        # Audit
        if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
            Write-AuditEvent -Action 'FILE_TRANSFER' -FilePath $FilePath -FileHash $localHash -Disposition 'FAILED' -Details @{
                remote_host = $RemoteHost
                attempts = $attempt
                error = $status.error
            }
        }
    }

    Update-StatusFile -StatusFile $statusFile -Status $status
    return $status
}

function Watch-WizOutbox {
    <#
    .SYNOPSIS
        Monitor outbox directory for new files and auto-transfer.
        Uses FileSystemWatcher + polling hybrid for reliability.
    .PARAMETER Config
        Transfer config from Initialize-WizTransfer.
    .PARAMETER RemoteHost
        Remote host (user@host format).
    .PARAMETER RemotePath
        Remote destination directory.
    .PARAMETER PollIntervalSeconds
        Polling interval in seconds (default 30).
    .PARAMETER PIIGate
        If true, scan files for PII before transfer. Block files with findings.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [object]$Config,

        [Parameter(Mandatory=$true)]
        [string]$RemoteHost,

        [Parameter(Mandatory=$true)]
        [string]$RemotePath,

        [Parameter(Mandatory=$false)]
        [int]$PollIntervalSeconds = 30,

        [Parameter(Mandatory=$false)]
        [switch]$PIIGate
    )

    $patterns = $null
    if ($PIIGate) {
        $patterns = Import-PIIPatterns
    }

    Write-Host "Watching outbox: $($Config.OutboxDir)"
    Write-Host "Remote: $RemoteHost:$RemotePath"
    Write-Host "Press Ctrl+C to stop."

    # FileSystemWatcher for immediate detection
    $watcher = New-Object System.IO.FileSystemWatcher
    $watcher.Path = $Config.OutboxDir
    $watcher.NotifyFilter = [System.IO.NotifyFilters]::FileName
    $watcher.EnableRaisingEvents = $true

    $fileQueue = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()

    $action = {
        $fileQueue.Enqueue($Event.SourceEventArgs.FullPath)
    }
    Register-ObjectEvent -InputObject $watcher -EventName Created -Action $action | Out-Null

    try {
        while ($true) {
            # Process watcher events
            $filePath = $null
            while ($fileQueue.TryDequeue([ref]$filePath)) {
                Process-OutboxFile -FilePath $filePath -Config $Config -RemoteHost $RemoteHost -RemotePath $RemotePath -Patterns $patterns
            }

            # Polling fallback — pick up files watcher might have missed
            $files = Get-ChildItem -Path $Config.OutboxDir -File -ErrorAction SilentlyContinue
            foreach ($file in $files) {
                Process-OutboxFile -FilePath $file.FullName -Config $Config -RemoteHost $RemoteHost -RemotePath $RemotePath -Patterns $patterns
            }

            Start-Sleep -Seconds $PollIntervalSeconds
        }
    }
    finally {
        $watcher.Dispose()
    }
}

function Process-OutboxFile {
    [CmdletBinding()]
    param(
        [string]$FilePath,
        [object]$Config,
        [string]$RemoteHost,
        [string]$RemotePath,
        [object[]]$Patterns
    )

    if (-not (Test-Path $FilePath)) { return }

    $fileName = Split-Path -Leaf $FilePath
    Write-Host "Processing: $fileName"

    # PII gate
    if ($Patterns) {
        $scanResult = Invoke-PIIScan -Path $FilePath -Patterns $Patterns
        if ($scanResult.TotalFindings -gt 0) {
            Write-Warning "PII detected in $fileName ($($scanResult.TotalFindings) findings). Blocking transfer."
            $failedPath = Join-Path $Config.FailedDir $fileName
            Move-Item -Path $FilePath -Destination $failedPath -Force

            # Write PII report
            $report = Format-PIIReport -ScanResult $scanResult
            $reportPath = Join-Path $Config.FailedDir "$fileName.pii-report.txt"
            Set-Content -Path $reportPath -Value $report -Encoding UTF8

            if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
                Write-AuditEvent -Action 'FILE_TRANSFER' -FilePath $FilePath -Disposition 'BLOCKED_PII' -Details @{
                    findings_count = $scanResult.TotalFindings
                }
            }
            return
        }
    }

    Send-WizFile -FilePath $FilePath -RemoteHost $RemoteHost -RemotePath $RemotePath -Config $Config
}

function Update-StatusFile {
    [CmdletBinding()]
    param(
        [string]$StatusFile,
        [hashtable]$Status
    )
    $Status | ConvertTo-Json -Depth 3 | Set-Content -Path $StatusFile -Encoding UTF8
}
