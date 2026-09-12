import type { Client as SSHClient } from "ssh2";

// Serializes SSH channel open requests so only one channel negotiation is
// in-flight at a time per session. Once the channel is established the slot
// is released immediately so the next open can proceed; the channels
// themselves remain open concurrently.
export class ChannelOpenSerializer {
  private tail: Promise<void> = Promise.resolve();

  run<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(
      () => action(),
      () => action(),
    );
    this.tail = next.then(
      () => {},
      () => {},
    );
    return next;
  }
}

export interface SSHSession {
  client: SSHClient;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  sudoPassword?: string;
  sftp?: import("ssh2").SFTPWrapper;
  sftpPending?: Promise<import("ssh2").SFTPWrapper>;
  channelOpener: ChannelOpenSerializer;
  poolKey?: string;
  userId?: string;
  hostId?: number;
  ip?: string;
  port?: number;
  username?: string;
  transferDedicated?: boolean;
  transferId?: string;
  browseSessionId?: string;
  scpLegacy?: boolean;
}

export interface PendingTOTPSession {
  client: SSHClient;
  finish: (responses: string[]) => void;
  config: import("ssh2").ConnectConfig;
  createdAt: number;
  sessionId: string;
  hostId?: number;
  ip?: string;
  port?: number;
  username?: string;
  userId?: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
  totpPromptIndex?: number;
  resolvedPassword?: string;
  totpAttempts: number;
  isWarpgate?: boolean;
}

export function execWithSudo(
  session: SSHSession,
  command: string,
  sudoPassword: string,
  assertSession?: () => void,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return execWithSudoBuffer(session, command, sudoPassword, assertSession).then(
    (result) => ({
      stdout: result.stdout.toString("utf8"),
      stderr: result.stderr,
      code: result.code,
    }),
  );
}

export function execWithSudoBuffer(
  session: SSHSession,
  command: string,
  sudoPassword: string,
  assertSession?: () => void,
): Promise<{ stdout: Buffer; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const sudoCommand = `sudo -S -p '' -- ${command}`;
    const stdoutChunks: Buffer[] = [];
    let stderr = "",
      settled = false,
      dispatched = false;
    let channel: import("ssh2").ClientChannel | undefined;
    const finish = (code: number | null, detail = stderr) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr: detail, code });
    };
    const timer = setTimeout(() => {
      finish(null, dispatched ? "SUDO_RESULT_UNKNOWN" : "SUDO_NOT_DISPATCHED");
      channel?.destroy();
    }, 60000);
    const checkSession = () => {
      if (!session.isConnected) throw Error("SUDO_NOT_DISPATCHED");
      assertSession?.();
    };
    execChannel(
      session,
      sudoCommand,
      (err, stream) => {
        if (settled) {
          stream?.destroy();
          return;
        }
        if (err) {
          finish(1, err.message);
          return;
        }
        channel = stream;
        try {
          checkSession();
        } catch {
          finish(null, "SUDO_RESULT_UNKNOWN");
          stream.destroy();
          return;
        }
        stream.on("data", (chunk: Buffer) => {
          if (!settled) stdoutChunks.push(chunk);
        });
        stream.stderr.on("data", (chunk: Buffer) => {
          if (!settled) stderr += chunk.toString();
        });
        stream.on("close", (code: number) => {
          finish(Number.isInteger(code) ? code : null);
        });
        stream.on("error", () => finish(null, "SUDO_RESULT_UNKNOWN"));
        try {
          // Send EOF after the password without exposing it in process arguments.
          stream.end(sudoPassword + "\n");
        } catch {
          finish(null, "SUDO_RESULT_UNKNOWN");
          stream.destroy();
        }
      },
      () => {
        if (settled) throw Error("SUDO_NOT_DISPATCHED");
        checkSession();
        dispatched = true;
      },
    );
  });
}

export function getSessionSftp(
  session: SSHSession,
): Promise<import("ssh2").SFTPWrapper> {
  if (session.sftp) {
    return Promise.resolve(session.sftp);
  }

  if (session.sftpPending) {
    return session.sftpPending;
  }

  const openOnce = (): Promise<import("ssh2").SFTPWrapper> =>
    session.channelOpener.run(
      () =>
        new Promise<import("ssh2").SFTPWrapper>((resolve, reject) => {
          session.client.sftp((err, sftp) => {
            if (err) return reject(err);
            session.sftp = sftp;
            sftp.on("error", () => {
              session.sftp = undefined;
            });
            sftp.on("close", () => {
              session.sftp = undefined;
            });
            resolve(sftp);
          });
        }),
    );

  session.sftpPending = openOnce()
    .catch((err: Error) => {
      const isChannelFailure =
        err.message.toLowerCase().includes("channel open failure") ||
        err.message.toLowerCase().includes("open failed");
      if (isChannelFailure) {
        return new Promise<import("ssh2").SFTPWrapper>((resolve, reject) =>
          setTimeout(() => openOnce().then(resolve, reject), 500),
        );
      }
      return Promise.reject(err);
    })
    .finally(() => {
      session.sftpPending = undefined;
    });

  return session.sftpPending;
}

export function execChannel(
  session: SSHSession,
  command: string,
  callback: (
    err: Error | undefined,
    stream: import("ssh2").ClientChannel,
  ) => void,
  beforeOpen?: () => void,
): void {
  session.channelOpener
    .run(
      () =>
        new Promise<import("ssh2").ClientChannel>((resolve, reject) => {
          beforeOpen?.();
          session.client.exec(command, (err, stream) => {
            if (err) return reject(err);
            resolve(stream);
          });
        }),
    )
    .then(
      (stream) => callback(undefined, stream),
      (err: Error) => callback(err, undefined as never),
    );
}
