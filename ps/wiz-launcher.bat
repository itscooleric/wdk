@echo off
REM Wiz Launcher — bootstrap script for restricted Windows environments.
REM Bypasses PS execution policy, launches bridge + opens browser.
REM No admin rights needed. SHA-256 integrity check on startup.
REM
REM Ticket: forge/datakit#4
REM Sprint: C (PowerShell layer)

title Wiz Data Toolkit
echo.
echo  ██╗    ██╗██╗███████╗
echo  ██║    ██║██║╚══███╔╝
echo  ██║ █╗ ██║██║  ███╔╝
echo  ██║███╗██║██║ ███╔╝
echo  ╚███╔███╔╝██║███████╗
echo   ╚══╝╚══╝ ╚═╝╚══════╝
echo.
echo  Portable Data Engineering Toolkit
echo  ==================================
echo.

REM Determine script directory
set "SCRIPT_DIR=%~dp0"
set "PS_DIR=%SCRIPT_DIR%ps"
set "DIST_DIR=%SCRIPT_DIR%dist"

REM Check for required files
if not exist "%PS_DIR%\wiz-bridge.ps1" (
    echo [ERROR] wiz-bridge.ps1 not found in %PS_DIR%
    echo         Run this launcher from the Wiz toolkit root directory.
    pause
    exit /b 1
)

if not exist "%PS_DIR%\wiz-audit.ps1" (
    echo [ERROR] wiz-audit.ps1 not found in %PS_DIR%
    pause
    exit /b 1
)

REM Check for dist/wiz.html
if not exist "%DIST_DIR%\wiz.html" (
    echo [WARNING] dist/wiz.html not found. Checking for standalone...
    if exist "%SCRIPT_DIR%wiz.html" (
        set "DIST_DIR=%SCRIPT_DIR%"
        echo  Found wiz.html in root directory.
    ) else (
        echo [ERROR] No wiz.html found. Run 'node build.js' first.
        pause
        exit /b 1
    )
)

echo [1/3] Verifying file integrity...

REM SHA-256 integrity check of core toolkit files
REM Generate checksums on first run, verify on subsequent runs
set "CHECKSUM_FILE=%SCRIPT_DIR%.wiz-checksums"

if exist "%CHECKSUM_FILE%" (
    REM Verify existing checksums
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$checksums = Get-Content '%CHECKSUM_FILE%' | ConvertFrom-Json; $failed = $false; foreach ($entry in $checksums) { if (Test-Path $entry.path) { $hash = (Get-FileHash -Path $entry.path -Algorithm SHA256).Hash.ToLower(); if ($hash -ne $entry.sha256) { Write-Host \"[FAIL] $($entry.path): hash mismatch\" -ForegroundColor Red; $failed = $true } } else { Write-Host \"[WARN] $($entry.path): file missing\" -ForegroundColor Yellow } }; if ($failed) { Write-Host '[ERROR] Integrity check failed. Files may have been tampered with.' -ForegroundColor Red; exit 1 } else { Write-Host '  All checksums verified.' -ForegroundColor Green }"
    if errorlevel 1 (
        echo.
        echo Press any key to continue anyway, or Ctrl+C to abort.
        pause > nul
    )
) else (
    REM First run — generate checksums
    echo   First run: generating checksums...
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "$files = @(); $psDir = '%PS_DIR%'; $distDir = '%DIST_DIR%'; foreach ($f in (Get-ChildItem -Path $psDir -Filter '*.ps1')) { $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower(); $files += @{path=$f.FullName; sha256=$hash} }; foreach ($f in (Get-ChildItem -Path $distDir -Filter '*.html' -ErrorAction SilentlyContinue)) { $hash = (Get-FileHash -Path $f.FullName -Algorithm SHA256).Hash.ToLower(); $files += @{path=$f.FullName; sha256=$hash} }; $files | ConvertTo-Json -Depth 3 | Set-Content '%CHECKSUM_FILE%' -Encoding UTF8; Write-Host \"  Checksums saved for $($files.Count) files.\" -ForegroundColor Green"
)

echo.
echo [2/3] Initializing audit log...

REM Set up audit logging
set "AUDIT_LOG=%SCRIPT_DIR%logs\wiz-audit.jsonl"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    ". '%PS_DIR%\wiz-audit.ps1'; Initialize-WizAudit -LogPath '%AUDIT_LOG%'; Write-Host '  Audit log: %AUDIT_LOG%' -ForegroundColor Green"

echo.
echo [3/3] Starting Wiz Bridge...
echo.

REM Find an available port starting from 8080
set "PORT=8080"

REM Launch the bridge server (blocks until Ctrl+C)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    ". '%PS_DIR%\wiz-audit.ps1'; . '%PS_DIR%\wiz-scanner.ps1'; . '%PS_DIR%\wiz-bridge.ps1'; Initialize-WizAudit -LogPath '%AUDIT_LOG%'; Start-WizBridge -Port %PORT% -WebRoot '%DIST_DIR%' -OpenBrowser"

echo.
echo Wiz Bridge stopped.
pause
