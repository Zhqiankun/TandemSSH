import { uploadTransfers, uploadTrees } from "./production.js";
import { uploadRecovery } from "./upload-recovery-production.js";
import { localFilesAvailable } from "./local-file-production.js";
import { UploadBatchNativeClient } from "./upload-batch-native-client.js";
import { UploadBatchRecoveryStore } from "./upload-batch-recovery-store.js";
import { UploadBatchRecoveryService } from "./upload-batch-recovery-service.js";
export const uploadBatchRecovery = new UploadBatchRecoveryService(
  uploadTransfers,
  uploadTrees,
  new UploadBatchRecoveryStore(process.env.DATA_DIR || "./db/data"),
  uploadRecovery,
  new UploadBatchNativeClient(
    {
      on: (event, listener) => process.on(event, listener),
      removeListener: (event, listener) =>
        process.removeListener(event, listener),
      send: (message, callback) => process.send!(message as object, callback),
    },
    localFilesAvailable,
  ),
);
