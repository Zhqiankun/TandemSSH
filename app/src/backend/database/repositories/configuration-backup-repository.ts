/* eslint-disable no-restricted-syntax -- Desktop-only synchronous SQLite transaction: assertDesktopStorage rejects every non-SQLite dialect before any query. */
import { and, eq, gte, lt } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { hosts, settings, uiPreferences } from "../db/schema.js";
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
  private state(
    db: Pick<DatabaseContext["drizzle"], "select">,
    userId: string,
  ) {
    const rows = db.select().from(hosts).where(eq(hosts.userId, userId)).all();
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
    }));
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ configuration, rawWorkflows, rawPreferences }))
      .digest("hex");
    return { rows, rawWorkflows, rawPreferences, fingerprint };
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
    },
  ): Promise<BackupImportResult> {
    this.assertDesktopStorage();
    const dataKey = DataCrypto.validateUserAccess(userId),
      receiptKey = receiptPrefix(userId) + request.id;
    const applied = this.context.drizzle.transaction((tx) => {
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
        request.restorePreferences && !!request.payload.preferences;
      if (preferencesRestored) {
        const preferences = sanitizeUiPreferences(request.payload.preferences);
        // Restoring layout must not reset the target workspace's onboarding state.
        if (before.rawPreferences)
          preferences.onboarding = sanitizeUiPreferences(
            JSON.parse(before.rawPreferences),
          ).onboarding;
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
      const result: BackupImportResult = {
        receiptId: request.id,
        hostIds,
        workflowIds: imported.map((row) => row.id),
        preferencesRestored,
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
      for (const old of receipts.slice(32))
        tx.delete(settings).where(eq(settings.key, old.key)).run();
      return {
        result,
        workflowValue: imported.length ? workflowValue : undefined,
      };
    });
    if (applied.workflowValue !== undefined)
      updateCachedSetting(workflowKey(userId), applied.workflowValue);
    await this.onWrite?.();
    return applied.result;
  }
}
