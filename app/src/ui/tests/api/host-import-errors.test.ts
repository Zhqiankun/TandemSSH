import { expect, it, vi, beforeEach } from "vitest";
import { AxiosError } from "axios";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  generic: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/main-axios", () => ({
  sshHostApi: { post: mocks.post },
  authApi: {},
  getAllServerStatuses: vi.fn(),
  handleApiError: mocks.generic,
}));
vi.mock("@/lib/hosts-request-cache", () => ({
  getCachedSSHHosts: vi.fn(),
  invalidateHostsAndStatusCaches: mocks.invalidate,
}));
vi.mock("@/lib/remote-sync-trigger", () => ({ requestRemoteSync: vi.fn() }));
vi.mock("@/lib/remote-server-api", () => ({
  getConnectedRemoteApi: vi.fn(),
  markRemoteSharedHosts: vi.fn(),
}));
import {
  bulkImportSSHHosts,
  importSSHConfigHosts,
} from "../../api/ssh-host-management-api";
beforeEach(() => vi.clearAllMocks());
it.each(["json", "ssh"])(
  "preserves %s lookup failure for Chinese UI without retrying or generic conflict conversion",
  async (kind) => {
    mocks.post.mockRejectedValueOnce(
      Object.assign(new AxiosError("raw detail"), {
        response: { status: 409, data: { code: "HOST_IMPORT_LOOKUP_FAILED" } },
      }),
    );
    const work =
      kind === "json"
        ? bulkImportSSHHosts([], true)
        : importSSHConfigHosts("Host fixture", true);
    await expect(work).rejects.toMatchObject({
      message: "HOST_IMPORT_LOOKUP_FAILED",
      code: "HOST_IMPORT_LOOKUP_FAILED",
      status: 409,
    });
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.generic).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
  },
);
it("keeps unrelated failures on the existing error path", async () => {
  const failure = new Error("other");
  mocks.post.mockRejectedValueOnce(failure);
  mocks.generic.mockImplementationOnce(() => {
    throw failure;
  });
  await expect(bulkImportSSHHosts([])).rejects.toBe(failure);
  expect(mocks.generic).toHaveBeenCalledWith(failure, "bulk import SSH hosts");
});
