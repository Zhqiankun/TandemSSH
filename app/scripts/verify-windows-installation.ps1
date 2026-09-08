[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# Registry and shortcuts may be changed only on disposable hosted runners.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Installer validation requires a GitHub-hosted Windows runner.' }
$appRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$runnerRoot = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$reportRoot = Join-Path $appRoot 'release/installer-validation'
$ownedRoot = Join-Path $runnerRoot ('tandem-install-' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $ownedRoot 'TandemSSH'
$profile = Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'TandemSSH'
$version = (Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$') { throw 'Invalid package version' }
$installer = Join-Path $appRoot "release/TandemSSH-$version-x64.exe"
$executable = Join-Path $installRoot 'TandemSSH.exe'
$uninstaller = Join-Path $installRoot 'Uninstall TandemSSH.exe'
$marker = Join-Path $installRoot '.tandemssh-installed'
$start = Get-Date
$evidence = [ordered]@{ version = $version; installed = $false; native = $false; desktop = $false; uninstalled = $false; dataPreserved = $false }
$failures = [System.Collections.Generic.List[string]]::new()
function Assert-OwnedInstallPath {
  $full = [IO.Path]::GetFullPath($installRoot)
  if (-not $full.StartsWith($runnerRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Parent $full) -ne $ownedRoot -or (Split-Path -Leaf $full) -ne 'TandemSSH') { throw 'Installer path escaped its disposable directory' }
  $current = $full
  while ($current.Length -gt $runnerRoot.Length) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Installer path contains a reparse point' }
    $current = Split-Path -Parent $current
  }
}
function Get-TandemUninstallEntries {
  foreach ($registry in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    if (Test-Path -LiteralPath $registry) {
      Get-ChildItem -LiteralPath $registry | ForEach-Object {
        $item = Get-ItemProperty -LiteralPath $_.PSPath
        if ($null -ne $item -and $null -ne $item.PSObject.Properties['DisplayName'] -and $item.DisplayName -eq 'TandemSSH') { $item }
      }
    }
  }
}
function Invoke-InstallerProcess([string]$File, [string]$Arguments) {
  $process = Start-Process -FilePath $File -ArgumentList $Arguments -WorkingDirectory $ownedRoot -WindowStyle Hidden -PassThru
  if (-not $process.WaitForExit(180000)) { throw "Installer timed out: $($process.Id)" }
  $process.Refresh()
  if ($process.ExitCode -ne 0) { throw "Installer exit code: $($process.ExitCode)" }
}
Assert-OwnedInstallPath
if (@(Get-TandemUninstallEntries).Count -ne 0 -or (Test-Path -LiteralPath $profile) -or (Test-Path -LiteralPath $ownedRoot)) { throw 'Runner already contains TandemSSH installation or data' }
$startMenuLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'TandemSSH.lnk'
$desktopLink = Join-Path ([Environment]::GetFolderPath('DesktopDirectory')) 'TandemSSH.lnk'
if ((Test-Path -LiteralPath $startMenuLink) -or (Test-Path -LiteralPath $desktopLink)) { throw 'Pre-existing TandemSSH shortcut' }
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw 'Installer artifact missing' }
New-Item -ItemType Directory -Path $ownedRoot | Out-Null
New-Item -ItemType Directory -Path $reportRoot -Force | Out-Null
try {
  # NSIS /D must be last and unquoted, including destinations containing spaces.
  Invoke-InstallerProcess $installer "/S /currentuser --no-desktop-shortcut /D=$installRoot"
  Assert-OwnedInstallPath
  if ((Get-Content -LiteralPath $marker -Raw).Trim() -ne 'app.tandemssh.desktop/v1') { throw 'Invalid installed marker' }
  $baseline = Join-Path $appRoot 'release/win-unpacked/TandemSSH.exe'
  if ((Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash) { throw 'Installed executable differs from the built package' }
  $entries = @(Get-TandemUninstallEntries)
  if ($entries.Count -ne 1 -or $entries[0].DisplayVersion -ne $version -or $entries[0].UninstallString -ne ('"' + $uninstaller + '" /currentuser')) { throw 'Incorrect installed version or uninstall registration' }
  if (-not (Test-Path -LiteralPath $startMenuLink) -or (Test-Path -LiteralPath $desktopLink)) { throw 'Installer shortcut selection was not respected' }
  $evidence.installed = $true
  & node (Join-Path $PSScriptRoot 'verify-native-package.cjs') $installRoot 2>&1 | Tee-Object -FilePath (Join-Path $reportRoot 'native.log')
  if ($LASTEXITCODE -ne 0) { throw 'Installed native modules failed verification' }
  $evidence.native = $true
  & node (Join-Path $PSScriptRoot 'verify-installed-desktop.cjs') $installRoot $profile $reportRoot
  if ($LASTEXITCODE -ne 0) { throw 'Installed desktop failed verification' }
  $evidence.desktop = $true
  $databaseFile = Join-Path $profile 'server-data/db.sqlite.encrypted'
  if ((Get-Item -LiteralPath $databaseFile).Length -lt 128) { throw 'Application database was not persisted' }
  $databaseHash = (Get-FileHash -LiteralPath $databaseFile -Algorithm SHA256).Hash
  $sentinel = Join-Path $profile 'installer-validation.json'
  [IO.File]::WriteAllText($sentinel, '{"purpose":"uninstall must preserve user data"}')
  $sentinelHash = (Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash
} catch { $failures.Add($_.Exception.Message) }
finally {
  try {
    Assert-OwnedInstallPath
    $remaining = @(Get-Process -Name TandemSSH -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $executable -and $_.StartTime -ge $start })
    if ($remaining.Count -gt 0) {
      $failures.Add('The tested desktop left running processes')
      $remaining | Stop-Process -Force
    }
    if (Test-Path -LiteralPath $uninstaller -PathType Leaf) {
      if (((Get-Item -LiteralPath $uninstaller).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Uninstaller was substituted' }
      Invoke-InstallerProcess $uninstaller '/S /currentuser'
      # A copied uninstaller may outlive its original process. Observe actual removal too.
      $deadline = (Get-Date).AddSeconds(45)
      do {
        $removed = -not (Test-Path -LiteralPath $installRoot) -and @(Get-TandemUninstallEntries).Count -eq 0
        if ($removed) { break }
        Start-Sleep -Milliseconds 500
      } while ((Get-Date) -lt $deadline)
      if (-not $removed -or (Test-Path -LiteralPath $startMenuLink) -or (Test-Path -LiteralPath $desktopLink)) { throw 'Uninstall left application files, registration or shortcuts' }
      $evidence.uninstalled = $true
    } elseif ($evidence.installed) { throw 'Installed uninstaller missing' }
    if ($evidence.desktop) {
      if ((Get-FileHash -LiteralPath $sentinel -Algorithm SHA256).Hash -ne $sentinelHash -or (Get-FileHash -LiteralPath $databaseFile -Algorithm SHA256).Hash -ne $databaseHash) { throw 'Uninstall removed user data' }
      $evidence.dataPreserved = $true
    }
  } catch { $failures.Add($_.Exception.Message) }
  $evidence.failures = $failures.ToArray()
  $evidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $reportRoot 'installation.json') -Encoding utf8
}
if ($failures.Count -gt 0) { throw ($failures -join '; ') }
if (-not ($evidence.installed -and $evidence.native -and $evidence.desktop -and $evidence.uninstalled -and $evidence.dataPreserved)) { throw 'Installer verification incomplete' }
$evidence | ConvertTo-Json -Compress
