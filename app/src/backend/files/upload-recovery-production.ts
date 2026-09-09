import { uploadTransfers } from "./production.js";
import { localFilesAvailable } from "./local-file-production.js";
import { UploadRecoveryStore } from "./upload-recovery-store.js";
import { UploadRecoveryCoordinator } from "./upload-recovery-coordinator.js";
export const uploadRecovery = new UploadRecoveryCoordinator(
  uploadTransfers,
  new UploadRecoveryStore(process.env.DATA_DIR || "./db/data"),
  localFilesAvailable,
);
