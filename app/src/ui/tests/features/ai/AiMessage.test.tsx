import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import zh from "@/locales/translated/zh_CN.json";
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      key === "ai.chatFailedRecord"
        ? zh.ai.chatFailedRecord
        : zh.ai.chatInterruptedRecord,
  }),
}));
import { AiMessage } from "@/features/ai/AiMessage";
afterEach(cleanup);
it.each(["failed", "interrupted"] as const)(
  "shows Chinese %s status alongside retained partial text",
  (outcome) => {
    render(
      <AiMessage role="assistant" content="已收到的文字" outcome={outcome} />,
    );
    expect(screen.getByRole("status").textContent).toContain(
      outcome === "failed" ? "失败" : "中断",
    );
    expect(screen.getByRole("status").textContent).toContain("不会自动重放");
    expect(screen.getByText("已收到的文字")).toBeTruthy();
  },
);
it("does not label successful replies as incomplete", () => {
  render(<AiMessage role="assistant" content="完成" />);
  expect(screen.queryByRole("status")).toBeNull();
});
