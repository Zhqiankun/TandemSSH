import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { automatedFilesFixture } from "../../test-helpers/automated-files-fixture";
import { scrubFileContent } from "../../files/content-redaction";
function fixture(...args: Parameters<typeof automatedFilesFixture>) {
  const result = automatedFilesFixture(...args);
  closers.push(result.close);
  return result;
}
const closers: Array<() => void> = [];
afterEach(() => {
  closers.splice(0).forEach((close) => close());
  vi.useRealTimers();
});
describe("automated versioned documents", () => {
  it("reads through MCP and performs an exact edit without logging file bodies", async () => {
    const f = fixture("port=80\nprivate_note=unique-body-marker\n"),
      taskId = await f.start();
    const submitted = (await f.call("files.read", {
      taskId,
      path: "/srv/config",
      requestId: "read",
    })) as { operationId: string };
    const op = await f.wait(taskId, submitted.operationId, "succeeded"),
      version = op.fileResult!.document!.version;
    const body = await f.call("files.content", { taskId, version });
    expect(body).toMatchObject({
      content: "port=80\nprivate_note=unique-body-marker\n",
      canReplace: true,
      redacted: false,
    });
    const edit = (await f.call("files.edit", {
      taskId,
      version,
      edits: [{ before: "port=80", after: "port=8080" }],
      requestId: "edit",
    })) as { operationId: string };
    await f.wait(taskId, edit.operationId, "succeeded");
    expect(f.rows.get("/srv/config")!.bytes.toString()).toBe(
      "port=8080\nprivate_note=unique-body-marker\n",
    );
    expect(JSON.stringify(f.events)).not.toContain("unique-body-marker");
    expect(f.writes).toEqual(["context"]);
  });
  it("redacts JSON secret keys and preserves unseen secrets during a unique edit", async () => {
    const f = fixture('{"password":"hidden-value","port":80}'),
      taskId = await f.start(),
      version = await f.read(taskId);
    const body = f.files.content(f.actor, taskId, { version });
    expect(body.content).not.toContain("hidden-value");
    expect(body.redacted).toBe(true);
    await expect(
      f.files.change(
        f.actor,
        taskId,
        { version, content: '{"port":81}' },
        "full",
        "write",
      ),
    ).rejects.toThrow("FILE_FULL_READ_REQUIRED");
    const changed = await f.files.change(
      f.actor,
      taskId,
      { version, edits: [{ before: '"port":80', after: '"port":81' }] },
      "patch",
      "edit",
    );
    await f.wait(taskId, changed.operationId, "succeeded");
    expect(f.rows.get("/srv/config")!.bytes.toString()).toBe(
      '{"password":"hidden-value","port":81}',
    );
    expect(JSON.stringify(f.events)).not.toContain("hidden-value");
  });
  it("blocks full replacement until all pages have actually been read, including empty drafts", async () => {
    const f = fixture("abcdefghij"),
      taskId = await f.start(),
      version = await f.read(taskId);
    expect(
      f.files.content(f.actor, taskId, {
        version,
        offset: 8,
        maxCharacters: 2,
      }),
    ).toMatchObject({ complete: true, canReplace: false });
    await expect(
      f.files.change(
        f.actor,
        taskId,
        { version, content: "" },
        "write",
        "write",
      ),
    ).rejects.toThrow("FILE_FULL_READ_REQUIRED");
    f.files.content(f.actor, taskId, { version, offset: 0, maxCharacters: 8 });
    const changed = await f.files.change(
      f.actor,
      taskId,
      { version, content: "" },
      "write",
      "write",
    );
    await f.wait(taskId, changed.operationId, "succeeded");
    expect(f.rows.get("/srv/config")!.bytes.length).toBe(0);
  });
  it("cooperative writes require a review bound to the exact operation and digest", async () => {
    const f = fixture("port=80\n", "collaborative"),
      taskId = await f.start(),
      version = await f.read(taskId);
    const changed = await f.files.change(
        f.actor,
        taskId,
        { version, edits: [{ before: "80", after: "81" }] },
        "edit",
        "edit",
      ),
      op = await f.wait(taskId, changed.operationId, "awaiting-approval");
    await expect(
      f.runtime.approve(f.human, taskId, op.id, op.digest, 1),
    ).rejects.toThrow("FILE_REVIEW_REQUIRED");
    expect(() => f.files.review(f.actor, taskId, op.id)).toThrow(
      "HUMAN_APPROVAL_REQUIRED",
    );
    const review = f.files.review(f.human, taskId, op.id);
    expect(review.before).toBe("port=80\n");
    expect(review.after).toBe("port=81\n");
    expect(f.rows.get("/srv/config")!.bytes.toString()).toBe("port=80\n");
    await expect(
      f.runtime.approve(
        f.human,
        taskId,
        op.id,
        "f".repeat(64),
        1,
        review.reviewId,
      ),
    ).rejects.toThrow("FILE_REVIEW_REQUIRED");
    await f.runtime.approve(
      f.human,
      taskId,
      op.id,
      op.digest,
      1,
      review.reviewId,
    );
    await f.wait(taskId, op.id, "succeeded");
  });
  it("takeover and foreign task identities cannot reuse cached bodies or old proposals", async () => {
    const f = fixture(),
      taskId = await f.start(),
      version = await f.read(taskId);
    expect(() =>
      f.files.content({ ...f.actor, userId: "other" }, taskId, { version }),
    ).toThrow("TASK_NOT_FOUND");
    const context = f.runtime.fileContext(f.actor, taskId);
    f.control.takeover();
    expect(() => f.files.content(f.actor, taskId, { version })).toThrow();
    expect(() =>
      f.store.content({ ...context, control: f.control.snapshot() }, version),
    ).toThrow("FILE_CONTEXT_EXPIRED");
  });
  it("keeps immutable request identity and detects remote changes before commit", async () => {
    const f = fixture(),
      taskId = await f.start(),
      version = await f.read(taskId);
    const context = f.runtime.fileContext(f.actor, taskId),
      input = { version, edits: [{ before: "80", after: "81" }] };
    const proposal = f.store.propose(context, input, "same");
    input.edits[0].after = "82";
    expect(() => f.store.propose(context, input, "same")).toThrow(
      "REQUEST_CONFLICT",
    );
    expect(proposal.type).toBe("file.write");
    f.put("/srv/config", "port=90\n");
    const changed = await f.files.change(
      f.actor,
      taskId,
      { version, edits: [{ before: "80", after: "81" }] },
      "run",
      "edit",
    );
    await f.wait(taskId, changed.operationId, "failed");
    expect(
      f.runtime.operation(f.actor, taskId, changed.operationId).error,
    ).toBe("FILE_CONFLICT");
    expect(f.rows.get("/srv/config")!.bytes.toString()).toBe("port=90\n");
  });
  it("rejects ambiguous replacements and expires snapshots without writing to disk", async () => {
    const f = fixture("80 80"),
      taskId = await f.start(),
      version = await f.read(taskId);
    await expect(
      f.files.change(
        f.actor,
        taskId,
        { version, edits: [{ before: "80", after: "81" }] },
        "ambiguous",
        "edit",
      ),
    ).rejects.toThrow("FILE_EDIT_NOT_UNIQUE");
    const context = f.runtime.fileContext(f.actor, taskId);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 16 * 60000);
    expect(() => f.store.content(context, version)).toThrow(
      "FILE_CONTEXT_EXPIRED",
    );
  });
  it("preserves a BOM and CRLF through an authorized save-as", async () => {
    const f = fixture("\ufeffport=80\r\n"),
      taskId = await f.start(),
      version = await f.read(taskId);
    const changed = await f.files.change(
      f.actor,
      taskId,
      { version, edits: [{ before: "80", after: "81" }], saveAs: "/srv/new" },
      "save-as",
      "edit",
    );
    await f.wait(taskId, changed.operationId, "succeeded");
    expect(f.rows.get("/srv/new")!.bytes.toString()).toBe("\ufeffport=81\r\n");
    expect(f.rows.get("/srv/config")!.bytes.toString()).toBe(
      "\ufeffport=80\r\n",
    );
  });
  it("recognizes escaped secret property names in JSON", () => {
    expect(
      scrubFileContent('{"pass\\u0077ord":"sensitive","port":80}'),
    ).not.toContain("sensitive");
    expect(scrubFileContent('"api_key": "sensitive-value"')).not.toContain(
      "sensitive-value",
    );
  });
});

