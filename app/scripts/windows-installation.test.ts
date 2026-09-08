import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const scripts = path.dirname(fileURLToPath(import.meta.url));
const installer = path.join(scripts, "verify-windows-installation.ps1");

describe.skipIf(process.platform !== "win32")(
  "isolated Windows installer verification",
  () => {
    it("refuses installer and desktop execution outside a hosted CI lifetime", () => {
      const env = { ...process.env, GITHUB_ACTIONS: "false" };
      for (const [command, args] of [
        ["pwsh.exe", ["-NoProfile", "-NonInteractive", "-File", installer]],
        [
          process.execPath,
          [path.join(scripts, "verify-installed-desktop.cjs")],
        ],
      ] as const) {
        const result = spawnSync(command, [...args], {
          env,
          windowsHide: true,
          encoding: "utf8",
          timeout: 10000,
        });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(1);
        expect(result.stderr + result.stdout).toContain(
          "GitHub-hosted Windows runner",
        );
      }
    });
    it("enumerates empty registry entries under strict mode without weakening product matching", () => {
      // Load only the actual read-only function; no installer/process/mutation function is executed.
      const script = `
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:TANDEM_INSTALLER_SCRIPT, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Script parse failed' }
$reader = $ast.Find({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Get-TandemUninstallEntries'}, $true)
. ([scriptblock]::Create($reader.Extent.Text))
function Test-Path { return $true }
function Get-ChildItem { @('null', 'empty', 'unrelated', 'match') | ForEach-Object { [pscustomobject]@{PSPath=$_} } }
function Get-ItemProperty {
  param([string]$LiteralPath)
  switch ($LiteralPath) {
    'null' { return $null }
    'empty' { return [pscustomobject]@{} }
    'unrelated' { return [pscustomobject]@{DisplayName='Other app'} }
    'match' { return [pscustomobject]@{DisplayName='TandemSSH'} }
  }
}
$result = @(Get-TandemUninstallEntries)
if ($result.Count -ne 3) { throw 'Registry enumeration lost valid matches' }
Write-Output 'REGISTRY_READER_OK'
`;
      const result = spawnSync(
        "pwsh.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          env: { ...process.env, TANDEM_INSTALLER_SCRIPT: installer },
          windowsHide: true,
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("REGISTRY_READER_OK");
    });
  },
);
