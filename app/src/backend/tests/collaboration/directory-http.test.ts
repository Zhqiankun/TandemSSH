import { afterEach, it, expect, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { directoryTaskRoutes } from "../../collaboration/files/directory-http";
import { transferToolsFixture } from "../../test-helpers/transfer-tools-fixture";
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const c of cleanup.splice(0).reverse()) await c();
});
it.each(["automatic", "collaborative"] as const)(
  "desktop HTTP %s directory task uses per-entry authorization and trusted user identity",
  async (mode) => {
    const f = await transferToolsFixture();
    cleanup.push(f.close);
    const folder = path.join(f.folder, "http-tree");
    await fs.mkdir(folder);
    await fs.writeFile(path.join(folder, "data.bin"), f.bytes);
    const task = await f.runtime.create(f.human, {
      sessionId: f.sessionId,
      requestId: randomUUID(),
      title: "目录任务",
      mode,
    });
    const ticket = f.grants.issue("owner", task.id, {
      windowToken: f.windowToken,
      direction: "upload",
      kind: "directory",
    });
    f.grants.claim(f.windowToken, ticket.id);
    const grant = (await f.grants.fulfill(f.windowToken, ticket.id, [folder]))
      .grants[0];
    await f.authorize(task.id);
    let userId = "owner",
      apiKeyId: string | undefined;
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use((req, _res, next) => {
      Object.assign(req, { userId, apiKeyId });
      next();
    });
    app.use(directoryTaskRoutes(f.directoryAutomation));
    const server = createServer(app);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    cleanup.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
    );
    const url =
      "http://127.0.0.1:" +
      (server.address() as { port: number }).port +
      "/tasks/" +
      task.id;
    const post = (endpoint: string, body: unknown) =>
      fetch(url + endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    const input = {
      requestId: randomUUID(),
      direction: "upload",
      path: "/srv",
      localGrantId: grant.id,
      localVersion: grant.version,
      timeoutMs: 10000,
    };
    const injection = await post("/previews", {
      ...input,
      userId: "owner",
      localPath: folder,
    });
    expect(injection.status).toBe(409);
    expect(await injection.json()).toEqual({ error: "INVALID_REQUEST" });
    apiKeyId = "key";
    expect((await post("/previews", input)).status).toBe(403);
    apiKeyId = undefined;
    userId = "other";
    expect((await fetch(url)).status).toBe(404);
    userId = "owner";
    const response = await post("/previews", input);
    expect(response.status).toBe(200);
    const submitted = (await response.json()) as { operationId: string };
    const approve = async () => {
      await vi.waitFor(() =>
        expect(f.runtime.state(f.human, task.id).state).toBe(
          "awaiting-approval",
        ),
      );
      const op = f.runtime.get(f.human, task.id).operations.at(-1)!;
      await f.runtime.approve(f.human, task.id, op.id, op.digest, 1);
      await vi.waitFor(() =>
        expect(f.runtime.operation(f.human, task.id, op.id).status).toBe(
          "succeeded",
        ),
      );
    };
    if (mode === "collaborative") {
      expect((await (await fetch(url)).json()).previews).toEqual([]);
      await approve();
    }
    await vi.waitFor(() =>
      expect(
        f.runtime.operation(f.human, task.id, submitted.operationId).status,
      ).toBe("succeeded"),
    );
    const snapshot = await (await fetch(url)).json();
    expect(snapshot.previews).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toContain(folder);
    const preview = snapshot.previews[0],
      page = await (await fetch(url + "/previews/" + preview.id)).json();
    expect(page.entries).toBe(2);
    expect(page.timeoutMs).toBe(10000);
    const runResponse = await post("/runs", {
      requestId: randomUUID(),
      previewId: preview.id,
      revision: preview.revision,
      choices: page.items.map((e: { id: string }) => ({
        id: e.id,
        action: "create",
      })),
    });
    expect(runResponse.status).toBe(200);
    if (mode === "collaborative") for (let i = 0; i < 3; i++) await approve();
    await vi.waitFor(async () =>
      expect((await (await fetch(url)).json()).runs[0].state).toBe("completed"),
    );
    const complete = await (
      await fetch(url + "/previews/" + preview.id)
    ).json();
    expect(
      complete.items.every(
        (e: { operation: { status: string } }) =>
          e.operation.status === "succeeded",
      ),
    ).toBe(true);
    expect(
      f.runtime
        .get(f.human, task.id)
        .operations.every((o) => o.action.timeoutMs === 10000),
    ).toBe(true);
    expect(await f.remote.read("/srv/http-tree/data.bin")).toEqual(f.bytes);
    expect(
      (await post("/previews/" + preview.id + "/release", {})).status,
    ).toBe(200);
    expect((await (await fetch(url)).json()).previews).toEqual([]);
  },
  30000,
);
