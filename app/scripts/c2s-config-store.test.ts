import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
const { C2sConfigStore } = createRequire(import.meta.url)(
  "../electron/c2s-config-store.cjs",
);
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tandem-c2s-store-"));
  roots.push(root);
  const file = path.join(root, "c2s-tunnels.json"),
    store = new C2sConfigStore(file);
  return {
    file,
    store,
    request: {
      id: randomUUID(),
      revision: store.snapshot().revision,
      config: [
        {
          scope: "c2s",
          mode: "local",
          sourceHostId: 7,
          sourcePort: 8080,
          endpointPort: 80,
          maxRetries: 3,
          retryInterval: 5000,
          autoStart: true,
          relayOrigin: "local",
          sourceIdentity: { ip: "localhost", port: 22, username: "fixture" },
          password: "fixture-secret",
          c2sSessionEpoch: 19,
        },
      ],
    },
  };
}
it("reads old array files and preserves their format on ordinary saves", () => {
  const f = fixture();
  fs.writeFileSync(f.file, JSON.stringify([{ autoStart: true }]));
  const snap = f.store.snapshot();
  f.store.save([...snap.config, { autoStart: false }], snap.revision);
  expect(JSON.parse(fs.readFileSync(f.file, "utf8"))).toEqual([
    { autoStart: true },
    { autoStart: false },
  ]);
});
it("appends inactive imports, strips session review and secrets, and persists receipt across restart", () => {
  const f = fixture();
  expect(f.store.import(f.request)).toEqual({ imported: 1, replayed: false });
  const reopened = new C2sConfigStore(f.file);
  expect(reopened.import(f.request)).toEqual({ imported: 1, replayed: true });
  expect(reopened.snapshot().config).toHaveLength(1);
  expect(reopened.snapshot().config[0]).toMatchObject({
    autoStart: false,
    sourceHostId: 7,
  });
  expect(JSON.stringify(reopened.snapshot())).not.toMatch(
    /fixture-secret|sourceIdentity|relayOrigin|c2sSessionEpoch/,
  );
});
it("preserves subsequent manual deletion when the same import is retried", () => {
  const f = fixture();
  f.store.import(f.request);
  f.store.save([], f.store.snapshot().revision);
  expect(new C2sConfigStore(f.file).import(f.request).replayed).toBe(true);
  expect(f.store.snapshot().config).toEqual([]);
});
it("rejects modified import content for an existing receipt", () => {
  const f = fixture();
  f.store.import(f.request);
  f.request.config[0].sourcePort = 9090;
  expect(() => f.store.import(f.request)).toThrow(
    "C2S_IMPORT_CONFIRMATION_CHANGED",
  );
});
it("rejects stale snapshot imports and saves without changing the file", () => {
  const f = fixture();
  f.store.save([{ autoStart: true }], f.request.revision);
  const before = fs.readFileSync(f.file, "utf8");
  expect(() => f.store.import(f.request)).toThrow("C2S_CONFIG_CHANGED");
  expect(() => f.store.save([], f.request.revision)).toThrow(
    "C2S_CONFIG_CHANGED",
  );
  expect(fs.readFileSync(f.file, "utf8")).toBe(before);
});
it("leaves original data intact if replacement fails and permits retry", () => {
  const f = fixture();
  f.store.save([], f.request.revision);
  f.request.revision = f.store.snapshot().revision;
  const old = fs.readFileSync(f.file, "utf8");
  vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
    throw Error("fixture rename failure");
  });
  expect(() => f.store.import(f.request)).toThrow("fixture rename failure");
  expect(fs.readFileSync(f.file, "utf8")).toBe(old);
  expect(fs.readdirSync(path.dirname(f.file))).toEqual(["c2s-tunnels.json"]);
  expect(f.store.import(f.request)).toEqual({ imported: 1, replayed: false });
});
it("refuses to overwrite corrupt configuration", () => {
  const f = fixture();
  fs.writeFileSync(f.file, "broken");
  expect(() => f.store.import(f.request)).toThrow("C2S_CONFIG_INVALID");
  expect(() => f.store.save([], f.request.revision)).toThrow(
    "C2S_CONFIG_INVALID",
  );
  expect(fs.readFileSync(f.file, "utf8")).toBe("broken");
});
it.each([0, 65536, -1, 1.5])(
  "rejects invalid imported listener port %s before writing",
  (sourcePort) => {
    const f = fixture();
    f.request.config[0].sourcePort = sourcePort;
    expect(() => f.store.import(f.request)).toThrow("C2S_IMPORT_INVALID");
    expect(fs.existsSync(f.file)).toBe(false);
  },
);
