import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AuditJournal } from "../../collaboration/audit/journal.js";
const workspace = path.resolve(
  import.meta.dirname,
  "../../../../../.cache/audit-tests",
);
const owned: string[] = [];
async function fixture(
  max = 100 * 1024 * 1024,
  retention = 7 * 24 * 60 * 60_000,
) {
  await fs.mkdir(workspace, { recursive: true });
  const root = await fs.mkdtemp(path.join(workspace, "journal-"));
  owned.push(root);
  const directory = path.join(
    root,
    "tandem-audit",
    createHash("sha256").update("user").digest("hex").slice(0, 24),
  );
  return {
    root,
    directory,
    journal: new AuditJournal(root, "user", max, retention),
  };
}
afterEach(async () => {
  for (const root of owned.splice(0)) {
    if (path.dirname(path.resolve(root)) !== workspace)
      throw Error("INVALID_TEST_CLEANUP");
    await fs.rm(root, { recursive: true, force: true });
  }
});
describe("persistent redacted audit journal", () => {
  it("writes ordered valid JSON events and masks keys and assignment values", async () => {
    const f = await fixture();
    await Promise.all([
      f.journal.record("one", {
        password: "never-save-this",
        output: "API_KEY=secret123\nnormal=yes",
      }),
      f.journal.record("two", {
        output: "--password secret456",
        args: ["--api-key", "argument-secret789"],
      }),
    ]);
    const files = await fs.readdir(f.directory);
    const text = await fs.readFile(path.join(f.directory, files[0]), "utf8");
    expect(text).not.toContain("never-save-this");
    expect(text).not.toContain("secret123");
    expect(text).not.toContain("secret456");
    expect(text).not.toContain("argument-secret789");
    expect(text).toContain("normal=yes");
    expect(
      text
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).type),
    ).toEqual(["one", "two"]);
  });
  it("prunes only owned expired shards and preserves unrelated files", async () => {
    const f = await fixture();
    await fs.mkdir(f.directory, { recursive: true });
    const old = path.join(
      f.directory,
      "record-1000000000000-" + randomUUID() + ".jsonl",
    );
    await fs.writeFile(old, "old");
    await fs.utimes(old, 0, 0);
    await fs.writeFile(path.join(f.directory, "user-notes.txt"), "keep");
    await f.journal.record("new", {});
    expect(await fs.readdir(f.directory)).not.toContain(path.basename(old));
    expect(
      await fs.readFile(path.join(f.directory, "user-notes.txt"), "utf8"),
    ).toBe("keep");
  });
  it("honors the total size cap and refuses a single oversized event", async () => {
    const f = await fixture(600);
    for (let i = 0; i < 6; i++)
      await f.journal.record("step", { text: "x".repeat(100) });
    const sizes = await Promise.all(
      (await fs.readdir(f.directory)).map(
        async (file) => (await fs.stat(path.join(f.directory, file))).size,
      ),
    );
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(600);
    await expect(
      f.journal.record("large", { text: "x".repeat(1000) }),
    ).rejects.toThrow("AUDIT_EVENT_TOO_LARGE");
  });
  it("recovers the write queue after an IO failure without hiding that failure", async () => {
    const f = await fixture();
    await fs.mkdir(path.dirname(f.directory), { recursive: true });
    await fs.writeFile(f.directory, "blocked");
    await expect(f.journal.record("failed", {})).rejects.toThrow();
    await fs.unlink(f.directory);
    await f.journal.record("next", {});
    expect((await fs.readdir(f.directory)).length).toBe(1);
  });
});