it("does not split a Unicode character between body pages", async () => {
  const f = fixture("A😀B"),
    taskId = await f.start(),
    version = await f.read(taskId);
  const first = f.files.content(f.actor, taskId, { version, maxCharacters: 2 });
  expect(first.content).toBe("A");
  const second = f.files.content(f.actor, taskId, {
    version,
    offset: first.nextOffset,
    maxCharacters: 1,
  });
  expect(second.content).toBe("😀");
  expect(() =>
    f.files.content(f.actor, taskId, { version, offset: 2 }),
  ).toThrow("INVALID_FILE_RANGE");
  expect(
    f.files.content(f.actor, taskId, {
      version,
      offset: second.nextOffset,
      maxCharacters: 1,
    }),
  ).toMatchObject({ content: "B", canReplace: true });
});
it("cannot infer or replace hidden secret text using exact edits", async () => {
  const f = fixture('{"password":"hidden-value","port":80}'),
    taskId = await f.start(),
    version = await f.read(taskId);
  for (const before of ["hidden-value", "wrong-guess"])
    await expect(
      f.files.change(
        f.actor,
        taskId,
        { version, edits: [{ before, after: "replacement" }] },
        before,
        "edit",
      ),
    ).rejects.toThrow("FILE_EDIT_NOT_UNIQUE");
  expect(f.rows.get("/srv/config")!.bytes.toString()).toContain("hidden-value");
});
it("rechecks review expiration after a slow approval audit", async () => {
  let release!: () => void,
    entered!: () => void,
    hold = false;
  const gate = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  const f = fixture("port=80", "collaborative", {
      audit: async (type) => {
        if (hold && type === "operation.approval") {
          entered();
          await gate;
        }
      },
    }),
    taskId = await f.start(),
    version = await f.read(taskId);
  const change = await f.files.change(
      f.actor,
      taskId,
      { version, edits: [{ before: "80", after: "81" }] },
      "change",
      "edit",
    ),
    op = await f.wait(taskId, change.operationId, "awaiting-approval"),
    review = f.files.review(f.human, taskId, op.id);
  hold = true;
  const pending = f.runtime.approve(
    f.human,
    taskId,
    op.id,
    op.digest,
    1,
    review.reviewId,
  );
  await started;
  vi.useFakeTimers();
  vi.setSystemTime(Date.now() + 6 * 60000);
  const rejected = expect(pending).rejects.toThrow("FILE_REVIEW_REQUIRED");
  release();
  await rejected;
  expect(f.rows.get("/srv/config")!.bytes.toString()).toBe("port=80");
});

