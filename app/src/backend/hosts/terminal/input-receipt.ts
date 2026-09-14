import { ControlError } from "../../collaboration/sessions/control.js";
/** Receipts describe accepted transport input, never remote command success. */
export function forwardHumanInputWithReceipt(
  sessionId: string,
  data: string,
  write: () => void,
  send: (message: string) => void,
): void {
  try {
    write();
  } catch (error) {
    send(
      JSON.stringify({
        type: "collaboration.error",
        code: error instanceof ControlError ? error.code : "RESULT_UNKNOWN",
      }),
    );
    return;
  }
  send(JSON.stringify({ type: "terminal.input.accepted", sessionId, data }));
}
