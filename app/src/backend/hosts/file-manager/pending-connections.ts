import type { Client } from "ssh2";
interface Entry {
  userId: string;
  client: Client;
  cancel: () => void;
}
/** Owns only pending SFTP handshakes; established clients belong to sshSessions. */
export class PendingFileConnections {
  private readonly entries = new Map<string, Entry>();
  cancel(sessionId: string, userId: string) {
    const entry = this.entries.get(sessionId);
    if (entry && entry.userId !== userId) throw Error("SSH_AUTH_ACCESS_DENIED");
    entry?.cancel();
  }
  begin(sessionId: string, userId: string, client: Client) {
    if (
      typeof sessionId !== "string" ||
      !/^[a-zA-Z0-9:._-]{1,128}$/.test(sessionId) ||
      !userId
    )
      throw Error("SSH_AUTH_INVALID_CHALLENGE");
    const old = this.entries.get(sessionId);
    if (old && old.userId !== userId) throw Error("SSH_AUTH_ACCESS_DENIED");
    old?.cancel();
    if (this.entries.size >= 256) throw Error("SSH_AUTH_LIMIT");
    const stop = new AbortController();
    let finished = false;
    const remove = () => {
      clearTimeout(timer);
      if (this.entries.get(sessionId) === entry) this.entries.delete(sessionId);
    };
    const cancel = (code = "SSH_AUTH_CANCELLED") => {
      if (finished) return;
      finished = true;
      remove();
      stop.abort(Error(code));
      client.destroy();
    };
    const entry: Entry = { userId, client, cancel };
    const timer = setTimeout(() => cancel("SSH_AUTH_TIMEOUT"), 300000);
    timer.unref?.();
    this.entries.set(sessionId, entry);
    client.once("close", () => cancel());
    return {
      signal: stop.signal,
      cancel,
      complete: () => {
        if (finished) return;
        finished = true;
        remove();
      },
    };
  }
}
export const pendingFileConnections = new PendingFileConnections();
