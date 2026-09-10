import "@testing-library/jest-dom/vitest";
import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import zh from "@/locales/translated/zh_CN.json";
vi.mock("@/api/shared-interactive-api", () => ({
  sharedInteractiveApi: { pending: vi.fn(), respond: vi.fn(), cancel: vi.fn() },
}));
import { sharedInteractiveApi } from "@/api/shared-interactive-api";
import { SharedInteractiveMonitor } from "@/ssh/SharedInteractiveMonitor";
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
const request = {
  id: "question",
  name: "login",
  instructions: "",
  expiresAt: Date.now() + 60000,
  prompts: [{ index: 0, prompt: "Secret:", echo: false }],
  target: {
    connectionId: "file-one",
    channel: "files" as const,
    hostId: 1,
    address: "127.0.0.1",
    port: 22,
    username: "fixture",
  },
};
async function fixture() {
  const i18n = createInstance();
  await i18n.init({
    lng: "zh-CN",
    resources: { "zh-CN": { translation: zh } },
  });
  vi.mocked(sharedInteractiveApi.pending).mockResolvedValue({
    requests: [request],
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <SharedInteractiveMonitor userId="owner" />
    </I18nextProvider>,
  );
}
it("shows the file connection identity and submits raw responses with the prompt ID", async () => {
  await fixture();
  await screen.findByLabelText("Secret:");
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "文件连接 · 127.0.0.1 · fixture@127.0.0.1:22",
  );
  vi.mocked(sharedInteractiveApi.respond).mockImplementation(async () => {
    vi.mocked(sharedInteractiveApi.pending).mockResolvedValue({ requests: [] });
  });
  fireEvent.change(screen.getByLabelText("Secret:"), {
    target: { value: "  raw answer  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
  await waitFor(() =>
    expect(sharedInteractiveApi.respond).toHaveBeenCalledWith(
      "question",
      ["  raw answer  "],
      expect.any(AbortSignal),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
it("cancels the current prompt without fabricating an empty response", async () => {
  await fixture();
  await screen.findByLabelText("Secret:");
  vi.mocked(sharedInteractiveApi.cancel).mockImplementation(async () => {
    vi.mocked(sharedInteractiveApi.pending).mockResolvedValue({ requests: [] });
  });
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(sharedInteractiveApi.cancel).toHaveBeenCalledWith(
      "question",
      expect.any(AbortSignal),
    ),
  );
  expect(sharedInteractiveApi.respond).not.toHaveBeenCalled();
});

it("allows cancellation while the answer request is still pending", async () => {
  await fixture();
  await screen.findByLabelText("Secret:");
  let finish!: () => void;
  vi.mocked(sharedInteractiveApi.respond).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  vi.mocked(sharedInteractiveApi.cancel).mockImplementation(async () => {
    vi.mocked(sharedInteractiveApi.pending).mockResolvedValue({ requests: [] });
  });
  fireEvent.click(screen.getByRole("button", { name: "发送回复" }));
  await waitFor(() =>
    expect(sharedInteractiveApi.respond).toHaveBeenCalledOnce(),
  );
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  await waitFor(() =>
    expect(sharedInteractiveApi.cancel).toHaveBeenCalledOnce(),
  );
  finish();
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
});
