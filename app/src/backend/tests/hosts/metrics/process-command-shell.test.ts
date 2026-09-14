import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { monitoringCommand } from "../../../hosts/metrics/collection-catalog.js";
const bash = process.env.TANDEM_TEST_BASH ?? "/bin/bash";
const header = "USER PID %CPU %MEM VSZ RSS TTY STAT START TIME COMMAND";
function run(
  id: "processes.1" | "processes.2" | "processes.3",
  rows: string[],
) {
  const fixture =
    "ps() { cat <<'TANDEM_PS'\n" +
    [header, ...rows].join("\n") +
    "\nTANDEM_PS\n}\n";
  return spawnSync(bash, ["-c", fixture + monitoringCommand(id).command], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
}
describe.runIf(!!process.env.TANDEM_TEST_BASH || process.platform !== "win32")(
  "fixed process sampling commands in a real shell",
  () => {
    it("counts R+ and Rs states without counting command arguments containing R", () => {
      const result = run("processes.3", [
        "root 1 0 0 0 0 ? R+ 00:00 0 cmd",
        "root 2 0 0 0 0 ? Rs 00:00 0 cmd",
        "root 3 0 0 0 0 ? S 00:00 0 echo R extra",
      ]);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("2");
    });
    it("returns successful zero when no process is running", () => {
      const r = run("processes.3", ["root 3 0 0 0 0 ? S 00:00 0 sleep"]);
      expect(r.status).toBe(0);
      expect(r.stdout.trim()).toBe("0");
    });
    it("preserves header-inclusive total and bounded process output", () => {
      const rows = Array.from(
        { length: 20 },
        (_, i) => `root ${i + 1} 0 0 0 0 ? S 00:00 0 cmd`,
      );
      const count = run("processes.2", rows);
      expect(count.status).toBe(0);
      expect(count.stdout.trim()).toBe("21");
      const top = run("processes.1", rows);
      expect(top.status).toBe(0);
      expect(top.stdout.trim().split("\n")).toHaveLength(11);
    });
    it.each(["processes.1", "processes.2", "processes.3"] as const)(
      "does not hide a ps failure behind a successful pipeline: %s",
      (id) => {
        const r = spawnSync(
          bash,
          ["-c", "ps() { return 17; }\n" + monitoringCommand(id).command],
          { encoding: "utf8", windowsHide: true, timeout: 5000 },
        );
        expect(r.error).toBeUndefined();
        expect(r.status).toBe(1);
        expect(r.stdout).toBe("");
      },
    );
  },
);
