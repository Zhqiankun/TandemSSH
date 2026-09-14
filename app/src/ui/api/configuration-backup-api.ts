import { authApi } from "@/main-axios";
import type { DesktopConfiguration } from "@/types/desktop-preferences";
import type {
  BackupPreview,
  PendingLocalBackup,
  BackupImportResult,
} from "@/types/configuration-backup";
export const configurationBackupApi = {
  async pendingLocal(): Promise<PendingLocalBackup[]> {
    return (await authApi.get("/configuration-backup/local/pending")).data;
  },
  async completeLocal(id: string): Promise<void> {
    await authApi.post("/configuration-backup/local/" + id + "/complete", {
      confirmed: true,
    });
  },
  async previewExport(desktop?: DesktopConfiguration): Promise<BackupPreview> {
    return (
      await authApi.post("/configuration-backup/export/preview", { desktop })
    ).data;
  },
  async previewImport(content: string): Promise<BackupPreview> {
    return (
      await authApi.post("/configuration-backup/import/preview", content, {
        headers: { "Content-Type": "application/vnd.tandemssh.backup+json" },
        transformRequest: [(value) => value],
      })
    ).data;
  },
  async download(id: string): Promise<Blob> {
    return (
      await authApi.get(`/configuration-backup/export/${id}`, {
        responseType: "blob",
      })
    ).data;
  },
  async apply(
    id: string,
    restorePreferences: boolean,
    restoreKeybindings = false,
    restoreHostDefaults = false,
    restoreLocalTunnels = false,
  ): Promise<BackupImportResult> {
    return (
      await authApi.post(`/configuration-backup/import/${id}`, {
        confirmed: true,
        restorePreferences,
        restoreKeybindings,
        restoreHostDefaults,
        restoreLocalTunnels,
      })
    ).data;
  },
};
