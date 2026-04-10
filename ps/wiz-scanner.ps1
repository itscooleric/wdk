<#
.SYNOPSIS
    Wiz PII Scanner — PowerShell-native PII detection consuming pii-patterns.json.

.DESCRIPTION
    Standalone PII scanner using shared pattern config with the JS browser scanner.
    Two-pass design: fast regex gate + validators (Luhn, SSN area check).
    Supports CSV, TXT, and XLSX scanning. Quarantine workflow with findings report.

.NOTES
    Ticket: forge/datakit#3
    Sprint: C (PowerShell layer)
#>

# Requires wiz-audit.ps1 for audit logging
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Import-PIIPatterns {
    <#
    .SYNOPSIS
        Load PII patterns from pii-patterns.json.
    .PARAMETER PatternsPath
        Path to pii-patterns.json. Defaults to src/transforms/pii-patterns.json.
    .OUTPUTS
        Array of compiled pattern objects with regex, validators, and metadata.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$false)]
        [string]$PatternsPath
    )

    if (-not $PatternsPath) {
        $PatternsPath = Join-Path (Split-Path -Parent $scriptDir) 'src' 'transforms' 'pii-patterns.json'
    }

    if (-not (Test-Path $PatternsPath)) {
        throw "PII patterns file not found: $PatternsPath"
    }

    $json = Get-Content -Path $PatternsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $patterns = @()

    foreach ($p in $json.patterns) {
        $patterns += [PSCustomObject]@{
            Name             = $p.name
            EntityType       = $p.entity_type
            Severity         = $p.severity
            Regex            = [regex]::new($p.regex, 'IgnoreCase')
            Score            = $p.score
            ContextWords     = @($p.context_words)
            ContextBoost     = $p.context_score_boost
            Validation       = $p.validation
            Description      = $p.description
        }
    }

    return $patterns
}

function Test-Luhn {
    <#
    .SYNOPSIS
        Validate a number using the Luhn checksum algorithm.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Number)

    $digits = $Number -replace '\D', ''
    if ($digits.Length -lt 13 -or $digits.Length -gt 19) { return $false }

    $sum = 0
    $alt = $false
    for ($i = $digits.Length - 1; $i -ge 0; $i--) {
        $d = [int]::Parse($digits[$i].ToString())
        if ($alt) {
            $d *= 2
            if ($d -gt 9) { $d -= 9 }
        }
        $sum += $d
        $alt = -not $alt
    }
    return ($sum % 10) -eq 0
}

function Test-SSNArea {
    <#
    .SYNOPSIS
        Validate SSN area number (rejects 000, 666, 900-999, invalid groups/serials).
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$SSN)

    $digits = $SSN -replace '\D', ''
    if ($digits.Length -ne 9) { return $false }

    $area = [int]$digits.Substring(0, 3)
    $group = [int]$digits.Substring(3, 2)
    $serial = [int]$digits.Substring(5, 4)

    if ($area -eq 0 -or $area -eq 666 -or $area -ge 900) { return $false }
    if ($group -eq 0) { return $false }
    if ($serial -eq 0) { return $false }
    if ($digits -match '^(\d)\1{8}$') { return $false }

    return $true
}

