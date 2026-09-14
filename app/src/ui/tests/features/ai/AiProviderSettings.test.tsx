import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { AiProvider } from "@/api/ai-api";

const api = vi.hoisted(() => ({
  createAiProvider: vi.fn(),
  deleteAiProvider: vi.fn(),
  getAiProviderModels: vi.fn(),
  probeAiModels: vi.fn(),
  updateAiProvider: vi.fn(),
}));

vi.mock("@/api/ai-api", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { AiProviderSettings } from "@/features/ai/AiProviderSettings";

const provider: AiProvider = {
  id: 7,
  providerType: "ollama",
  label: "Local Ollama",
  baseUrl: "http://localhost:11434",
  apiKeyPrefix: null,
  defaultModel: "llama3.1",
  enabled: true,
  createdAt: "2026-08-21T00:00:00Z",
};

beforeEach(() => {
  api.getAiProviderModels.mockReset();
  api.getAiProviderModels.mockResolvedValue([]);
  api.updateAiProvider.mockReset();
  api.updateAiProvider.mockResolvedValue(provider);
});

afterEach(cleanup);

describe("AiProviderSettings", () => {
  it("edits an existing provider name and configured model", async () => {
    const onChanged = vi.fn();
    render(<AiProviderSettings providers={[provider]} onChanged={onChanged} />);

    expect(screen.getByText(/llama3\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    const label = screen.getByLabelText("ai.providerLabel");
    const model = screen.getByLabelText("ai.defaultModel");
    fireEvent.change(label, { target: { value: "Production Ollama" } });
    fireEvent.change(model, { target: { value: "qwen3:32b" } });
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));

    await waitFor(() => {
      expect(api.updateAiProvider).toHaveBeenCalledWith(7, {
        label: "Production Ollama",
        defaultModel: "qwen3:32b",
      });
    });
    expect(onChanged).toHaveBeenCalledWith(7);
  });

  it("loads the saved provider model list when editing starts", async () => {
    api.getAiProviderModels.mockResolvedValue(["llama3.1", "qwen3:32b"]);
    render(<AiProviderSettings providers={[provider]} onChanged={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));

    await waitFor(() => {
      expect(api.getAiProviderModels).toHaveBeenCalledWith(7);
    });
    expect(
      screen.getByRole("combobox", { name: "ai.defaultModel" }),
    ).toBeTruthy();
  });
});
it.each(["AI_KEY_ENCRYPTION_UNAVAILABLE", "AI_KEY_ENCRYPTION_FAILED"])(
  "preserves edits and selects the encryption error translation for %s",
  async (code) => {
    const { toast } = await import("sonner");
    vi.mocked(toast.error).mockClear();
    const onChanged = vi.fn();
    api.updateAiProvider.mockRejectedValueOnce(
      Object.assign(new Error("private detail"), { code }),
    );
    render(<AiProviderSettings providers={[provider]} onChanged={onChanged} />);
    fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));
    fireEvent.change(screen.getByLabelText("ai.providerLabel"), {
      target: { value: "保留修改" },
    });
    fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("ai.providerKeyStorageFailed"),
    );
    expect(
      (screen.getByLabelText("ai.providerLabel") as HTMLInputElement).value,
    ).toBe("保留修改");
    expect(onChanged).not.toHaveBeenCalled();
  },
);
it("replaces an existing Key with an explicitly selected memory-only Key", async () => {
  render(<AiProviderSettings providers={[provider]} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "ai.editProvider" }));
  fireEvent.change(screen.getByPlaceholderText("ai.keepKeyBlank"), {
    target: { value: "temporary-key" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "ai.memoryKeyOnly" }));
  fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
  await waitFor(() =>
    expect(api.updateAiProvider).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        apiKey: "temporary-key",
        apiKeyStorage: "memory",
      }),
    ),
  );
});

