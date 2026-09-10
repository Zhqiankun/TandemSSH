import { randomUUID } from "node:crypto";
import {
  SSH_AUTH_MAX_PROMPTS,
  validInteractiveResponses,
  type SSHInteractiveChallenge,
  type SSHInteractiveErrorCode,
} from "../../types/ssh-interactive-auth.js";
interface Options {
  challenge: (challenge: SSHInteractiveChallenge) => void;
  failure: (code: SSHInteractiveErrorCode, id?: string) => void;
  now?: () => number;
  timeoutMs?: number;
  lifetimeMs?: number;
}
interface Pending {
  challenge: SSHInteractiveChallenge;
  answers: string[];
  finish: (answers: string[]) => void;
  timer: ReturnType<typeof setTimeout>;
}
/** One exchange belongs to one SSH authentication attempt. It never writes to a PTY. */
export class KeyboardInteractiveExchange {
  private pending?: Pending;
  private closed = false;
  private rounds = 0;
  private lifetimeTimer?: ReturnType<typeof setTimeout>;
  private started?: number;
  private readonly now: () => number;
  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now;
  }
  private clear() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
  }
  private fail(code: SSHInteractiveErrorCode) {
    if (this.closed) return;
    const id = this.pending?.challenge.id;
    this.clear();
    this.closed = true;
    clearTimeout(this.lifetimeTimer);
    try {
      this.options.failure(code, id);
    } catch {
      /* The transport may already be closed; authority is already revoked. */
    }
  }
  begin(
    name: string,
    instructions: string,
    prompts: Array<{ prompt: string; echo: boolean }>,
    finish: (responses: string[]) => void,
    password?: string,
  ) {
    if (this.closed) return;
    this.clear();
    if (this.started === undefined) {
      this.started = this.now();
      this.lifetimeTimer = setTimeout(
        () => this.fail("SSH_AUTH_TIMEOUT"),
        this.options.lifetimeMs ?? 300000,
      );
      this.lifetimeTimer.unref?.();
    }
    if (++this.rounds > 32) {
      this.fail("SSH_AUTH_LIMIT");
      return;
    }
    if (
      typeof name !== "string" ||
      typeof instructions !== "string" ||
      typeof finish !== "function" ||
      !Array.isArray(prompts) ||
      prompts.length > SSH_AUTH_MAX_PROMPTS ||
      prompts.some(
        (p) =>
          !p || typeof p.prompt !== "string" || typeof p.echo !== "boolean",
      ) ||
      name.length +
        instructions.length +
        prompts.reduce((n, p) => n + p.prompt.length, 0) >
        32768 ||
      Buffer.byteLength(
        name + instructions + prompts.map((p) => p.prompt).join(""),
        "utf8",
      ) > 32768
    ) {
      this.fail("SSH_AUTH_INVALID_CHALLENGE");
      return;
    }
    const lifetime = this.options.lifetimeMs ?? 300000;
    const remaining = this.started + lifetime - this.now();
    if (remaining <= 0) {
      this.fail("SSH_AUTH_TIMEOUT");
      return;
    }
    const answers = prompts.map((p) =>
      !p.echo && /password/i.test(p.prompt) && typeof password === "string"
        ? password
        : "",
    );
    if (!validInteractiveResponses(answers, prompts.length)) {
      this.fail("SSH_AUTH_LIMIT");
      return;
    }
    const visible = prompts.flatMap((p, index) =>
      !p.echo && /password/i.test(p.prompt) && typeof password === "string"
        ? []
        : [{ index, prompt: p.prompt, echo: p.echo }],
    );
    if (!visible.length) {
      try {
        finish(answers);
      } catch {
        this.fail("SSH_AUTH_CONNECTION_LOST");
      }
      return;
    }
    const duration = Math.min(this.options.timeoutMs ?? 180000, remaining);
    const challenge: SSHInteractiveChallenge = {
      id: randomUUID(),
      name,
      instructions,
      prompts: visible,
      expiresAt: this.now() + duration,
    };
    const timer = setTimeout(() => {
      if (this.pending?.challenge.id === challenge.id)
        this.fail("SSH_AUTH_TIMEOUT");
    }, duration);
    timer.unref?.();
    this.pending = { challenge, answers, finish, timer };
    try {
      this.options.challenge(challenge);
    } catch {
      this.fail("SSH_AUTH_CONNECTION_LOST");
    }
  }
  respond(id: unknown, responses: unknown) {
    const current = this.pending;
    if (this.closed || !current || id !== current.challenge.id)
      throw Error("SSH_AUTH_STALE_PROMPT");
    if (this.now() >= current.challenge.expiresAt) {
      this.fail("SSH_AUTH_TIMEOUT");
      throw Error("SSH_AUTH_STALE_PROMPT");
    }
    if (!validInteractiveResponses(responses, current.challenge.prompts.length))
      throw Error("SSH_AUTH_INVALID_RESPONSE");
    const answers = [...current.answers];
    current.challenge.prompts.forEach((prompt, index) => {
      answers[prompt.index] = responses[index];
    });
    if (!validInteractiveResponses(answers, answers.length))
      throw Error("SSH_AUTH_INVALID_RESPONSE");
    this.clear();
    try {
      current.finish(answers);
    } catch {
      this.fail("SSH_AUTH_CONNECTION_LOST");
    }
  }
  cancel(id: unknown): boolean {
    if (this.closed || !this.pending || id !== this.pending.challenge.id)
      return false;
    this.fail("SSH_AUTH_CANCELLED");
    return true;
  }
  dispose() {
    clearTimeout(this.lifetimeTimer);
    this.clear();
    this.closed = true;
  }
}
