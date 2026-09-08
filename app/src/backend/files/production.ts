import { DownloadService, type DownloadPorts } from "./download-service.js";
import { DownloadTreeService } from "./download-tree-service.js";
import { acceptedHostKeyFor } from "../hosts/accepted-host-key.js";
import { UploadService, type UploadPorts } from "./upload-service.js";
import { UploadTreeService } from "./upload-tree-service.js";
import { fileCommitLocks } from "./path-locks.js";
import { randomUUID } from "node:crypto";
import type { Client, SFTPWrapper } from "ssh2";
import type { FileDocumentTarget } from "./ports.js";
import type { DocumentActor } from "./document-service.js";
import { AutomatedDocuments } from "./automated-documents.js";
import type { SSHSession } from "../hosts/file-manager/session.js";
import { getSessionSftp } from "../hosts/file-manager/session.js";
import { sessionManager } from "../hosts/terminal/session-manager.js";
import { journalFor } from "../collaboration/audit/production.js";
import { hostFileFence } from "../collaboration/sessions/host-file-fence.js";
import { DocumentService, DocumentError } from "./document-service.js";
import { SftpFileIO } from "./sftp-io.js";
let browseSession: (id: string) => SSHSession | undefined = () => undefined;
const connections = new WeakMap<Client, string>();
const capabilities = new WeakMap<
  FileDocumentTarget,
  { userId: string; taskId: string; sessionId: string; source: string }
>();
export function bindFileBrowserDocuments(
  lookup: (id: string) => SSHSession | undefined,
) {
  browseSession = lookup;
}
export const documents = new DocumentService(
  {
    target: resolveFileDocumentTarget,
    audit: (actor, type, data) =>
      journalFor(actor.userId).record(type, {
        source: actor.source,
        taskId: actor.taskId,
        ...(data as Record<string, unknown>),
      }),
    beginWrite: beginFileWrite,
  },
  fileCommitLocks,
);

export async function openAutomatedFileTarget(
  actor: DocumentActor,
  sessionId: string,
  guard: (canonical?: string) => void,
  signal: AbortSignal,
) {
  if (actor.source === "human" || !actor.taskId)
    throw new DocumentError("FILE_AUTOMATION_GATEWAY_REQUIRED");
  guard();
  const session = sessionManager.getSession(sessionId),
    client = session?.sshConn;
  if (!session?.isConnected || !client || session.userId !== actor.userId)
    throw new DocumentError("FILE_SESSION_UNAVAILABLE");
  let connection = connections.get(client);
  if (!connection) {
    connection = randomUUID();
    connections.set(client, connection);
  }
  const channel = await new Promise<SFTPWrapper>((resolve, reject) => {
    let settled = false;
    const finish = (error: unknown, sftp?: SFTPWrapper) => {
      if (settled) {
        sftp?.end();
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve(sftp!);
    };
    const abort = () => finish(new DocumentError("FILE_REQUEST_CANCELLED"));
    const timer = setTimeout(
      () => finish(new DocumentError("FILE_IO_TIMEOUT")),
      30000,
    );
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (signal.aborted) {
        abort();
        return;
      }
      guard();
      client.sftp((error, sftp) =>
        finish(
          error ? new DocumentError("FILE_SFTP_UNAVAILABLE") : undefined,
          sftp,
        ),
      );
    } catch {
      finish(new DocumentError("FILE_SFTP_UNAVAILABLE"));
    }
  });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    try {
      channel.end();
    } catch {
      /* The owned SFTP channel may already be closed. */
    }
  };
  signal.addEventListener("abort", close, { once: true });
  const access: FileDocumentTarget = {
    key: JSON.stringify([actor.userId, session.hostName]),
    connection,
    hostScope: {
      userId: actor.userId,
      hostId: session.hostId,
      identity: session.hostName,
    },
    io: new SftpFileIO(channel, 30000, 8 * 1024 * 1024),
    retain: () => () => {},
    check: (_action, _requested, canonical) => {
      if (closed || signal.aborted)
        throw new DocumentError("FILE_REQUEST_CANCELLED");
      if (
        sessionManager.getSession(sessionId) !== session ||
        !session.isConnected ||
        session.sshConn !== client ||
        connections.get(client) !== connection
      )
        throw new DocumentError("FILE_CONNECTION_CHANGED");
      guard(canonical);
    },
  };
  capabilities.set(access, {
    userId: actor.userId,
    taskId: actor.taskId,
    sessionId,
    source: actor.source,
  });
  try {
    if (signal.aborted) throw Error("FILE_REQUEST_CANCELLED");
    guard();
    return { access, close };
  } catch (error) {
    close();
    throw error;
  }
}
export const automatedDocuments = new AutomatedDocuments(documents, {
  open: openAutomatedFileTarget,
});

