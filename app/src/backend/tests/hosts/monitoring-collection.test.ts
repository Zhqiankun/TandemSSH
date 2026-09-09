import { afterEach, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { Server, Client, utils } from "ssh2";
import type { ServerChannel } from "ssh2";
import {
  MonitoringCollectionRuntime,
  execMetricCommand,
} from "../../hosts/metrics/collection-runtime";
import { monitoringCommand } from "../../hosts/metrics/collection-catalog";
import { collectUptimeMetrics } from "../../hosts/metrics/widgets/uptime-collector";
import { collectMemoryMetrics } from "../../hosts/metrics/widgets/memory-collector";
const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
});
const key = generateKeyPairSync("rsa", {
  modulusLength: 2048,
}).privateKey.export({ type: "pkcs1", format: "pem" });
const expectedKey = utils.parseKey(key);
if (expectedKey instanceof Error) throw expectedKey;
async function fixture(exec: (command: string, stream: ServerChannel) => void) {
  const connections = new Set<{ end(): void }>(),
    commands: string[] = [];
  let ptys = 0,
    shells = 0;
  const server = new Server({ hostKeys: [key] }, (conn) => {
    connections.add(conn);
    conn.on("error", () => {});
    conn.once("close", () => connections.delete(conn));
    conn.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.password === "fixture-only")
        ctx.accept();
      else ctx.reject();
    });
    conn.on("session", (accept) => {
      const session = accept();
      session.on("pty", (accept) => {
        ptys++;
        accept?.();
      });
      session.on("shell", (accept) => {
        shells++;
        const stream = accept();
        stream.on("error", () => {});
        stream.on("data", (bytes) => stream.write(bytes));
      });
      session.on("exec", (accept, _reject, info) => {
        commands.push(info.command);
        const stream = accept();
        stream.on("error", () => {});
        stream.resume();
        exec(info.command, stream);
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const client = new Client();
  client.on("error", () => {});
  cleanup.push(async () => {
    client.destroy();
    for (const c of connections) c.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    client.once("ready", resolve);
    client.once("error", reject);
    client.connect({
      host: "127.0.0.1",
      port: (server.address() as { port: number }).port,
      username: "fixture",
      password: "fixture-only",
      hostVerifier: (actual) => actual.equals(expectedKey.getPublicSSH()),
      readyTimeout: 5000,
    });
  });
  return { client, commands, ptys: () => ptys, shells: () => shells };
}
const settings = {
  metricsEnabled: true,
  metricsInterval: 30,
  enabledWidgets: ["cpu", "memory", "system", "disk"],
};
function runtime(
  overrides: Partial<
    ConstructorParameters<typeof MonitoringCollectionRuntime>[0]
  > = {},
) {
  const audit = vi.fn(async () => {}),
    authorize = vi.fn(async () => {});
  const runtime = new MonitoringCollectionRuntime({
    audit,
    authorize,
    ...overrides,
  });
  return { runtime, audit, authorize };
}

it("collects real SSH metrics with fixed commands and records results without output", async () => {
  const f = await fixture((_cmd, stream) => {
    stream.exit(0);
    stream.end("MemTotal: 1048576 kB\nMemAvailable: 524288 kB\n");
  });
  const r = runtime();
  const result = await r.runtime.run(7, "reader", settings, () =>
    collectMemoryMetrics(f.client),
  );
  expect(result.totalGiB).toBe(1);
  expect(result.percent).toBe(50);
  expect(f.commands).toEqual(["cat /proc/meminfo"]);
  expect(f.ptys()).toBe(0);
  const snapshot = r.runtime.snapshot(7, "reader", settings);
  expect(snapshot.recent[0].status).toBe("completed");
  expect(snapshot.recent[0].actions[0]).toMatchObject({
    command: "cat /proc/meminfo",
    exitCode: 0,
    status: "completed",
  });
  expect(JSON.stringify(r.audit.mock.calls)).not.toContain("MemTotal");
  expect(r.audit).toHaveBeenCalledTimes(2);
  expect(r.authorize).toHaveBeenCalledTimes(2);
  expect(r.runtime.snapshot(7, "someone-else", settings).recent).toEqual([]);
}, 10000);

it("cancels a running sample, keeps the interactive shell alive, and requires explicit resume", async () => {
  let channel!: ServerChannel;
  const f = await fixture((_cmd, stream) => {
    channel = stream;
  });
  const interactive = await new Promise<import("ssh2").ClientChannel>(
    (resolve, reject) => f.client.shell((e, s) => (e ? reject(e) : resolve(s))),
  );
  const r = runtime();
  const work = r.runtime.run(7, "reader", settings, () =>
    execMetricCommand(f.client, "memory.1"),
  );
  const rejected = expect(work).rejects.toThrow("MONITORING_CANCELLED");
  await vi.waitFor(() => expect(channel).toBeDefined());
  let closed = false;
  channel.once("close", () => {
    closed = true;
  });
  r.runtime.pause(7, "reader");
  await rejected;
  await vi.waitFor(() => expect(closed).toBe(true));
  const echoed = new Promise<Buffer>((resolve) =>
    interactive.once("data", resolve),
  );
  interactive.write("人工终端仍可输入");
  expect((await echoed).toString()).toBe("人工终端仍可输入");
  expect(f.ptys()).toBe(1);
  expect(f.shells()).toBe(1);
  await expect(
    r.runtime.run(7, "reader", settings, async () => {}),
  ).rejects.toThrow("MONITORING_PAUSED");
  expect(
    r.runtime.snapshot(7, "reader", settings).recent[0].actions[0].status,
  ).toBe("cancelled");
  r.runtime.resume(7, "reader");
  await r.runtime.run(7, "reader", settings, async () => {});
  interactive.destroy();
}, 10000);

it("bounds output on real exec channels", async () => {
  const f = await fixture((_cmd, stream) =>
      stream.write(Buffer.alloc(16384, 65)),
    ),
    r = runtime({ commandOutputLimit: 1024 });
  await expect(
    r.runtime.run(7, "reader", settings, () =>
      execMetricCommand(f.client, "memory.1"),
    ),
  ).rejects.toThrow("MONITORING_OUTPUT_LIMIT");
  const action = r.runtime.snapshot(7, "reader", settings).recent[0].actions[0];
  expect(action.status).toBe("output-limit");
  expect(JSON.stringify(action)).not.toContain("AAAA");
}, 10000);

it("ends the batch deadline and destroys its late channel", async () => {
  const client = new Client();
  let respond!: (error: undefined, channel: unknown) => void;
  vi.spyOn(client, "exec").mockImplementation((...args) => {
    respond = args[2] as typeof respond;
    return client;
  });
  const r = runtime({ batchTimeoutMs: 30 });
  await expect(
    r.runtime.run(7, "reader", settings, () =>
      execMetricCommand(client, "memory.1"),
    ),
  ).rejects.toThrow("MONITORING_TIMEOUT");
  const destroy = vi.fn();
  respond(undefined, { destroy });
  expect(destroy).toHaveBeenCalledOnce();
  expect(
    r.runtime.snapshot(7, "reader", settings).recent[0].actions[0].status,
  ).toBe("timeout");
});

it("checks permission again before sending a command and sends nothing after a denied audit", async () => {
  const f = await fixture((_cmd, stream) => {
    stream.exit(0);
    stream.end();
  });
  const authorize = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(Error("MONITORING_DENIED"));
  const r = runtime({ authorize });
  await expect(
    r.runtime.run(7, "reader", settings, () =>
      execMetricCommand(f.client, "memory.1"),
    ),
  ).rejects.toThrow("MONITORING_DENIED");
  expect(f.commands).toEqual([]);
  const unavailable = runtime({
    audit: async () => {
      throw Error("storage unavailable");
    },
  });
  await expect(
    unavailable.runtime.run(7, "reader", settings, () =>
      execMetricCommand(f.client, "memory.1"),
    ),
  ).rejects.toThrow("storage unavailable");
  expect(f.commands).toEqual([]);
}, 10000);

it("does not run disabled widgets or free-form commands and safely quotes disk paths", async () => {
  const f = await fixture((_cmd, stream) => {
      stream.exit(0);
      stream.end();
    }),
    r = runtime();
  await r.runtime.run(
    7,
    "reader",
    { ...settings, enabledWidgets: ["cpu"] },
    () => collectMemoryMetrics(f.client),
  );
  const disabledUptime = await r.runtime.run(
    7,
    "reader",
    { ...settings, enabledWidgets: ["cpu"] },
    () => collectUptimeMetrics(f.client),
  );
  expect(disabledUptime.seconds).toBeNull();
  expect(f.commands).toEqual([]);
  await expect(execMetricCommand(f.client, "memory.1")).rejects.toThrow(
    "MONITORING_CONTEXT_REQUIRED",
  );
  expect(() => monitoringCommand("rm -rf /" as never)).toThrow(
    "MONITORING_COMMAND_UNKNOWN",
  );
  const value = monitoringCommand("disk.3", {
    path: "/srv/a' ; touch /tmp/unwanted #",
  });
  expect(value.command).toBe(
    "df -hT -P -- '/srv/a'\"'\"' ; touch /tmp/unwanted #' | tail -n +2",
  );
  expect(() => monitoringCommand("disk.3", { path: "/srv/a\nnext" })).toThrow(
    "MONITORING_PATH_INVALID",
  );
}, 10000);

it("limits concurrent channels even while queued work is being released", async () => {
  let active = 0,
    maximum = 0;
  const f = await fixture((_cmd, stream) => {
    active++;
    maximum = Math.max(maximum, active);
    setTimeout(() => {
      active--;
      stream.exit(0);
      stream.end("ok");
    }, 10);
  });
  const r = runtime();
  await r.runtime.run(7, "reader", settings, () =>
    Promise.all(
      Array.from({ length: 12 }, () => execMetricCommand(f.client, "memory.1")),
    ),
  );
  expect(maximum).toBeLessThanOrEqual(4);
  expect(f.commands).toHaveLength(12);
}, 10000);
