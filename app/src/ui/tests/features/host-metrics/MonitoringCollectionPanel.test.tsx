import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MonitoringCollectionPanel } from "@/features/host-metrics/MonitoringCollectionPanel";
import type { MonitoringSnapshot } from "@/types/monitoring";
import i18n from "@/i18n/i18n";
const api = vi.hoisted(() => ({ read: vi.fn(), control: vi.fn() }));
vi.mock("@/api/monitoring-collection-api", () => ({
  getMonitoringCollection: api.read,
  controlMonitoringCollection: api.control,
}));
const snapshot: MonitoringSnapshot = {
  hostId: 7,
  paused: false,
  intervalSeconds: 30,
  metricsEnabled: true,
  commands: [
    {
      id: "memory.1",
      widget: "memory",
      template: "cat /proc/meminfo",
      timeoutMs: 15000,
    },
  ],
  recent: [
    {
      id: "sample",
      hostId: 7,
      startedAt: 100,
      finishedAt: 120,
      status: "partial",
      actions: [
        {
          commandId: "memory.1",
          command: "cat /proc/meminfo",
          status: "unavailable",
          startedAt: 100,
          finishedAt: 120,
          exitCode: 1,
          outputBytes: 0,
        },
      ],
    },
  ],
};
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
  api.read.mockReset();
  api.control.mockReset();
  api.read.mockResolvedValue(snapshot);
});
afterEach(cleanup);
it("shows Chinese command templates and results, then pauses and resumes through the API", async () => {
  const changed = vi.fn();
  api.control
    .mockResolvedValueOnce({ ...snapshot, paused: true })
    .mockResolvedValueOnce(snapshot);
  render(
    <MonitoringCollectionPanel
      hostId={7}
      visible={true}
      onPausedChange={changed}
    />,
  );
  await screen.findByText("每 30 秒");
  expect(screen.getByText("不可用或权限不足 · 退出码 1")).toBeInTheDocument();
  expect(screen.getAllByText("cat /proc/meminfo")).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "暂停采样" }));
  await screen.findByRole("button", { name: "恢复采样" });
  expect(api.control).toHaveBeenLastCalledWith(7, "pause");
  expect(changed).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "恢复采样" }));
  await screen.findByRole("button", { name: "暂停采样" });
  expect(api.control).toHaveBeenLastCalledWith(7, "resume");
});
it("keeps the new host when an old host control response arrives late", async () => {
  let resolve!: (value: MonitoringSnapshot) => void;
  api.control.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const changed = vi.fn(),
    view = render(
      <MonitoringCollectionPanel
        hostId={7}
        visible={true}
        onPausedChange={changed}
      />,
    );
  await screen.findByText("每 30 秒");
  fireEvent.click(screen.getByRole("button", { name: "暂停采样" }));
  await waitFor(() => expect(resolve).toBeTypeOf("function"));
  api.read.mockResolvedValue({ ...snapshot, hostId: 8, intervalSeconds: 60 });
  view.rerender(
    <MonitoringCollectionPanel
      hostId={8}
      visible={true}
      onPausedChange={changed}
    />,
  );
  await screen.findByText("每 60 秒");
  await act(async () => resolve({ ...snapshot, paused: true }));
  expect(screen.getByText("每 60 秒")).toBeInTheDocument();
  expect(changed).toHaveBeenLastCalledWith(false);
});
it("disables resume for disabled monitoring", async () => {
  api.read.mockResolvedValue({
    ...snapshot,
    metricsEnabled: false,
    paused: true,
  });
  render(
    <MonitoringCollectionPanel
      hostId={7}
      visible={true}
      onPausedChange={() => {}}
    />,
  );
  expect(
    await screen.findByRole("button", { name: "恢复采样" }),
  ).toBeDisabled();
  expect(screen.getByText("已在主机设置中停用")).toBeInTheDocument();
});
