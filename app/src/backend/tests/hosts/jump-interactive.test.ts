import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { connect as tcpConnect } from "node:net";
import type { Socket } from "node:net";
import { Server, type Connection } from "ssh2";
const state = vi.hoisted(() => ({
  hosts: new Map<number, Record<string, unknown>>(),
}));
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: async (id: number, user: string) =>
    user === "owner" ? state.hosts.get(id) : null,
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => Buffer.alloc(32, 1) },
}));
vi.mock("../../hosts/host-key-verifier.js", () => ({
  SSHHostKeyVerifier: { createHostVerifier: async () => () => true },
}));
vi.mock("../../utils/logger.js", () => ({ fileLogger: { error: vi.fn() } }));
import { createJumpHostChain } from "../../hosts/jump-host-chain.js";
import { interactiveAuth } from "../../hosts/interactive-auth/production.js";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  interactiveAuth.dispose();
  for (const close of cleanup.splice(0).reverse()) await close();
  state.hosts.clear();
});
const key = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey.export({ type: "pkcs1", format: "pem" });
async function ssh(id: number) {
  const peers = new Set<Connection>(),
    sockets = new Set<Socket>();
  const stats = { answers: 0, accepted: 0 };
  const server = new Server({ hostKeys: [key] }, (peer) => {
    peers.add(peer);
    peer.on("error", () => {});
    peer.on("close", () => peers.delete(peer));
    peer.on("authentication", (ctx) => {
      if (ctx.method !== "keyboard-interactive")
        return ctx.reject(["keyboard-interactive"]);
      ctx.prompt(
        [
          { prompt: "Tenant:", echo: true },
          { prompt: "Code:", echo: false },
        ],
        (answers) => {
          stats.answers++;
          if (answers[0] === "  tenant  " && answers[1] === `code-${id}`) {
            stats.accepted++;
            ctx.accept();
          } else ctx.reject(["keyboard-interactive"]);
        },
      );
    });
    peer.on("ready", () => {
      peer.on("tcpip", (accept, reject, info) => {
        if (
          info.destIP !== "127.0.0.1" ||
          ![...state.hosts.values()].some((h) => h.port === info.destPort)
        )
          return reject();
        const socket = tcpConnect(info.destPort, info.destIP);
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => socket.destroy());
        socket.once("connect", () => {
          const stream = accept();
          socket.pipe(stream).pipe(socket);
          stream.on("error", () => socket.destroy());
          stream.on("close", () => socket.destroy());
        });
      });
      peer.on("session", (accept) =>
        accept().on("exec", (acceptExec) => {
          const stream = acceptExec();
          stream.end("actual jump bytes");
        }),
      );
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as { port: number }).port;
  state.hosts.set(id, {
    id,
    ip: "127.0.0.1",
    port,
    username: "fixture",
    authType: "none",
  });
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    for (const peer of peers) peer.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port, peers, stats };
}
async function prompt(id: number) {
  let value:
    | Awaited<ReturnType<typeof interactiveAuth.list>>["requests"][number]
    | undefined;
  await vi.waitFor(
    async () => {
      value = (await interactiveAuth.list("owner")).requests.find(
        (r) => r.target.hostId === id,
      );
      expect(value).toBeDefined();
    },
    { timeout: 5000 },
  );
  return value!;
}
const options = { keyboardInteractiveVersion: 1 as const };
it("authenticates each real SSH hop separately and closes earlier hops with the final client", async () => {
  const first = await ssh(1),
    second = await ssh(2);
  const connecting = createJumpHostChain(
    [{ hostId: 1 }, { hostId: 2 }],
    "owner",
    undefined,
    options,
  );
  const a = await prompt(1);
  expect(a.target.channel).toBe("jump");
  expect((await interactiveAuth.list("other")).requests).toEqual([]);
  await interactiveAuth.respond("owner", a.id, ["  tenant  ", "code-1"]);
  const b = await prompt(2);
  expect(b.id).not.toBe(a.id);
  expect(b.target.connectionId).not.toBe(a.target.connectionId);
  await expect(
    interactiveAuth.respond("owner", a.id, ["wrong"]),
  ).rejects.toThrow("SSH_AUTH_STALE_PROMPT");
  await interactiveAuth.respond("owner", b.id, ["  tenant  ", "code-2"]);
  const client = (await connecting)!;
  const bytes = await new Promise<string>((resolve, reject) =>
    client.exec("fixture", (error, stream) => {
      if (error) return reject(error);
      let data = "";
      stream.on("data", (chunk) => {
        data += chunk;
      });
      stream.on("error", reject);
      stream.on("close", () => resolve(data));
    }),
  );
  expect(bytes).toBe("actual jump bytes");
  expect(first.stats.accepted).toBe(1);
  expect(second.stats.accepted).toBe(1);
  client.end();
  await vi.waitFor(() => {
    expect(first.peers.size).toBe(0);
    expect(second.peers.size).toBe(0);
  });
  expect((await interactiveAuth.list("owner")).requests).toEqual([]);
}, 15000);
it("cancelling the second hop closes the already authenticated first hop without sending empty answers", async () => {
  const first = await ssh(1),
    second = await ssh(2);
  const connecting = createJumpHostChain(
    [{ hostId: 1 }, { hostId: 2 }],
    "owner",
    undefined,
    options,
  );
  const rejected = expect(connecting).rejects.toThrow("SSH_AUTH_CANCELLED");
  const a = await prompt(1);
  await interactiveAuth.respond("owner", a.id, ["  tenant  ", "code-1"]);
  const b = await prompt(2);
  await interactiveAuth.cancel("owner", b.id);
  await rejected;
  await vi.waitFor(() => {
    expect(first.peers.size).toBe(0);
    expect(second.peers.size).toBe(0);
  });
  expect(second.stats.answers).toBe(0);
}, 15000);
it("cancels on the caller signal and denies a response after host access is revoked", async () => {
  const server = await ssh(1),
    controller = new AbortController();
  const connecting = createJumpHostChain(
    [{ hostId: 1 }],
    "owner",
    controller.signal,
    options,
  );
  const rejected = expect(connecting).rejects.toThrow("fixture caller closed");
  await prompt(1);
  controller.abort(Error("fixture caller closed"));
  await rejected;
  await vi.waitFor(() => expect(server.peers.size).toBe(0));
  const again = createJumpHostChain(
    [{ hostId: 1 }],
    "owner",
    undefined,
    options,
  );
  const revoked = expect(again).rejects.toThrow("SSH_AUTH_ACCESS_DENIED");
  const challenge = await prompt(1);
  state.hosts.delete(1);
  await expect(
    interactiveAuth.respond("owner", challenge.id, ["  tenant  ", "code-1"]),
  ).rejects.toThrow("SSH_AUTH_ACCESS_DENIED");
  await revoked;
  await vi.waitFor(() => expect(server.peers.size).toBe(0));
  expect(server.stats.answers).toBe(0);
}, 15000);
