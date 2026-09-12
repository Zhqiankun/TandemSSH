export interface DirectoryQuerySocket {
  readyState: number;
  send(data: string): void;
}
type Pending = {
  socket: DirectoryQuerySocket;
  host: string;
  id: string;
  timer?: ReturnType<typeof setTimeout>;
};

/** One manual directory query per terminal component. Only matching responses
 * can consume it; lost responses and failed sends cannot leave the UI busy. */
export class TerminalDirectoryQuery {
  private pending: Pending | null = null;

  isPending(socket: DirectoryQuerySocket, host: string): boolean {
    return this.pending?.socket === socket && this.pending.host === host;
  }

  start(
    socket: DirectoryQuerySocket,
    host: string,
    id: string,
    onTimeout: () => void,
  ): void {
    if (socket.readyState !== 1) throw Error("CWD_UNAVAILABLE");
    if (this.isPending(socket, host)) throw Error("CWD_QUERY_BUSY");
    this.dispose();
    const pending: Pending = { socket, host, id };
    this.pending = pending;
    pending.timer = setTimeout(() => {
      if (this.pending !== pending) return;
      this.dispose();
      onTimeout();
    }, 20000);
    try {
      socket.send(
        JSON.stringify({
          type: "get_cwd",
          data: { shellReady: true, requestId: id },
        }),
      );
    } catch (error) {
      if (this.pending === pending) this.dispose();
      throw error;
    }
  }

  consume(
    id: unknown,
    host: string,
    socket: DirectoryQuerySocket | null | undefined,
  ): boolean {
    const pending = this.pending;
    if (
      !pending ||
      pending.id !== id ||
      pending.host !== host ||
      pending.socket !== socket ||
      socket.readyState !== 1
    )
      return false;
    this.dispose();
    return true;
  }

  dispose(): void {
    const pending = this.pending;
    this.pending = null;
    if (pending?.timer !== undefined) clearTimeout(pending.timer);
  }
}
