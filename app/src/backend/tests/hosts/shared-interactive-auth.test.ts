import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { Client } from "ssh2";
import { InteractiveAuthService } from "../../hosts/interactive-auth/service.js";
import { PendingFileConnections } from "../../hosts/file-manager/pending-connections.js";
const services: InteractiveAuthService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});
const target = {
  userId: "owner",
  connectionId: "file-one",
  channel: "files" as const,
  hostId: 1,
  address: "127.0.0.1",
  port: 22,
  username: "fixture",
};
function service() {
  const s = new InteractiveAuthService();
  services.push(s);
  return s;
}
it("lists and answers only the current user's prompt, without exposing a saved password", async () => {
  const s = service(),
    finish = vi.fn(),
    abort = vi.fn();
  const handle = s.create(target, () => {}, abort);
  await handle.begin(
    "login",
    "",
    [
      { prompt: "Password:", echo: false },
      { prompt: "Tenant:", echo: true },
    ],
    finish,
    "saved fixture password",
  );
  const requests = (await s.list("owner")).requests;
  expect((await s.list("other")).requests).toEqual([]);
  expect(JSON.stringify(requests)).not.toContain("saved fixture password");
  await expect(s.respond("other", requests[0].id, ["wrong"])).rejects.toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  await s.respond("owner", requests[0].id, ["  租户  "]);
  expect(finish).toHaveBeenCalledWith(["saved fixture password", "  租户  "]);
  await expect(s.respond("owner", requests[0].id, ["again"])).rejects.toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  expect(finish).toHaveBeenCalledOnce();
  expect(abort).not.toHaveBeenCalled();
});
it("keeps a reentrant next round and accepts empty answers exactly once", async () => {
  const s = service(),
    finish = vi.fn();
  const h = s.create(target, () => {}, vi.fn());
  await h.begin("", "", [{ prompt: "First:", echo: true }], async () => {
    await h.begin("", "", [{ prompt: "Press enter:", echo: true }], finish);
  });
  const first = (await s.list("owner")).requests[0];
  await s.respond("owner", first.id, ["yes"]);
  await vi.waitFor(async () =>
    expect((await s.list("owner")).requests).toHaveLength(1),
  );
  const second = (await s.list("owner")).requests[0];
  expect(second.id).not.toBe(first.id);
  await expect(s.respond("owner", first.id, ["late"])).rejects.toThrow(
    "SSH_AUTH_STALE_PROMPT",
  );
  await s.respond("owner", second.id, [""]);
  expect(finish).toHaveBeenCalledWith([""]);
});
it("rechecks access before reply and removes revoked prompts", async () => {
  const s = service(),
    finish = vi.fn(),
    abort = vi.fn();
  let allowed = true;
  const h = s.create(
    target,
    () => {
      if (!allowed) throw Error("revoked");
    },
    abort,
  );
  await h.begin("", "", [{ prompt: "Code:", echo: false }], finish);
  const id = (await s.list("owner")).requests[0].id;
  allowed = false;
  await expect(s.respond("owner", id, ["secret"])).rejects.toThrow(
    "SSH_AUTH_ACCESS_DENIED",
  );
  expect(finish).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledOnce();
  expect((await s.list("owner")).requests).toEqual([]);
});
it("does not answer if cancelled during asynchronous authorization", async () => {
  const s = service(),
    finish = vi.fn(),
    abort = vi.fn();
  let release!: () => void,
    delayed = false;
  const h = s.create(
    target,
    () =>
      delayed
        ? new Promise<void>((resolve) => {
            release = resolve;
          })
        : undefined,
    abort,
  );
  await h.begin("", "", [{ prompt: "Code:", echo: false }], finish);
  const id = (await s.list("owner")).requests[0].id;
  delayed = true;
  const pending = s.respond("owner", id, ["secret"]);
  const rejected = expect(pending).rejects.toThrow("SSH_AUTH_STALE_PROMPT");
  await s.cancel("owner", id);
  release();
  await rejected;
  expect(finish).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledOnce();
});
it("disposal removes prompts and stops only still-pending authentication", async () => {
  const s = service(),
    stopped = vi.fn(),
    completed = vi.fn();
  const a = s.create(target, () => {}, stopped),
    b = s.create({ ...target, connectionId: "two" }, () => {}, completed);
  await a.begin("", "", [{ prompt: "p", echo: false }], vi.fn());
  b.dispose();
  s.dispose();
  expect(stopped).toHaveBeenCalledOnce();
  expect(completed).not.toHaveBeenCalled();
  expect((await s.list("owner")).requests).toEqual([]);
});
function client() {
  const c = Object.assign(new EventEmitter(), { destroy: vi.fn(() => c) });
  return c;
}
it("binds pending SFTP attempts to their owner and prevents old close events from removing replacements", () => {
  const registry = new PendingFileConnections(),
    first = client(),
    second = client(),
    other = client();
  const a = registry.begin("same", "owner", first as unknown as Client);
  expect(() =>
    registry.begin("same", "other", other as unknown as Client),
  ).toThrow("SSH_AUTH_ACCESS_DENIED");
  expect(first.destroy).not.toHaveBeenCalled();
  const b = registry.begin("same", "owner", second as unknown as Client);
  expect(a.signal.aborted).toBe(true);
  first.emit("close");
  expect(() => registry.cancel("same", "other")).toThrow(
    "SSH_AUTH_ACCESS_DENIED",
  );
  expect(second.destroy).not.toHaveBeenCalled();
  b.complete();
  b.cancel();
  expect(second.destroy).not.toHaveBeenCalled();
});

it("checks authorization before automatically using a stored password", async () => {
  const s = service(),
    finish = vi.fn(),
    abort = vi.fn();
  const h = s.create(
    target,
    () => {
      throw Error("revoked");
    },
    abort,
  );
  await expect(
    h.begin(
      "",
      "",
      [{ prompt: "Password:", echo: false }],
      finish,
      "private fixture password",
    ),
  ).rejects.toThrow("SSH_AUTH_ACCESS_DENIED");
  expect(finish).not.toHaveBeenCalled();
  expect(abort).toHaveBeenCalledWith("SSH_AUTH_ACCESS_DENIED");
  expect((await s.list("owner")).requests).toEqual([]);
});

it("keeps an answered prompt cancellable while the server is still authenticating", async () => {
  const s = service(),
    finish = vi.fn(),
    abort = vi.fn();
  const h = s.create(target, () => {}, abort);
  await h.begin("", "", [{ prompt: "Confirm:", echo: true }], finish);
  const id = (await s.list("owner")).requests[0].id;
  await s.respond("owner", id, [""]);
  expect((await s.list("owner")).requests[0]).toMatchObject({
    id,
    waiting: true,
  });
  await s.cancel("owner", id);
  expect(abort).toHaveBeenCalledWith("SSH_AUTH_CANCELLED");
  expect(finish).toHaveBeenCalledOnce();
  expect((await s.list("owner")).requests).toEqual([]);
});
