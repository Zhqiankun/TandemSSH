[CmdletBinding()]
param([Parameter(Mandatory)][string]$Executable, [Parameter(Mandatory)][string]$Sha256, [Parameter(Mandatory)][ValidateSet('cancel','approve','installer')][string]$Action, [Parameter(Mandatory)][string]$Report)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows') { throw 'Upgrade UI verification requires a GitHub-hosted Windows runner.' }
$runnerRoot = (Resolve-Path -LiteralPath $env:RUNNER_TEMP).Path
$expected = (Resolve-Path -LiteralPath $Executable).Path
if (-not $expected.StartsWith($runnerRoot.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Upgrade UI target escaped the disposable runner directory' }
if ((Get-FileHash -LiteralPath $expected -Algorithm SHA256).Hash -ne $Sha256) { throw 'Upgrade UI executable digest mismatch' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TandemUpgradeNativeWindows {
  public class Window { public IntPtr Handle; public IntPtr Root; public string ClassName; public string Text; public bool Visible; public bool Enabled; }
  public delegate bool Visitor(IntPtr window, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumWindows(Visitor callback, IntPtr data);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr root, Visitor callback, IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll", SetLastError=true)] static extern bool PostMessage(IntPtr window, uint message, IntPtr wparam, IntPtr lparam);
  static Window Read(IntPtr handle, IntPtr root) { var text=new StringBuilder(1024);var name=new StringBuilder(256);GetWindowText(handle,text,text.Capacity);GetClassName(handle,name,name.Capacity);return new Window {Handle=handle,Root=root,ClassName=name.ToString(),Text=text.ToString(),Visible=IsWindowVisible(handle),Enabled=IsWindowEnabled(handle)}; }
  public static Window[] ForProcess(int processId) {
    var rows=new List<Window>();
    EnumWindows((window,data)=>{uint actual;GetWindowThreadProcessId(window,out actual);if(actual!=(uint)processId)return true;rows.Add(Read(window,window));EnumChildWindows(window,(child,unused)=>{uint owner;GetWindowThreadProcessId(child,out owner);if(owner==(uint)processId)rows.Add(Read(child,window));return true;},IntPtr.Zero);return true;},IntPtr.Zero);
    return rows.ToArray();
  }
  public static bool Click(IntPtr handle,int processId) {uint actual;GetWindowThreadProcessId(handle,out actual);var row=Read(handle,handle);return actual==(uint)processId&&row.ClassName=="Button"&&row.Visible&&row.Enabled&&PostMessage(handle,0x00F5,IntPtr.Zero,IntPtr.Zero);}
}

'@
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$events = [System.Collections.Generic.List[object]]::new()
$deadline = (Get-Date).AddSeconds(180)
$observed = [System.Collections.Generic.HashSet[string]]::new()
$seen = $false
$finished = $false
$finishingInstaller = $false
try {
  while ((Get-Date) -lt $deadline) {
    $targets = @(Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($expected)) -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $expected })
    if ($seen -and $targets.Count -eq 0 -and $Action -eq 'installer') { $finished = $true; break }
    foreach ($target in $targets) {
      if ($finishingInstaller) { continue }
      $seen = $true
      $native = @([TandemUpgradeNativeWindows]::ForProcess([int]$target.Id))
      $clickedNative = $false
      foreach ($rootWindow in @($native | Where-Object { $_.Handle -eq $_.Root })) {
        $nativeButtons = @($native | Where-Object { $_.Root -eq $rootWindow.Handle -and $_.ClassName -eq 'Button' })
        foreach ($item in $nativeButtons) { if ($observed.Count -lt 100) { [void]$observed.Add('Native button: ' + $rootWindow.ClassName + ' / ' + $rootWindow.Text + ' / ' + $item.Text) } }
        $nativeNames = @($nativeButtons | ForEach-Object { $_.Text.Replace('&','').Trim() })
        if ($Action -ne 'installer' -and ($nativeNames -notcontains '取消' -or $nativeNames -notcontains '现在安装')) { continue }
        foreach ($button in $nativeButtons) {
          $name = $button.Text.Replace('&','').Trim()
          $match = if ($Action -eq 'cancel') { $name -eq '取消' } elseif ($Action -eq 'approve') { $name -eq '现在安装' } else { $name -match '^(Finish|完成|Install|安装|Next\s*>?|下一步\s*>?)(\([A-Z]\))?$' }
          if ($match -and [TandemUpgradeNativeWindows]::Click($button.Handle,[int]$target.Id)) {
            $events.Add([ordered]@{ processId=$target.Id; window=$rootWindow.Text; button=$name; method='native-button-message' })
            if ($Action -eq 'installer' -and $name -match '^(Finish|完成)') { $finishingInstaller = $true }
            $clickedNative = $true
            if ($Action -ne 'installer') { $finished = $true }
            break
          }
        }
        if ($clickedNative) { break }
      }
      if ($clickedNative) { Start-Sleep -Milliseconds 500; if ($finished) { break }; continue }

      $condition = [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]$target.Id)
      $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)
      foreach ($window in $windows) {
        if ($observed.Count -lt 100) { [void]$observed.Add('Window: ' + $window.Current.Name) }

        $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button))
        foreach ($item in $buttons) { if ($observed.Count -lt 100) { [void]$observed.Add('UIA button: ' + $item.Current.Name) } }
        if ($Action -ne 'installer') {
          $names = @($buttons | ForEach-Object { $_.Current.Name.Replace('&','').Trim() })
          if ($names -notcontains '现在安装' -or $names -notcontains '取消') { continue }
        }
        foreach ($button in $buttons) {
          $name = $button.Current.Name.Replace('&','').Trim()
          if ($observed.Count -lt 100) { [void]$observed.Add('Button: ' + $name) }
          $match = if ($Action -eq 'cancel') { $name -eq '取消' } elseif ($Action -eq 'approve') { $name -eq '现在安装' } else { $name -match '^(Finish|完成|Install|安装|Next\s*>?|下一步\s*>?)(\([A-Z]\))?$' }
          if (-not $match -or -not $button.Current.IsEnabled -or $button.Current.IsOffscreen) { continue }
          $pattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $events.Add([ordered]@{ processId=$target.Id; window=$window.Current.Name; button=$name })
          $pattern.Invoke()
          if ($Action -eq 'installer' -and $name -match '^(Finish|完成)') { $finishingInstaller = $true }
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
