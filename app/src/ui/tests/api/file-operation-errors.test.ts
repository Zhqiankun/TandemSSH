import { expect, it, vi, beforeEach } from "vitest";
const { post, put, remove } = vi.hoisted(() => ({
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));
const generic = vi.hoisted(() =>
  vi.fn((error: unknown) => {
    throw error;
  }),
);
vi.mock("@/main-axios", () => ({
  authApi: {},
  fileManagerApi: {},
  handleApiError: generic,
  getFileManagerApiForSession: () => ({ post, put, delete: remove }),
  setSessionOrigin: vi.fn(),
  clearSessionOrigin: vi.fn(),
}));
import {
  deleteSSHItem,
  createSSHFile,
  createSSHFolder,
  copySSHItem,
  renameSSHItem,
  moveSSHItem,
} from "../../api/ssh-file-operations-api";
import { throwFileOperationError } from "../../api/file-operation-errors";
beforeEach(() => vi.clearAllMocks());
it.each([
  ["file", () => createSSHFile("s", "/target", "name")],
  ["folder", () => createSSHFolder("s", "/target", "name")],
  ["copy", () => copySSHItem("s", "/source", "/target")],
  ["rename", () => renameSSHItem("s", "/source", "name")],
  ["move", () => moveSSHItem("s", "/source", "/target")],
] as const)(
  "preserves structured results for %s without copying request secrets",
  async (_name, action) => {
    const transport = {
      isAxiosError: true,
      config: { headers: { Authorization: "fixture-secret" } },
      response: { status: 409, data: { error: "FILE_TARGET_EXISTS" } },
    };
    post.mockRejectedValue(transport);
    put.mockRejectedValue(transport);
    await expect(action()).rejects.toMatchObject({
      response: { status: 409, data: { error: "FILE_TARGET_EXISTS" } },
    });
    try {
      await action();
    } catch (error) {
      expect((error as { config?: unknown }).config).toBeUndefined();
      expect(JSON.stringify(error)).not.toContain("fixture-secret");
    }
    expect(generic).not.toHaveBeenCalled();
  },
);
it("retains the existing handling for unrelated and authentication errors", () => {
  const error = {
    isAxiosError: true,
    response: { status: 401, data: { error: "AUTH_REQUIRED" } },
  };
  expect(() => throwFileOperationError(error, "copy")).toThrow();
  expect(generic).toHaveBeenCalledWith(error, "copy");
});

it("passes an unconfirmed trash result through deleteSSHItem without retaining credentials", async () => {
  remove.mockRejectedValue({
    isAxiosError: true,
    config: { headers: { Authorization: "fixture-secret" } },
    response: {
      status: 500,
      data: { error: "TRASH_RESULT_UNKNOWN", trashUnavailable: false },
    },
  });
  const error = await deleteSSHItem("s", "/file", false).catch(
    (error) => error,
  );
  expect(error).toMatchObject({
    response: { status: 500, data: { error: "TRASH_RESULT_UNKNOWN" } },
  });
  expect(error.config).toBeUndefined();
  expect(error.response.data.trashUnavailable).not.toBe(true);
  expect(JSON.stringify(error)).not.toContain("fixture-secret");
  expect(generic).not.toHaveBeenCalled();
});
