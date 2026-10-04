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

Write-Host "--- Storage ---" -ForegroundColor Yellow
$disks = Get-PhysicalDisk -ErrorAction SilentlyContinue
if ($disks) {
    $disks | Format-Table FriendlyName, MediaType, BusType, Size -AutoSize
} else {
    Get-CimInstance Win32_DiskDrive | Format-Table Model, InterfaceType, Size -AutoSize
}

Write-Host "--- Memory modules (module count shows single vs dual channel) ---" -ForegroundColor Yellow
Get-CimInstance Win32_PhysicalMemory -ErrorAction SilentlyContinue | Format-Table BankLabel, Capacity, Speed, ConfiguredClockSpeed -AutoSize

Write-Host "--- Power / battery ---" -ForegroundColor Yellow
powercfg /getactivescheme 2>$null
Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue | Format-List BatteryStatus, EstimatedChargeRemaining

Write-Host "--- Defender real-time protection / Fast Startup ---" -ForegroundColor Yellow
Get-MpComputerStatus -ErrorAction SilentlyContinue | Select-Object RealTimeProtectionEnabled
reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Power" /v HiberbootEnabled 2>$null

Write-Host "--- WebView2 runtime ---" -ForegroundColor Yellow
(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}' -ErrorAction SilentlyContinue).pv

Write-Host "===============================================" -ForegroundColor Cyan

