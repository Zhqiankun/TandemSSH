import type { FileTaskContext } from "../../files/automated-documents.js";
import type { DirectoryAutomation } from "./directories.js";
import type { DirectoryTransfers } from "../../files/directory-transfers.js";
import type { AutomatedTransfers } from "../../files/automated-transfers.js";
import type { AutomatedDocuments } from "../../files/automated-documents.js";
import type { LocalFileGrants } from "../../files/local-file-grants.js";
interface TaskFileResourcePorts {
  context(userId: string, taskId: string): FileTaskContext;
  directories: Pick<DirectoryAutomation, "list" | "forgetTask">;
  directoryTransfers: Pick<DirectoryTransfers, "list" | "release">;
  transfers: Pick<AutomatedTransfers, "forgetTask">;
  documents: Pick<AutomatedDocuments, "forgetTask">;
  local: Pick<LocalFileGrants, "humanList" | "forget">;
}
/** Task archival owns the state check and durable record. This releases only owned file resources. */
export async function releaseTaskFileResources(
  ports: TaskFileResourcePorts,
  userId: string,
  taskId: string,
) {
  const actor = { kind: "human" as const, userId },
    context = ports.context(userId, taskId);
  if (ports.directories.list(actor, taskId).some((r) => !r.endedAt))
    throw Error("DIRECTORY_IN_PROGRESS");
  for (const preview of ports.directoryTransfers.list(context))
    await ports.directoryTransfers.release(context, preview.id);
  ports.transfers.forgetTask(context);
  ports.documents.forgetTask(context);
  for (const grant of ports.local.humanList(userId, taskId))
    await ports.local.forget(userId, taskId, grant.id);
  ports.directories.forgetTask(userId, taskId);
}
