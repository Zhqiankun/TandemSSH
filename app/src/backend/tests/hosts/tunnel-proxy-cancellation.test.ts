import { afterEach, expect, it, vi } from "vitest";
import { createServer, connect, type Socket } from "node:net";
import { createSocks5Connection } from "../../utils/proxy-helper";
import type { ProxyNode } from "../../../types/index";
vi.mock("../../utils/logger.js", () => ({ sshLogger: { error: vi.fn() } }));
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function endpoint(onSocket: (socket: Socket) => void) {
  const sockets = new Set<Socket>();
  let accepted = 0;
  const server = createServer((socket) => {
    accepted++;
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    onSocket(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    port: (server.address() as { port: number }).port,
    live: () => sockets.size,
    accepted: () => accepted,
  };
}
async function proxy(type: "socks5" | "http", destination: number) {
  return endpoint((socket) => {
    let stage = 0,
      data = Buffer.alloc(0);
    const parse = (chunk: Buffer) => {
      data = Buffer.concat([data, chunk]);
      if (type === "socks5" && stage === 0) {
        if (data.length < 2 || data.length < 2 + data[1]) return;
        data = data.subarray(2 + data[1]);
        stage = 1;
        socket.write(Buffer.from([5, 0]));
      }
      if (type === "socks5" ? data.length < 10 : !data.includes("\r\n\r\n"))
        return;
      socket.off("data", parse);
      const outgoing = connect(destination, "127.0.0.1");
      outgoing.on("error", () => socket.destroy());
      socket.once("close", () => outgoing.destroy());
      outgoing.once("close", () => socket.destroy());
      outgoing.once("connect", () => {
        socket.write(
          type === "socks5"
            ? Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
            : "HTTP/1.1 200 Connection established\r\n\r\n",
        );
        socket.pipe(outgoing).pipe(socket);
      });
    };
    socket.on("data", parse);
  });
}

it.each(["single", "socks-chain", "http-chain"] as const)(
  "cancels a stalled %s proxy handshake and releases all sockets",
  async (kind) => {
    let bytes = 0;
    const stalled = await endpoint((s) =>
      s.on("data", (chunk) => {
        bytes += chunk.length;
      }),
    );
    const first =
      kind === "single"
        ? undefined
        : await proxy(kind === "http-chain" ? "http" : "socks5", stalled.port);
    const controller = new AbortController();
    const chain: ProxyNode[] | undefined = first
      ? [
          {
            host: "127.0.0.1",
            port: first.port,
            type: kind === "http-chain" ? "http" : 5,
          },
          {
            host: "127.0.0.1",
            port: stalled.port,
            type: kind === "http-chain" ? "http" : 5,
          },
        ]
      : undefined;
    const pending = createSocks5Connection(
      "127.0.0.1",
      2222,
      {
        useSocks5: true,
        socks5Host: "127.0.0.1",
        socks5Port: stalled.port,
        socks5ProxyChain: chain,
      },
      controller.signal,
    );
    const rejected = expect(pending).rejects.toThrow("cancel fixture");
    await vi.waitFor(() => expect(bytes).toBeGreaterThan(0));
    controller.abort(Error("cancel fixture"));
    await rejected;
    await vi.waitFor(() =>
      expect(stalled.live() + (first?.live() ?? 0)).toBe(0),
    );
    expect(stalled.accepted()).toBe(1);
  },
  10000,
);

it.each(["single", "socks-chain", "mixed-chain", "editor-chain"] as const)(
  "forwards exact bytes through %s with cancellation support",
  async (kind) => {
    const echo = await endpoint((s) => s.pipe(s)),
      last = await proxy("socks5", echo.port);
    const first =
      kind === "single"
        ? undefined
        : await proxy(kind === "mixed-chain" ? "http" : "socks5", last.port);
    const controller = new AbortController();
    const chain: ProxyNode[] | undefined = first
      ? [
          {
            host: "127.0.0.1",
            port: first.port,
            type:
              kind === "mixed-chain"
                ? "http"
                : kind === "editor-chain"
                  ? "socks5"
                  : 5,
          },
          {
            host: "127.0.0.1",
            port: last.port,
            type: kind === "editor-chain" ? "socks5" : 5,
          },
        ]
      : undefined;
    const socket = await createSocks5Connection(
      "127.0.0.1",
      echo.port,
      {
        useSocks5: true,
        socks5Host: "127.0.0.1",
        socks5Port: last.port,
        socks5ProxyChain: chain,
      },
      controller.signal,
    );
    const payload = Buffer.from([0, 255, 10, 13, 127, 129]);
    const received = new Promise<Buffer>((resolve, reject) => {
      socket!.once("error", reject);
      socket!.once("data", resolve);
    });
    socket!.write(payload);
    expect(await received).toEqual(payload);
    socket!.destroy();
    await vi.waitFor(() => expect(echo.live()).toBe(0));
  },
  10000,
);

it("never connects a pre-cancelled proxy request", async () => {
  const target = await endpoint((s) => s.resume()),
    controller = new AbortController();
  controller.abort(Error("cancel fixture"));
  await expect(
    createSocks5Connection(
      "127.0.0.1",
      2222,
      { useSocks5: true, socks5Host: "127.0.0.1", socks5Port: target.port },
      controller.signal,
    ),
  ).rejects.toThrow("cancel fixture");
  expect(target.accepted()).toBe(0);
});
