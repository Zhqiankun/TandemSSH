import "@testing-library/jest-dom/vitest";
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "../../locales/translated/zh_CN.json";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
vi.mock("@/api/local-file-grants-api", () => ({
  localFileGrantsApi: {
    list: vi.fn(),
    ticket: vi.fn(),
    cancel: vi.fn(async () => {}),
    action: vi.fn(async () => {}),
  },
  localFileError: () => "FILE_LOCAL_REQUEST_FAILED",
}));
import { localFileGrantsApi as api } from "@/api/local-file-grants-api";
import { TaskLocalFiles } from "../../features/collaboration/TaskLocalFiles";
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete window.electronAPI;
});
const grant: HumanLocalFileGrant = {
  id: "grant",
  version: "version",
  taskId: "task",
  direction: "upload",
  name: "产物.bin",
  path: "C:/chosen/产物.bin",
  size: 3,
  allowOverwrite: false,
  state: "active",
  createdAt: 0,
  expiresAt: 60000,
};
async function fixture(selected: HumanLocalFileGrant = grant) {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh_CN",
    resources: { zh_CN: { translation: zh } },
    interpolation: { escapeValue: false },
  });
  let grants: HumanLocalFileGrant[] = [];
  const native = {
    identity: vi.fn(async () => ({
      ok: true,
      value: { windowToken: "window" },
    })),
    choose: vi.fn(async () => {
      grants = [selected];
      return { ok: true, value: { grants } };
    }),
    reset: vi.fn(async () => ({ ok: true, value: null })),
  };
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: { localFiles: native },
  });
  vi.mocked(api.list).mockImplementation(async () => ({
    available: true,
    grants,
  }));
  vi.mocked(api.ticket).mockResolvedValue({
    id: "ticket",
    direction: "upload",
    expiresAt: 60000,
  });
  const view = render(
    <I18nextProvider i18n={i18n}>
      <TaskLocalFiles taskId="task" disabled={false} />
    </I18nextProvider>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "选择上传来源" })).toBeEnabled(),
  );
  return { ...view, native };
}
it("requests a task ticket before invoking the native picker and defaults to no overwrite", async () => {
  const f = await fixture();
  fireEvent.click(screen.getByRole("button", { name: "选择上传来源" }));
  await screen.findByText("C:/chosen/产物.bin");
  expect(api.ticket).toHaveBeenCalledWith(
    "task",
    { windowToken: "window", direction: "upload", allowOverwrite: false },
    expect.any(AbortSignal),
  );
  expect(f.native.choose).toHaveBeenCalledWith("ticket");
  expect(screen.getByText("上传文件 · 可用 · 不允许覆盖")).toBeInTheDocument();
  expect(JSON.stringify(vi.mocked(api.ticket).mock.calls)).not.toContain(
    "C:/chosen",
  );
});
it("records explicit overwrite selection and offers revoke and cleanup separately", async () => {
  await fixture();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "允许本次选择的授权覆盖目标文件" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "选择上传来源" }));
  await screen.findByText("产物.bin");
  expect(vi.mocked(api.ticket).mock.calls[0][1].allowOverwrite).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "撤销授权" }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith("task", "grant", "revoke"),
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "清理并移除记录" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "清理并移除记录" }));
  await waitFor(() =>
    expect(api.action).toHaveBeenCalledWith("task", "grant", "forget"),
  );
});
it("cancels a pending ticket on unmount and does not apply the late picker result", async () => {
  const f = await fixture();
  let release!: (value: {
    ok: boolean;
    value: { grants: HumanLocalFileGrant[] };
  }) => void;
  f.native.choose.mockImplementation(() => new Promise((r) => (release = r)));
  fireEvent.click(screen.getByRole("button", { name: "选择上传来源" }));
  await waitFor(() => expect(f.native.choose).toHaveBeenCalledOnce());
  f.unmount();
  await waitFor(() =>
    expect(api.cancel).toHaveBeenCalledWith("task", "ticket"),
  );
  release({ ok: true, value: { grants: [grant] } });
  await Promise.resolve();
  expect(api.list).toHaveBeenCalledTimes(1);
});

it.each(["upload", "download"] as const)(
  "requests a native %s directory ticket and shows its snapshot count",
  async (direction) => {
    const selected: HumanLocalFileGrant = {
      ...grant,
      direction,
      kind: "directory",
      name: "目录",
      path: "C:/chosen/目录",
      entries: 3,
      excluded: 1,
    };
    const f = await fixture(selected);
    fireEvent.click(
      screen.getByRole("button", {
        name: direction === "upload" ? "选择上传目录" : "选择下载目录",
      }),
    );
    await screen.findByText("C:/chosen/目录");
    expect(api.ticket).toHaveBeenCalledWith(
      "task",
      {
        windowToken: "window",
        direction,
        allowOverwrite: false,
        kind: "directory",
      },
      expect.any(AbortSignal),
    );
    expect(f.native.choose).toHaveBeenCalledWith("ticket");
    expect(screen.getByText("已固定 3 项，排除 1 项")).toBeInTheDocument();
  },
);
