# scripts/package-msix.ps1
# Packages Clypra as an MSIX bundle for Microsoft Store distribution.
#
# Usage:
#   pwsh scripts/package-msix.ps1
#   pwsh scripts/package-msix.ps1 -Version "1.5.3.0" -PackageName "AIEraDev.Clypra" -PublisherId "CN=..."

param (
    [string]$Version = "",
    [string]$PackageName = "AIEraDev.Clypra",
    [string]$PublisherId = "CN=4FAAB289-A6A7-4C83-ADB7-10B14A849298",
    [string]$PublisherDisplayName = "AIEraDev",
    [string]$Target = "x86_64-pc-windows-msvc",
    [string]$OutputDir = "dist",
    [switch]$NoPack
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rootDir = Split-Path -Parent $scriptDir
$srcTauriDir = Join-Path $rootDir "src-tauri"
$stageDir = Join-Path $rootDir "dist-msix"

Write-Host "============================================================"
Write-Host "[MSIX BUILD] Packaging Clypra for Microsoft Store"
Write-Host "============================================================"

# Resolve Version from package.json if not specified
if (-not $Version) {
    $pkgJsonPath = Join-Path $rootDir "package.json"
    if (Test-Path $pkgJsonPath) {
        $pkg = Get-Content $pkgJsonPath -Raw | ConvertFrom-Json
        $rawVersion = $pkg.version
        $parts = $rawVersion.Split('.')
        if ($parts.Count -eq 3) {
            $Version = "$rawVersion.0"
        } else {
            $Version = $rawVersion
        }
    } else {
        $Version = "1.5.4.0"
    }
}

Write-Host "[INFO] Target Architecture : $Target"
Write-Host "[INFO] Package Name        : $PackageName"
Write-Host "[INFO] Package Version     : $Version"
Write-Host "[INFO] Publisher ID        : $PublisherId"
Write-Host "[INFO] Publisher Name      : $PublisherDisplayName"

# Reset staging directory
if (Test-Path $stageDir) {
    Remove-Item -Recurse -Force $stageDir
}
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stageDir "Assets") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $stageDir "bin") | Out-Null

# 1. Locate and copy Clypra main executable
$exeCandidates = @(
    (Join-Path $srcTauriDir "target\$Target\release\clypra.exe"),
    (Join-Path $srcTauriDir "target\$Target\release\Clypra.exe"),
    (Join-Path $srcTauriDir "target\release\clypra.exe"),
    (Join-Path $srcTauriDir "target\release\Clypra.exe")
)

$foundExe = $null
foreach ($candidate in $exeCandidates) {
    if (Test-Path $candidate) {
        $foundExe = $candidate
        break
    }
}

if (-not $foundExe) {
    Write-Warning "[WARN] Clypra executable not found in target release directories."
    Write-Warning "[WARN] Expected build artifact before packaging. Run: npm run tauri build -- --no-bundle"
} else {
    Write-Host "[COPY] Copying executable: $foundExe -> clypra.exe"
    Copy-Item $foundExe -Destination (Join-Path $stageDir "clypra.exe")
}

# 2. Copy dynamic libraries (e.g. onnxruntime.dll from ort crate)
$dllDirs = @(
    (Join-Path $srcTauriDir "target\$Target\release"),
    (Join-Path $srcTauriDir "target\release")
)

foreach ($dir in $dllDirs) {
    if (Test-Path $dir) {
        Get-ChildItem -Path $dir -Filter "*.dll" | ForEach-Object {
            $dest = Join-Path $stageDir $_.Name
            if (-not (Test-Path $dest)) {
                Write-Host "[COPY] Copying DLL: $($_.Name)"
                Copy-Item $_.FullName -Destination $dest
            }
        }
    }
}

# 3. Copy static FFmpeg / FFprobe sidecars
$ffmpegSidecar = Join-Path $srcTauriDir "bin\ffmpeg-$Target.exe"
$ffprobeSidecar = Join-Path $srcTauriDir "bin\ffprobe-$Target.exe"

