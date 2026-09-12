import { beforeEach, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  patch: vi.fn(),
  generic: vi.fn(),
}));
vi.mock("@/main-axios", () => ({
  authApi: { post: mocks.post, patch: mocks.patch },
  handleApiError: mocks.generic,
}));
import { createAiProvider, updateAiProvider } from "../../api/ai-api";
beforeEach(() => vi.clearAllMocks());
it.each(["AI_KEY_ENCRYPTION_UNAVAILABLE", "AI_KEY_ENCRYPTION_FAILED"])(
  "preserves %s through both write APIs without generic conversion or retries",
  async (code) => {
    const error = Object.assign(new AxiosError("private detail"), {
      response: { status: 503, data: { code } },
    });
    mocks.post.mockRejectedValueOnce(error);
    mocks.patch.mockRejectedValueOnce(error);
    await expect(
      createAiProvider({
        providerType: "openai",
        label: "fixture",
        apiKey: "test",
      }),
    ).rejects.toMatchObject({ message: code, code, status: 503 });
    await expect(updateAiProvider(1, { apiKey: "test" })).rejects.toMatchObject(
      { message: code, code, status: 503 },
    );
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.patch).toHaveBeenCalledTimes(1);
    expect(mocks.generic).not.toHaveBeenCalled();
  },
);
