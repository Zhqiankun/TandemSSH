import { AutomatedTransfers } from "./automated-transfers.js";
import { localFileGrants } from "./local-file-production.js";
import { openAutomatedFileTarget } from "./production.js";
import { SftpFileIO } from "./sftp-io.js";
import { fileCommitLocks } from "./path-locks.js";
import { journalFor } from "../collaboration/audit/production.js";
export const automatedTransfers = new AutomatedTransfers({
  local: localFileGrants,
  locks: fileCommitLocks,
  audit: (context, type, data) =>
    journalFor(context.userId).record(type, {
      ...data,
      taskId: context.taskId,
      operationId: context.operationId,
      source: context.origin,
    }),
  open: async (context, guard, signal) => {
    const opened = await openAutomatedFileTarget(
      {
        userId: context.userId,
        taskId: context.taskId,
        source:
          context.origin === "mcp"
            ? "mcp"
            : context.origin === "workflow"
              ? "workflow"
              : "agent",
        signal,
      },
      context.sessionId,
      guard,
      signal,
    );
    if (
      !(opened.access.io instanceof SftpFileIO) ||
      !opened.access.acceptedHostKey
    ) {
      opened.close();
      throw Error("FILE_CONNECTION_CHANGED");
    }
    return {
      target: { ...opened.access, io: opened.access.io },
      close: opened.close,
      beginWrite: () => {
        guard();
        return () => {};
      },
    };
  },
});
