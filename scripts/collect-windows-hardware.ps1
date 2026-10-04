# ==============================================================================
# Collects Windows hardware specifications for the Clypra benchmark report
# ==============================================================================

Write-Host "=== Clypra Benchmark Hardware Specs (Windows) ===" -ForegroundColor Cyan

$cpu = Get-CimInstance Win32_Processor | Select-Object -ExpandProperty Name
Write-Host "CPU: $cpu"

$ramGb = [math]::Round(((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1GB), 1)
Write-Host "RAM: $ramGb GB"

$os = (Get-CimInstance Win32_OperatingSystem).Caption
$osBuild = (Get-CimInstance Win32_OperatingSystem).BuildNumber
Write-Host "OS: $os (Build $osBuild)"

Write-Host "--- GPU & Displays ---" -ForegroundColor Yellow
Get-CimInstance Win32_VideoController | Select-Object Name, DriverVersion, CurrentRefreshRate, VideoModeDescription | Format-Table -AutoSize

Write-Host "--- Storage Type ---" -ForegroundColor Yellow
Get-PhysicalDisk | Select-Object FriendlyName, MediaType, BusType, Size | Format-Table -AutoSize

Write-Host "===============================================" -ForegroundColor Cyan
