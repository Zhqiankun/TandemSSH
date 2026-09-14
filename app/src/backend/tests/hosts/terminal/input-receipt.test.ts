import { expect, it } from "vitest";
import { forwardHumanInputWithReceipt } from "../../../hosts/terminal/input-receipt.js";
import {
  SessionControl,
  ControlError,
} from "../../../collaboration/sessions/control.js";
import { encodeTerminalInput } from "../../../hosts/terminal/encoding.js";
it("acknowledges only input accepted by real Big5 preflight and transport", () => {
  const writes: Buffer[] = [],
    messages: string[] = [];
  const control = new SessionControl(
    "session",
    {
      isReady: () => true,
      validateWrite: (data) => {
        try {
          encodeTerminalInput(data, "big5");
        } catch {
          throw new ControlError("TERMINAL_INPUT_NOT_REPRESENTABLE");
        }
      },
      write: (data) => {
        writes.push(encodeTerminalInput(data, "big5"));
      },
    },
    () => {},
  );
  const send = (data: string) =>
    forwardHumanInputWithReceipt(
      "session",
      data,
      () => control.humanInput(Buffer.from(data)),
      (message) => messages.push(message),
    );
  send("繁體中文");
  send("😀");
  send("OK\r");
  expect(writes).toHaveLength(2);
  const events = messages.map((m) => JSON.parse(m));
  expect(
    events
      .filter((e) => e.type === "terminal.input.accepted")
      .map((e) => e.data),
  ).toEqual(["繁體中文", "OK\r"]);
  expect(events[1]).toEqual({
    type: "collaboration.error",
    code: "TERMINAL_INPUT_NOT_REPRESENTABLE",
  });
});
it("does not acknowledge a transport failure", () => {
  const messages: string[] = [];
  forwardHumanInputWithReceipt(
    "session",
    "pwd\r",
    () => {
      throw Error("closed");
    },
    (m) => messages.push(m),
  );
  expect(messages.map((m) => JSON.parse(m))).toEqual([
    { type: "collaboration.error", code: "RESULT_UNKNOWN" },
  ]);
});
