import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { createServer, connect as tcpConnect, type Socket } from "node:net";
import ssh2 from "ssh2";
import { resolveSshKeepalive } from "../../hosts/ssh-keepalive.js";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function fixture(interval: number, count: number, proxy = false) {
  const pem = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  }).privateKey.export({ type: "pkcs1", format: "pem" });
  const key = ssh2.utils.parseKey(pem);
  if (key instanceof Error || Array.isArray(key)) throw Error("fixture key");
  const requests: number[] = [],
    peers = new Set<ssh2.Connection>();
  const server = new ssh2.Server(
    {
      hostKeys: [pem],
      debug: (message) => {
        if (message.includes("Inbound: GLOBAL_REQUEST (keepalive@openssh.com)"))
          requests.push(Date.now());
      },
    },
    (peer) => {
      peers.add(peer);
      peer.on("error", () => {});
      peer.on("close", () => peers.delete(peer));
      peer.on("authentication", (ctx) =>
        ctx.method === "password" && ctx.password === "fixture"
          ? ctx.accept()
          : ctx.reject(),
      );
    },
  );
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  cleanup.push(async () => {
    for (const peer of peers) peer.end();
    await new Promise<void>((r) => server.close(() => r()));
  });
  let port = (server.address() as { port: number }).port,
    blocked = false;
  if (proxy) {
    const targetPort = port,
      sockets = new Set<Socket>();
    const bridge = createServer((down) => {
      const up = tcpConnect(targetPort, "127.0.0.1");
      sockets.add(down);
      sockets.add(up);
      for (const [a, b] of [
        [down, up],
        [up, down],
      ]) {
        a.on("data", (data) => {
          if (!blocked) b.write(data);
        });
        a.on("error", () => b.destroy());
        a.on("close", () => {
          sockets.delete(a);
          b.destroy();
        });
      }
    });
    await new Promise<void>((r) => bridge.listen(0, "127.0.0.1", r));
    port = (bridge.address() as { port: number }).port;
    cleanup.push(async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((r) => bridge.close(() => r()));
    });
  }
  const client = new ssh2.Client(),
    errors: Error[] = [];
  let closed = false;
  client.on("error", (error) => errors.push(error));
  client.on("close", () => {
    closed = true;
  });
  cleanup.push(() => client.destroy());
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    client.connect({
      host: "127.0.0.1",
      port,
      username: "fixture",
      password: "fixture",
      hostVerifier: (raw) => raw.equals(key.getPublicSSH()),
      readyTimeout: 5000,
      ...resolveSshKeepalive(interval, count, 30000, 5),
    });
  });
  return {
    requests,
    errors,
    closed: () => closed,
    block: () => {
      blocked = true;
    },
    readyAt: Date.now(),
  };
}
it("sends real keepalives on an idle authenticated connection and remains connected", async () => {
  const f = await fixture(5, 1);
  await vi.waitFor(() => expect(f.requests.length).toBeGreaterThanOrEqual(2), {
    timeout: 14000,
    interval: 100,
  });
  expect(f.requests[0] - f.readyAt).toBeGreaterThanOrEqual(4000);
  expect(f.requests[1] - f.requests[0]).toBeGreaterThanOrEqual(4000);
  expect(f.errors).toEqual([]);
  expect(f.closed()).toBe(false);
}, 20000);
it("sends no keepalive when the configured interval is zero", async () => {
  const f = await fixture(0, 1);
  await new Promise((r) => setTimeout(r, 6000));
  expect(f.requests).toEqual([]);
  expect(f.errors).toEqual([]);
  expect(f.closed()).toBe(false);
}, 12000);
it("detects a silent network after the configured missed-keepalive limit", async () => {
  const f = await fixture(5, 1, true);
  f.block();
  await vi.waitFor(() => expect(f.closed()).toBe(true), {
    timeout: 15000,
    interval: 100,
  });
  expect(f.errors.some((e) => /keepalive timeout/i.test(e.message))).toBe(true);
  expect(Date.now() - f.readyAt).toBeGreaterThanOrEqual(9000);
  expect(f.requests).toEqual([]);
}, 20000);