it("does not expose a plain content hash for a proposal that retains a secret", async () => {
  const first = fixture("port=80\npassword=keep-secret"),
    second = fixture("port=80\npassword=keep-secret");
  const a = await first.start(),
    b = await second.start(),
    av = await first.read(a),
    bv = await second.read(b);
  const input = (version: string) => ({
    version,
    edits: [{ before: "port=80", after: "port=81" }],
  });
  const left = first.store.propose(
      first.runtime.fileContext(first.actor, a),
      input(av),
      "a",
    ),
    right = second.store.propose(
      second.runtime.fileContext(second.actor, b),
      input(bv),
      "b",
    );
  if (left.type !== "file.write" || right.type !== "file.write")
    throw Error("expected write");
  expect(left.contentHash).not.toBe(
    createHash("sha256").update("port=81\npassword=keep-secret").digest("hex"),
  );
  expect(left.contentHash).not.toBe(right.contentHash);
});

it("masks URL userinfo and JSON auth containers without changing non-secret formatting", () => {
  expect(
    scrubFileContent("DATABASE_URL=postgres://app:pass123@db.internal/app"),
  ).toBe("DATABASE_URL=postgres://[redacted]@db.internal/app");
  expect(scrubFileContent('{"auth":"dXNlcjpwYXNz","port":80}')).toBe(
    '{"auth":"[redacted]","port":80}',
  );
  expect(scrubFileContent("Authorization: Basic dXNlcjpwYXNz")).not.toContain(
    "dXNlcjpwYXNz",
  );
});
