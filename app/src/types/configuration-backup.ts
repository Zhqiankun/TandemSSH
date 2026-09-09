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
export interface BackupHost {
  ref: string;
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
  format: "tandemssh-configuration";
  version: 2;
  createdAt: string;
  hosts: BackupHost[];
  workflows: Array<{ ref: string; definition: WorkflowDefinition }>;
  preferences?: UiPreferences;
  appearance?: DesktopAppearance;
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
  }>;
  workflows: Array<{ name: string; steps: number }>;
  hasPreferences: boolean;
  keybindingsCount?: number;
  warnings: BackupWarning[];
}
export interface BackupImportResult {
  receiptId: string;
  hostIds: number[];
  workflowIds: string[];
  preferencesRestored: boolean;
  keybindingsImported?: number;
  desktopConfiguration?: DesktopConfiguration;
}
