[CmdletBinding()]
param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][ValidateSet('cancel','approve','installer')][string]$Action, [Parameter(Mandatory)][string]$Report)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Upgrade UI verification requires a GitHub-hosted Windows runner.' }
$runnerRoot = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$expected = (Resolve-Path -LiteralPath $Executable).Path
if (-not $expected.StartsWith($runnerRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Upgrade UI target escaped the disposable runner directory' }
if ((Get-FileHash -LiteralPath $expected -Algorithm SHA256).Hash -ne $Sha256) { throw 'Upgrade UI executable digest mismatch' }
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$events = [System.Collections.Generic.List[object]]::new()
$deadline = (Get-Date).AddSeconds(180)
$observed = [System.Collections.Generic.HashSet[string]]::new()
$seen = $false
$finished = $false
try {
  while ((Get-Date) -lt $deadline) {
    $targets = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($expected)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected })
    if ($seen -and $targets.Count -eq 0 -and $Action -eq 'installer') { $finished = $true; break }
    foreach ($target in $targets) {
      $seen = $true
      $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$target.Id)
      $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
      foreach ($window in $windows) {
        if ($observed.Count -lt 100) { [void]$observed.Add('Window: ' + $window.Current.Name) }
        if ($Action -ne 'installer' -and $window.Current.Name -ne '安装同舟 SSH 更新') { continue }
        $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
        foreach ($button in $buttons) {
          $name = $button.Current.Name.Replace('&','').Trim()
          if ($observed.Count -lt 100) { [void]$observed.Add('Button: ' + $name) }
          $match = if ($Action -eq 'cancel') { $name -eq '取消' } elseif ($Action -eq 'approve') { $name -eq '现在安装' } else { $name -match '^(Finish|完成|Install|安装|Next\s*>?|下一步\s*>?)(\([A-Z]\))?$' }
          if (-not $match -or -not $button.Current.IsEnabled -or $button.Current.IsOffscreen) { continue }
          $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $events.Add([ordered]@{ processId=$target.Id; window=$window.Current.Name; button=$name })
          $pattern.Invoke()
          if ($Action -ne 'installer') { $finished = $true }
          Start-Sleep -Milliseconds 500
          break
        }
        if ($finished) { break }
      }
      if ($finished) { break }
    }
    if ($finished) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $finished -or $events.Count -eq 0) { throw 'Owned upgrade UI did not finish the expected confirmation' }
} finally {
  [ordered]@{ action=$Action; finished=$finished; events=$events.ToArray(); observed=@($observed) } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $Report -Encoding utf8
}