it("ignores a late model list from the previous endpoint", async () => {
  let old!: (value: { models: string[]; source: string }) => void;
  api.probeAiModels.mockReset();
  api.probeAiModels.mockImplementationOnce(() => new Promise(resolve => { old = resolve; })).mockResolvedValue({ models: ["model-b"], source: "live" });
  render(<AiProviderSettings providers={[]} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "ai.addProvider" }));
  await waitFor(() => expect(api.probeAiModels).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText("http://localhost:11434"), { target: { value: "http://localhost:12434" } });
  await waitFor(() => expect(screen.queryAllByText("model-b").length).toBeGreaterThan(0));
  await act(async () => { old({ models: ["model-a"], source: "live" }); });
  expect(screen.queryAllByText("model-a")).toHaveLength(0);
  expect(screen.queryAllByText("model-b").length).toBeGreaterThan(0);
});
it("refreshes an automatic model suggestion when the endpoint changes", async () => {
  api.probeAiModels.mockReset();
  api.probeAiModels.mockResolvedValueOnce({ models: ["model-a"], source: "live" }).mockResolvedValue({ models: ["model-b"], source: "live" });
  api.createAiProvider.mockReset();api.createAiProvider.mockResolvedValue(provider);
  render(<AiProviderSettings providers={[]} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "ai.addProvider" }));
  await waitFor(() => expect(screen.queryAllByText("model-a").length).toBeGreaterThan(0));
  fireEvent.change(screen.getByPlaceholderText("ai.providerLabelPlaceholder"), { target: { value: "Changed endpoint" } });
  fireEvent.change(screen.getByPlaceholderText("http://localhost:11434"), { target: { value: "http://localhost:12434" } });
  await waitFor(() => expect(api.probeAiModels).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
  await waitFor(() => expect(api.createAiProvider).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: "http://localhost:12434", defaultModel: "model-b" })));
});

it("keeps a manually entered model while discovery completes and the endpoint changes", async () => {
  let complete!: (value: { models: string[]; source: string }) => void;
  api.probeAiModels.mockReset();api.probeAiModels.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; })).mockResolvedValue({ models: ["suggested-b"], source: "live" });
  api.createAiProvider.mockReset();api.createAiProvider.mockResolvedValue(provider);
  render(<AiProviderSettings providers={[]} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "ai.addProvider" }));
  await waitFor(() => expect(api.probeAiModels).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText("ai.defaultModelPlaceholder"), { target: { value: "manual-model" } });
  await act(async () => complete({ models: ["suggested-a"], source: "live" }));
  expect((screen.getByPlaceholderText("ai.defaultModelPlaceholder") as HTMLInputElement).value).toBe("manual-model");
  fireEvent.change(screen.getByPlaceholderText("http://localhost:11434"), { target: { value: "http://localhost:12434" } });
  await waitFor(() => expect(api.probeAiModels).toHaveBeenCalledTimes(2));
  fireEvent.change(screen.getByPlaceholderText("ai.providerLabelPlaceholder"), { target: { value: "Manual configuration" } });
  fireEvent.click(screen.getByRole("button", { name: "ai.save" }));
  await waitFor(() => expect(api.createAiProvider).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "manual-model" })));
});
it("ignores a late probe failure after a newer endpoint succeeded", async () => {
  let fail!: (error: Error) => void;
  api.probeAiModels.mockReset();api.probeAiModels.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; })).mockResolvedValue({ models: ["current-model"], source: "live" });
  render(<AiProviderSettings providers={[]} onChanged={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "ai.addProvider" }));
  await waitFor(() => expect(api.probeAiModels).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByPlaceholderText("http://localhost:11434"), { target: { value: "http://localhost:12434" } });
  await waitFor(() => expect(screen.queryAllByText("current-model").length).toBeGreaterThan(0));
  await act(async () => fail(new Error("old endpoint failed")));
  expect(screen.queryByText("ai.modelDetectFailed")).toBeNull();
});
