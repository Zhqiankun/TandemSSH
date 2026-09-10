import { afterEach, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
const require = createRequire(import.meta.url);
const {
  createWindowsAttributesReader,
  readWindowsAttributes,
} = require("../electron/windows-file-attributes.cjs");
const { LocalFileBrowser } = require("../electron/local-file-browser.cjs");
const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
function childFixture() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", 1));
      return true;
    }),
  });
  const spawnProcess = vi.fn(() => child);
  let input = "";
  child.stdin.on("data", (bytes) => {
    input += bytes.toString("utf8");
  });
  return { child, spawnProcess, input: () => JSON.parse(input) };
}
it("passes special names as stdin JSON and accepts only a complete numeric attribute array", async () => {
  const f = childFixture(),
    reader = createWindowsAttributesReader({
      platform: "win32",
      spawnProcess: f.spawnProcess,
    });
  const root = path.resolve("../.cache"),
    names = ["中文 ' $().txt", "[literal].txt"];
  const result = reader(root, names);
  expect(f.input()).toEqual({ root, names });
  const args = f.spawnProcess.mock.calls[0][1];
  expect(args).toContain("-EncodedCommand");
  expect(args.join(" ")).not.toContain(names[0]);
  expect(f.spawnProcess.mock.calls[0][2]).toMatchObject({
    windowsHide: true,
    shell: false,
  });
  f.child.stdout.write("[6,null]");
  f.child.emit("close", 0);
  await expect(result).resolves.toEqual([6, null]);
  expect(f.child.kill).not.toHaveBeenCalled();
});
it.each(["[]", "[true]", "[-1]", "[2,4]", "not json"])(
  "rejects incomplete or invalid helper output %s",
  async (output) => {
    const f = childFixture(),
      reader = createWindowsAttributesReader({
        platform: "win32",
        spawnProcess: f.spawnProcess,
      });
    const result = reader(path.resolve("../.cache"), ["one"]);
    f.child.stdout.write(output);
    f.child.emit("close", 0);
    await expect(result).rejects.toThrow("LOCAL_ATTRIBUTES_UNAVAILABLE");
  },
);
it("kills its own helper on timeout, cancellation and oversized output", async () => {
  for (const mode of ["timeout", "cancel", "output"] as const) {
    const f = childFixture(),
      abort = new AbortController();
    const reader = createWindowsAttributesReader({
      platform: "win32",
      spawnProcess: f.spawnProcess,
      timeoutMs: mode === "timeout" ? 10 : 15000,
    });
    const result = reader(path.resolve("../.cache"), ["one"], abort.signal);
    if (mode === "cancel") abort.abort();
    if (mode === "output") f.child.stdout.write(Buffer.alloc(256 * 1024 + 1));
    await expect(result).rejects.toThrow(
      mode === "cancel" ? "LOCAL_CANCELLED" : "LOCAL_ATTRIBUTES_UNAVAILABLE",
    );
    expect(f.child.kill).toHaveBeenCalledOnce();
  }
});
it("does not start a helper for unsupported platforms, cancelled requests or path traversal", async () => {
  const f = childFixture(),
    abort = new AbortController();
  abort.abort();
  await expect(
    createWindowsAttributesReader({
      platform: "linux",
      spawnProcess: f.spawnProcess,
    })("/tmp", ["one"]),
  ).resolves.toBeNull();
  const reader = createWindowsAttributesReader({
    platform: "win32",
    spawnProcess: f.spawnProcess,
  });
  await expect(
    reader(path.resolve("../.cache"), ["one"], abort.signal),
  ).rejects.toThrow("LOCAL_CANCELLED");
  await expect(
    reader(path.resolve("../.cache"), ["../outside"]),
  ).rejects.toThrow("LOCAL_REQUEST_INVALID");
  expect(f.spawnProcess).not.toHaveBeenCalled();
});
async function fixture() {
  const cache = await fs.realpath(path.resolve("../.cache"));
  const root = await fs.mkdtemp(path.join(cache, "windows-attributes-test-"));
  const changed: string[] = [];
  const attrib = path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "attrib.exe",
  );
  const set = (name: string, flags: string[]) => {
    const file = path.resolve(root, name);
    if (!file.startsWith(root + path.sep))
      throw Error("Attribute fixture scope");
    const result = spawnSync(attrib, [...flags, file], {
      windowsHide: true,
      shell: false,
      encoding: "utf8",
      timeout: 15000,
    });
    if (result.status !== 0) throw Error("Attribute fixture change failed");
    if (!changed.includes(file)) changed.push(file);
  };
  cleanup.push(async () => {
    const actual = await fs.realpath(root);
    if (
      !actual.startsWith(cache + path.sep) ||
      !path.basename(actual).startsWith("windows-attributes-test-")
    )
      throw Error("Cleanup scope");
    for (const file of changed) {
      const result = spawnSync(attrib, ["-H", "-S", "-R", file], {
        windowsHide: true,
        shell: false,
        encoding: "utf8",
        timeout: 15000,
      });
      if (result.status !== 0) throw Error("Attribute fixture cleanup failed");
    }
    await fs.rm(actual, { recursive: true, force: true });
  });
  return { root, set };
}
it.runIf(process.platform === "win32")(
  "reads actual Hidden/System/ReadOnly flags and refreshes Windows visibility without changing bytes",
  async () => {
    const f = await fixture();
    const names = [
      "普通.txt",
      "隐藏.txt",
      "系统.txt",
      "只读 ' $().txt",
      ".dot",
      "隐藏目录",
    ];
    for (const name of names.slice(0, -1))
      await fs.writeFile(path.join(f.root, name), "unchanged");
    await fs.mkdir(path.join(f.root, names.at(-1)!));
    f.set("隐藏.txt", ["+H"]);
    f.set("系统.txt", ["+S"]);
    f.set("只读 ' $().txt", ["+R"]);
    f.set("隐藏目录", ["+H"]);
    const flags = await readWindowsAttributes(f.root, names);
    expect(await readWindowsAttributes(f.root, [names[1]])).toEqual([flags[1]]);
    expect(flags[1] & 2).toBe(2);
    expect(flags[2] & 4).toBe(4);
    expect(flags[3] & 1).toBe(1);
    expect(flags[5] & 2).toBe(2);
    const browser = new LocalFileBrowser(),
      root = await browser.select(1, f.root);
    cleanup.push(() => browser.reset(1));
    const visible = await browser.list(1, root.id, "", {});
    expect(visible.entries.map((e) => e.name).sort()).toEqual(
      [names[0], names[3]].sort(),
    );
    expect(visible.attributeWarning).toBeUndefined();
    const all = await browser.list(1, root.id, "", { showHidden: true });
    expect(all.total).toBe(6);
    expect(all.entries.find((e) => e.name === names[2])).toMatchObject({
      system: true,
      attributesKnown: true,
    });
    expect(all.entries.find((e) => e.name === names[3])).toMatchObject({
      readOnly: true,
      attributesKnown: true,
    });
    f.set("隐藏.txt", ["-H"]);
    expect(
      (await browser.list(1, root.id, "", {})).entries.some(
        (e) => e.name === "隐藏.txt",
      ),
    ).toBe(true);
    for (const name of names.slice(0, -1))
      expect(await fs.readFile(path.join(f.root, name), "utf8")).toBe(
        "unchanged",
      );
  },
  20000,
);
it("keeps entries visible and marks unknown attributes when the Windows adapter fails", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, "ordinary.txt"), "data");
  const browser = new LocalFileBrowser({
    readAttributes: async () => {
      throw Error("LOCAL_ATTRIBUTES_UNAVAILABLE");
    },
  });
  const root = await browser.select(1, f.root);
  cleanup.push(() => browser.reset(1));
  const page = await browser.list(1, root.id, "", {});
  expect(page).toMatchObject({ attributeWarning: true, total: 1 });
  expect(page.entries[0]).toMatchObject({
    name: "ordinary.txt",
    attributesKnown: false,
  });
});
it("aborts an in-flight attribute query when the local folder capability is released", async () => {
  const f = await fixture();
  await fs.writeFile(path.join(f.root, "ordinary.txt"), "data");
  let signal: AbortSignal | undefined;
  const reader = vi.fn(
    (_root, _names, current: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal = current;
        current.addEventListener("abort", () =>
          reject(Error("LOCAL_CANCELLED")),
        );
      }),
  );
  const browser = new LocalFileBrowser({ readAttributes: reader }),
    root = await browser.select(1, f.root);
  cleanup.push(() => browser.reset(1));
  const result = browser.list(1, root.id, "", {});
  const rejected = expect(result).rejects.toThrow("LOCAL_CANCELLED");
  await vi.waitFor(() => expect(reader).toHaveBeenCalledOnce());
  browser.release(1, root.id);
  expect(signal?.aborted).toBe(true);
  await rejected;
});

it.runIf(process.platform === "win32")(
  "waits for the actual Windows helper to close after cancellation",
  async () => {
    const f = await fixture();
    await fs.writeFile(path.join(f.root, "one.txt"), "data");
    let child: ReturnType<typeof spawn> | undefined,
      closed = false;
    const reader = createWindowsAttributesReader({
      spawnProcess: (...args: Parameters<typeof spawn>) => {
        child = spawn(...args);
        child.once("close", () => {
          closed = true;
        });
        return child;
      },
    });
    const abort = new AbortController();
    const result = reader(f.root, ["one.txt"], abort.signal);
    expect(child?.pid).toBeGreaterThan(0);
    abort.abort();
    await expect(result).rejects.toThrow("LOCAL_CANCELLED");
    expect(closed).toBe(true);
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
  },
  10000,
);
