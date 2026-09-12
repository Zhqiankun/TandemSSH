import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
const page = vi.hoisted(() => vi.fn());
vi.mock("@/api/ai-api", () => ({ getAiConversationPage: page }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
import { AiConversationPicker } from "@/features/ai/AiConversationPicker";
afterEach(() => {
  cleanup();
  page.mockReset();
});
it("loads older rows, keeps the selection and resets pages on refresh", async () => {
  page
    .mockResolvedValueOnce({
      conversations: [{ id: 3, title: "最新" }],
      nextCursor: "older",
    })
    .mockResolvedValueOnce({
      conversations: [
        { id: 3, title: "重复" },
        { id: 2, title: "较早" },
      ],
      nextCursor: null,
    })
    .mockResolvedValueOnce({
      conversations: [{ id: 4, title: "刷新后" }],
      nextCursor: null,
    });
  const select = vi.fn();
  render(
    <AiConversationPicker value={null} refreshKey="idle" onSelect={select} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "ai.loadOlderConversations" }),
  );
  await screen.findByRole("option", { name: "较早" });
  expect(page).toHaveBeenNthCalledWith(2, "older");
  expect(screen.queryByRole("option", { name: "重复" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "2" } });
  expect(select).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByRole("button", { name: "ai.refreshHistory" }));
  await screen.findByRole("option", { name: "刷新后" });
  expect(screen.queryByRole("option", { name: "较早" })).toBeNull();
});
it("keeps loaded rows and the same cursor available after a failed next page", async () => {
  page
    .mockResolvedValueOnce({
      conversations: [{ id: 3, title: "保留" }],
      nextCursor: "older",
    })
    .mockRejectedValueOnce(Error("offline"))
    .mockResolvedValueOnce({
      conversations: [{ id: 2, title: "重试成功" }],
      nextCursor: null,
    });
  render(
    <AiConversationPicker value={3} refreshKey="idle" onSelect={() => {}} />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "ai.loadOlderConversations" }),
  );
  await screen.findByRole("alert");
  expect(screen.getByRole("option", { name: "保留" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "ai.loadOlderConversations" }),
  );
  await screen.findByRole("option", { name: "重试成功" });
  await waitFor(() => expect(page).toHaveBeenNthCalledWith(3, "older"));
});
