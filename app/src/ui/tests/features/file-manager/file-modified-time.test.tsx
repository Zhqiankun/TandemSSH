import "@testing-library/jest-dom/vitest";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18n from "@/i18n/i18n";
import { createFileModifiedFormatter } from "@/features/file-manager/file-manager-utils";
import { FileViewer } from "@/features/file-manager/components/FileViewer";
vi.mock("@/features/file-manager/components/CodeEditor", () => ({
  CodeEditor: () => null,
}));
afterEach(cleanup);
const modifiedTimestamp = Date.UTC(2026, 8, 11, 12, 34, 56) / 1000;
it("uses Chinese date ordering instead of legacy English month text", () => {
  const file = { modifiedTimestamp, modified: "Sep 11 12:34" };
  const text = createFileModifiedFormatter("zh-CN")(file);
  expect(text).toMatch(/^2026\/09\/\d{2}/);
  expect(text).not.toContain("Sep");
  expect(file).toEqual({ modifiedTimestamp, modified: "Sep 11 12:34" });
});
it("preserves legacy text only when the timestamp is missing or invalid", () => {
  const format = createFileModifiedFormatter("zh-CN");
  for (const value of [undefined, NaN, Infinity, 1e20])
    expect(format({ modifiedTimestamp: value, modified: "legacy" })).toBe(
      "legacy",
    );
  expect(format({})).toBe("—");
  expect(format({ modifiedTimestamp: 0, modified: "legacy" })).not.toBe(
    "legacy",
  );
});
it("falls back safely for an invalid locale", () => {
  const file = { modifiedTimestamp };
  expect(createFileModifiedFormatter("invalid_locale")(file)).toBe(
    createFileModifiedFormatter("zh-CN")(file),
  );
});
it("updates actual file properties when the UI language changes", async () => {
  await i18n.changeLanguage("zh-CN");
  render(
    <FileViewer
      file={{
        name: "config.txt",
        type: "file",
        path: "/config.txt",
        modified: "Sep 11 12:34",
        modifiedTimestamp,
      }}
      content="example"
    />,
  );
  expect(screen.getByText(/2026\/09\/\d{2}/)).toBeInTheDocument();
  expect(screen.queryByText(/Sep 11/)).not.toBeInTheDocument();
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByText(/09\/\d{2}\/2026/)).toBeInTheDocument();
});
