# ==============================================================================
# Clypra Automated Performance & Cold-Start Benchmark Suite (Windows / HD 520)
# ==============================================================================
# Executes high-fidelity S1 and S2 benchmarks on Windows:
# - Clears OS Standby List using RAMMap64.exe -Et before cold runs
# - Measures 512 MB cache canary read throughput (MB/s)
# - Interleaves N cold / warm pairs for S1 and S2
# - Emits timestamped JSON reports and manifest.json
# ==============================================================================

[CmdletBinding()]
param (
    [int]$Runs = 5,
    [string]$AppPath = "",
    [string]$FixturesDir = "C:\clypra-fixtures",
    [string]$ResultsDir = "",
    [string]$RAMMapPath = "RAMMap64.exe",
    [switch]$SkipPurge,
    [switch]$S1Only,
    [switch]$S2Only
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot = Resolve-Path "$ScriptDir\..\.."

# Locate Clypra executable if not explicitly provided
if (-not $AppPath) {
    $Candidates = @(
        "$RepoRoot\src-tauri\target\release\clypra.exe",
        "$RepoRoot\src-tauri\target\release\bundle\nsis\Clypra.exe",
        "C:\clypra-build\clypra.exe"
    )
    foreach ($cand in $Candidates) {
        if (Test-Path $cand) {
            $AppPath = $cand
            break
        }
    }
}

if (-not (Test-Path $AppPath)) {
    Write-Error "Clypra executable not found. Please provide -AppPath or build release binary."
    exit 1
}

$S2Project = "$FixturesDir\benchmark_project_s2.json"
$CanaryFile = "$FixturesDir\cache_canary.bin"

if (-not (Test-Path $S2Project)) {
    Write-Warning "S2 Project fixture not found at $S2Project. Ensure C:\clypra-fixtures\ is populated."
}

# Timestamped results directory
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
if (-not $ResultsDir) {
    $ResultsDir = "$RepoRoot\scripts\benchmarks\results\windows_$Timestamp"
}
New-Item -ItemType Directory -Force -Path $ResultsDir | Out-Null

# Git metadata
$GitCommit = "unknown"
$GitDirty = $false
try {
    $GitCommit = (git -C $RepoRoot rev-parse HEAD).Trim()
    $status = (git -C $RepoRoot status --porcelain)
    if ($status) { $GitDirty = $true }
} catch {}

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " Starting Clypra Automated Benchmark Suite on Windows" -ForegroundColor Cyan
Write-Host " App:         $AppPath"
Write-Host " Results Dir: $ResultsDir"
Write-Host " Project:     $S2Project"
Write-Host " Git Commit:  $($GitCommit.Substring(0, [Math]::Min(10, $GitCommit.Length))) (dirty: $GitDirty)"
Write-Host " Runs:        $Runs pairs"
Write-Host "==============================================================================" -ForegroundColor Cyan

# Ensure 512 MB cache canary exists
if (-not (Test-Path $CanaryFile)) {
    Write-Host "Creating 512 MB cache canary file at $CanaryFile..."
    $buffer = New-Object byte[] (1024 * 1024)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $fs = [System.IO.File]::Create($CanaryFile)
    for ($i = 0; $i -lt 512; $i++) {
        $rng.GetBytes($buffer)
        $fs.Write($buffer, 0, $buffer.Length)
    }
    $fs.Close()
}

function Measure-CanaryThroughput {
    param([string]$Path)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $fs = [System.IO.File]::OpenRead($Path)
    $buf = New-Object byte[] (4 * 1024 * 1024)
    $total = 0
    while (($bytesRead = $fs.Read($buf, 0, $buf.Length)) -gt 0) {
        $total += $bytesRead
    }
    $fs.Close()
    $sw.Stop()
    $secs = $sw.Elapsed.TotalSeconds
    if ($secs -le 0) { $secs = 0.0001 }
    $mb_s = ($total / (1024.0 * 1024.0)) / $secs
    return [Math]::Round($mb_s, 1)
}

function Clear-WindowsCache {
    if ($SkipPurge) { return $null }
    Write-Host "  [PURGE] Emptying OS Standby List..." -ForegroundColor Yellow
    $purgeCode = 1
    try {
        $proc = Start-Process -FilePath $RAMMapPath -ArgumentList "-Et" -Wait -PassThru -NoNewWindow
        $purgeCode = $proc.ExitCode
        Write-Host "  [PURGE] RAMMap64 -Et exited with code $purgeCode"
    } catch {
        Write-Warning "Failed to execute $RAMMapPath. Ensure RAMMap64.exe is in PATH or specify -RAMMapPath."
    }
    Start-Sleep -Seconds 1
    $canarySpeed = Measure-CanaryThroughput -Path $CanaryFile
    Write-Host "  [CANARY] 512 MB read throughput: $canarySpeed MB/s" -ForegroundColor Yellow
    return @{ PurgeExitCode = $purgeCode; CanaryMbS = $canarySpeed }
}

$ManifestRuns = [System.Collections.ArrayList]::new()

function Run-SingleBench {
    param(
        [string]$Scenario,
        [string]$Warmth,
        [int]$Index,
        [bool]$IsS2
    )

    $ReportPath = "$ResultsDir\win_${Scenario}_${Warmth}_${Index}.json"
    Write-Host "------------------------------------------------------------------------------"
    Write-Host ">>> Running $Scenario ($Warmth) #$Index..." -ForegroundColor Green

    $canaryData = $null
    if ($Warmth -eq "cold") {
        $canaryData = Clear-WindowsCache
    }

    $benchArgs = @("--bench-report", $ReportPath, "--bench-auto-exit")
    if ($IsS2) {
        $benchArgs += @("--bench-project", $S2Project)
    }

    $proc = Start-Process -FilePath $AppPath -ArgumentList $benchArgs -PassThru
    $proc.WaitForExit(30000)
    $exitCode = $proc.ExitCode

    if (-not (Test-Path $ReportPath)) {
        Write-Error "ERROR: Report was not generated at $ReportPath (exit code $exitCode)"
        return
    }

    $sha256 = (Get-FileHash -Algorithm SHA256 -Path $ReportPath).Hash.ToLower()
    $mtime = (Get-Item $ReportPath).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")

    Write-Host "Completed $Scenario ($Warmth) #$Index: exit=$exitCode, sha256=$($sha256.Substring(0,16))..., mtime=$mtime"

    $entry = [ordered]@{
        file = "win_${Scenario}_${Warmth}_${Index}.json"
        scenario = $Scenario
        warmth = $Warmth
        index = $Index
        exitCode = $exitCode
        purgeExitCode = if ($canaryData) { $canaryData.PurgeExitCode } else { $null }
        canaryMbS = if ($canaryData) { $canaryData.CanaryMbS } else { $null }
        mtime = $mtime
        sha256 = $sha256
    }
    $ManifestRuns.Add($entry) | Out-Null
}

# Run S1
if (-not $S2Only) {
    Write-Host "[1/2] Running S1 benchmark (Launch to Interactive: $Runs pairs)..." -ForegroundColor Cyan
    for ($i = 1; $i -le $Runs; $i++) {
        Run-SingleBench -Scenario "s1" -Warmth "cold" -Index $i -IsS2 $false
        Run-SingleBench -Scenario "s1" -Warmth "warm" -Index $i -IsS2 $false
    }
}

# Run S2
if (-not $S1Only) {
    Write-Host "[2/2] Running S2 benchmark (Project Open to First Frame: $Runs pairs)..." -ForegroundColor Cyan
    for ($i = 1; $i -le $Runs; $i++) {
        Run-SingleBench -Scenario "s2" -Warmth "cold" -Index $i -IsS2 $true
        Run-SingleBench -Scenario "s2" -Warmth "warm" -Index $i -IsS2 $true
    }
}

# Write manifest.json
$Manifest = [ordered]@{
    timestamp = $Timestamp
    platform = "windows_x64"
    appPath = $AppPath
    gitCommit = $GitCommit
    gitDirty = $GitDirty
    resultsDir = $ResultsDir
    runs = $ManifestRuns
}
$Manifest | ConvertTo-Json -Depth 5 | Set-Content -Path "$ResultsDir\manifest.json" -Encoding UTF8

Write-Host "==============================================================================" -ForegroundColor Cyan
Write-Host " Windows benchmark suite completed! Results archived at: $ResultsDir"
Write-Host "==============================================================================" -ForegroundColor Cyan

# Run summarizer
try {
    python "$RepoRoot\scripts\summarize_reports.py" "$ResultsDir"
} catch {
    Write-Warning "Could not execute python summarizer: $_"
}
