# Builds the Windows installer Stachel-Setup-<version>.exe (Inno Setup) and optionally the MSIX for the Microsoft Store.
# Run in flutter/app (Windows PowerShell 5.1 or PowerShell 7), docs/release/desktop.md:
#   powershell -ExecutionPolicy Bypass -File windows\installer\build.ps1            # flutter build + installer
#   powershell -ExecutionPolicy Bypass -File windows\installer\build.ps1 -NoBuild   # installer from the existing build
#   powershell -ExecutionPolicy Bypass -File windows\installer\build.ps1 -Msix      # also build\windows\msix\stachel.msix
# Needs: Flutter, Visual Studio (C++ desktop workload), Inno Setup 6 (winget install JRSoftware.InnoSetup).
# Output: build\installer\Stachel-Setup-<version>.exe
param(
  [switch]$NoBuild,
  [switch]$Msix
)
$ErrorActionPreference = 'Stop'
$app = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $app

# version x.y.z from pubspec.yaml ("version: 1.2.0+4")
$line = Select-String -Path pubspec.yaml -Pattern '^version:\s*([0-9]+\.[0-9]+\.[0-9]+)' | Select-Object -First 1
if (-not $line) { throw 'pubspec.yaml: no version line "version: x.y.z+n"' }
$version = $line.Matches[0].Groups[1].Value
Write-Host "Stachel $version"

if (-not $NoBuild) {
  & flutter build windows --release
  if ($LASTEXITCODE -ne 0) { throw "flutter build windows failed ($LASTEXITCODE)" }
}
$release = Join-Path $app 'build\windows\x64\runner\Release'
if (-not (Test-Path (Join-Path $release 'stachel.exe'))) { throw "$release\stachel.exe missing - build first (without -NoBuild)" }

# Visual C++ runtime (app-local next to stachel.exe): newest Microsoft.VC14x.CRT of the Visual Studio installation
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'vswhere.exe not found - install Visual Studio with the C++ desktop workload' }
$vs = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'Visual Studio with C++ tools not found (vswhere)' }
$crt = Get-ChildItem -Path (Join-Path $vs 'VC\Redist\MSVC') -Directory |
  Where-Object { $_.Name -match '^[0-9]' } | Sort-Object { [version]$_.Name } -Descending |
  ForEach-Object { Get-ChildItem -Path (Join-Path $_.FullName 'x64') -Directory -Filter 'Microsoft.VC14*.CRT' -ErrorAction SilentlyContinue } |
  Select-Object -First 1
if (-not $crt) { throw "Microsoft.VC14x.CRT not found under $vs\VC\Redist\MSVC" }
Write-Host "VC runtime: $($crt.FullName)"

# Inno Setup compiler: per-user (winget --scope user) or machine-wide install, or on PATH
$iscc = @(
  (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6\ISCC.exe'),
  (Join-Path $env:ProgramFiles 'Inno Setup 6\ISCC.exe')
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { $iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source }
if (-not $iscc) { throw 'Inno Setup 6 not found - winget install JRSoftware.InnoSetup' }

& $iscc "/DAppVersion=$version" "/DReleaseDir=$release" "/DCrtDir=$($crt.FullName)" `
  "/DOutputDir=$(Join-Path $app 'build\installer')" (Join-Path $PSScriptRoot 'stachel.iss')
if ($LASTEXITCODE -ne 0) { throw "ISCC failed ($LASTEXITCODE)" }
Write-Host "-> build\installer\Stachel-Setup-$version.exe"

if ($Msix) {
  # unsigned package for the Store (the Store signs it); identity from msix_config in pubspec.yaml
  & dart run msix:create --store --build-windows false --output-path build\windows\msix --output-name stachel
  if ($LASTEXITCODE -ne 0) { throw "msix:create failed ($LASTEXITCODE)" }
  Write-Host '-> build\windows\msix\stachel.msix'
}
