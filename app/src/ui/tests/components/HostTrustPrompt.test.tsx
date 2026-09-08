import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HostTrustPrompt } from "../../ssh/HostTrustMonitor";
import i18n from "../../i18n/i18n";
import type { HostTrustRequest } from "@/types/host-trust";
vi.mock("@/api/host-trust-api", () => ({
  hostTrustApi: {},
  hostTrustError: () => "HOST_TRUST_DECISION_STALE",
}));
const request: HostTrustRequest = {
  id: "request",
  address: "server.example",
  port: 22,
  hostname: "部署服务器",
  isJumpHost: true,
  scenario: "changed",
  fingerprint: "SHA256:" + "a".repeat(43),
  oldFingerprint: "SHA256:" + "b".repeat(43),
  keyType: "ssh-ed25519",
  expectedRevision: 3,
  createdAt: Date.now(),
  expiresAt: Date.now() + 60000,
  connectionStopped: true,
};
beforeEach(async () => {
  await i18n.changeLanguage("zh-CN");
});
afterEach(cleanup);
it("shows exact fingerprints and requires an explicit check before updating trust", () => {
  const decide = vi.fn();
  render(
    <HostTrustPrompt
      request={request}
      pending={false}
      count={1}
      onDecision={decide}
    />,
  );
  expect(screen.getByText(request.fingerprint)).toBeTruthy();
  expect(screen.getByText(request.oldFingerprint!)).toBeTruthy();
  expect(screen.getByText(/当前连接已拒绝/)).toBeTruthy();
  const button = screen.getByRole("button", {
    name: "更新信任，随后重新连接",
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(button);
  expect(decide).toHaveBeenCalledWith("trust", true);
});
it("can reject without confirming the key and never turns dismissal into acceptance", () => {
  const decide = vi.fn();
  render(
    <HostTrustPrompt
      request={{ ...request, scenario: "new", connectionStopped: false }}
      pending={false}
      count={2}
      onDecision={decide}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "拒绝" }));
  expect(decide).toHaveBeenCalledWith("reject", false);
  expect(decide).toHaveBeenCalledTimes(1);
});
