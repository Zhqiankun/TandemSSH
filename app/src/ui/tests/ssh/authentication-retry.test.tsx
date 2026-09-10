import { afterEach, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useConnectionRetry } from "@/lib/useConnectionRetry";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
it("does not retry a rejected authentication automatically but permits a manual retry", () => {
  vi.useFakeTimers();
  const connect = vi.fn();
  const { result } = renderHook(() =>
    useConnectionRetry({ connect, autoStart: false }),
  );
  act(() => result.current.retryNow());
  expect(connect).toHaveBeenCalledTimes(1);
  act(() => result.current.markFailed({ retry: false }));
  act(() => vi.advanceTimersByTime(60000));
  expect(connect).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe("disconnected");
  act(() => result.current.retryNow());
  expect(connect).toHaveBeenCalledTimes(2);
});
