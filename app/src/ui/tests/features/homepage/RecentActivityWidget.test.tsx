import { afterEach, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import i18n from "@/i18n/i18n";
vi.mock("@/api/dashboard-api", () => ({
  getRecentActivity: vi.fn(async () => [
    {
      id: 1,
      userId: "fixture",
      type: "file_manager",
      hostId: 1,
      hostName: "备份服务器",
      timestamp: new Date(Date.now() - 5 * 60_000).toISOString(),
    },
  ]),
}));
vi.mock("../../../features/homepage/use-visible-interval", () => ({
  runVisibleInterval: () => () => {},
}));
import { RecentActivityWidget } from "../../../features/homepage/widgets/RecentActivityWidget";
afterEach(cleanup);
it("renders Chinese activity type and elapsed time", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <RecentActivityWidget
      widget={{
        id: 1,
        typeId: "recent_activity",
        title: "",
        config: {},
        x: 0,
        y: 0,
        w: 10,
        h: 8,
        zOrder: 0,
      }}
      config={{ maxItems: 10, filterTypes: [], showTimestamp: true }}
    />,
  );
  await screen.findByText("备份服务器");
  expect(screen.getByText(i18n.t("networkGraph.fileManager"))).toBeTruthy();
  expect(screen.getByText("5分钟前")).toBeTruthy();
  expect(screen.queryByText("file manager")).toBeNull();
});
