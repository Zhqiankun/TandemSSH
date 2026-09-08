import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "../../i18n/i18n";
import { FileInspectionResult } from "../../features/collaboration/FileInspectionResult";
const metadata = {
  kind: "symlink" as const,
  size: 10,
  mtime: 1700000000,
  atime: 1700000000,
  mode: 0o640,
  uid: 1000,
  gid: 1000,
};
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
it("shows Chinese paginated directory details and renders hostile-looking names as text", () => {
  const name = "<img src=x onerror=alert(1)>";
  const { container } = render(
    <FileInspectionResult
      result={{
        directory: {
          path: "/目录",
          canonicalPath: "/目录",
          snapshotId: "snapshot",
          observedAt: 1700000000000,
          entries: [{ name, metadata }],
          offset: 0,
          total: 2,
          omitted: 1,
          nextCursor: "next",
          contentTrust: "untrusted-directory-entries",
        },
      }}
    />,
  );
  expect(screen.getByText(name)).toBeTruthy();
  expect(screen.getByText("符号链接")).toBeTruthy();
  expect(screen.getByText("0640")).toBeTruthy();
  expect(screen.getByText("此目录还有后续页面")).toBeTruthy();
  expect(screen.getByText(/未显示/)).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
});
it("shows metadata as attributes, not file text or a command exit code", () => {
  render(
    <FileInspectionResult
      result={{
        metadata: {
          path: "/链接",
          canonicalPath: "/链接",
          followedLinks: false,
          observedAt: 1700000000000,
          metadata,
        },
      }}
    />,
  );
  expect(screen.getByText("保留最后一级链接")).toBeTruthy();
  expect(screen.getByText("UID 1000 / GID 1000")).toBeTruthy();
  expect(screen.queryByText(/退出码/)).toBeNull();
});