it("reads redacted history after restart and pages without duplicating events", async () => {
  const f = await fixture();
  for (let i = 0; i < 4; i++)
    await f.journal.record("operation.result", {
      context: { taskId: i === 1 ? "other" : "task" },
      id: randomUUID(),
      status: "succeeded",
      action: { type: "terminal.command", program: "echo", args: [] },
      output: "API_KEY=must-not-leak " + i,
    });
  const restarted = new AuditJournal(f.root, "user"),
    first = await restarted.queryHistory({ taskId: "task", limit: 2 }),
    second = await restarted.queryHistory({
      taskId: "task",
      limit: 2,
      cursor: first.nextCursor!,
    });
  expect(first.items).toHaveLength(2);
  expect(second.items).toHaveLength(1);
  expect(new Set([...first.items, ...second.items].map((e) => e.id)).size).toBe(
    3,
  );
  const detail = await restarted.historyDetail(first.items[0].detail);
  expect(detail.text).not.toContain("must-not-leak");
  expect(detail.text).toContain("[redacted]");
  await expect(
    new AuditJournal(f.root, "another-user").historyDetail(
      first.items[0].detail,
    ),
  ).rejects.toThrow("HISTORY_CURSOR_INVALID");
  await expect(
    restarted.queryHistory({ taskId: "other", cursor: first.nextCursor! }),
  ).rejects.toThrow("HISTORY_CURSOR_INVALID");
});
it("reports blank, corrupt and partial records without hanging or losing valid lines", async () => {
  const f = await fixture();
  await f.journal.record("task.created", { taskId: "task", title: "目录任务" });
  const name = (await fs.readdir(f.directory))[0],
    file = path.join(f.directory, name),
    valid = await fs.readFile(file, "utf8");
  await fs.writeFile(file, "\n{broken}\n" + valid + '{"unfinished":');
  const history = await f.journal.queryHistory({});
  expect(history.items).toHaveLength(1);
  expect(history.items[0].title).toBe("目录任务");
  expect(history.skipped).toBe(3);
});
it("bounds detail pages and tolerates a shard removed by retention", async () => {
  const f = await fixture();
  await f.journal.record("one", { text: "一".repeat(230000) });
  await f.journal.record("two", { text: "二".repeat(230000) });
  const first = await f.journal.queryHistory({ limit: 1 });
  const detail = await f.journal.historyDetail(first.items[0].detail);
  expect(detail.text.length).toBeLessThanOrEqual(16000);
  expect(detail.nextOffset).not.toBeNull();
  const token = JSON.parse(
    Buffer.from(first.items[0].detail, "base64url").toString(),
  );
  await fs.unlink(path.join(f.directory, token.file));
  const next = await f.journal.queryHistory({
    cursor: first.nextCursor!,
    limit: 1,
  });
  expect(next.items[0].type).toBe("one");
  expect(next.skipped).toBeGreaterThan(0);
});
it("rejects arbitrary file cursors and a redirected journal directory", async () => {
  const f = await fixture();
  await f.journal.record("task.created", { taskId: "task" });
  const page = await f.journal.queryHistory({});
  const token = JSON.parse(
    Buffer.from(page.items[0].detail, "base64url").toString(),
  );
  token.file = "../../user-notes.txt";
  await expect(
    f.journal.historyDetail(
      Buffer.from(JSON.stringify(token)).toString("base64url"),
    ),
  ).rejects.toThrow();
  const relocated = path.join(f.root, "relocated");
  if (
    !path.resolve(f.directory).startsWith(path.resolve(f.root) + path.sep) ||
    path.dirname(relocated) !== f.root
  )
    throw Error("Move scope");
  await fs.rename(f.directory, relocated);
  await fs.symlink(
    relocated,
    f.directory,
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(f.journal.queryHistory({})).rejects.toThrow(
    "AUDIT_PATH_INVALID",
  );
});

it("does not expose expired records even before the next writer retention pass", async () => {
  const f = await fixture();
  await f.journal.record("task.created", { taskId: "task", title: "expired" });
  const page = await f.journal.queryHistory({}),
    files = await fs.readdir(f.directory),
    file = path.join(f.directory, files[0]),
    record = JSON.parse((await fs.readFile(file, "utf8")).trim());
  record.at = Date.now() - 8 * 86400000;
  await fs.writeFile(file, JSON.stringify(record) + "\n");
  expect((await f.journal.queryHistory({})).items).toEqual([]);
  await expect(f.journal.historyDetail(page.items[0].detail)).rejects.toThrow(
    "HISTORY_RECORD_NOT_FOUND",
  );
});

async function exportFrames(journal: AuditJournal, taskId?: string) {
  const frames = [];
  for await (const frame of journal.exportHistory(
    { taskId },
    new AbortController().signal,
  ))
    frames.push(frame);
  return frames;
}
it("exports every retained event beyond a history page and filters within the current user", async () => {
  const f = await fixture();
  for (let i = 0; i < 61; i++)
    await f.journal.record("operation.result", {
      context: { taskId: i % 2 ? "other" : "selected" },
      id: randomUUID(),
      output: "API_KEY=export-secret-" + i,
    });
  const all = await exportFrames(f.journal),
    selected = await exportFrames(f.journal, "selected"),
    foreign = await exportFrames(new AuditJournal(f.root, "different-user"));
  expect(all.filter((f) => f.kind === "record")).toHaveLength(61);
  expect(selected.filter((f) => f.kind === "record")).toHaveLength(31);
  expect(all.at(-1)).toMatchObject({
    kind: "summary",
    completed: true,
    records: 61,
    skipped: 0,
  });
  expect(foreign.at(-1)).toMatchObject({ records: 0 });
  expect(JSON.stringify(all)).not.toContain("export-secret-");
});
it("redacts legacy plaintext again and counts damaged and incomplete records", async () => {
  const f = await fixture();
  await f.journal.record("task.created", { id: "selected" });
  const name = (await fs.readdir(f.directory))[0],
    file = path.join(f.directory, name);
  await fs.appendFile(
    file,
    JSON.stringify({
      schemaVersion: 1,
      id: randomUUID(),
      at: Date.now(),
      type: "operation.result",
      data: {
        context: { taskId: "selected" },
        password: "legacy-password",
        args: ["--token", "legacy-argument"],
        output: "API_KEY=legacy-assignment",
      },
    }) + '\n{broken}\n{"incomplete":',
  );
  const frames = await exportFrames(f.journal, "selected");
  expect(frames.at(-1)).toMatchObject({ records: 2, skipped: 2 });
  const output = JSON.stringify(frames);
  for (const secret of [
    "legacy-password",
    "legacy-argument",
    "legacy-assignment",
  ])
    expect(output).not.toContain(secret);
  expect(output).toContain("[redacted]");
});
it("releases the export slot after cancellation and rejects overlapping scans", async () => {
  const f = await fixture();
  await f.journal.record("event", {});
  const stop = new AbortController(),
    first = f.journal.exportHistory({}, stop.signal);
  expect((await first.next()).value).toMatchObject({ kind: "header" });
  await expect(
    f.journal.exportHistory({}, new AbortController().signal).next(),
  ).rejects.toThrow("HISTORY_EXPORT_BUSY");
  stop.abort(Error("cancelled"));
  await expect(first.next()).rejects.toThrow("cancelled");
  expect((await exportFrames(f.journal)).at(-1)).toMatchObject({ records: 1 });
});
it("fails an oversized retained scan without producing a success summary", async () => {
  const f = await fixture(600);
  await f.journal.record("event", {});
  const name = (await fs.readdir(f.directory))[0];
  await fs.appendFile(
    path.join(f.directory, name),
    JSON.stringify({
      schemaVersion: 1,
      id: randomUUID(),
      at: Date.now(),
      type: "event",
      data: { text: "x".repeat(700) },
    }) + "\n",
  );
  await expect(exportFrames(f.journal)).rejects.toThrow("HISTORY_EXPORT_LIMIT");
});

it("counts invalid UTF-8 as damaged data instead of silently replacing characters", async () => {
  const f = await fixture();
  await f.journal.record("event", {});
  const name = (await fs.readdir(f.directory))[0];
  const broken = Buffer.from(
    JSON.stringify({
      schemaVersion: 1,
      id: randomUUID(),
      at: Date.now(),
      type: "event",
      data: { text: "bad-value" },
    }) + "\n",
  );
  broken[broken.indexOf("bad-value")] = 255;
  await fs.appendFile(path.join(f.directory, name), broken);
  expect((await exportFrames(f.journal)).at(-1)).toMatchObject({
    records: 1,
    skipped: 1,
  });
});
