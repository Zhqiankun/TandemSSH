import { useEffect, useRef, useState } from "react";
import {
  captureDesktopConfiguration,
  applyDesktopConfiguration,
} from "@/settings/desktop-configuration";
import { useTranslation } from "react-i18next";
import { Download, Upload, FileJson, ShieldCheck } from "lucide-react";
import { Button } from "@/components/button";
import { configurationBackupApi as api } from "@/api/configuration-backup-api";
import type {
  BackupPreview,
  PendingLocalBackup,
  BackupImportResult,
} from "@/types/configuration-backup";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
function errorCode(error: unknown): string {
  const code = (error as { response?: { data?: { code?: unknown } } })?.response
    ?.data?.code;
  return typeof code === "string" && /^[A-Z_]+$/.test(code)
    ? code
    : error instanceof Error && /^BACKUP_/.test(error.message)
      ? error.message
      : "BACKUP_FAILED";
}
export function ConfigurationBackupPanel() {
  const { t } = useTranslation(),
    picker = useRef<HTMLInputElement>(null),
    localSnapshot = useRef<string | null>(null),
    localTunnelRevision = useRef<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [restoreKeybindings, setRestoreKeybindings] = useState(false),
    [localRestorePending, setLocalRestorePending] = useState(false);
  const [pendingLocal, setPendingLocal] = useState<PendingLocalBackup[]>([]);
  useEffect(() => {
    if (!window.electronAPI?.importC2STunnelConfig) return;
    let active = true;
    void api
      .pendingLocal()
      .then((rows) => {
        if (active) setPendingLocal(rows);
      })
      .catch(() => {
        if (active) setError("BACKUP_LOCAL_RECOVERY_UNAVAILABLE");
      });
    return () => {
      active = false;
    };
  }, []);
  const [restoreLocalTunnels, setRestoreLocalTunnels] = useState(false);
  const [localTunnelsRestored, setLocalTunnelsRestored] = useState(false);
  const [restoreHostDefaults, setRestoreHostDefaults] = useState(false);
  const [restorePreferences, setRestorePreferences] = useState(false),
    [result, setResult] = useState<BackupImportResult | null>(null);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (error) {
      setError(errorCode(error));
    } finally {
      setBusy(false);
    }
  };
  const exportPreview = () =>
    run(async () => {
      setPreview(null);
      setResult(null);
      const desktop = captureDesktopConfiguration();
      if (window.electronAPI?.snapshotC2STunnelConfig)
        desktop.localTunnels = (
          await window.electronAPI.snapshotC2STunnelConfig()
        ).config;
      setPreview(await api.previewExport(desktop));
    });
  const importPreview = (file?: File) => {
    if (!file) return;
    void run(async () => {
      setPreview(null);
      setResult(null);
      if (file.size > MAX_FILE_BYTES) throw Error("BACKUP_TOO_LARGE");
      setRestorePreferences(false);
      setRestoreKeybindings(false);
      setRestoreHostDefaults(false);
      setRestoreLocalTunnels(false);
      setLocalTunnelsRestored(false);
      localTunnelRevision.current = window.electronAPI?.snapshotC2STunnelConfig
        ? (await window.electronAPI.snapshotC2STunnelConfig()).revision
        : null;
      localSnapshot.current = JSON.stringify(captureDesktopConfiguration());
      setPreview(await api.previewImport(await file.text()));
    });
  };
  const restoreLocal = async (value: BackupImportResult) => {
    try {
      if (value.desktopConfiguration)
        applyDesktopConfiguration(value.desktopConfiguration);
      if (value.localTunnels?.length) {
        if (
          !window.electronAPI?.importC2STunnelConfig ||
          !localTunnelRevision.current
        )
          throw Error("BACKUP_LOCAL_TUNNELS_FAILED");
        const applied = await window.electronAPI.importC2STunnelConfig({
          id: value.receiptId,
          revision: localTunnelRevision.current,
          config: value.localTunnels,
        });
        if (!applied.success)
          throw Error(
            applied.error === "C2S_CONFIG_CHANGED"
              ? "BACKUP_LOCAL_TUNNELS_CHANGED"
              : "BACKUP_LOCAL_TUNNELS_FAILED",
          );
        await api.completeLocal(value.receiptId);
        setPendingLocal((rows) =>
          rows.filter((row) => row.result.receiptId !== value.receiptId),
        );
        setLocalTunnelsRestored(true);
      }
      setLocalRestorePending(false);
    } catch (error) {
      setLocalRestorePending(true);
      throw error;
    }
  };
  const confirm = () =>
    run(async () => {
      if (!preview) return;
      if (preview.direction === "export") {
        const blob = await api.download(preview.id),
          url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = "TandemSSH-configuration.json";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        setPreview(null);
      } else {
        if (
          restorePreferences &&
          localSnapshot.current !==
            JSON.stringify(captureDesktopConfiguration())
        )
          throw Error("BACKUP_LOCAL_CONFIGURATION_CHANGED");
        if (
          restoreLocalTunnels &&
          (!localTunnelRevision.current ||
            !window.electronAPI?.snapshotC2STunnelConfig ||
            (await window.electronAPI.snapshotC2STunnelConfig()).revision !==
              localTunnelRevision.current)
        )
          throw Error("BACKUP_LOCAL_CONFIGURATION_CHANGED");
        const restored = await api.apply(
          preview.id,
          restorePreferences,
          restoreKeybindings,
          restoreHostDefaults,
          restoreLocalTunnels,
        );
        setResult(restored);
        setPreview(null);
        window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
        if (restored.keybindingsImported)
          window.dispatchEvent(new Event("customKeybindingsChanged"));
        await restoreLocal(restored);
      }
    });
  return (
    <section className="space-y-3 py-3" aria-label={t("configBackup.title")}>
      {pendingLocal.length > 0 && (
        <div className="space-y-2 border border-border p-3">
          <p className="text-sm font-semibold">
            {t("configBackup.pendingLocalTitle")}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("configBackup.pendingLocalHint")}
          </p>
          {pendingLocal.map((row) => (
            <div
              key={row.result.receiptId}
              className="space-y-2 border-t border-border pt-2"
            >
              <p className="text-xs">
                {new Date(row.at).toLocaleString()} ·{" "}
                {t("configBackup.pendingLocalCount", {
                  count: row.result.localTunnels?.length ?? 0,
                })}
              </p>
              <details className="text-xs">
                <summary>{t("configBackup.inspectPendingLocal")}</summary>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
                  {JSON.stringify(row.result.localTunnels, null, 2)}
                </pre>
              </details>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (!window.electronAPI?.snapshotC2STunnelConfig)
                      throw Error("BACKUP_LOCAL_RECOVERY_UNAVAILABLE");
                    localTunnelRevision.current = (
                      await window.electronAPI.snapshotC2STunnelConfig()
                    ).revision;
                    setResult(row.result);
                    setPreview(null);
                    setLocalTunnelsRestored(false);
                    await restoreLocal(row.result);
                  })
                }
              >
                {t("configBackup.continuePendingLocal")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="size-4 text-accent-brand" />
        {t("configBackup.title")}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t("configBackup.description")}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void exportPreview()}
        >
          <Download className="mr-1 size-3.5" />
          {t("configBackup.previewExport")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => picker.current?.click()}
        >
          <Upload className="mr-1 size-3.5" />
          {t("configBackup.selectImport")}
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".json,application/json"
          disabled={busy}
          className="hidden"
          aria-label={t("configBackup.selectImport")}
          onChange={(event) => {
            importPreview(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      {busy && (
        <p role="status" className="text-xs text-muted-foreground">
          {t("configBackup.working")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(`configBackup.errors.${error}`, {
            defaultValue: t("configBackup.errors.BACKUP_FAILED"),
          })}
        </p>
      )}
      {preview && (
        <div className="space-y-3 border border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <FileJson className="size-4" />
            {t(
              preview.direction === "export"
                ? "configBackup.exportPreview"
                : "configBackup.importPreview",
            )}
          </div>
          <p className="text-xs">
            {t("configBackup.summary", {
              hosts: preview.hosts.length,
              workflows: preview.workflows.length,
              size: Math.ceil(preview.bytes / 1024),
            })}
          </p>
          {!!(
            preview.jumpHostCount ||
            preview.tunnelCount ||
            preview.tunnelPresetCount
          ) && (
            <p className="text-xs">
              {t("configBackup.networkSummary", {
                jumps: preview.jumpHostCount ?? 0,
                tunnels: preview.tunnelCount ?? 0,
                presets: preview.tunnelPresetCount ?? 0,
              })}
            </p>
          )}
          {!!(preview.hasTerminalDefaults || preview.terminalThemeCount) && (
            <p className="text-xs">
              {t("configBackup.terminalSummary", {
                defaults: preview.hasTerminalDefaults
                  ? t("common.yes")
                  : t("common.no"),
                themes: preview.terminalThemeCount ?? 0,
              })}
            </p>
          )}
          {!!preview.keybindingsCount && (
            <p className="text-xs">
              {t("configBackup.keybindingsCount", {
                count: preview.keybindingsCount,
              })}
            </p>
          )}
          <ul className="max-h-36 space-y-1 overflow-auto text-xs text-muted-foreground">
            {preview.hosts.map((host, index) => (
              <li key={index}>
                {host.name || host.ip} · {host.username}@{host.ip}:{host.port}
                {" · "}
                {t("hosts.terminalEncodingLabel")}:{" "}
                {(host.terminalEncoding ?? "utf-8").toUpperCase()}
              </li>
            ))}
            {preview.workflows.map((workflow, index) => (
              <li key={`workflow-${index}`}>
                {workflow.name} ·{" "}
                {t("configBackup.steps", { count: workflow.steps })}
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-xs text-amber-500">
            {preview.warnings.map((warning, index) => (
              <li key={index}>
                {t(`configBackup.warnings.${warning.code}`, {
                  defaultValue: warning.code,
                })}
                {warning.code === "IGNORED_FIELD" && `：${warning.path}`}
              </li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer text-xs font-semibold">
              {t("configBackup.inspectContent")}
            </summary>
            <textarea
              readOnly
              value={preview.content}
              className="mt-2 h-56 w-full rounded-none border border-border bg-background p-2 font-mono text-xs"
              aria-label={t("configBackup.inspectContent")}
            />
          </details>
          {preview.direction === "import" && preview.hasPreferences && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={restorePreferences}
                disabled={busy}
                onChange={(event) =>
                  setRestorePreferences(event.target.checked)
                }
              />
              {t("configBackup.restorePreferences")}
            </label>
          )}
          {preview.direction === "import" && !!preview.keybindingsCount && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={restoreKeybindings}
                disabled={busy}
                onChange={(event) =>
                  setRestoreKeybindings(event.target.checked)
                }
              />
              {t("configBackup.restoreKeybindings")}
            </label>
          )}
          {preview.direction === "import" && preview.hasHostDefaults && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={restoreHostDefaults}
                disabled={busy}
                onChange={(event) =>
                  setRestoreHostDefaults(event.target.checked)
                }
              />
              {t("configBackup.restoreHostDefaults")}
            </label>
          )}
          {preview.direction === "import" && !!preview.localTunnelCount && (
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={restoreLocalTunnels}
                disabled={busy || !window.electronAPI?.importC2STunnelConfig}
                onChange={(event) =>
                  setRestoreLocalTunnels(event.target.checked)
                }
              />
              {t("configBackup.restoreLocalTunnels")}
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void confirm()}>
              {t(
                preview.direction === "export"
                  ? "configBackup.confirmExport"
                  : "configBackup.confirmImport",
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
      {result && (
        <div
          role="status"
          className="space-y-2 border border-accent-brand/30 p-3 text-xs"
        >
          <p>
            {t("configBackup.completed", {
              hosts: result.hostIds.length,
              workflows: result.workflowIds.length,
            })}
          </p>
          <p className="text-muted-foreground">
            {t("configBackup.afterImport")}
          </p>
          {result.hostDefaultsRestored && (
            <p>{t("configBackup.hostDefaultsRestored")}</p>
          )}
          {!!result.keybindingsImported && (
            <p>
              {t("configBackup.keybindingsRestored", {
                count: result.keybindingsImported,
              })}
            </p>
          )}
          {localTunnelsRestored && (
            <p>{t("configBackup.localTunnelsRestored")}</p>
          )}
          {localRestorePending && (
            <div>
              <p role="alert">{t("configBackup.localRestorePending")}</p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (
                      error === "BACKUP_LOCAL_TUNNELS_CHANGED" &&
                      window.electronAPI?.snapshotC2STunnelConfig
                    )
                      localTunnelRevision.current = (
                        await window.electronAPI.snapshotC2STunnelConfig()
                      ).revision;
                    await restoreLocal(result);
                  })
                }
              >
                {t(
                  error === "BACKUP_LOCAL_TUNNELS_CHANGED"
                    ? "configBackup.retryAppendLocalTunnels"
                    : "configBackup.retryLocalRestore",
                )}
              </Button>
            </div>
          )}
          {(result.preferencesRestored || localTunnelsRestored) &&
            !localRestorePending && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.location.reload()}
              >
                {t("configBackup.reloadPreferences")}
              </Button>
            )}
        </div>
      )}
    </section>
  );
}