if (Test-Path $ffmpegSidecar) {
    Write-Host "[COPY] Bundling FFmpeg sidecar..."
    Copy-Item $ffmpegSidecar -Destination (Join-Path $stageDir "bin\ffmpeg.exe")
    Copy-Item $ffmpegSidecar -Destination (Join-Path $stageDir "ffmpeg.exe")
} else {
    Write-Warning "[WARN] FFmpeg sidecar not found at $ffmpegSidecar. Run setup-sidecars.ps1 first."
}

if (Test-Path $ffprobeSidecar) {
    Write-Host "[COPY] Bundling FFprobe sidecar..."
    Copy-Item $ffprobeSidecar -Destination (Join-Path $stageDir "bin\ffprobe.exe")
    Copy-Item $ffprobeSidecar -Destination (Join-Path $stageDir "ffprobe.exe")
} else {
    Write-Warning "[WARN] FFprobe sidecar not found at $ffprobeSidecar. Run setup-sidecars.ps1 first."
}

# 4. Copy Store Assets & Logos
$iconDir = Join-Path $srcTauriDir "icons"
if (Test-Path $iconDir) {
    Write-Host "[COPY] Staging Microsoft Store image assets..."
    Get-ChildItem -Path $iconDir -Filter "*.png" | ForEach-Object {
        Copy-Item $_.FullName -Destination (Join-Path $stageDir "Assets\$($_.Name)")
    }
} else {
    Write-Error "[ERROR] Icon directory not found at $iconDir!"
    exit 1
}

# 5. Populate AppxManifest.xml
$manifestTemplate = Join-Path $srcTauriDir "msix\AppxManifest.xml"
if (-not (Test-Path $manifestTemplate)) {
    Write-Error "[ERROR] AppxManifest.xml template missing at $manifestTemplate!"
    exit 1
}

$manifestContent = Get-Content $manifestTemplate -Raw
$manifestContent = $manifestContent.Replace("__VERSION__", $Version)
$manifestContent = $manifestContent.Replace("__PACKAGE_NAME__", $PackageName)
$manifestContent = $manifestContent.Replace("__PUBLISHER_ID__", $PublisherId)
$manifestContent = $manifestContent.Replace("__PUBLISHER_DISPLAY_NAME__", $PublisherDisplayName)

$targetManifest = Join-Path $stageDir "AppxManifest.xml"
Set-Content -Path $targetManifest -Value $manifestContent -Encoding UTF8
Write-Host "[GEN] Generated $targetManifest"

# 6. Packaging with MakeAppx.exe
if ($NoPack) {
    Write-Host "[OK] Staging complete (-NoPack specified). Staged files at: $stageDir"
    exit 0
}

Write-Host "==> Searching for MakeAppx.exe..."
$makeAppx = $null

# Check Windows SDK installations
$sdkKits = "C:\Program Files (x86)\Windows Kits\10\bin"
if (Test-Path $sdkKits) {
    $found = Get-ChildItem -Path $sdkKits -Recurse -Filter "makeappx.exe" -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -like "*\x64\*" } |
        Select-Object -Last 1
    if ($found) {
        $makeAppx = $found.FullName
    }
}

if (-not $makeAppx) {
    $cmd = Get-Command "makeappx.exe" -ErrorAction SilentlyContinue
    if ($cmd) {
        $makeAppx = $cmd.Source
    }
}

if (-not $makeAppx) {
    Write-Error "[ERROR] makeappx.exe not found. Ensure Windows 10/11 SDK is installed on this runner."
    exit 1
}

Write-Host "[FOUND] MakeAppx: $makeAppx"

$outPath = Join-Path $rootDir $OutputDir
if (-not (Test-Path $outPath)) {
    New-Item -ItemType Directory -Force -Path $outPath | Out-Null
}

$msixFile = Join-Path $outPath "Clypra_${Version}_x64.msix"
Write-Host "[PACK] Packing MSIX to $msixFile..."

& $makeAppx pack /d $stageDir /p $msixFile /nv /o
if ($LASTEXITCODE -ne 0) {
    Write-Error "[ERROR] MakeAppx failed with exit code $LASTEXITCODE"
    exit $LASTEXITCODE
}

Write-Host "============================================================"
Write-Host "[SUCCESS] Clypra MSIX created successfully: $msixFile"
Write-Host "============================================================"
