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
import type {
  DirectoryPreviewPage,
  DirectoryRunView,
} from "@/types/directory-transfer";
import type { HumanLocalFileGrant } from "@/types/local-file-grants";
vi.mock("@/api/directory-transfer-api", () => ({
  directoryTransferApi: {
    snapshot: vi.fn(),
    page: vi.fn(),
    preview: vi.fn(),
    run: vi.fn(),
    release: vi.fn(),
  },
}));
import { directoryTransferApi as api } from "@/api/directory-transfer-api";
import { DirectoryTransferManifest } from "../../features/collaboration/DirectoryTransferManifest";
import { TaskDirectoryTransfers } from "../../features/collaboration/TaskDirectoryTransfers";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const grant: HumanLocalFileGrant = {
  id: "grant",
  version: "version",
  taskId: "task",
  direction: "upload",
  kind: "directory",
  name: "产物",
  path: "C:/chosen/产物",
  allowOverwrite: true,
  state: "active",
  createdAt: 0,
  expiresAt: 9999999999999,
};
function page(count = 1, offset = 0): DirectoryPreviewPage {
  return {
    id: "preview",
    revision: "revision",
    taskId: "task",
    direction: "upload",
    path: "/srv",
    localGrantId: grant.id,
    localVersion: grant.version,
    state: "preview",
    overwrite: true,
    entries: count,
    files: count,
    directories: 0,
    excluded: 0,
    totalBytes: count,
    createdAt: 0,
    expiresAt: 9999999999999,
    offset,
    nextOffset: offset + 100 < count ? offset + 100 : null,
    contentTrust: "untrusted-directory-transfer-entries",
    items: Array.from({ length: Math.min(100, count - offset) }, (_, i) => ({
      id: String(offset + i),
      relativePath: `产物/文件${offset + i}.bin`,
      sourceRelativePath: `产物/文件${offset + i}.bin`,
      path: `/srv/产物/文件${offset + i}.bin`,
      kind: "file" as const,
      size: 1,
      status: offset + i === 1 ? ("blocked" as const) : ("new" as const),
    })),
  };
}
async function provider() {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh_CN",
    resources: { zh_CN: { translation: zh } },
    interpolation: { escapeValue: false },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  );
}
it("requires acknowledgement of every page and preserves choices across pagination", async () => {
  vi.mocked(api.page).mockImplementation(async (_t, _p, offset) =>
    page(101, offset),
  );
  const reviewed = vi.fn(),
    Wrapper = await provider();
  render(
    <DirectoryTransferManifest
      taskId="task"
      previewId="preview"
      editable
      onReview={reviewed}
    />,
    { wrapper: Wrapper },
  );
  const checkbox = await screen.findByRole("checkbox", {
    name: "我已核对本页所有条目、目标路径和处理方式",
  });
  await waitFor(() => expect(checkbox).toBeEnabled());
  expect(
    screen
      .getByRole("combobox", { name: "处理 产物/文件1.bin" })
      .querySelectorAll("option"),
  ).toHaveLength(1);
  fireEvent.change(
    screen.getByRole("combobox", { name: "处理 产物/文件0.bin" }),
    { target: { value: "skip" } },
  );
  fireEvent.click(checkbox);
  expect(reviewed.mock.lastCall?.[0].ready).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("产物/文件100.bin");
  await waitFor(() => expect(screen.getByRole("checkbox")).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(reviewed.mock.lastCall?.[0].ready).toBe(true));
  expect(reviewed.mock.lastCall?.[0].choices).toHaveLength(101);
  expect(
    reviewed.mock.lastCall?.[0].choices.find(
      (e: { id: string }) => e.id === "0",
    ).action,
  ).toBe("skip");
  fireEvent.click(screen.getByRole("button", { name: "上一页" }));
  await screen.findByText("产物/文件0.bin");
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "处理 产物/文件0.bin" }),
    ).toBeEnabled(),
  );
  expect(
    screen.getByRole("combobox", { name: "处理 产物/文件0.bin" }),
  ).toHaveValue("skip");
  fireEvent.change(
    screen.getByRole("textbox", { name: "重命名 产物/文件0.bin" }),
    { target: { value: "重命名.bin" } },
  );
  await waitFor(() =>
    expect(reviewed.mock.lastCall?.[0].hasRenames).toBe(true),
  );
  expect(reviewed.mock.lastCall?.[0].ready).toBe(false);
  expect(reviewed.mock.lastCall?.[0].renames).toContainEqual({
    relativePath: "产物/文件0.bin",
    name: "重命名.bin",
  });
});
it("shows an unknown task result even when the filesystem write succeeded", async () => {
  const p = page();
  p.items[0].operation = { id: "op", status: "unknown", auditGap: true };
  p.items[0].result = { status: "succeeded" };
  vi.mocked(api.page).mockResolvedValue(p);
  render(<DirectoryTransferManifest taskId="task" previewId="preview" />, {
    wrapper: await provider(),
  });
  await screen.findByText("文件系统结果: 执行成功");
  expect(screen.getByText(/任务操作:.*未知/)).toBeInTheDocument();
  expect(screen.getByRole("alert")).toBeInTheDocument();
});
it("previews and submits only after page review, then shows takeover and prevents release", async () => {
  const p = page();
  let hasPreview = false;
  const runs: DirectoryRunView[] = [];
  vi.mocked(api.snapshot).mockImplementation(async () => ({
    previews: hasPreview ? [p] : [],
    runs: [...runs],
  }));
  vi.mocked(api.page).mockResolvedValue(p);
  vi.mocked(api.preview).mockImplementation(async () => {
    hasPreview = true;
    return { operationId: "preview-op", status: "queued" };
  });
  vi.mocked(api.run).mockImplementation(async () => {
    const r: DirectoryRunView = {
      id: "run",
      taskId: "task",
      previewId: "preview",
      state: "paused-human",
      completed: 0,
      total: 1,
      createdAt: 0,
    };
    runs.push(r);
    return r;
  });
  const onChange = vi.fn();
  render(
    <TaskDirectoryTransfers
      taskId="task"
      grants={[grant]}
      ready
      disabled={false}
      onChange={onChange}
    />,
    { wrapper: await provider() },
  );
  fireEvent.change(screen.getByRole("textbox", { name: "远端目标父目录" }), {
    target: { value: "/srv" },
  });
  fireEvent.click(screen.getByRole("button", { name: "生成目录预览" }));
  await screen.findByText("产物/文件0.bin");
  expect(screen.getByRole("button", { name: "提交目录批次" })).toBeDisabled();
  await waitFor(() =>
    expect(
      screen.getByRole("checkbox", {
        name: "我已核对本页所有条目、目标路径和处理方式",
      }),
    ).toBeEnabled(),
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "我已核对本页所有条目、目标路径和处理方式",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "提交目录批次" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "提交目录批次" }));
  await screen.findByText("已暂停，人工接管中");
  expect(screen.getByRole("button", { name: "释放此预览" })).toBeDisabled();
  expect(api.run).toHaveBeenCalledWith(
    "task",
    expect.objectContaining({
      previewId: "preview",
      revision: "revision",
      choices: [{ id: "0", action: "create" }],
    }),
  );
  expect(JSON.stringify(vi.mocked(api.preview).mock.calls)).not.toContain(
    grant.path,
  );
  expect(onChange).toHaveBeenCalledTimes(2);
});