async function resolveFileDocumentTarget(
  actor: DocumentActor,
  sessionId: string,
): Promise<FileDocumentTarget> {
  if (actor.source !== "human") {
    const scope = actor.access && capabilities.get(actor.access);
    if (
      !scope ||
      scope.userId !== actor.userId ||
      scope.taskId !== actor.taskId ||
      scope.sessionId !== sessionId ||
      scope.source !== actor.source
    )
      throw new DocumentError("FILE_AUTOMATION_GATEWAY_REQUIRED");
    return actor.access!;
  }
  const session = browseSession(sessionId);
  if (!session?.isConnected || session.userId !== actor.userId)
    throw new DocumentError("FILE_SESSION_UNAVAILABLE");
  let connection = connections.get(session.client);
  if (!connection) {
    connection = randomUUID();
    connections.set(session.client, connection);
  }
  const identity =
    session.ip && session.username
      ? session.username + "@" + session.ip + ":" + (session.port ?? 22)
      : undefined;
  const hostScope = {
    userId: actor.userId,
    hostId: session.hostId,
    identity,
  };
  const key = JSON.stringify([
    actor.userId,
    identity ?? session.hostId ?? sessionId,
  ]);
  const peerKey = acceptedHostKeyFor(session.client);
  const io = new SftpFileIO(await getSessionSftp(session));
  return {
    key,
    connection,
    acceptedHostKey: peerKey,
    io,
    hostScope,
    retain: () => {
      session.activeOperations++;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          session.activeOperations = Math.max(0, session.activeOperations - 1);
        }
      };
    },
    check: () => {
      if (actor.signal?.aborted)
        throw new DocumentError("FILE_REQUEST_CANCELLED");
      if (
        browseSession(sessionId) !== session ||
        !session.isConnected ||
        connections.get(session.client) !== connection ||
        acceptedHostKeyFor(session.client) !== peerKey
      )
        throw new DocumentError("FILE_CONNECTION_CHANGED");
      session.lastActive = Date.now();
    },
  };
}
function beginFileWrite(
  actor: DocumentActor,
  target: FileDocumentTarget,
  takeover: boolean,
) {
  if (actor.source !== "human") {
    if (!capabilities.has(target))
      throw new DocumentError("FILE_AUTOMATION_GATEWAY_REQUIRED");
    return () => {};
  }
  if (!target.hostScope)
    throw new DocumentError("FILE_AUTOMATION_GATEWAY_REQUIRED");
  const scope = target.hostScope,
    release = hostFileFence.acquire(scope);
  try {
    const active = sessionManager
      .getUserSessions(actor.userId)
      .filter(
        (session) =>
          ((scope.hostId !== undefined && session.hostId === scope.hostId) ||
            (!!scope.identity && session.hostName === scope.identity)) &&
          session.control.snapshot().controller.kind === "automation",
      );
    if (active.length && !takeover)
      throw new DocumentError("FILE_AUTOMATION_ACTIVE");
    for (const session of active) session.control.takeover();
    return release;
  } catch (error) {
    release();
    throw error;
  }
}

const uploadPorts: UploadPorts = {
  async target(userId, sessionId) {
    const target = await resolveFileDocumentTarget(
      { userId, source: "human" },
      sessionId,
    );
    if (!(target.io instanceof SftpFileIO))
      throw new DocumentError("FILE_TRANSFER_UNAVAILABLE");
    return { ...target, io: target.io };
  },
  beginWrite: (userId, target, takeover) =>
    beginFileWrite({ userId, source: "human" }, target, takeover),
  audit: (userId, type, data) =>
    journalFor(userId).record(type, { source: "human", ...data }),
  locks: fileCommitLocks,
};
export const uploadTransfers = new UploadService(uploadPorts);
export const uploadTrees = new UploadTreeService(uploadPorts, uploadTransfers);

const downloadPorts: DownloadPorts = {
  async target(userId, sessionId) {
    const target = await resolveFileDocumentTarget(
      { userId, source: "human" },
      sessionId,
    );
    if (!(target.io instanceof SftpFileIO))
      throw new DocumentError("FILE_TRANSFER_UNAVAILABLE");
    return { ...target, io: target.io };
  },
  audit: (userId, type, data) =>
    journalFor(userId).record(type, { source: "human", ...data }),
};
export const downloadTransfers = new DownloadService(downloadPorts);
export const downloadTrees = new DownloadTreeService(
  downloadPorts,
  downloadTransfers,
);
