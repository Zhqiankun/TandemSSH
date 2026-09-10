import { randomUUID } from "node:crypto";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  connectLinux,
  linuxExec,
  linuxFixture,
} from "../../test-helpers/linux-ssh-fixture.js";
import { TaskRuntime } from "../../collaboration/tasks/runtime.js";
import { quoteShellWord } from "../../collaboration/adapters/pty-command.js";
import { DocumentService } from "../../files/document-service.js";
import { HostFileFence } from "../../collaboration/sessions/host-file-fence.js";
const enabled = !!process.env.TANDEM_LINUX_MANIFEST,
  closers: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close();
});
async function fixture() {
  const f = await linuxFixture();
  closers.push(() => f.close());
  return f;
}
function documents(f: Awaited<ReturnType<typeof linuxFixture>>) {
  const fence = new HostFileFence();
  const service = new DocumentService({
    target: async () => ({
      key: "linux",
      connection: "linux-session",
      io: f.io,
      acceptedHostKey: f.manifest.hostFingerprint,
      hostScope: { userId: "owner", hostId: 1, identity: f.manifest.id },
      check: () => {},
    }),
    audit: async () => {},
    beginWrite: (_actor, target) => fence.acquire(target.hostScope!),
  });
  closers.push(() => service.dispose());
  return service;
}
const actor = { userId: "owner", source: "human" as const };
describe.runIf(enabled)("actual Linux OpenSSH acceptance", () => {
  it("authenticates by key and password as a non-root Linux user and rejects a wrong password", async () => {
    for (const method of ["key", "encrypted-key", "password"] as const) {
      const client = await connectLinux(method);
      try {
        const r = await linuxExec(
          client,
          "uname -s; id -u; cat /etc/alpine-release",
        );
        expect(r.code).toBe(0);
        expect(r.output.split("\n")).toEqual(["Linux", "1000", "3.24.1", ""]);
      } finally {
        client.end();
      }
    }
    await expect(
      connectLinux("password", "definitely-not-the-fixture-password"),
    ).rejects.toThrow();
    await expect(
      connectLinux("encrypted-key", "wrong-key-passphrase"),
    ).rejects.toThrow(/privateKey|decrypt/i);
  }, 45000);
  it.each(["automatic", "collaborative"] as const)(
    "executes %s tasks in one real Linux shell with visible results and literal parameters",
    async (mode) => {
      const f = await fixture(),
        t = await f.terminal(),
        human = { kind: "human" as const, userId: "owner" },
        runtime = new TaskRuntime({
          getSession: () => ({
            id: t.id,
            userId: "owner",
            hostId: 1,
            hostName: "linux-fixture",
            groups: () => [],
            control: t.control,
            executor: t.executor,
          }),
          policy: async () => ({ revision: 1, sets: [] }),
          audit: () => ({ append: async () => {}, record: async () => {} }),
        });
      closers.push(() => {
        t.control.close();
      });
      const literal = "中文\n$(touch SHOULD_NOT_EXIST); 'quoted'\tend\n";
      const task = await runtime.create(human, {
        sessionId: t.id,
        requestId: "linux-" + mode,
        title: "Linux 双模式验收",
        mode,
        commands: [
          { program: "export", args: ["TANDEM_LINUX_VALUE=同舟"] },
          { program: "cd", args: [f.child] },
          { program: "printenv", args: ["TANDEM_LINUX_VALUE"] },
          { program: "printf", args: ["%s", literal] },
          { program: "pwd", args: [] },
        ],
      });
      await runtime.authorize(human, task.id, {
        ...t.control.snapshot(),
        policyRevision: 1,
        shellReady: true,
        directory: f.root,
        maxOperations: 5,
        durationMinutes: 2,
        allowReviewedPlan: false,
      });
      if (mode === "collaborative")
        for (let i = 0; i < 5; i++) {
          await vi.waitFor(
            () =>
              expect(runtime.get(human, task.id).state).toBe(
                "awaiting-approval",
              ),
            { timeout: 15000 },
          );
          const v = runtime.get(human, task.id);
          expect(
            v.operations.filter((o) => o.status === "succeeded"),
          ).toHaveLength(i);
          const op = v.operations[i];
          await runtime.approve(
            human,
            task.id,
            op.id,
            op.digest,
            v.policyRevision,
          );
        }
      await vi.waitFor(
        () => expect(runtime.get(human, task.id).state).toBe("completed"),
        { timeout: 15000 },
      );
      const v = runtime.get(human, task.id);
      expect(v.operations.map((o) => o.exitCode)).toEqual([0, 0, 0, 0, 0]);
      expect(v.operations[2].output?.trim()).toBe("同舟");
      expect(v.operations[3].output?.replace(/\r\n/g, "\n")).toBe(literal);
      expect(v.operations[4].output?.trim()).toBe(f.child);
      expect(await f.exists(f.child + "/SHOULD_NOT_EXIST")).toBe(false);
      expect(t.control.snapshot().controller.kind).toBe("human");
    },
    90000,
  );
  it("takes over the same PTY, refuses an old lease, and observes manual state on hand-back", async () => {
    const f = await fixture(),
      t = await f.terminal(),
      owner = {
        kind: "automation" as const,
        ownerType: "agent-task" as const,
        ownerId: "linux-task",
      },
      old = t.control.grant(owner, t.control.snapshot());
    t.control.takeover();
    expect(() =>
      t.control.commitWrite(old, Buffer.from("touch SHOULD_NOT_EXIST\r")),
    ).toThrow("STALE_CONTROL");
    t.control.humanInput(
      Buffer.from(
        "cd " +
          quoteShellWord(f.child) +
          "; export TANDEM_LINUX_MANUAL=manual\r",
      ),
    );
    const lease = t.control.grant(owner, t.control.snapshot()),
      probe = t.executor.prepareContext();
    probe.beforeSend?.();
    t.control.commitWrite(lease, probe.bytes);
    const context = await probe.completion;
    probe.dispose();
    expect(context.cwd).toBe(f.child);
    const cmd = await t.executor.prepare(
      {
        type: "terminal.command",
        program: "printenv",
        args: ["TANDEM_LINUX_MANUAL"],
        cwd: f.child,
      },
      "hand-back",
    );
    cmd.beforeSend?.();
    t.control.commitWrite(lease, cmd.bytes);
    expect((await cmd.completion).output.trim()).toBe("manual");
    cmd.dispose();
    expect(await f.exists(f.root + "/SHOULD_NOT_EXIST")).toBe(false);
    t.control.close();
  }, 45000);
  it("preserves BOM, CRLF, real ownership and mode during a document save", async () => {
    const f = await fixture(),
      file = f.root + "/配置 ' quoted.txt",
      initial = Buffer.concat([
        Buffer.from([239, 187, 191]),
        Buffer.from("第一行\r\n第二行\r\n"),
      ]);
    await f.write(file, initial);
    expect((await f.exec("chmod 640 -- " + quoteShellWord(file))).code).toBe(0);
    const service = documents(f),
      base = await service.read(actor, "linux-session", file, undefined, true),
      saved = await service.save(actor, {
        sessionId: "linux-session",
        path: file,
        version: base.document.version,
        content: "更改\r\n保留\r\n",
        requestId: randomUUID(),
      });
    expect(saved.document.mode).toBe(0o640);
    const data = await f.read(file);
    expect(
      data.equals(
        Buffer.concat([
          Buffer.from([239, 187, 191]),
          Buffer.from("更改\r\n保留\r\n"),
        ]),
      ),
    ).toBe(true);
    expect(await f.io.stat(file)).toMatchObject({ uid: 1000, gid: 1000 });
  }, 45000);
  it("detects an actual external edit and preserves the changed remote file", async () => {
    const f = await fixture(),
      file = f.root + "/conflict.txt";
    await f.write(file, "original");
    const service = documents(f),
      base = await service.read(actor, "linux-session", file, undefined, true);
    await f.write(file, "external");
    await expect(
      service.save(actor, {
        sessionId: "linux-session",
        path: file,
        version: base.document.version,
        content: "draft",
        requestId: randomUUID(),
      }),
    ).rejects.toThrow("FILE_CONFLICT");
    expect((await f.read(file)).toString()).toBe("external");
  }, 30000);
  it("reports real Linux permission denial", async () => {
    const f = await fixture();
    await expect(
      f.io.createExclusive(
        "/srv/tandem-denied/forbidden-" + randomUUID(),
        Buffer.from("blocked"),
        undefined,
        () => {},
      ),
    ).rejects.toThrow("FILE_PERMISSION_DENIED");
  }, 30000);
  it("keeps the original document when a real bounded filesystem runs out of space", async () => {
    const f = await fixture(),
      file = "/mnt/tandem-full/document-" + randomUUID() + ".txt";
    const space = await f.exec("df -B1 /mnt/tandem-full");
    expect(space.code).toBe(0);
    expect(space.output.split(/\s+/)).toContain("1048576");
    await f.write(file, "original");
    try {
      const service = documents(f),
        base = await service.read(
          actor,
          "linux-session",
          file,
          undefined,
          true,
        );
      await expect(
        service.save(actor, {
          sessionId: "linux-session",
          path: file,
          version: base.document.version,
          content: "x".repeat(2 * 1024 * 1024),
          requestId: randomUUID(),
        }),
      ).rejects.toThrow("FILE_IO_FAILED");
      expect((await f.read(file)).toString()).toBe("original");
    } finally {
      await f.io.remove(file, () => {});
    }
  }, 45000);
});
