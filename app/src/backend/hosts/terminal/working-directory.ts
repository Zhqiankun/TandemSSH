import type { SessionControl } from "../../collaboration/sessions/control.js";

type DirectoryProbe = {
  bytes: Uint8Array;
  completion: Promise<{
    exitCode: number | null;
    cwd?: string;
    protocolError?: boolean;
    timedOut?: boolean;
  }>;
  dispose(): void;
};
const active = new WeakSet<SessionControl>();

/** An explicitly confirmed manual read on the existing PTY. Never creates a
 * second SSH connection or takes control away from automation. */
export async function readTerminalDirectory(
  control: SessionControl,
  prepare: () => DirectoryProbe,
  isReady: () => boolean,
  shellReady: boolean,
): Promise<string> {
  if (!shellReady) throw Error("CWD_CONFIRM_REQUIRED");
  const before = control.snapshot();
  if (before.closed || !isReady()) throw Error("CWD_UNAVAILABLE");
  if (before.controller.kind !== "human") throw Error("CWD_CONTROL_BUSY");
  if (active.has(control)) throw Error("CWD_QUERY_BUSY");
  active.add(control);
  let probe: DirectoryProbe | undefined;
  let unsubscribe = () => {};
  try {
    probe = prepare();
    const current = control.snapshot();
    if (
      !isReady() ||
      current.closed ||
      current.controller.kind !== "human" ||
      current.generation !== before.generation ||
      current.controlEpoch !== before.controlEpoch
    )
      throw Error("CWD_CHANGED");
    unsubscribe = control.subscribe(() => probe?.dispose());
    const expectedInput = control.humanInputRevision() + 1;
    control.humanInput(probe.bytes);
    const result = await probe.completion;
    const after = control.snapshot();
    if (
      !isReady() ||
      after.closed ||
      after.generation !== before.generation ||
      after.controlEpoch !== before.controlEpoch ||
      control.humanInputRevision() !== expectedInput
    )
      throw Error("CWD_CHANGED");
    if (
      result.exitCode !== 0 ||
      result.protocolError ||
      result.timedOut ||
      typeof result.cwd !== "string" ||
      !result.cwd.startsWith("/") ||
      result.cwd.length > 16384 ||
      /[\x00-\x1f\x7f]/.test(result.cwd)
    )
      throw Error("CWD_UNAVAILABLE");
    return result.cwd;
  } finally {
    unsubscribe();
    probe?.dispose();
    active.delete(control);
  }
}
