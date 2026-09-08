import "@testing-library/jest-dom/vitest";
import { afterEach, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "../../locales/translated/zh_CN.json";
import { FileTransferResult } from "../../features/collaboration/FileTransferResult";
import type { FileTransferResult as Result } from "@/types/file-transfer";
afterEach(cleanup);
async function show(result: Result) {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh_CN",
    resources: { zh_CN: { translation: zh } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <FileTransferResult result={result} />
    </I18nextProvider>,
  );
}
const base: Result = {
  direction: "upload",
  localGrantId: "grant",
  localVersion: "v",
  transferId: "transfer",
  bytes: 4,
  totalBytes: 8,
  verification: "none",
  cleanupRequired: true,
};
it("shows partial confirmed bytes without claiming content verification", async () => {
  await show(base);
  expect(screen.getByText("上传文件 · 已确认 4 / 8 字节")).toBeInTheDocument();
  expect(screen.getByText("尚未完成整体内容校验")).toBeInTheDocument();
  expect(
    screen.getByText("仍有临时文件或清理事项，请先核对结果。"),
  ).toBeInTheDocument();
  expect(screen.queryByText(/SHA-256/)).not.toBeInTheDocument();
});
it("shows verified downloads and their digest in Chinese", async () => {
  await show({
    ...base,
    direction: "download",
    bytes: 8,
    verification: "sha256",
    sha256: "a".repeat(64),
    cleanupRequired: false,
  });
  expect(screen.getByText("下载文件 · 已确认 8 / 8 字节")).toBeInTheDocument();
  expect(screen.getByText("内容校验通过")).toBeInTheDocument();
  expect(screen.getByText("SHA-256 " + "a".repeat(64))).toBeInTheDocument();
});
