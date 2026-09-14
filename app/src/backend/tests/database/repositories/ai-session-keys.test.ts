import { expect, it } from "vitest";
import { AiSessionKeys } from "../../../database/repositories/ai-session-keys.js";
it("bounds pending secrets and releases reserved capacity", () => {
  const store = new AiSessionKeys(),
    tickets = Array.from({ length: 256 }, () => store.prepare("owner", "test"));
  expect(() => store.prepare("owner", "overflow")).toThrow(
    "AI_SESSION_KEY_LIMIT",
  );
  tickets[0].discard();
  const next = store.prepare("owner", "next");
  next.discard();
  tickets.forEach((t) => t.discard());
  expect(() => store.prepare("owner", "x".repeat(16385))).toThrow(
    "AI_SESSION_KEY_TOO_LARGE",
  );
});
it("cancels pending writes on deletion or replacement without affecting other owners", () => {
  const store = new AiSessionKeys();
  const first = store.prepare("owner", "first", 7);
  first.bind(7);
  const other = store.prepare("other", "other", 7);
  other.bind(7);
  other.commit(7);
  const second = store.prepare("owner", "second", 7);
  second.bind(7);
  expect(() => first.commit(7)).toThrow("AI_SESSION_KEY_EXPIRED");
  second.commit(7);
  expect(store.get("owner", 7)).toBe("second");
  const pending = store.prepare("owner", "late", 7);
  pending.bind(7);
  store.remove("owner", 7);
  expect(() => pending.commit(7)).toThrow("AI_SESSION_KEY_EXPIRED");
  expect(store.get("other", 7)).toBe("other");
  store.clear();
  expect(store.get("other", 7)).toBeUndefined();
});
it("clears only the disabled user's keys and clears all on global disable", async () => {
  const { aiSessionKeys } =
    await import("../../../database/repositories/ai-session-keys.js");
  const { notifyAiAccessChanged } =
    await import("../../../ai/access-events.js");
  for (const user of ["first", "second"]) {
    const ticket = aiSessionKeys.prepare(user, "test");
    ticket.bind(1);
    ticket.commit(1);
  }
  notifyAiAccessChanged({ enabled: false, userId: "first" });
  expect(aiSessionKeys.get("first", 1)).toBeUndefined();
  expect(aiSessionKeys.get("second", 1)).toBe("test");
  notifyAiAccessChanged({ enabled: false });
  expect(aiSessionKeys.get("second", 1)).toBeUndefined();
});
