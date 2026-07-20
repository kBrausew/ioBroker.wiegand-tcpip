$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $repoRoot ".dev-server\smoke-runtime"
$pidFile = Join-Path $runtimeDir "processes.json"

function Stop-ProcessTree {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return
    }

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if (-not $process) {
        return
    }

    try {
        & taskkill /PID $ProcessId /T /F | Out-Null
    }
    catch {
        # Ignore process stop errors during cleanup.
    }
}

function Is-DevLabProcess {
    param([string]$CommandLine)

    if (-not $CommandLine) {
        return $false
    }

    return (
        $CommandLine -match "@iobroker/dev-server\s+run" -or
        $CommandLine -match "iobroker\.js-controller[\\/]controller\.js" -or
        $CommandLine -match "uhppote-simulator\.exe" -or
        $CommandLine -match "\\.dev-server\\"
    )
}

if (Test-Path $pidFile) {
    $runtime = Get-Content $pidFile -Raw | ConvertFrom-Json
    Stop-ProcessTree -ProcessId ([int]$runtime.devServerPid)
    Stop-ProcessTree -ProcessId ([int]$runtime.simulatorPid)
    if ($runtime.dashboardPid -and [int]$runtime.dashboardPid -gt 0) {
        Stop-ProcessTree -ProcessId ([int]$runtime.dashboardPid)
    }
}

$repoRootEscaped = [Regex]::Escape($repoRoot)
$candidates = Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and (
        (($_.CommandLine -match $repoRootEscaped) -and (Is-DevLabProcess -CommandLine $_.CommandLine)) -or
        ($_.CommandLine -match "@iobroker/dev-server\s+run\s+default")
    )
}

foreach ($candidate in $candidates) {
    Stop-ProcessTree -ProcessId $candidate.ProcessId
}

$ports = @(8081, 18000, 24426, 26426, 3100, 9228)
foreach ($port in $ports) {
    $listeners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($listener in $listeners) {
        $owningPid = [int]$listener.OwningProcess
        if ($owningPid -le 0) {
            continue
        }

        $procInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $owningPid" -ErrorAction SilentlyContinue
        if ($procInfo -and (Is-DevLabProcess -CommandLine $procInfo.CommandLine)) {
            Stop-ProcessTree -ProcessId $owningPid
        }
    }
}

if (Test-Path $pidFile) {
    Remove-Item $pidFile -Force
}

Write-Host "Dev lab stopped."
