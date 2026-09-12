import { afterEach, beforeEach, expect, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs/promises";
import path from "node:path";
import * as schema from "../../../database/db/schema.js";
import { sqliteSchemaSql } from "./test-support.js";
import { AiRepository } from "../../../database/repositories/ai-repository.js";
import {
  chatTurnOutcome,
  encodeChatTurn,
  restoreChatHistory,
} from "../../../ai/chat-history.js";
import type { ChatMessage } from "../../../ai/providers/types.js";
let db: Database.Database, repo: AiRepository, folder: string, cache: string;
function open() {
  db = new Database(path.join(folder, "chat.sqlite"));
  db.pragma("foreign_keys = ON");
  repo = new AiRepository({
    dialect: "sqlite",
    drizzle: drizzle(db, { schema }),
  });
}
beforeEach(async () => {
  cache = await fs.realpath(path.resolve(process.cwd(), "../.cache"));
  folder = await fs.mkdtemp(path.join(cache, "chat-sqlite-"));
  open();
  db.exec(sqliteSchemaSql());
  db.exec(
    "INSERT INTO users (id,username,password_hash) VALUES ('owner','alice','fixture'),('other','bob','fixture')",
  );
});
afterEach(async () => {
  if (db?.open) db.close();
  const actual = await fs.realpath(folder);
  if (
    path.dirname(actual) !== cache ||
    !path.basename(actual).startsWith("chat-sqlite-")
  )
    throw Error("Cleanup scope");
  await fs.rm(actual, { recursive: true, force: true });
});
it("reopens a disk database with ordered legacy, complete and incomplete chat records intact", async () => {
  const conversation = await repo.createConversation({
    userId: "owner",
    title: "中文会话",
  });
  const other = await repo.createConversation({
    userId: "other",
    title: "其他用户",
  });
  const call = {
    id: "call-1",
    name: "list_hosts",
    arguments: { name: "中文主机" },
    providerSignature: "opaque-provider-signature",
  };
  const complete: ChatMessage[] = [
    { role: "assistant", content: "检查中", toolCalls: [call] },
    {
      role: "tool",
      content: '{"hosts":[]}',
      toolCallId: call.id,
      toolName: call.name,
    },
    { role: "assistant", content: "检查完成" },
  ];
  await repo.appendMessage({
    conversationId: conversation.id,
    role: "user",
    content: "请检查",
  });
  await repo.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "检查中检查完成",
    toolCalls: encodeChatTurn(complete),
  });
  for (const outcome of ["failed", "interrupted"] as const)
    await repo.appendMessage({
      conversationId: conversation.id,
      role: "assistant",
      content: "保留片段：" + outcome,
      toolCalls: encodeChatTurn(
        [{ role: "assistant", content: "部分", toolCalls: [call] }],
        outcome,
      ),
    });
  await repo.appendMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "旧记录",
    toolCalls: JSON.stringify([call]),
  });
  await repo.touchConversation(conversation.id);
  // Timestamp ties must not reorder messages; ordering belongs to message IDs.
  db.prepare("UPDATE ai_messages SET created_at=? WHERE conversation_id=?").run(
    "2026-09-12 12:00:00",
    conversation.id,
  );
  const before = await repo.listMessages(conversation.id);
  db.close();
  open();
  const loaded = await repo.listMessages(conversation.id);
  expect(loaded).toEqual(before);
  expect(loaded.map((r) => r.id)).toEqual(
    [...loaded.map((r) => r.id)].sort((a, b) => a - b),
  );
  expect(loaded.map((r) => chatTurnOutcome(r.toolCalls))).toEqual([
    undefined,
    undefined,
    "failed",
    "interrupted",
    undefined,
  ]);
  expect(restoreChatHistory(loaded)).toEqual([
    { role: "user", content: "请检查" },
    ...complete,
    { role: "assistant", content: "旧记录", toolCalls: [call] },
  ]);
  expect(await repo.findConversation(conversation.id, "other")).toBeNull();
  expect((await repo.listConversations("owner")).map((r) => r.id)).toEqual([
    conversation.id,
  ]);
  expect((await repo.listConversations("other")).map((r) => r.id)).toEqual([
    other.id,
  ]);
});
it("does not leave a partial row when SQLite rejects a message write", async () => {
  const c = await repo.createConversation({
    userId: "owner",
    title: "写入失败",
  });
  await repo.appendMessage({
    conversationId: c.id,
    role: "user",
    content: "请求",
  });
  db.exec(
    "CREATE TRIGGER reject_assistant BEFORE INSERT ON ai_messages WHEN NEW.role='assistant' BEGIN SELECT RAISE(ABORT,'fixture storage failure'); END",
  );
  await expect(
    repo.appendMessage({
      conversationId: c.id,
      role: "assistant",
      content: "不应出现",
      toolCalls: encodeChatTurn([{ role: "assistant", content: "不应出现" }]),
    }),
  ).rejects.toThrow();
  db.close();
  open();
  expect((await repo.listMessages(c.id)).map((r) => r.content)).toEqual([
    "请求",
  ]);
});
it("pages past 50 conversations without skipping tied timestamps when a newer row is inserted", async () => {
  const ids: number[] = [];
  for (let i = 0; i < 103; i++)
    ids.push(
      (await repo.createConversation({ userId: "owner", title: "历史" + i }))
        .id,
    );
  await repo.createConversation({ userId: "other", title: "不应出现" });
  db.prepare("UPDATE ai_conversations SET updated_at=?").run(
    "2026-01-01 00:00:00",
  );
  const first = await repo.listConversationPage("owner");
  expect(first.conversations).toHaveLength(50);
  const newest = await repo.createConversation({
    userId: "owner",
    title: "新会话",
  });
  await repo.deleteConversation(first.conversations[0].id, "owner");
  const second = await repo.listConversationPage(
    "owner",
    JSON.parse(first.nextCursor!),
  );
  const third = await repo.listConversationPage(
    "owner",
    JSON.parse(second.nextCursor!),
  );
  expect(second.conversations).toHaveLength(50);
  expect(third.conversations).toHaveLength(3);
  expect(third.nextCursor).toBeNull();
  const actual = [
    ...first.conversations,
    ...second.conversations,
    ...third.conversations,
  ].map((r) => r.id);
  expect(actual).toEqual(ids.reverse());
  expect(new Set(actual).size).toBe(103);
  expect(actual).not.toContain(newest.id);
  expect((await repo.listConversationPage("owner")).conversations[0].id).toBe(
    newest.id,
  );
});