function Invoke-PIIScan {
    <#
    .SYNOPSIS
        Scan a file for PII using shared pattern config.
    .PARAMETER Path
        File to scan (CSV, TXT, or XLSX).
    .PARAMETER Patterns
        Compiled pattern objects from Import-PIIPatterns.
    .PARAMETER MinScore
        Minimum confidence score to report (default 0.5).
    .OUTPUTS
        PSCustomObject with findings, summary, and metadata.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path,

        [Parameter(Mandatory=$true)]
        [object[]]$Patterns,

        [Parameter(Mandatory=$false)]
        [double]$MinScore = 0.5
    )

    if (-not (Test-Path $Path)) {
        throw "File not found: $Path"
    }

    $ext = [System.IO.Path]::GetExtension($Path).ToLower()
    $lines = @()

    switch ($ext) {
        '.xlsx' {
            $lines = Read-XlsxLines -Path $Path
        }
        default {
            # CSV, TXT, TSV — read as lines
            $lines = Get-Content -Path $Path -Encoding UTF8
        }
    }

    $findings = @()
    $summary = @{}
    foreach ($p in $Patterns) {
        $summary[$p.Name] = @{ Count = 0; Severity = $p.Severity; EntityType = $p.EntityType }
    }

    for ($lineNum = 0; $lineNum -lt $lines.Count; $lineNum++) {
        $line = $lines[$lineNum]
        if ([string]::IsNullOrWhiteSpace($line)) { continue }

        foreach ($pattern in $Patterns) {
            $matches = $pattern.Regex.Matches($line)
            foreach ($m in $matches) {
                $score = $pattern.Score
                $valid = $true

                # Pass 2: validation
                if ($pattern.Validation -eq 'luhn') {
                    $valid = Test-Luhn -Number $m.Value
                    if (-not $valid) { continue }
                    $score += 0.15
                }
                elseif ($pattern.Validation -eq 'ssn_area_check') {
                    $valid = Test-SSNArea -SSN $m.Value
                    if (-not $valid) { continue }
                    $score += 0.10
                }

                # Context scoring
                if ($pattern.ContextWords.Count -gt 0) {
                    $lower = $line.ToLower()
                    foreach ($cw in $pattern.ContextWords) {
                        if ($lower.Contains($cw)) {
                            $score += $pattern.ContextBoost
                            break
                        }
                    }
                }

                $score = [Math]::Min(1.0, $score)
                if ($score -lt $MinScore) { continue }

                # Redact match for safe reporting
                $redacted = Get-RedactedValue -Value $m.Value -EntityType $pattern.EntityType

                $findings += [PSCustomObject]@{
                    Line        = $lineNum + 1
                    Column      = $m.Index
                    PatternName = $pattern.Name
                    EntityType  = $pattern.EntityType
                    Severity    = $pattern.Severity
                    Match       = $redacted
                    Score       = [Math]::Round($score, 2)
                    Description = $pattern.Description
                }

                $summary[$pattern.Name].Count++
            }
        }
    }

    return [PSCustomObject]@{
        FilePath       = $Path
        FileName       = Split-Path -Leaf $Path
        LinesScanned   = $lines.Count
        TotalFindings  = $findings.Count
        Findings       = $findings
        Summary        = $summary
    }
}

function Read-XlsxLines {
    <#
    .SYNOPSIS
        Extract text lines from XLSX using ZipFile + XML parsing.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][string]$Path)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $lines = @()

    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)

        # Read shared strings
        $sharedStrings = @()
        $ssEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
        if ($ssEntry) {
            $reader = [System.IO.StreamReader]::new($ssEntry.Open())
            $ssXml = [xml]$reader.ReadToEnd()
            $reader.Close()
            foreach ($si in $ssXml.sst.si) {
                $text = if ($si.t -is [string]) { $si.t } else { $si.t.'#text' }
                $sharedStrings += $text
            }
        }

        # Read each sheet
        $sheetEntries = $zip.Entries | Where-Object { $_.FullName -match '^xl/worksheets/sheet\d+\.xml$' }
        foreach ($sheetEntry in $sheetEntries) {
            $reader = [System.IO.StreamReader]::new($sheetEntry.Open())
            $sheetXml = [xml]$reader.ReadToEnd()
            $reader.Close()

            foreach ($row in $sheetXml.worksheet.sheetData.row) {
                $cellValues = @()
                foreach ($cell in $row.c) {
                    $val = $cell.v
                    if ($cell.t -eq 's' -and $val -match '^\d+$') {
                        $idx = [int]$val
                        if ($idx -lt $sharedStrings.Count) {
                            $val = $sharedStrings[$idx]
                        }
                    }
                    $cellValues += $val
                }
                $lines += ($cellValues -join "`t")
            }
        }

        $zip.Dispose()
    }
    catch {
        Write-Warning "Failed to read XLSX: $_"
    }

    return $lines
}

