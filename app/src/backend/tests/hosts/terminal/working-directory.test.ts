import { expect, it, vi } from "vitest";
import { SessionControl } from "../../../collaboration/sessions/control.js";
import { readTerminalDirectory } from "../../../hosts/terminal/working-directory.js";
function fixture() {
  const writes: Uint8Array[] = [];
  let ready = true;
  const control = new SessionControl(
    "session",
    {
      isReady: () => ready,
      write: (bytes) => {
        writes.push(bytes);
      },
    },
    () => {},
  );
  let finish!: (result: { exitCode: number | null; cwd?: string }) => void;
  const completion = new Promise<{ exitCode: number | null; cwd?: string }>(
    (resolve) => {
      finish = resolve;
    },
  );
  const dispose = vi.fn(() => finish({ exitCode: null }));
  const prepare = vi.fn(() => ({
    bytes: Buffer.from("fixed-probe\r"),
    completion,
    dispose,
  }));
  return {
    control,
    writes,
    finish,
    dispose,
    prepare,
    disconnect: () => {
      ready = false;
    },
    read: (confirmed = true) =>
      readTerminalDirectory(control, prepare, () => ready, confirmed),
  };
}
it("requires explicit shell readiness and does not take control from automation", async () => {
  const f = fixture();
  await expect(f.read(false)).rejects.toThrow("CWD_CONFIRM_REQUIRED");
  f.control.grant(
    { ownerType: "agent-task", ownerId: "ai" },
    f.control.snapshot(),
  );
  await expect(f.read()).rejects.toThrow("CWD_CONTROL_BUSY");
  expect(f.prepare).not.toHaveBeenCalled();
  expect(f.writes).toEqual([]);
});
it("returns only the same terminal's confirmed directory and prevents a parallel probe", async () => {
  const f = fixture();
  const pending = f.read();
  await expect(f.read()).rejects.toThrow("CWD_QUERY_BUSY");
  expect(f.writes).toHaveLength(1);
  f.finish({ exitCode: 0, cwd: "/srv/中文 folder" });
  expect(await pending).toBe("/srv/中文 folder");
  expect(f.dispose).toHaveBeenCalledTimes(1);
});
it("rejects a directory when human input changes without changing control ownership", async () => {
  const f = fixture(),
    epoch = f.control.snapshot().controlEpoch;
  const pending = f.read();
  f.control.humanInput(Buffer.from("cd /other\r"));
  expect(f.control.snapshot().controlEpoch).toBe(epoch);
  f.finish({ exitCode: 0, cwd: "/old" });
  await expect(pending).rejects.toThrow("CWD_CHANGED");
});
it.each(["takeover", "disconnect"] as const)(
  "rejects a stale directory after %s",
  async (reason) => {
    const f = fixture(),
      pending = f.read();
    if (reason === "takeover") f.control.takeover();
    else {
      f.disconnect();
      f.finish({ exitCode: 0, cwd: "/old" });
    }
    await expect(pending).rejects.toThrow("CWD_CHANGED");
  },
);
it.each([undefined, "relative", "/bad\npath"])(
  "does not invent a fallback for invalid cwd %j",
  async (cwd) => {
    const f = fixture(),
      pending = f.read();
    f.finish({ exitCode: 0, cwd });
    await expect(pending).rejects.toThrow("CWD_UNAVAILABLE");
  },
);

it("does not take over if authority changes during probe preparation", async () => {
  const f = fixture();
  const probe = f.prepare();
  f.prepare.mockImplementation(() => {
    f.control.grant(
      { ownerType: "agent-task", ownerId: "other" },
      f.control.snapshot(),
    );
    return probe;
  });
  await expect(f.read()).rejects.toThrow("CWD_CHANGED");
  expect(f.writes).toEqual([]);
  expect(f.control.snapshot().controller.kind).toBe("automation");
});
