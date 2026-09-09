import { downloadTransfers } from "./production.js";
import { localFilesAvailable } from "./local-file-production.js";
import { DownloadRecoveryTickets } from "./download-recovery-tickets.js";
export const downloadRecoveryTickets = new DownloadRecoveryTickets(
  downloadTransfers,
  localFilesAvailable,
);
