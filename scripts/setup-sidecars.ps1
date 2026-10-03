# scripts/setup-sidecars.ps1
# Downloads and cryptographically verifies static FFmpeg and FFprobe sidecars for Windows.
#
# Usage:
#   pwsh scripts/setup-sidecars.ps1
#   pwsh scripts/setup-sidecars.ps1 -Force

param (
    [string]$Target = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$detectedArch = $env:PROCESSOR_ARCHITECTURE
if (-not $Target) {
    if ($detectedArch -eq "ARM64") {
        $Target = "aarch64-pc-windows-msvc"
    } else {
        $Target = "x86_64-pc-windows-msvc"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $scriptDir
$binDir = Join-Path $projectRoot "src-tauri\bin"

if (-not (Test-Path $binDir)) {
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
}

$baseUrl = "https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"

$artifacts = @(
    @{
        name = "ffmpeg"
        file = "ffmpeg-win32-x64.gz"
        dest = "ffmpeg-x86_64-pc-windows-msvc.exe"
        sha  = "8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77"
    },
    @{
        name = "ffprobe"
        file = "ffprobe-win32-x64.gz"
        dest = "ffprobe-x86_64-pc-windows-msvc.exe"
        sha  = "f309e6223ad89d2fe54bccd420a7709b66fd27540674e92309578ed491a43c8d"
    }
)

Write-Host "============================================================"
Write-Host "[INFO] Host PROCESSOR_ARCHITECTURE: $detectedArch"
Write-Host "[INFO] Installing static sidecars for target: $Target"
Write-Host "============================================================"

if ($Target -eq "aarch64-pc-windows-msvc") {
    $arm64ZipUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-31-13-27/ffmpeg-n8.1.2-50-g1a748fe2cd-winarm64-gpl-8.1.zip"
    $arm64ZipSha = "722be613f4fdb0b114671515c44a747edd86b814d4e367ca11b10df4539e6e74"

    $ffmpegDest = Join-Path $binDir "ffmpeg-aarch64-pc-windows-msvc.exe"
    $ffprobeDest = Join-Path $binDir "ffprobe-aarch64-pc-windows-msvc.exe"

    if (-not $Force -and (Test-Path $ffmpegDest) -and (Test-Path $ffprobeDest)) {
        $sizeFfmpeg = (Get-Item $ffmpegDest).Length
        $sizeFfprobe = (Get-Item $ffprobeDest).Length
        if ($sizeFfmpeg -gt 1000000 -and $sizeFfprobe -gt 1000000) {
            Write-Host "[OK] Windows ARM64 sidecars already installed. Pass -Force to re-download."
            return
        }
    }

    $tempDir = [System.IO.Path]::GetTempPath()
    $zipPath = Join-Path $tempDir "ffmpeg-winarm64.zip"
    $extractDir = Join-Path $tempDir "ffmpeg-winarm64-extract"

    Write-Host "[DOWNLOAD] Downloading Windows ARM64 FFmpeg package..."
    curl.exe -fsSL "$arm64ZipUrl" -o "$zipPath"

    Write-Host "[VERIFY] Verifying SHA-256 digest..."
    $actualSha = (Get-FileHash -Algorithm SHA256 -Path "$zipPath").Hash.ToLower()
    if ($actualSha -ne $arm64ZipSha) {
        Remove-Item -Force "$zipPath" -ErrorAction SilentlyContinue
        Write-Error "[ERROR] SHA-256 mismatch for Windows ARM64 FFmpeg package! Expected: $arm64ZipSha, Got: $actualSha"
        exit 1
    }
    Write-Host "[VERIFIED] SHA-256 verified: $actualSha"

    Write-Host "[EXTRACT] Extracting ARM64 binaries to $binDir..."
    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Expand-Archive -Path "$zipPath" -DestinationPath "$extractDir" -Force

    $srcFfmpeg = Get-ChildItem -Path $extractDir -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1
    $srcFfprobe = Get-ChildItem -Path $extractDir -Recurse -Filter "ffprobe.exe" | Select-Object -First 1

    if (-not $srcFfmpeg -or -not $srcFfprobe) {
        Write-Error "[ERROR] Could not find ffmpeg.exe or ffprobe.exe in extracted archive!"
        exit 1
    }

    Copy-Item -Force $srcFfmpeg.FullName $ffmpegDest
    Copy-Item -Force $srcFfprobe.FullName $ffprobeDest

    Remove-Item -Force "$zipPath" -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force "$extractDir" -ErrorAction SilentlyContinue

    Write-Host "[OK] Successfully installed Windows ARM64 sidecars: ffmpeg and ffprobe"
    return
}

foreach ($item in $artifacts) {
    $destPath = Join-Path $binDir $item.dest

    if (-not $Force -and (Test-Path $destPath)) {
        $existingSize = (Get-Item $destPath).Length
        if ($existingSize -gt 1000000) {
            Write-Host "[OK] Sidecar already installed: $($item.dest) ($existingSize bytes). Pass -Force to re-download."
            continue
        }
    }

    $url = "$baseUrl/$($item.file)"
    $tempDir = [System.IO.Path]::GetTempPath()
    $gzPath = Join-Path $tempDir "$($item.file)"

    Write-Host "[DOWNLOAD] Downloading $($item.name) from $url..."
    curl.exe -fsSL "$url" -o "$gzPath"

    Write-Host "[VERIFY] Verifying SHA-256 digest for $($item.file)..."
    $actualSha = (Get-FileHash -Algorithm SHA256 -Path "$gzPath").Hash.ToLower()
    if ($actualSha -ne $item.sha) {
        Remove-Item -Force "$gzPath" -ErrorAction SilentlyContinue
        Write-Error "[ERROR] SHA-256 mismatch for $($item.file)! Expected: $($item.sha), Got: $actualSha"
        exit 1
    }
    Write-Host "[VERIFIED] SHA-256 verified: $actualSha"

    Write-Host "[EXTRACT] Decompressing to $destPath..."
    $inStream = [System.IO.File]::OpenRead($gzPath)
    $gzStream = [System.IO.Compression.GZipStream]::new($inStream, [System.IO.Compression.CompressionMode]::Decompress)
    $outStream = [System.IO.File]::Create($destPath)
    $gzStream.CopyTo($outStream)
    $outStream.Close()
    $gzStream.Close()
    $inStream.Close()
    Remove-Item -Force "$gzPath" -ErrorAction SilentlyContinue

    $installedSize = (Get-Item $destPath).Length
    Write-Host "[OK] Successfully installed $($item.dest) ($installedSize bytes)"
}

Write-Host ""
Write-Host "[SUCCESS] Sidecars successfully configured!"
