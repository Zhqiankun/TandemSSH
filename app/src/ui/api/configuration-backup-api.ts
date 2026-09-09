import { authApi } from "@/main-axios";
import type {
  BackupPreview,
  BackupImportResult,
} from "@/types/configuration-backup";
export const configurationBackupApi = {
  async previewExport(): Promise<BackupPreview> {
    return (await authApi.post("/configuration-backup/export/preview", {}))
      .data;
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
  ): Promise<BackupImportResult> {
    return (
      await authApi.post(`/configuration-backup/import/${id}`, {
        confirmed: true,
        restorePreferences,
      })
    ).data;
  },
};
