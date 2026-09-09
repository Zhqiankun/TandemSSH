import type { WorkflowDefinition } from "./workflow.js";
import type { UiPreferences } from "./ui-preferences.js";
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
  version: 1;
  createdAt: string;
  hosts: BackupHost[];
  workflows: Array<{ ref: string; definition: WorkflowDefinition }>;
  preferences?: UiPreferences;
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
  warnings: BackupWarning[];
}
export interface BackupImportResult {
  receiptId: string;
  hostIds: number[];
  workflowIds: string[];
  preferencesRestored: boolean;
}
