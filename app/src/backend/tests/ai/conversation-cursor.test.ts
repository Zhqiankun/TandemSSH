import { expect, it } from "vitest";
import { parseConversationCursor } from "../../ai/conversation-cursor.js";
it("accepts an absent cursor and a bounded timestamp/ID pair", () => {
  expect(parseConversationCursor(undefined)).toBeUndefined();
  expect(
    parseConversationCursor('{"updatedAt":"2026-09-12 12:00:00","id":7}'),
  ).toEqual({ updatedAt: "2026-09-12 12:00:00", id: 7 });
});
it.each([
  "",
  "null",
  "[]",
  '{"updatedAt":"2026-09-12 12:00:00","id":0}',
  '{"updatedAt":"x","id":1}',
  '{"updatedAt":"2026-09-12 12:00:00","id":1,"userId":"other"}',
  "x".repeat(257),
])("rejects malformed or identity-bearing cursors", (value) => {
  expect(() => parseConversationCursor(value)).toThrow(
    "INVALID_CONVERSATION_CURSOR",
  );
});
