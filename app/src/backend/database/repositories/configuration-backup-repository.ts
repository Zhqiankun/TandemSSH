/* eslint-disable no-restricted-syntax -- Desktop-only synchronous SQLite transaction: assertDesktopStorage rejects every non-SQLite dialect before any query. */
import { and, eq, gte, lt } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import {
  hosts,
  users,
  c2sTunnelPresets,
  settings,
  uiPreferences,
  userPreferences,
} from "../db/schema.js";
import {
  restoreTunnel,
  validateNetworkReferences,
} from "../../configuration-backup/network.js";
import { appendTerminalThemes } from "../../configuration-backup/terminal.js";
import { restoreHostDefaults } from "../../../types/backup-host-defaults.js";
import { restoreKeybindings } from "../../configuration-backup/keyboard.js";
import type { DesktopConfiguration } from "../../../types/desktop-preferences.js";
import type { DatabaseContext } from "./database-context.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { updateCachedSetting } from "./settings-cache.js";
import type {
  ConfigurationBackup,
  BackupImportResult,
} from "../../../types/configuration-backup.js";
import type { SavedWorkflow } from "../../../types/workflow.js";
import { parseWorkflow } from "../../collaboration/workflows/definition.js";
import { sanitizeUiPreferences } from "../../../types/ui-preferences.js";
const workflowKey = (userId: string) => `tandem-workflows:${userId}`;
const receiptPrefix = (userId: string) =>
  `tandem-config-import:${encodeURIComponent(userId)}:`;
