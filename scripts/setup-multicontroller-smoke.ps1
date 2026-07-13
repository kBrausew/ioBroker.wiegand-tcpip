param(
    [string]$Profile = "default"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$simulatorExe = Join-Path $repoRoot ".tools\uhppote-simulator\uhppote-simulator.exe"
$profileDir = Join-Path $repoRoot ".dev-server\$Profile"
$ioPackagePath = Join-Path $repoRoot "io-package.json"

if (-not (Test-Path $ioPackagePath)) {
    throw "Run this setup in adapter root repository (io-package.json missing)."
}

Push-Location $repoRoot
try {
    if (-not (Test-Path $simulatorExe)) {
        Write-Host "Simulator missing - running setup script..."
        & powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot "scripts\setup-uhppote-simulator.ps1")
    }
    else {
        Write-Host "Simulator already present: $simulatorExe"
    }

    if (-not (Test-Path $profileDir)) {
        Write-Host "Dev-server profile '$Profile' missing - running dev-server setup..."
        & npx @iobroker/dev-server setup
    }
    else {
        Write-Host "Dev-server profile found: $profileDir"
    }

    if (-not (Test-Path $profileDir)) {
        throw "Dev-server profile '$Profile' is still missing after setup."
    }

    Write-Host "Smoke setup finished."
    Write-Host "Next: npm run smoke:multicontroller"
    Write-Host "Or persistent lab: npm run devlab:start"
}
finally {
    Pop-Location
}