function Get-RedactedValue {
    <#
    .SYNOPSIS
        Redact a matched value for safe display. Shows first 2 and last 2 chars.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Value,
        [Parameter(Mandatory=$false)][string]$EntityType = ''
    )

    if ($EntityType -eq 'CLASSIFICATION' -or $EntityType -eq 'EXPORT_CONTROL') {
        return $Value
    }
    if ($Value.Length -le 4) { return '****' }

    $middle = $Value.Substring(2, $Value.Length - 4) -replace '[A-Za-z0-9]', '*'
    return $Value.Substring(0, 2) + $middle + $Value.Substring($Value.Length - 2)
}

function Invoke-PIIQuarantine {
    <#
    .SYNOPSIS
        Scan a file and quarantine if PII is detected.
    .PARAMETER Path
        File to scan.
    .PARAMETER QuarantineDir
        Directory to move PII-containing files to.
    .PARAMETER Patterns
        Compiled pattern objects from Import-PIIPatterns.
    .PARAMETER ReportDir
        Directory for scan reports. Defaults to QuarantineDir.
    .OUTPUTS
        PSCustomObject with scan result and quarantine action taken.
    #>
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$Path,

        [Parameter(Mandatory=$true)]
        [string]$QuarantineDir,

        [Parameter(Mandatory=$true)]
        [object[]]$Patterns,

        [Parameter(Mandatory=$false)]
        [string]$ReportDir
    )

    if (-not $ReportDir) { $ReportDir = $QuarantineDir }

    # Ensure directories exist
    foreach ($dir in @($QuarantineDir, $ReportDir)) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }

    $result = Invoke-PIIScan -Path $Path -Patterns $Patterns
    $fileName = Split-Path -Leaf $Path

    $action = 'CLEAN'
    if ($result.TotalFindings -gt 0) {
        $action = 'QUARANTINED'

        # Move file to quarantine
        $quarantinePath = Join-Path $QuarantineDir $fileName
        Move-Item -Path $Path -Destination $quarantinePath -Force

        # Write findings report
        $reportName = "$($fileName).pii-report.txt"
        $reportPath = Join-Path $ReportDir $reportName
        $report = Format-PIIReport -ScanResult $result
        Set-Content -Path $reportPath -Value $report -Encoding UTF8
    }

    # Audit log
    if (Get-Command Write-AuditEvent -ErrorAction SilentlyContinue) {
        $hash = if (Test-Path $Path) { Get-FileHashSHA256 -Path $Path } else { 'quarantined' }
        Write-AuditEvent -Action 'FILE_SCAN' -FilePath $Path -FileHash $hash -Disposition $action -Details @{
            findings_count = $result.TotalFindings
            lines_scanned = $result.LinesScanned
        }
    }

    return [PSCustomObject]@{
        File      = $fileName
        Action    = $action
        Findings  = $result.TotalFindings
        Result    = $result
    }
}

function Format-PIIReport {
    <#
    .SYNOPSIS
        Format scan results as a human-readable text report.
    #>
    [CmdletBinding()]
    param([Parameter(Mandatory=$true)][object]$ScanResult)

    $lines = @()
    $lines += "PII Scan Report"
    $lines += "==============="
    $lines += "File: $($ScanResult.FileName)"
    $lines += "Lines scanned: $($ScanResult.LinesScanned)"
    $lines += "Total findings: $($ScanResult.TotalFindings)"
    $lines += ""

    $lines += "Summary:"
    foreach ($key in $ScanResult.Summary.Keys) {
        $s = $ScanResult.Summary[$key]
        if ($s.Count -gt 0) {
            $lines += "  ${key}: $($s.Count) ($($s.Severity))"
        }
    }
    $lines += ""

    if ($ScanResult.Findings.Count -gt 0) {
        $lines += "Findings:"
        $lines += "Line`tColumn`tType`tSeverity`tScore`tMatch"
        foreach ($f in $ScanResult.Findings) {
            $lines += "$($f.Line)`t$($f.Column)`t$($f.EntityType)`t$($f.Severity)`t$($f.Score)`t$($f.Match)"
        }
    } else {
        $lines += "No PII detected."
    }

    return ($lines -join "`n")
}