/** Desktop configuration restore is one synchronous SQLite transaction across its declared data set. */
export class ConfigurationBackupRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => Promise<void>,
  ) {}
  private assertDesktopStorage() {
    if (this.context.dialect !== "sqlite")
      throw Error("BACKUP_SQLITE_REQUIRED");
  }
  private receipts(
    db: Pick<DatabaseContext["drizzle"], "select">,
    userId: string,
  ) {
    const prefix = receiptPrefix(userId);
    return db
      .select()
      .from(settings)
      .where(
        and(gte(settings.key, prefix), lt(settings.key, prefix + "\uffff")),
      )
      .all();
  }
  async pendingLocal(userId: string) {
    this.assertDesktopStorage();
    DataCrypto.validateUserAccess(userId);
    return this.receipts(this.context.drizzle, userId)
      .map(
        (row) =>
          JSON.parse(row.value) as {
            at: number;
            localCompleted?: boolean;
            result: BackupImportResult;
          },
      )
      .filter((row) => row.result.localTunnels?.length && !row.localCompleted)
      .sort((a, b) => a.at - b.at)
      .map((row) => ({
        at: row.at,
        result: {
          receiptId: row.result.receiptId,
          hostIds: row.result.hostIds,
          workflowIds: row.result.workflowIds,
          preferencesRestored: false,
          localTunnels: row.result.localTunnels,
        },
      }));
  }
  async completeLocal(userId: string, id: string) {
    this.assertDesktopStorage();
    DataCrypto.validateUserAccess(userId);
    this.context.drizzle.transaction((tx) => {
      const key = receiptPrefix(userId) + id;
      const row = tx.select().from(settings).where(eq(settings.key, key)).get();
      if (!row) throw Error("BACKUP_PREVIEW_NOT_FOUND");
      const receipt = JSON.parse(row.value);
      if (!receipt.result?.localTunnels?.length) throw Error("BACKUP_INVALID");
      tx.update(settings)
        .set({ value: JSON.stringify({ ...receipt, localCompleted: true }) })
        .where(eq(settings.key, key))
        .run();
    });
    await this.onWrite?.();
  }
  private state(
    db: Pick<DatabaseContext["drizzle"], "select">,
    userId: string,
  ) {
    const rows = db.select().from(hosts).where(eq(hosts.userId, userId)).all();
    const tunnelPresets = db
      .select()
      .from(c2sTunnelPresets)
      .where(eq(c2sTunnelPresets.userId, userId))
      .all();
    const rawWorkflows =
      db
        .select()
        .from(settings)
        .where(eq(settings.key, workflowKey(userId)))
        .get()?.value ?? "[]";
    const rawPreferences = db
      .select()
      .from(uiPreferences)
      .where(eq(uiPreferences.userId, userId))
      .get()?.data;
    const application = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .get();
    const isAdmin =
      db
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, userId))
        .get()?.isAdmin === true;
    const rawHostDefaults = isAdmin
      ? db
          .select()
          .from(settings)
          .where(eq(settings.key, "host_defaults"))
          .get()?.value
      : undefined;
    const applicationConfiguration = application
      ? {
          theme: application.theme,
          fontSize: application.fontSize,
          accentColor: application.accentColor,
          language: application.language,
          hiddenRailTabs: application.hiddenRailTabs,
          customKeybindings: application.customKeybindings,
          terminalDefaults: application.terminalDefaults,
          customThemes: application.customThemes,
        }
      : undefined;
    const configuration = rows.map((row) => ({
      id: row.id,
      name: row.name,
      ip: row.ip,
      port: row.port,
      username: row.username,
      folder: row.folder,
      tags: row.tags,
      pin: row.pin,
      notes: row.notes,
      authType: row.authType,
      credentialId: row.credentialId,
      jumpHosts: row.jumpHosts,
      tunnelConnections: row.tunnelConnections,
      terminalConfig: row.terminalConfig,
    }));
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          configuration,
          tunnelPresets,
          rawWorkflows,
          rawPreferences,
          applicationConfiguration,
          rawHostDefaults,
          isAdmin,
        }),
      )
      .digest("hex");
    return {
      rows,
      rawHostDefaults,
      isAdmin,
      rawWorkflows,
      rawPreferences,
      fingerprint,
      application,
      tunnelPresets,
    };
  }
  async snapshot(userId: string) {
    this.assertDesktopStorage();
    const key = DataCrypto.validateUserAccess(userId),
      state = this.state(this.context.drizzle, userId);
    const workflows = JSON.parse(state.rawWorkflows) as SavedWorkflow[];
    if (!Array.isArray(workflows) || workflows.length > 128)
      throw Error("WORKFLOW_STORE_INVALID");
    return {
      fingerprint: state.fingerprint,
      hostDefaults:
        state.rawHostDefaults === undefined
          ? undefined
          : JSON.parse(state.rawHostDefaults),
      tunnelPresets: state.tunnelPresets as unknown as Array<
        Record<string, unknown>
      >,
      appearance: state.application
        ? Object.fromEntries(
            ["theme", "fontSize", "accentColor", "language", "hiddenRailTabs"]
              .map((key) => [
                key,
                state.application![
                  key as
                    | "theme"
                    | "fontSize"
                    | "accentColor"
                    | "language"
                    | "hiddenRailTabs"
                ],
              ])
              .filter(([, value]) => value !== null),
          )
        : undefined,
      keybindings: state.application?.customKeybindings,
      terminalDefaults: state.application?.terminalDefaults,
      customThemes: state.application?.customThemes,
      hosts: state.rows.map(
        (row) =>
          DataCrypto.decryptRecord(
            "ssh_data",
            row,
            userId,
            key,
          ) as unknown as Record<string, unknown>,
      ),
      workflows: workflows.map((row) => ({
        definition: parseWorkflow(row.definition),
      })),
      preferences: state.rawPreferences
        ? JSON.parse(state.rawPreferences)
        : undefined,
    };
  }
  async apply(
    userId: string,
    request: {
      id: string;
      fingerprint: string;
      digest: string;
      payload: ConfigurationBackup;
      restorePreferences: boolean;
      restoreKeybindings?: boolean;
      restoreHostDefaults?: boolean;
      restoreLocalTunnels?: boolean;
    },
  ): Promise<BackupImportResult> {
    this.assertDesktopStorage();
    validateNetworkReferences(
      request.payload.hosts,
      request.payload.tunnelPresets ?? [],
      request.payload.localTunnels,
    );
    const dataKey = DataCrypto.validateUserAccess(userId),
      receiptKey = receiptPrefix(userId) + request.id;
    const applied = this.context.drizzle.transaction((tx) => {
      if (
        request.restoreHostDefaults &&
        !tx
          .select({ isAdmin: users.isAdmin })
          .from(users)
          .where(eq(users.id, userId))
          .get()?.isAdmin
      )
        throw Error("BACKUP_ADMIN_REQUIRED");
      const receipt = tx
        .select()
        .from(settings)
        .where(eq(settings.key, receiptKey))
        .get();
      if (receipt) {
        const stored = JSON.parse(receipt.value) as {
          digest: string;
          result: BackupImportResult;
        };
        if (stored.digest !== request.digest)
          throw Error("BACKUP_CONFIRMATION_CHANGED");
        return {
          result: stored.result,
          workflowValue: tx
            .select()
            .from(settings)
            .where(eq(settings.key, workflowKey(userId)))
            .get()?.value,
        };
      }
      if (
        request.restoreLocalTunnels &&
        request.payload.localTunnels?.length &&
        this.receipts(tx, userId).filter((row) => {
          const r = JSON.parse(row.value);
          return r.result?.localTunnels?.length && !r.localCompleted;
        }).length >= 128
      )
        throw Error("BACKUP_PENDING_LOCAL_LIMIT");
      const before = this.state(tx, userId);
      if (before.fingerprint !== request.fingerprint)
        throw Error("BACKUP_CONFIGURATION_CHANGED");
      if (before.rows.length + request.payload.hosts.length > 2000)
        throw Error("BACKUP_HOST_LIMIT");
      const oldWorkflows = JSON.parse(before.rawWorkflows) as SavedWorkflow[];
      if (
        !Array.isArray(oldWorkflows) ||
        oldWorkflows.length + request.payload.workflows.length > 128
      )
        throw Error("WORKFLOW_LIMIT");
      const hostIds: number[] = [];
      for (const host of request.payload.hosts) {
        const encrypted = DataCrypto.encryptRecord(
          "ssh_data",
          {
            id: Date.now() + hostIds.length,
            userId,
            syncId: randomUUID(),
            connectionType: "ssh",
            name: host.name,
            ip: host.ip,
            port: host.port,
            username: host.username,
            folder: host.folder,
            tags: JSON.stringify(host.tags),
            pin: host.pin,
            notes: host.notes,
            authType: "unconfigured",
            shareSshAuth: false,
            credentialId: null,
            vaultProfileId: null,
            password: null,
            key: null,
            keyPassword: null,
            sudoPassword: null,
            autostartPassword: null,
            autostartKey: null,
            autostartKeyPassword: null,
            enableTerminal: true,
            enableFileManager: true,
            enableTunnel: false,
            enableDocker: false,
            enableProxmoxStats: false,
            enableSessionLogging: false,
            tunnelConnections: "[]",
            jumpHosts: "[]",
            useSocks5: false,
            portKnockSequence: "[]",
            quickActions: "[]",
            statsConfig: JSON.stringify({
              metricsEnabled: false,
              statusCheckEnabled: false,
              disableTcpPing: true,
            }),
            terminalConfig: JSON.stringify({
              ...host.terminalAppearance,
              ...(host.terminalEncoding
                ? { encoding: host.terminalEncoding }
                : {}),
              backupSourceAuthentication: {
                method: host.originalAuthType,
                credentialRef: host.credentialRef,
              },
            }),
          },
          userId,
          dataKey,
        ) as typeof hosts.$inferInsert;
        delete encrypted.id;
        const created = tx
          .insert(hosts)
          .values(encrypted)
          .returning({ id: hosts.id })
          .get();
        hostIds.push(created.id);
      }
      const hostMap = new Map(
        request.payload.hosts.map((h, i) => [h.ref, hostIds[i]]),
      );
      for (const host of request.payload.hosts) {
        if (!host.network) continue;
        tx.update(hosts)
          .set({
            jumpHosts: JSON.stringify(
              host.network.jumpHostRefs.map((ref) => ({
                hostId: hostMap.get(ref)!,
              })),
            ),
            tunnelConnections: JSON.stringify(
              host.network.tunnels.map((t) => restoreTunnel(t, hostMap)),
            ),
          })
          .where(
            and(eq(hosts.userId, userId), eq(hosts.id, hostMap.get(host.ref)!)),
          )
          .run();
      }
      const presets = request.payload.tunnelPresets ?? [];
      if (before.tunnelPresets.length + presets.length > 128)
        throw Error("BACKUP_TUNNEL_PRESET_LIMIT");
      const presetNames = new Set(before.tunnelPresets.map((p) => p.name));
      const tunnelPresetIds: number[] = [];
      for (const preset of presets) {
        let name = preset.name,
          suffix = 2;
        while (presetNames.has(name))
          name = preset.name.slice(0, 480) + " (" + suffix++ + ")";
        presetNames.add(name);
        const created = tx
          .insert(c2sTunnelPresets)
          .values({
            userId,
            name,
            config: JSON.stringify(
              preset.tunnels.map((t) => restoreTunnel(t, hostMap)),
            ),
            platform: null,
            computerName: null,
          })
          .returning({ id: c2sTunnelPresets.id })
          .get();
        tunnelPresetIds.push(created.id);
      }
      const imported: SavedWorkflow[] = request.payload.workflows.map(
        (row) => ({
          id: randomUUID(),
          revision: 1,
          definition: parseWorkflow(row.definition),
          allowedHostIds: [],
          needsHostBinding: true,
          updatedAt: Date.now(),
        }),
      );
      const workflowValue = JSON.stringify([...oldWorkflows, ...imported]);
      if (Buffer.byteLength(workflowValue) > 4 * 1024 * 1024)
        throw Error("WORKFLOW_STORE_LIMIT");
      if (imported.length)
        tx.insert(settings)
          .values({ key: workflowKey(userId), value: workflowValue })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: workflowValue },
          })
          .run();
      const preferencesRestored =
        request.restorePreferences &&
        !!(
          request.payload.desktopLayout ||
          request.payload.preferences ||
          request.payload.appearance ||
          request.payload.terminalDefaults ||
          request.payload.terminalThemes?.length
        );
      const desktopConfiguration: DesktopConfiguration | undefined =
        preferencesRestored ? {} : undefined;
      if (request.restorePreferences && request.payload.preferences) {
        const preferences = sanitizeUiPreferences(request.payload.preferences);
        // Restoring layout must not reset the target workspace's onboarding state.
        if (before.rawPreferences)
          preferences.onboarding = sanitizeUiPreferences(
            JSON.parse(before.rawPreferences),
          ).onboarding;
        desktopConfiguration!.preferences = preferences;
        const data = JSON.stringify(preferences),
          updatedAt = new Date().toISOString();
        tx.insert(uiPreferences)
          .values({ userId, data, updatedAt })
          .onConflictDoUpdate({
            target: uiPreferences.userId,
            set: { data, updatedAt },
          })
          .run();
      }
      if (request.restorePreferences && request.payload.desktopLayout)
        desktopConfiguration!.layout = request.payload.desktopLayout;
      const hostDefaultsValue =
        request.restoreHostDefaults && request.payload.hostDefaults
          ? JSON.stringify(restoreHostDefaults(request.payload.hostDefaults))
          : undefined;
      if (hostDefaultsValue !== undefined)
        tx.insert(settings)
          .values({ key: "host_defaults", value: hostDefaultsValue })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: hostDefaultsValue },
          })
          .run();
      const applicationUpdates: Partial<typeof userPreferences.$inferInsert> =
        {};
      if (request.restorePreferences && request.payload.appearance) {
        Object.assign(applicationUpdates, request.payload.appearance);
        desktopConfiguration!.appearance = request.payload.appearance;
      }
      const importedThemes = request.restorePreferences
        ? (request.payload.terminalThemes ?? [])
        : [];
      if (request.restorePreferences && request.payload.terminalDefaults)
        applicationUpdates.terminalDefaults = JSON.stringify(
          request.payload.terminalDefaults,
        );
      if (importedThemes.length)
        applicationUpdates.customThemes = JSON.stringify(
          appendTerminalThemes(
            before.application?.customThemes,
            importedThemes,
          ),
        );
      const importedKeys = request.restoreKeybindings
        ? restoreKeybindings(request.payload.keybindings ?? [])
        : [];
      if (importedKeys.length) {
        const existing = JSON.parse(
          before.application?.customKeybindings ?? "[]",
        );
        if (!Array.isArray(existing))
          throw Error("BACKUP_KEYBINDING_STORE_INVALID");
        if (existing.length + importedKeys.length > 200)
          throw Error("BACKUP_KEYBINDING_LIMIT");
        applicationUpdates.customKeybindings = JSON.stringify([
          ...existing,
          ...importedKeys,
        ]);
      }
      if (Object.keys(applicationUpdates).length) {
        applicationUpdates.updatedAt = new Date().toISOString();
        tx.insert(userPreferences)
          .values({ userId, ...applicationUpdates })
          .onConflictDoUpdate({
            target: userPreferences.userId,
            set: applicationUpdates,
          })
          .run();
      }
      const localTunnels = request.restoreLocalTunnels
        ? request.payload.localTunnels?.map((tunnel) => ({
            ...restoreTunnel(tunnel, hostMap),
            displayName: tunnel.displayName,
            sourceHostName: request.payload.hosts.find(
              (host) => host.ref === tunnel.sourceHostRef,
            )!.name,
          }))
        : undefined;
      const result: BackupImportResult = {
        localTunnels,
        receiptId: request.id,
        hostIds,
        workflowIds: imported.map((row) => row.id),
        preferencesRestored,
        keybindingsImported: importedKeys.length,
        terminalThemesImported: importedThemes.length,
        hostDefaultsRestored: hostDefaultsValue !== undefined,
        tunnelPresetIds,
        desktopConfiguration,
      };
      tx.insert(settings)
        .values({
          key: receiptKey,
          value: JSON.stringify({
            digest: request.digest,
            at: Date.now(),
            result,
          }),
        })
        .run();
      const prefix = receiptPrefix(userId),
        receipts = tx
          .select()
          .from(settings)
          .where(
            and(gte(settings.key, prefix), lt(settings.key, prefix + "\uffff")),
          )
          .all();
      receipts.sort(
        (a, b) => (JSON.parse(b.value).at ?? 0) - (JSON.parse(a.value).at ?? 0),
      );
      for (const old of receipts
        .filter((row) => {
          const r = JSON.parse(row.value);
          return !r.result?.localTunnels?.length || r.localCompleted;
        })
        .slice(32))
        tx.delete(settings).where(eq(settings.key, old.key)).run();
      return {
        result,
        workflowValue: imported.length ? workflowValue : undefined,
        hostDefaultsValue,
      };
    });
    if (applied.hostDefaultsValue !== undefined)
      updateCachedSetting("host_defaults", applied.hostDefaultsValue);
    if (applied.workflowValue !== undefined)
      updateCachedSetting(workflowKey(userId), applied.workflowValue);
    await this.onWrite?.();
    return applied.result;
  }
}
