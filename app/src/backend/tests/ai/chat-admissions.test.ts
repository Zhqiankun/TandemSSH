import { expect, it } from "vitest";
import { ChatAdmissions } from "../../ai/chat-admissions.js";
it("keeps conversation locks until release, including newly created IDs", () => {
  const pool = new ChatAdmissions(),
    first = pool.acquire("owner");
  first.bind(7);
  expect(() => pool.acquire("owner", 7)).toThrow("CHAT_CONVERSATION_BUSY");
  const other = pool.acquire("other", 7);
  other.release();
  first.release();
  const next = pool.acquire("owner", 7);
  first.release();
  expect(() => pool.acquire("owner", 7)).toThrow("CHAT_CONVERSATION_BUSY");
  next.release();
  expect(() => first.bind(8)).toThrow("CHAT_ADMISSION_RELEASED");
});
it("bounds per-user parallel chats and restores capacity after failures", () => {
  const pool = new ChatAdmissions(),
    leases = Array.from({ length: 4 }, (_, id) =>
      pool.acquire("owner", id + 1),
    );
  expect(() => pool.acquire("owner", 5)).toThrow("CHAT_CONCURRENCY_LIMIT");
  leases[0].release();
  const next = pool.acquire("owner", 5);
  next.release();
  leases.forEach((l) => l.release());
});
it("bounds total parallel chats across users", () => {
  const pool = new ChatAdmissions(),
    leases = Array.from({ length: 16 }, (_, id) => pool.acquire("user" + id));
  expect(() => pool.acquire("another")).toThrow("CHAT_CONCURRENCY_LIMIT");
  leases.forEach((l) => l.release());
  expect(() => pool.acquire("another")).not.toThrow();
});
