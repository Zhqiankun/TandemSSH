import { useRef, useState } from "react";
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
    localSnapshot = useRef<string | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [restoreKeybindings, setRestoreKeybindings] = useState(false),
    [localRestorePending, setLocalRestorePending] = useState(false);
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
      setPreview(await api.previewExport(captureDesktopConfiguration()));
    });
  const importPreview = (file?: File) => {
    if (!file) return;
    void run(async () => {
      setPreview(null);
      setResult(null);
      if (file.size > MAX_FILE_BYTES) throw Error("BACKUP_TOO_LARGE");
      setRestorePreferences(false);
      setRestoreKeybindings(false);
      localSnapshot.current = JSON.stringify(captureDesktopConfiguration());
      setPreview(await api.previewImport(await file.text()));
    });
  };
  const restoreLocal = (value: BackupImportResult) => {
    if (!value.desktopConfiguration) return;
    try {
      applyDesktopConfiguration(value.desktopConfiguration);
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
        const restored = await api.apply(
          preview.id,
          restorePreferences,
          restoreKeybindings,
        );
        setResult(restored);
        setPreview(null);
        window.dispatchEvent(new CustomEvent("ssh-hosts:changed"));
        if (restored.keybindingsImported)
          window.dispatchEvent(new Event("customKeybindingsChanged"));
        restoreLocal(restored);
      }
    });
  return (
    <section className="space-y-3 py-3" aria-label={t("configBackup.title")}>
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
          {!!result.keybindingsImported && (
            <p>
              {t("configBackup.keybindingsRestored", {
                count: result.keybindingsImported,
              })}
            </p>
          )}
          {localRestorePending && (
            <div>
              <p role="alert">{t("configBackup.localRestorePending")}</p>
              <Button
                disabled={busy}
                onClick={() => void run(async () => restoreLocal(result))}
              >
                {t("configBackup.retryLocalRestore")}
              </Button>
            </div>
          )}
          {result.preferencesRestored && !localRestorePending && (
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
