import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { usePendingSudoOperation } from "../../../features/file-manager/hooks/use-pending-sudo-operation";
const operation = () => ({
  type: "navigate" as const,
  sessionId: "session",
  path: "/protected",
});
afterEach(cleanup);
it("revokes a pending password continuation immediately on cancel", async () => {
  const { result } = renderHook(usePendingSudoOperation);
  const pending = operation();
  act(() => result.current.setPending(pending));
  const isCurrent = result.current.isCurrent;
  let resolve!: () => void;
  const ready = new Promise<void>((yes) => {
    resolve = yes;
  });
  let executed = false;
  const continuation = ready.then(() => {
    if (isCurrent(pending)) executed = true;
  });
  act(() => {
    result.current.setPending(null);
    expect(isCurrent(pending)).toBe(false);
  });
  resolve();
  await continuation;
  expect(executed).toBe(false);
});
it("rejects an older confirmation without revoking a replacement", () => {
  const { result, unmount } = renderHook(usePendingSudoOperation);
  const old = operation(),
    replacement = operation();
  act(() => result.current.setPending(old));
  act(() => result.current.setPending(replacement));
  expect(result.current.isCurrent(old)).toBe(false);
  expect(result.current.isCurrent(replacement)).toBe(true);
  const isCurrent = result.current.isCurrent;
  unmount();
  expect(isCurrent(replacement)).toBe(false);
});
