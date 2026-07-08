param(
    [string]$Version = "v0.9.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot ".tools\uhppote-simulator"
$zipName = "uhppote-simulator_${Version}-windows-x64.zip"
$zipPath = Join-Path $targetDir $zipName
$url = "https://github.com/uhppoted/uhppote-simulator/releases/download/$Version/$zipName"

New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Write-Host "Download simulator from $url"
Invoke-WebRequest -Uri $url -OutFile $zipPath

Write-Host "Extract simulator to $targetDir"
Expand-Archive -Path $zipPath -DestinationPath $targetDir -Force

$exePath = Join-Path $targetDir "uhppote-simulator.exe"
if (-not (Test-Path $exePath)) {
    throw "Simulator executable not found at $exePath"
}

Write-Host "UHPPOTE simulator is ready: $exePath"
