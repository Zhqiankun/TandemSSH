import { DirectoryTransfers } from "./directory-transfers.js";
import { localFileGrants } from "./local-file-production.js";
import { automatedTransferPorts } from "./automated-transfer-production.js";
export const directoryTransfers = new DirectoryTransfers(
  localFileGrants,
  automatedTransferPorts,
);
