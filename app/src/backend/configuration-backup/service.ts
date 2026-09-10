import { createHash, randomUUID } from "node:crypto";
import type { DesktopConfiguration } from "../../types/desktop-preferences.js";
import type {
  ConfigurationBackup,
  BackupPreview,
  BackupImportResult,
  BackupWarning,
} from "../../types/configuration-backup.js";
import {
  MAX_BACKUP_BYTES,
  parseConfigurationBackup,
  projectConfigurationBackup,
} from "./schema.js";
export interface BackupSnapshot {
  fingerprint: string;
  hosts: Array<Record<string, unknown>>;
  workflows: Array<{ definition: unknown }>;
  preferences?: unknown;
  appearance?: unknown;
  keybindings?: unknown;
  terminalDefaults?: unknown;
  customThemes?: unknown;
  tunnelPresets?: Array<Record<string, unknown>>;
}
interface PreviewRecord {
  owner: string;
  preview: BackupPreview;
  payload: ConfigurationBackup;
  fingerprint: string;
  settled?: boolean;
  apply?: {
    preferences: boolean;
    keybindings: boolean;
    promise: Promise<BackupImportResult>;
  };
}
export class ConfigurationBackupService {
  private readonly previews = new Map<string, PreviewRecord>();
  constructor(
    private readonly ports: {
      snapshot(userId: string): Promise<BackupSnapshot>;
      apply(
        userId: string,
        request: {
          id: string;
          fingerprint: string;
          digest: string;
          payload: ConfigurationBackup;
          restorePreferences: boolean;
          restoreKeybindings?: boolean;
        },
      ): Promise<BackupImportResult>;
      audit(userId: string, type: string, data: unknown): Promise<void>;
    },
  ) {}
  private add(
    owner: string,
    direction: BackupPreview["direction"],
    payload: ConfigurationBackup,
    warnings: BackupWarning[],
    fingerprint: string,
  ): BackupPreview {
    for (const [id, record] of this.previews)
      if (
        record.preview.expiresAt < Date.now() &&
        (!record.apply || record.settled)
      )
        this.previews.delete(id);
    if (this.previews.size >= 32) throw Error("BACKUP_PREVIEW_LIMIT");
    const content = JSON.stringify(payload, null, 2);
    const bytes = Buffer.byteLength(content);
    if (bytes > MAX_BACKUP_BYTES) throw Error("BACKUP_TOO_LARGE");
    const preview: BackupPreview = {
      id: randomUUID(),
      direction,
      expiresAt: Date.now() + 5 * 60 * 1000,
      bytes,
      content,
      hosts: payload.hosts.map(
        ({ name, ip, port, username, originalAuthType }) => ({
          name,
          ip,
          port,
          username,
          originalAuthType,
        }),
      ),
      workflows: payload.workflows.map((row) => ({
        name: row.definition.name,
        steps: row.definition.steps.length,
      })),
      hasPreferences:
        !!payload.preferences ||
        !!payload.appearance ||
        !!payload.terminalDefaults ||
        !!payload.terminalThemes?.length,
      terminalThemeCount: payload.terminalThemes?.length ?? 0,
      hasTerminalDefaults: !!payload.terminalDefaults,
      keybindingsCount: payload.keybindings?.length ?? 0,
      jumpHostCount: payload.hosts.reduce(
        (n, h) => n + (h.network?.jumpHostRefs.length ?? 0),
        0,
      ),
      tunnelCount:
        payload.hosts.reduce(
          (n, h) => n + (h.network?.tunnels.length ?? 0),
          0,
        ) +
        (payload.tunnelPresets ?? []).reduce((n, p) => n + p.tunnels.length, 0),
      tunnelPresetCount: payload.tunnelPresets?.length ?? 0,
      warnings,
    };
    this.previews.set(preview.id, { owner, preview, payload, fingerprint });
    return structuredClone(preview);
  }
  async previewExport(
    userId: string,
    desktop?: DesktopConfiguration,
  ): Promise<BackupPreview> {
    const snapshot = await this.ports.snapshot(userId),
      data = projectConfigurationBackup(
        snapshot.hosts,
        snapshot.workflows,
        desktop?.preferences ?? snapshot.preferences,
        desktop?.appearance ?? snapshot.appearance,
        snapshot.keybindings,
        snapshot.tunnelPresets,
        { defaults: snapshot.terminalDefaults, themes: snapshot.customThemes },
      );
    return this.add(
      userId,
      "export",
      data.payload,
      data.warnings,
      snapshot.fingerprint,
    );
  }
  async previewImport(userId: string, content: string): Promise<BackupPreview> {
    if (Buffer.byteLength(content) > MAX_BACKUP_BYTES)
      throw Error("BACKUP_TOO_LARGE");
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      throw Error("BACKUP_INVALID");
    }
    const { payload, warnings } = parseConfigurationBackup(value),
      snapshot = await this.ports.snapshot(userId);
    return this.add(userId, "import", payload, warnings, snapshot.fingerprint);
  }
  private record(
    userId: string,
    id: string,
    direction: BackupPreview["direction"],
  ): PreviewRecord {
    const record = this.previews.get(id);
    if (
      !record ||
      record.owner !== userId ||
      record.preview.direction !== direction
    )
      throw Error("BACKUP_PREVIEW_NOT_FOUND");
    if (record.preview.expiresAt < Date.now() && !record.apply)
      throw Error("BACKUP_PREVIEW_EXPIRED");
    return record;
  }
  async download(userId: string, id: string): Promise<string> {
    const record = this.record(userId, id, "export");
    await this.ports.audit(userId, "configuration-backup.export", {
      hosts: record.payload.hosts.length,
      workflows: record.payload.workflows.length,
    });
    return JSON.stringify(record.payload, null, 2);
  }
  apply(
    userId: string,
    id: string,
    restorePreferences: boolean,
    restoreKeybindings = false,
  ): Promise<BackupImportResult> {
    const record = this.record(userId, id, "import");
    if (record.apply) {
      if (
        record.apply.preferences !== restorePreferences ||
        record.apply.keybindings !== restoreKeybindings
      )
        throw Error("BACKUP_CONFIRMATION_CHANGED");
      return record.apply.promise;
    }
    record.settled = false;
    const promise = (async () => {
      await this.ports.audit(userId, "configuration-backup.import-requested", {
        id,
        hosts: record.payload.hosts.length,
        workflows: record.payload.workflows.length,
        restorePreferences,
        restoreKeybindings,
      });
      return this.ports.apply(userId, {
        id,
        fingerprint: record.fingerprint,
        digest: createHash("sha256")
          .update(
            JSON.stringify({
              payload: record.payload,
              restorePreferences,
              restoreKeybindings,
            }),
          )
          .digest("hex"),
        payload: record.payload,
        restorePreferences,
        restoreKeybindings,
      });
    })();
    record.apply = {
      preferences: restorePreferences,
      keybindings: restoreKeybindings,
      promise,
    };
    void promise
      .finally(() => {
        record.settled = true;
      })
      .catch(() => {});
    void promise.catch(() => {
      record.apply = undefined;
    });
    return promise;
  }
}
