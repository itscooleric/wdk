@echo off
REM WDK Launcher — Windows .bat variant.
REM Reads launcher\sites.json, opens Chrome to each URL, prints
REM per-site checklist, and (optionally) starts the folder watcher
REM via the bundled Python launcher.
REM
REM No admin rights needed. Uses cmd.exe + powershell built-ins.
REM
REM Usage:
REM     wdk-launcher.bat                 - open browser tabs + print checklist
REM     wdk-launcher.bat --watch         - additionally start folder watcher
REM     wdk-launcher.bat --no-open       - skip browser, only checklist
REM
REM Requires: Python 3.8+ on PATH for --watch mode.

setlocal EnableDelayedExpansion

set "SCRIPT_DIR=%~dp0"
set "CONFIG=%SCRIPT_DIR%sites.json"
set "OPEN=1"
set "WATCH=0"

REM Args
:parse
if "%~1"=="" goto done
if /I "%~1"=="--config"  ( set "CONFIG=%~2" & shift & shift & goto parse )
if /I "%~1"=="--watch"   ( set "WATCH=1"  & shift & goto parse )
if /I "%~1"=="--no-open" ( set "OPEN=0"   & shift & goto parse )
echo [warn] unknown arg: %~1
shift
goto parse
:done

if not exist "%CONFIG%" (
    echo [error] config not found: %CONFIG%
    echo Run with --config ^<path^>.json or copy sites.example.json to sites.json
    exit /b 1
)

echo.
echo ================================================================
echo   WDK Launcher
echo   Config: %CONFIG%
echo ================================================================
echo.

REM Parse sites.json with PowerShell + collect URLs into a numbered
REM array (avoids cmd's tokenize-on-space-and-! when URLs are joined
REM into one string).
set "URL_COUNT=0"
for /f "usebackq delims=" %%U in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-Content -Raw '%CONFIG%' ^| ConvertFrom-Json).sites ^| ForEach-Object { $_.url }"`) do (
    set /a URL_COUNT+=1
    call set "URL_%%URL_COUNT%%=%%U"
)

if "!URL_COUNT!"=="0" (
    echo [error] no URLs found in %CONFIG%
    exit /b 1
)

REM Print the per-site checklist via PowerShell (richer formatting)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$cfg = Get-Content -Raw '%CONFIG%' | ConvertFrom-Json;" ^
    "$outbox = if ($cfg.outbox) { $cfg.outbox } else { './outbox' };" ^
    "Write-Host \"  Outbox: $outbox`n\";" ^
    "$i = 0; foreach ($s in $cfg.sites) { $i++;" ^
    "  Write-Host \"  [$i] $($s.name)   method=$($s.method)\";" ^
    "  Write-Host \"      url:  $($s.url)\";" ^
    "  if ($s.description) { Write-Host \"      note: $($s.description)\" };" ^
    "  if ($s.bookmarklet_file) { Write-Host \"      file: $($s.bookmarklet_file)\" };" ^
    "  if ($s.recorder_file)    { Write-Host \"      file: $($s.recorder_file)\" };" ^
    "  if ($s.filename_hint)    { Write-Host \"      drop: $outbox\\$($s.filename_hint)\" };" ^
    "  Write-Host '' }"

if "%OPEN%"=="1" (
    REM Find Chrome
    set "CHROME="
    if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe"      set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" if not defined CHROME set "CHROME=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"

    REM Open one tab per URL — iterate the numbered array so URLs with
    REM spaces / ampersands / bangs survive cmd's word-splitting.
    if defined CHROME (
        echo [ok] launching: !CHROME!
        for /l %%I in (1,1,!URL_COUNT!) do (
            call start "" "!CHROME!" "%%URL_%%I%%"
        )
    ) else (
        echo [warn] Chrome/Edge not found in standard paths; opening with default browser.
        for /l %%I in (1,1,!URL_COUNT!) do (
            call start "" "%%URL_%%I%%"
        )
    )
)

if "%WATCH%"=="1" (
    where python >nul 2>nul
    if errorlevel 1 (
        echo [error] python not on PATH; cannot run --watch.
        echo         Run wdk-launcher.py directly or install Python 3.8+.
        exit /b 1
    )
    echo.
    echo [watcher] Starting folder watcher (Ctrl+C to stop)...
    python "%SCRIPT_DIR%wdk-launcher.py" --config "%CONFIG%" --no-open --watch
)

echo.
echo Done. Run with --watch to fire the transfer pipeline on new files.
endlocal
