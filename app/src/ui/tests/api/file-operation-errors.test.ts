import { expect, it, vi, beforeEach } from "vitest";
const { post, put } = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn() }));
const generic = vi.hoisted(() =>
  vi.fn((error: unknown) => {
    throw error;
  }),
);
vi.mock("@/main-axios", () => ({
  authApi: {},
  fileManagerApi: {},
  handleApiError: generic,
  getFileManagerApiForSession: () => ({ post, put }),
  setSessionOrigin: vi.fn(),
  clearSessionOrigin: vi.fn(),
}));
import {
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
