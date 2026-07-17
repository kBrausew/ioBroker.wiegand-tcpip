param(
    [string]$Profile = "default",
    [int]$BindPort = 60000,
    [int]$RestPort = 18000,
    [string]$AdminUrl = "http://127.0.0.1:8081",
    [switch]$NoOpenBrowser
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$simulatorExe = Join-Path $repoRoot ".tools\uhppote-simulator\uhppote-simulator.exe"
$simulatorDevicesDir = Join-Path $repoRoot ".tools\uhppote-simulator\devices"
$profileDir = Join-Path $repoRoot ".dev-server\$Profile"
$runtimeDir = Join-Path $repoRoot ".dev-server\smoke-runtime"
$pidFile = Join-Path $runtimeDir "processes.json"
$devLog = Join-Path $runtimeDir "dev-server.log"
$devErrLog = Join-Path $runtimeDir "dev-server.err.log"
$profileAdapterDir = Join-Path $profileDir "node_modules\iobroker.wiegand-tcpip"

function Sync-WorkspaceAdapterToProfile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$SourceRoot,
        [Parameter(Mandatory = $true)]
        [string]$TargetRoot
    )

    if (-not (Test-Path $TargetRoot)) {
        throw "Profile adapter path not found: $TargetRoot`nRun once: npx @iobroker/dev-server setup"
    }

    $copyFiles = @(
        "main.js",
        "io-package.json",
        "package.json",
        "README.md",
        "LICENSE"
    )

    foreach ($file in $copyFiles) {
        $src = Join-Path $SourceRoot $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $TargetRoot $file) -Force
        }
    }

    foreach ($dirName in @("admin", "lib", "docs")) {
        $srcDir = Join-Path $SourceRoot $dirName
        $dstDir = Join-Path $TargetRoot $dirName
        if (Test-Path $dstDir) {
            Remove-Item -Path $dstDir -Recurse -Force
        }
        if (Test-Path $srcDir) {
            Copy-Item -Path $srcDir -Destination $dstDir -Recurse -Force
        }
    }
}

function Wait-HttpOk {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    throw "Timeout waiting for URL: $Url"
}

function Invoke-SimulatorSeed {
    param(
        [int]$RestPort
    )

    $baseUrl = "http://127.0.0.1:$RestPort/uhppote/simulator"
    $controllers = @(405419896, 405419897)

    foreach ($controllerId in $controllers) {
        try {
            Invoke-RestMethod -Method Delete -Uri "$baseUrl/$controllerId" | Out-Null
        }
        catch {
            # Controller may not exist yet.
        }

        $createBody = @{
            "device-id" = $controllerId
            "device-type" = "UT0311-L04"
            compressed = $false
        } | ConvertTo-Json

        Invoke-RestMethod -Method Post -Uri $baseUrl -Body $createBody -ContentType "application/json" | Out-Null
    }

    $cards = @(
        @{ controller = 405419896; card = 10058400; pin = 1357 },
        @{ controller = 405419897; card = 10058400; pin = 1357 },
        @{ controller = 405419896; card = 10059999; pin = 0 },
        @{ controller = 405419896; card = 10051111; pin = 0 },
        @{ controller = 405419897; card = 10051111; pin = 0 }
    )

    foreach ($entry in $cards) {
        $cardBody = @{
            "start-date" = "2026-01-01"
            "end-date" = "2027-12-31"
            doors = @(1)
            PIN = $entry.pin
        } | ConvertTo-Json

        Invoke-RestMethod -Method Put -Uri "$baseUrl/$($entry.controller)/cards/$($entry.card)" -Body $cardBody -ContentType "application/json" | Out-Null

        $swipeBody = @{
            door = 1
            "card-number" = $entry.card
            direction = 1
            PIN = $entry.pin
        } | ConvertTo-Json

        Invoke-RestMethod -Method Post -Uri "$baseUrl/$($entry.controller)/swipe" -Body $swipeBody -ContentType "application/json" | Out-Null
    }
}

if (-not (Test-Path $simulatorExe)) {
    throw "Simulator not found: $simulatorExe`nRun: npm run simulator:setup"
}

if (-not (Test-Path $profileDir)) {
    throw "Dev-server profile '$Profile' not found in $profileDir`nRun once: npx @iobroker/dev-server setup"
}

if (-not (Test-Path (Join-Path $repoRoot "io-package.json"))) {
    throw "Run this script in adapter root repository (io-package.json missing)."
}

New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
New-Item -ItemType Directory -Force -Path $simulatorDevicesDir | Out-Null

Sync-WorkspaceAdapterToProfile -SourceRoot $repoRoot -TargetRoot $profileAdapterDir

if (Test-Path $pidFile) {
    $existing = Get-Content $pidFile -Raw | ConvertFrom-Json
    $existingSim = Get-Process -Id $existing.simulatorPid -ErrorAction SilentlyContinue
    $existingDev = Get-Process -Id $existing.devServerPid -ErrorAction SilentlyContinue
    if ($existingSim -or $existingDev) {
        throw "Dev lab seems to be running already (PID file: $pidFile). Run stop script first."
    }
}

$simulatorArgs = @(
    "--bind", "127.0.0.1:$BindPort",
    "--rest", "127.0.0.1:$RestPort",
    "--devices", $simulatorDevicesDir
)

$simulatorProc = Start-Process -FilePath $simulatorExe -ArgumentList $simulatorArgs -WorkingDirectory $repoRoot -PassThru -WindowStyle Hidden
Wait-HttpOk -Url "http://127.0.0.1:$RestPort/uhppote/simulator" -TimeoutSeconds 20
Invoke-SimulatorSeed -RestPort $RestPort

if (Test-Path $devLog) { Remove-Item $devLog -Force }
if (Test-Path $devErrLog) { Remove-Item $devErrLog -Force }

$devProc = Start-Process -FilePath "npx.cmd" -ArgumentList "@iobroker/dev-server", "run", $Profile -WorkingDirectory $repoRoot -PassThru -RedirectStandardOutput $devLog -RedirectStandardError $devErrLog -WindowStyle Hidden

try {
    # First start can take longer because adapter/admin files are uploaded into profile.
    Wait-HttpOk -Url $AdminUrl -TimeoutSeconds 180
}
catch {
    Start-Sleep -Seconds 5
    Wait-HttpOk -Url $AdminUrl -TimeoutSeconds 120
}

$runtime = [PSCustomObject]@{
    startedAt = (Get-Date).ToString("o")
    profile = $Profile
    bindPort = $BindPort
    restPort = $RestPort
    adminUrl = $AdminUrl
    simulatorPid = $simulatorProc.Id
    devServerPid = $devProc.Id
    logs = @{
        stdout = $devLog
        stderr = $devErrLog
    }
}

$runtime | ConvertTo-Json -Depth 8 | Set-Content -Path $pidFile -Encoding UTF8

Write-Host "Dev lab started successfully."
Write-Host "Admin UI: $AdminUrl"
Write-Host "Simulator REST: http://127.0.0.1:$RestPort/uhppote/simulator"
Write-Host "Simulator UI: http://127.0.0.1:$RestPort/uhppote/simulator"
Write-Host "Stop with: npm run devlab:stop"

if (-not $NoOpenBrowser) {
    Start-Process $AdminUrl | Out-Null
    Start-Process "http://127.0.0.1:$RestPort/uhppote/simulator" | Out-Null
}
