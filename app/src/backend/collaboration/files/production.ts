import { DirectoryAutomation } from "./directories.js";
import { directoryTransfers } from "../../files/directory-transfer-production.js";
import { TransferAutomation } from "./transfers.js";
import { localFileGrants } from "../../files/local-file-production.js";
import { automatedTransfers } from "../../files/automated-transfer-production.js";
import { taskRuntime } from "../tasks/production.js";
import { automatedDocuments } from "../../files/production.js";
import { FileAutomation } from "./automation.js";
export const fileAutomation = new FileAutomation(
  taskRuntime,
  automatedDocuments,
);

export const transferAutomation = new TransferAutomation(
  taskRuntime,
  localFileGrants,
  automatedTransfers,
);

export const directoryAutomation = new DirectoryAutomation(
  taskRuntime,
  directoryTransfers,
);
