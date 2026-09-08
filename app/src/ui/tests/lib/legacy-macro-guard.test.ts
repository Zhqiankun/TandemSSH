import { expect, it, vi } from "vitest";
import { runTerminalMacro } from "../../lib/terminal-macros";
it("the shipped raw macro adapter cannot synthesize human input", async () => {
  const send = vi.fn(),
    subscribe = vi.fn(() => () => {});
  await expect(
    runTerminalMacro(
      {
        id: "m",
        name: "旧宏",
        createdAt: "",
        updatedAt: "",
        steps: [
          { id: "s", type: "send", text: "rm /srv/file", pressEnter: true },
        ],
      },
      { send, subscribe },
    ),
  ).rejects.toThrow("CONTROLLED_MACRO_REQUIRED");
  expect(send).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});
