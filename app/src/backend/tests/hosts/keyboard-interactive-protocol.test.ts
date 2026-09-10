import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import ssh2 from "ssh2";
import type { WebSocket } from "ws";
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findCredentialByIdForUser: async () => null,
  }),
}));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  authLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
import { SSHAuthManager } from "../../hosts/auth-manager.js";
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
interface Round {
  prompts: Array<{ prompt: string; echo: boolean }>;
  responses: string[];
}
async function authenticate(rounds: Round[]) {
  const key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs1", format: "pem" });
  const parsed = ssh2.utils.parseKey(key);
  if (parsed instanceof Error || Array.isArray(parsed))
    throw Error("fixture key");
  const clients = new Set<ssh2.Connection>(),
    received: string[][] = [];
  const server = new ssh2.Server({ hostKeys: [key] }, (connection) => {
    clients.add(connection);
    connection.on("error", () => {});
    connection.once("close", () => clients.delete(connection));
    connection.on("authentication", (ctx) => {
      if (ctx.method !== "keyboard-interactive") {
        ctx.reject(["keyboard-interactive"]);
        return;
      }
      const ask = (index: number) =>
        ctx.prompt(rounds[index].prompts, "Fixture login", (responses) => {
          received.push(responses);
          if (
            JSON.stringify(responses) !==
            JSON.stringify(rounds[index].responses)
          ) {
            ctx.reject();
            return;
          }
          if (index + 1 === rounds.length) ctx.accept();
          else ask(index + 1);
        });
      ask(0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const client of clients) client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const client = new ssh2.Client();
  cleanup.push(() => client.destroy());
  let replyRound = 0;
  const ws = {
    send: (data: string) => {
      const message = JSON.parse(data);
      if (
        ![
          "password_required",
          "totp_required",
          "keyboard_interactive_required",
        ].includes(message.type)
      )
        return;
      const responses = rounds[replyRound++]?.responses ?? [];
      queueMicrotask(() => {
        if (message.type === "keyboard_interactive_required")
          manager.respondKeyboardInteractive(message.challenge.id, responses);
        else manager.context.keyboardInteractiveFinish?.(responses);
      });
    },
  };
  const manager = new SSHAuthManager({
    userId: "fixture",
    ws: ws as unknown as WebSocket,
    hostId: 1,
    isKeyboardInteractive: false,
    keyboardInteractiveResponded: false,
    keyboardInteractiveFinish: null,
    totpPromptSent: false,
    warpgateAuthPromptSent: false,
    totpTimeout: null,
    warpgateAuthTimeout: null,
    totpAttempts: 0,
    keyboardInteractiveVersion: 1,
    onInteractiveFailure: () => client.destroy(),
  });
  cleanup.push(() => {
    manager.dispose();
    if (manager.context.totpTimeout) clearTimeout(manager.context.totpTimeout);
    if (manager.context.warpgateAuthTimeout)
      clearTimeout(manager.context.warpgateAuthTimeout);
  });
  client.on(
    "keyboard-interactive",
    (name, instructions, lang, prompts, finish) =>
      manager.handleKeyboardInteractive(
        name,
        instructions,
        lang,
        prompts,
        finish,
        { username: "fixture", authType: "none" },
      ),
  );
  const connected = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      client.destroy();
      resolve(false);
    }, 6000);
    client.once("ready", () => {
      clearTimeout(timer);
      resolve(true);
    });
    client.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    client.connect({
      host: "127.0.0.1",
      port: (server.address() as { port: number }).port,
      username: "fixture",
      authHandler: ["keyboard-interactive"],
      tryKeyboard: true,
      readyTimeout: 5000,
      hostVerifier: (key) => key.equals(parsed.getPublicSSH()),
    });
  });
  return { connected, received };
}
it("preserves a whitespace-sensitive password over actual SSH keyboard-interactive authentication", async () => {
  const rounds = [
    {
      prompts: [{ prompt: "Password:", echo: false }],
      responses: ["  whitespace fixture  "],
    },
  ];
  const result = await authenticate(rounds);
  expect(result.received).toEqual(rounds.map((round) => round.responses));
  expect(result.connected).toBe(true);
}, 10000);
it("collects every answer in a multi-prompt SSH round", async () => {
  const rounds = [
    {
      prompts: [
        { prompt: "Tenant:", echo: true },
        { prompt: "Secret:", echo: false },
      ],
      responses: ["租户 A", "long-fixture-secret"],
    },
  ];
  const result = await authenticate(rounds);
  expect(result.received).toEqual(rounds.map((round) => round.responses));
  expect(result.connected).toBe(true);
}, 10000);
it("continues multiple SSH rounds including an empty confirmation answer", async () => {
  const rounds = [
    {
      prompts: [{ prompt: "Select authentication method:", echo: true }],
      responses: ["2"],
    },
    {
      prompts: [{ prompt: "Press enter to confirm:", echo: true }],
      responses: [""],
    },
    {
      prompts: [{ prompt: "Verification code:", echo: false }],
      responses: ["135790"],
    },
  ];
  const result = await authenticate(rounds);
  expect(result.received).toEqual(rounds.map((round) => round.responses));
  expect(result.connected).toBe(true);
}, 10000);
