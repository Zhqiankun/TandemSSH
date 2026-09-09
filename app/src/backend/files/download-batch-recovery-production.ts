import { downloadTransfers, downloadTrees } from "./production.js";
import { downloadRecoveryTickets } from "./download-recovery-production.js";
import { DownloadBatchRecoveryTickets } from "./download-batch-recovery-tickets.js";
export const downloadBatchRecoveryTickets = new DownloadBatchRecoveryTickets(
  downloadTrees,
  downloadTransfers,
  downloadRecoveryTickets,
);
