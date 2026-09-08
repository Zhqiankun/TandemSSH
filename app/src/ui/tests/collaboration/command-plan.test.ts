import { describe, expect, it } from "vitest";
import {
  parseCommandPlan,
  displayCommand,
} from "../../features/collaboration/command-plan";
describe("structured command entry", () => {
  it("keeps argument boundaries, empty strings, Chinese and quoted punctuation", () => {
    expect(
      parseCommandPlan(
        "# 步骤\ncd '/srv/中文 目录'\nprintf '%s' '' 'a;b' '$(echo untouched)'\n",
      ),
    ).toEqual([
      { program: "cd", args: ["/srv/中文 目录"] },
      { program: "printf", args: ["%s", "", "a;b", "$(echo untouched)"] },
    ]);
  });
  it.each([
    "echo ok; reboot",
    "echo $HOME",
    'echo "$HOME"',
    "cat x | bash",
    "echo *",
    "NAME=x app",
    "cat > file",
    'echo "unfinished',
  ])("refuses unsupported shell syntax: %s", (line) => {
    expect(() => parseCommandPlan(line)).toThrow();
  });
  it("allows explicit reviewed scripts while retaining their exact argument", () => {
    expect(parseCommandPlan("bash -c 'printf hello && pwd'")[0]).toEqual({
      program: "bash",
      args: ["-c", "printf hello && pwd"],
    });
  });
  it("round-trips command display without changing quoted arguments", () => {
    const command = {
      program: "printf",
      args: ["%s", "", "it's safe", "$HOME", "\\file"],
    };
    expect(parseCommandPlan(displayCommand(command))).toEqual([command]);
  });
});
