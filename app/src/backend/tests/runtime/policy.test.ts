import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:net";
import { once } from "node:events";
import {
  resolveRuntimePolicy,
  serviceListenOptions,
} from "../../runtime/policy.js";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve())),
      ),
  );
});

describe("desktop runtime boundary", () => {
  it("forces all desktop service listeners onto loopback even with a wildcard fallback", () => {
    const policy = resolveRuntimePolicy({
      ELECTRON_EMBEDDED: "true",
      HOST: "0.0.0.0",
    });
    expect(serviceListenOptions(30001, "0.0.0.0", policy)).toEqual({
      port: 30001,
      host: "127.0.0.1",
    });
    expect(serviceListenOptions(30002, undefined, policy)).toEqual({
      port: 30002,
      host: "127.0.0.1",
    });
  });

  it("actually binds a TCP socket to the IPv4 loopback address", async () => {
    const server = createServer();
    servers.push(server);
    server.listen(
      serviceListenOptions(
        0,
        undefined,
        resolveRuntimePolicy({ ELECTRON_EMBEDDED: "true" }),
      ),
    );
    await once(server, "listening");
    expect(server.address()).toMatchObject({
      address: "127.0.0.1",
      family: "IPv4",
    });
  });

  it("preserves existing server listener defaults outside desktop mode", () => {
    const policy = resolveRuntimePolicy({});
    expect(serviceListenOptions(30001, undefined, policy)).toEqual({
      port: 30001,
    });
    expect(serviceListenOptions(30009, "0.0.0.0", policy)).toEqual({
      port: 30009,
      host: "0.0.0.0",
    });
  });

  it("does not download optional components or check upstream releases by default", () => {
    expect(resolveRuntimePolicy({ ELECTRON_EMBEDDED: "true" })).toMatchObject({
      opkssh: false,
      guacamole: false,
      upstreamUpdates: false,
    });
  });

  it("uses an immutable snapshot rather than following later environment changes", () => {
    const env = { ELECTRON_EMBEDDED: "true", ENABLE_OPKSSH: "false" };
    const policy = resolveRuntimePolicy(env);
    env.ELECTRON_EMBEDDED = "false";
    env.ENABLE_OPKSSH = "true";
    expect(policy).toMatchObject({ desktop: true, opkssh: false });
    expect(Object.isFrozen(policy)).toBe(true);
  });
});
