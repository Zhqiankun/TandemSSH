import { expect, it } from "vitest";
import { formatRecentActivityTime } from "../../../features/homepage/recent-activity-time";
const now = Date.parse("2026-09-13T00:00:00Z");
it.each([
  [5 * 60_000, "5分钟前"],
  [2 * 3600_000, "2小时前"],
  [3 * 86400_000, "3天前"],
])("formats %s elapsed milliseconds in Chinese", (elapsed, expected) => {
  expect(
    formatRecentActivityTime(
      new Date(now - Number(elapsed)).toISOString(),
      "zh-CN",
      "刚刚",
      now,
    ),
  ).toBe(expected);
});
it("keeps recent/future times distinct from missing data and supports English", () => {
  expect(
    formatRecentActivityTime(
      new Date(now + 60_000).toISOString(),
      "zh-CN",
      "刚刚",
      now,
    ),
  ).toBe("刚刚");
  expect(formatRecentActivityTime("invalid", "zh-CN", "刚刚", now)).toBe("—");
  expect(
    formatRecentActivityTime(
      new Date(now - 60_000).toISOString(),
      "en_US",
      "just now",
      now,
    ),
  ).toBe("1 minute ago");
});
