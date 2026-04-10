<#
.SYNOPSIS
    Wiz Audit Logger — append-only JSON Lines audit log.

.DESCRIPTION
    Provides audit logging for all Wiz toolkit operations.
    Timestamps, operator identity, action type, file SHA-256 hash, disposition.
    Never logs PII content itself. NIST 800-53 AU family alignment.

.NOTES
    Ticket: forge/datakit#5
    Sprint: C (PowerShell layer)
#>

$script:AuditLogPath = $null
$script:OperatorIdentity = $null

function Initialize-WizAudit {
    <#
    .SYNOPSIS
        Initialize audit logging with a log file path and operator identity.
    .PARAMETER LogPath
        Path to the JSON Lines audit log file.
    .PARAMETER Operator
        Operator identity string (username, workstation, etc.).
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$LogPath,

        [Parameter(Mandatory=$false)]
        [string]$Operator = "$env:USERNAME@$env:COMPUTERNAME"
    )

    $script:AuditLogPath = $LogPath
    $script:OperatorIdentity = $Operator

    # Ensure log directory exists
    $logDir = Split-Path -Parent $LogPath
    if ($logDir -and -not (Test-Path $logDir)) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }

    # Write session start event
    Write-AuditEvent -Action 'SESSION_START' -Details @{
        toolkit_version = '1.0.0'
        powershell_version = $PSVersionTable.PSVersion.ToString()
        os = [System.Environment]::OSVersion.ToString()
    }
}

function Write-AuditEvent {
    <#
    .SYNOPSIS
        Write a single audit event to the JSON Lines log.
    .PARAMETER Action
        Action type (e.g., FILE_SCAN, FILE_TRANSFER, SESSION_START).
    .PARAMETER FilePath
        Optional file path associated with the action.
    .PARAMETER FileHash
        Optional SHA-256 hash of the file.
    .PARAMETER Disposition
        Outcome of the action (e.g., CLEAN, PII_DETECTED, TRANSFERRED, ERROR).
    .PARAMETER Details
        Optional hashtable of additional details.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Action,

        [Parameter(Mandatory=$false)]
        [string]$FilePath,

        [Parameter(Mandatory=$false)]
        [string]$FileHash,

        [Parameter(Mandatory=$false)]
        [string]$Disposition,

        [Parameter(Mandatory=$false)]
        [hashtable]$Details
    )

    if (-not $script:AuditLogPath) {
        Write-Warning "Audit log not initialized. Call Initialize-WizAudit first."
        return
    }

    $event = [ordered]@{
        timestamp  = [DateTime]::UtcNow.ToString('o')
        operator   = $script:OperatorIdentity
        action     = $Action
    }

    if ($FilePath) {
        # Log filename only, not full path (avoid leaking directory structure)
        $event.file = Split-Path -Leaf $FilePath
        $event.file_size = if (Test-Path $FilePath) { (Get-Item $FilePath).Length } else { $null }
    }

    if ($FileHash) {
        $event.sha256 = $FileHash
    }

    if ($Disposition) {
        $event.disposition = $Disposition
    }

    if ($Details) {
        $event.details = $Details
    }

    $json = $event | ConvertTo-Json -Compress -Depth 5
    Add-Content -Path $script:AuditLogPath -Value $json -Encoding UTF8
}

function Get-FileHashSHA256 {
    <#
    .SYNOPSIS
        Compute SHA-256 hash of a file.
    .PARAMETER Path
        File path to hash.
    .OUTPUTS
        Lowercase hex string of the SHA-256 hash.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path
    )

    if (-not (Test-Path $Path)) {
        return $null
    }

    $hash = Get-FileHash -Path $Path -Algorithm SHA256
    return $hash.Hash.ToLower()
}

function Write-AuditSessionEnd {
    <#
    .SYNOPSIS
        Write a session end event to the audit log.
    #>
    [CmdletBinding()]
    param()

    Write-AuditEvent -Action 'SESSION_END' -Details @{
        log_file = $script:AuditLogPath
    }
}

function Get-AuditLog {
    <#
    .SYNOPSIS
        Read and parse the audit log.
    .PARAMETER LogPath
        Path to the audit log file.
    .PARAMETER Last
        Number of most recent entries to return.
    .OUTPUTS
        Array of parsed audit event objects.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$false)]
        [string]$LogPath = $script:AuditLogPath,

        [Parameter(Mandatory=$false)]
        [int]$Last = 0
    )

    if (-not $LogPath -or -not (Test-Path $LogPath)) {
        return @()
    }

    $lines = Get-Content -Path $LogPath -Encoding UTF8
    $events = @()
    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        if ($trimmed -eq '') { continue }
        try {
            $events += ($trimmed | ConvertFrom-Json)
        } catch {
            # Skip malformed lines
        }
    }

    if ($Last -gt 0 -and $events.Count -gt $Last) {
        $events = $events[($events.Count - $Last)..($events.Count - 1)]
    }

    return $events
}

# Export functions
if ($MyInvocation.ScriptName -ne '') {
    # Dot-sourced or run directly — functions are available in scope
} else {
    Export-ModuleMember -Function Initialize-WizAudit, Write-AuditEvent, Get-FileHashSHA256, Write-AuditSessionEnd, Get-AuditLog
}
