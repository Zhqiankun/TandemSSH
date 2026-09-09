import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useMetricsViewer } from "@/features/host-metrics/hooks/useMetricsViewer";
const api = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(async () => {}) }));
vi.mock("@/api/host-metrics-status-api", () => ({
  startMetricsPolling: api.start,
  stopMetricsPolling: api.stop,
}));
afterEach(() => {
  api.start.mockReset();
  api.stop.mockClear();
});
it("releases the pending ID and rejects a late connection result", async () => {
  let finish!: (value: { success: boolean; viewerSessionId: string }) => void;
  api.start.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook(() => useMetricsViewer());
  let pending!: Promise<unknown>;
  act(() => {
    pending = hook.result.current.start(7);
  });
  const id = hook.result.current.current.current!.id,
    rejected = expect(pending).rejects.toThrow("MONITORING_CANCELLED");
  await act(() => hook.result.current.release(7));
  expect(api.stop).toHaveBeenCalledWith(7, id);
  await act(async () => {
    finish({ success: true, viewerSessionId: id });
    await rejected;
  });
  expect(hook.result.current.current.current).toBeNull();
  hook.unmount();
});
it("two windows of the same host release different IDs", async () => {
  api.start.mockImplementation(async (_host, id) => ({
    success: true,
    viewerSessionId: id,
  }));
  const first = renderHook(() => useMetricsViewer()),
    second = renderHook(() => useMetricsViewer());
  await act(() => first.result.current.start(7));
  await act(() => second.result.current.start(7));
  const a = first.result.current.current.current!.id,
    b = second.result.current.current.current!.id;
  expect(a).not.toBe(b);
  first.unmount();
  expect(api.stop).toHaveBeenCalledWith(7, a);
  expect(api.stop).not.toHaveBeenCalledWith(7, b);
  expect(second.result.current.current.current!.id).toBe(b);
  second.unmount();
});
it("an old host cleanup cannot release the newer host", async () => {
  api.start.mockImplementation(async (_host, id) => ({
    success: true,
    viewerSessionId: id,
  }));
  const hook = renderHook(() => useMetricsViewer());
  await act(() => hook.result.current.start(7));
  await act(() => hook.result.current.start(8));
  const next = hook.result.current.current.current!.id;
  await act(() => hook.result.current.release(7));
  expect(hook.result.current.current.current!.id).toBe(next);
  expect(api.stop).not.toHaveBeenCalledWith(8, next);
  hook.unmount();
});
