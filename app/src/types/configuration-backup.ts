import type {
  TerminalAppearance,
  BackupTerminalTheme,
} from "./terminal-appearance.js";
import type { WorkflowDefinition } from "./workflow.js";
import type { UiPreferences } from "./ui-preferences.js";
import type {
  DesktopAppearance,
  DesktopConfiguration,
} from "./desktop-preferences.js";
import type { KeyCombo, DefaultKeybindingId } from "./keybindings.js";
export interface BackupKeybinding {
  ref: string;
  combo: KeyCombo;
  action:
    | { type: "copy" | "paste" }
    | { type: "sendControlCode"; controlCode: string }
    | { type: "sendText"; text: string; appendEnter?: boolean }
    | { type: "runSnippet"; snippetRef: string; appendEnter?: boolean };
  originalEnabled: boolean;
  overridesDefaultId?: DefaultKeybindingId;
}
export interface BackupTunnel {
  scope: "s2s" | "c2s";
  mode: "local" | "remote" | "dynamic";
  sourceHostRef: string;
  endpointHostRef?: string;
  bindHost: string;
  targetHost?: string;
  sourcePort: number;
  endpointPort: number;
  maxRetries: number;
  retryInterval: number;
}
export interface BackupNetwork {
  jumpHostRefs: string[];
  tunnels: BackupTunnel[];
}
export interface BackupPreset {
  ref: string;
  name: string;
  tunnels: BackupTunnel[];
}
export interface BackupHost {
  terminalEncoding?: import("./terminal-encoding.js").TerminalEncoding;
  ref: string;
  network?: BackupNetwork;
  terminalAppearance?: TerminalAppearance;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  notes: string;
  credentialRef: string;
  originalAuthType: string;
}
export interface ConfigurationBackup {
  desktopLayout?: import("./desktop-layout.js").DesktopLayout;
  localTunnels?: Array<BackupTunnel & { displayName?: string }>;
  hostDefaults?: import("./backup-host-defaults.js").BackupHostDefaults;
  format: "tandemssh-configuration";
  version: 2 | 3;
  tunnelPresets?: BackupPreset[];
  createdAt: string;
  hosts: BackupHost[];
  workflows: Array<{ ref: string; definition: WorkflowDefinition }>;
  preferences?: UiPreferences;
  appearance?: DesktopAppearance;
  terminalDefaults?: TerminalAppearance;
  terminalThemes?: BackupTerminalTheme[];
  keybindings?: BackupKeybinding[];
}
export interface BackupWarning {
  code: string;
  path: string;
}
export interface BackupPreview {
  id: string;
  direction: "export" | "import";
  expiresAt: number;
  bytes: number;
  content: string;
  hosts: Array<{
    name: string;
    ip: string;
    port: number;
    username: string;
    originalAuthType: string;
    terminalEncoding?: import("./terminal-encoding.js").TerminalEncoding;
  }>;
  workflows: Array<{ name: string; steps: number }>;
  hasPreferences: boolean;
  localTunnelCount?: number;
  hasHostDefaults?: boolean;
  keybindingsCount?: number;
  jumpHostCount?: number;
  tunnelCount?: number;
  tunnelPresetCount?: number;
  terminalThemeCount?: number;
  hasTerminalDefaults?: boolean;
  warnings: BackupWarning[];
}
export interface PendingLocalBackup {
  at: number;
  result: BackupImportResult;
}
export interface BackupImportResult {
  receiptId: string;
  localTunnels?: Array<
    import("./index.js").TunnelConnection & { displayName?: string }
  >;
  hostDefaultsRestored?: boolean;
  hostIds: number[];
  workflowIds: string[];
  preferencesRestored: boolean;
  keybindingsImported?: number;
  terminalThemesImported?: number;
  tunnelPresetIds?: number[];
  desktopConfiguration?: DesktopConfiguration;
}
