import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "../../../../locales/translated/zh_CN.json";
import { FileManagerContextMenu } from "../../../../features/file-manager/FileManagerContextMenu";
afterEach(cleanup);
it("offers directory downloads and preserves every selected item", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh_CN", resources: { zh_CN: { translation: zh } } });
  const folder = { name: "tree", path: "/tree", type: "directory" as const },
    file = { name: "file", path: "/file", type: "file" as const },
    onDownload = vi.fn();
  const props = { x: 0, y: 0, isVisible: true, onClose: vi.fn(), onDownload };
  const r = render(
    <I18nextProvider i18n={i18n}>
      <FileManagerContextMenu {...props} files={[folder]} />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByText("下载目录"));
  expect(onDownload).toHaveBeenLastCalledWith([folder]);
  r.rerender(
    <I18nextProvider i18n={i18n}>
      <FileManagerContextMenu {...props} files={[folder, file]} />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByText("下载所选 2 项"));
  expect(onDownload).toHaveBeenLastCalledWith([folder, file]);
});
