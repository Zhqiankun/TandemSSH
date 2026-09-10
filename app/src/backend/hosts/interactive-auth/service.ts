import { KeyboardInteractiveExchange } from "../keyboard-interactive.js";
export type InteractiveTarget =
  import("../../../types/ssh-interactive-auth.js").SSHInteractiveTarget & {
    userId: string;
  };
export type SharedInteractiveRequest =
  import("../../../types/ssh-interactive-auth.js").SharedSSHInteractiveRequest;
interface Entry {
  abort: (code: string) => void;
  target: InteractiveTarget;
  authorize: () => void | Promise<void>;
  exchange: KeyboardInteractiveExchange;
  request?: SharedInteractiveRequest;
  closed: boolean;
  revision: number;
  promptIds: Set<string>;
  replying?: Promise<void>;
}
export class InteractiveAuthService {
  private readonly entries = new Set<Entry>();
  create(
    target: InteractiveTarget,
    authorize: () => void | Promise<void>,
    abort: (code: string) => void,
  ) {
    if (
      typeof target.userId !== "string" ||
      !target.userId ||
      target.userId.length > 256 ||
      typeof target.connectionId !== "string" ||
      !/^[a-zA-Z0-9:._-]{1,128}$/.test(target.connectionId) ||
      !["files", "monitoring", "jump"].includes(target.channel) ||
      (target.hostId !== undefined &&
        (!Number.isSafeInteger(target.hostId) || target.hostId < 1)) ||
      typeof target.address !== "string" ||
      !target.address ||
      (target.hostname !== undefined &&
        (typeof target.hostname !== "string" ||
          target.hostname.length > 1024)) ||
      target.address.length > 512 ||
      !Number.isInteger(target.port) ||
      target.port < 1 ||
      target.port > 65535 ||
      typeof target.username !== "string" ||
      target.username.length > 1024
    )
      throw Error("SSH_AUTH_INVALID_CHALLENGE");
    if (
      this.entries.size >= 256 ||
      [...this.entries].filter((e) => e.target.userId === target.userId)
        .length >= 32
    )
      throw Error("SSH_AUTH_LIMIT");
    const { userId: _userId, ...publicTarget } = target;
    const entry = {
      target: { ...target },
      authorize,
      abort,
      closed: false,
      revision: 0,
      promptIds: new Set<string>(),
    } as Entry;
    const dispose = () => {
      if (entry.closed) return;
      entry.closed = true;
      entry.request = undefined;
      entry.exchange.dispose();
      this.entries.delete(entry);
    };
    entry.exchange = new KeyboardInteractiveExchange({
      challenge: (challenge) => {
        if (!entry.closed) {
          entry.promptIds.add(challenge.id);
          entry.request = { ...challenge, target: publicTarget };
        }
      },
      failure: (code) => {
        dispose();
        abort(code);
      },
    });
    this.entries.add(entry);
    return {
      begin: async (
        ...args: Parameters<KeyboardInteractiveExchange["begin"]>
      ) => {
        if (entry.closed) return;
        const revision = ++entry.revision;
        entry.request = undefined;
        entry.replying = undefined;
        const [name, instructions, prompts, finish, password] = args;
        entry.exchange.begin(
          name,
          instructions,
          prompts,
          (answers) => {
            const replying = this.check(entry)
              .then(() => {
                if (entry.closed || revision !== entry.revision)
                  throw Error("SSH_AUTH_STALE_PROMPT");
                finish(answers);
              })
              .catch((error) => {
                if (
                  !entry.closed &&
                  !(
                    error instanceof Error &&
                    error.message === "SSH_AUTH_STALE_PROMPT"
                  )
                ) {
                  dispose();
                  abort("SSH_AUTH_CONNECTION_LOST");
                }
                throw error;
              });
            entry.replying = replying;
            void replying.catch(() => {});
          },
          password,
        );
        await entry.replying;
      },
      dispose,
    };
  }
  private owned(userId: string, id: string) {
    const entry = [...this.entries].find(
      (e) => !e.closed && e.target.userId === userId && e.request?.id === id,
    );
    if (!entry) throw Error("SSH_AUTH_STALE_PROMPT");
    return entry;
  }
  private async check(entry: Entry) {
    try {
      await entry.authorize();
    } catch {
      if (!entry.closed) {
        entry.closed = true;
        entry.request = undefined;
        entry.exchange.dispose();
        this.entries.delete(entry);
        try {
          entry.abort("SSH_AUTH_ACCESS_DENIED");
        } catch {
          /* closed transport */
        }
      }
      throw Error("SSH_AUTH_ACCESS_DENIED");
    }
  }
  async list(userId: string) {
    const requests: SharedInteractiveRequest[] = [];
    for (const entry of [...this.entries]) {
      if (entry.target.userId !== userId || !entry.request) continue;
      try {
        await this.check(entry);
      } catch {
        continue;
      }
      if (!entry.closed && entry.request)
        requests.push(structuredClone(entry.request));
    }
    return { requests };
  }
  async respond(userId: string, id: string, responses: unknown) {
    const entry = this.owned(userId, id);
    await this.check(entry);
    if (this.owned(userId, id) !== entry) throw Error("SSH_AUTH_STALE_PROMPT");
    entry.exchange.respond(id, responses);
    const replying = entry.replying;
    if (entry.request?.id === id)
      entry.request = { ...entry.request, waiting: true };
    await replying;
  }
  async cancel(userId: string, id: string) {
    const entry = [...this.entries].find(
      (e) => !e.closed && e.target.userId === userId && e.promptIds.has(id),
    );
    if (!entry) throw Error("SSH_AUTH_STALE_PROMPT");
    if (!entry.exchange.cancel(id)) {
      entry.closed = true;
      entry.request = undefined;
      entry.exchange.dispose();
      this.entries.delete(entry);
      try {
        entry.abort("SSH_AUTH_CANCELLED");
      } catch {
        /* already closed */
      }
    }
  }
  dispose() {
    for (const entry of [...this.entries]) {
      entry.closed = true;
      entry.request = undefined;
      entry.exchange.dispose();
      try {
        entry.abort("SSH_AUTH_CANCELLED");
      } catch {
        /* already closed */
      }
    }
    this.entries.clear();
  }
}
