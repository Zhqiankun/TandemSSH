import { afterEach, expect, it } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import ssh2, { Client, type ParsedKey } from "ssh2";
import { applyAgentAuth } from "../../hosts/terminal-auth-helpers";
import { preparePrivateKeyForSSH2 } from "../../utils/ssh-key-utils";
const cleanup: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function key() {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = pair.privateKey.export({ type: "pkcs1", format: "pem" });
  const parsed = ssh2.utils.parseKey(pem);
  if (parsed instanceof Error || Array.isArray(parsed))
    throw Error("fixture key");
  return {
    parsed,
    pem,
    pair,
    publicText: `ssh-rsa ${parsed.getPublicSSH().toString("base64")} fixture`,
  };
}
async function agent(keys: ParsedKey[]) {
  const address =
    process.platform === "win32"
      ? String.raw`\\.\pipe\tandem-agent-${randomUUID()}`
      : path.join(tmpdir(), `tandem-${randomUUID()}.sock`);
  const sockets = new Set<Socket>(),
    signed: Buffer[] = [];
  let identities = 0;
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    const protocol = new ssh2.AgentProtocol(false);
    protocol.on("error", () => socket.destroy());
    protocol.on("identities", (request) => {
      identities++;
      protocol.getIdentitiesReply(request, keys);
    });
    protocol.on("sign", (request, publicKey, data, options) => {
      const selected = keys.find((key) =>
        key.getPublicSSH().equals(publicKey.getPublicSSH()),
      );
      if (!selected) {
        protocol.failureReply(request);
        return;
      }
      signed.push(Buffer.from(publicKey.getPublicSSH()));
      const signature = selected.sign(data, options.hash);
      if (signature instanceof Error) protocol.failureReply(request);
      else protocol.signReply(request, signature);
    });
    socket.pipe(protocol).pipe(socket);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(address, resolve);
  });
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { address, signed, identities: () => identities };
}
async function ssh(expected: ParsedKey, password?: string) {
  const host = key(),
    connections = new Set<{ end(): void }>(),
    offered: Buffer[] = [];
  let signatures = 0,
    authCalls = 0;
  const server = new ssh2.Server({ hostKeys: [host.pem] }, (client) => {
    connections.add(client);
    client.on("error", () => {});
    client.once("close", () => connections.delete(client));
    client.on("authentication", (ctx) => {
      authCalls++;
      if (ctx.method === "password" && password && ctx.password === password) {
        ctx.accept();
        return;
      }
      if (ctx.method !== "publickey") {
        ctx.reject();
        return;
      }
      offered.push(Buffer.from(ctx.key.data));
      if (!ctx.key.data.equals(expected.getPublicSSH())) {
        ctx.reject();
        return;
      }
      if (!ctx.signature) {
        ctx.accept();
        return;
      }
      if (expected.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true) {
        signatures++;
        ctx.accept();
      } else ctx.reject();
    });
    client.on("session", (accept) => {
      const session = accept();
      session.on("exec", (accept, _reject, info) => {
        const stream = accept();
        stream.on("error", () => {});
        stream.resume();
        stream.exit(info.command === "whoami" ? 0 : 127);
        stream.end("fixture-user\n");
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const client of connections) client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return {
    port: (server.address() as { port: number }).port,
    hostKey: host.parsed.getPublicSSH(),
    offered,
    signatures: () => signatures,
    authCalls: () => authCalls,
  };
}
async function connect(
  server: Awaited<ReturnType<typeof ssh>>,
  authentication: Record<string, unknown>,
  verify?: (key: Buffer, decide: (trusted: boolean) => void) => void,
) {
  const client = new Client();
  client.on("error", () => {});
  cleanup.push(() => client.destroy());
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    client.connect({
      host: "127.0.0.1",
      port: server.port,
      username: "fixture-user",
      readyTimeout: 5000,
      hostVerifier: verify ?? ((key) => key.equals(server.hostKey)),
      ...authentication,
    });
  });
  return client;
}
async function command(client: Client) {
  return new Promise<string>((resolve, reject) =>
    client.exec("whoami", (error, channel) => {
      if (error) {
        reject(error);
        return;
      }
      let output = "";
      channel.on("data", (bytes) => {
        output += bytes.toString();
      });
      channel.on("error", reject);
      channel.once("close", (code) =>
        code === 0 ? resolve(output) : reject(Error("fixture command failed")),
      );
    }),
  );
}
it("authenticates over the real local agent protocol using only the selected key after host trust", async () => {
  const ignored = key(),
    selected = key(),
    service = await agent([ignored.parsed, selected.parsed]),
    server = await ssh(selected.parsed),
    options: Record<string, unknown> = {};
  expect(
    await applyAgentAuth(options, {
      agentSocketPath: service.address,
      agentIdentity: selected.publicText,
    }),
  ).toEqual({ socketPath: service.address });
  let approve!: () => void;
  const pending = connect(server, options, (actual, decide) => {
    expect(actual).toEqual(server.hostKey);
    approve = () => decide(true);
  });
  const deadline = Date.now() + 4000;
  while (!approve && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  expect(approve).toBeTypeOf("function");
  expect(service.identities()).toBe(0);
  expect(service.signed).toEqual([]);
  expect(server.authCalls()).toBe(0);
  approve();
  const client = await pending;
  expect(await command(client)).toBe("fixture-user\n");
  expect(service.identities()).toBe(1);
  expect(service.signed).toHaveLength(1);
  expect(service.signed[0]).toEqual(selected.parsed.getPublicSSH());
  expect(
    server.offered.every((k) => k.equals(selected.parsed.getPublicSSH())),
  ).toBe(true);
  expect(server.signatures()).toBe(1);
}, 10000);
it("does not silently use a different agent key when the configured identity is absent", async () => {
  const available = key(),
    missing = key(),
    service = await agent([available.parsed]),
    server = await ssh(available.parsed),
    options: Record<string, unknown> = {};
  await applyAgentAuth(options, {
    agentSocketPath: service.address,
    agentIdentity: missing.publicText,
  });
  await expect(connect(server, options)).rejects.toThrow();
  expect(service.signed).toEqual([]);
  expect(server.offered).toEqual([]);
}, 10000);
it("authenticates with password and an encrypted private key and rejects the wrong passphrase", async () => {
  const identity = key(),
    server = await ssh(identity.parsed, "fixture-password");
  const passwordClient = await connect(server, {
    password: "fixture-password",
  });
  expect(await command(passwordClient)).toBe("fixture-user\n");
  const encrypted = identity.pair.privateKey.export({
    type: "pkcs1",
    format: "pem",
    cipher: "aes-256-cbc",
    passphrase: "fixture-key-passphrase",
  });
  const prepared = preparePrivateKeyForSSH2(
    encrypted.toString(),
    "fixture-key-passphrase",
  );
  const keyClient = await connect(server, {
    privateKey: prepared,
    passphrase: "fixture-key-passphrase",
  });
  expect(await command(keyClient)).toBe("fixture-user\n");
  expect(server.signatures()).toBe(1);
  const acceptedBeforeWrongPassphrase = server.signatures();
  await expect(
    connect(server, {
      privateKey: preparePrivateKeyForSSH2(
        encrypted.toString(),
        "wrong-passphrase",
      ),
      passphrase: "wrong-passphrase",
    }),
  ).rejects.toThrow();
  expect(server.signatures()).toBe(acceptedBeforeWrongPassphrase);
}, 10000);
