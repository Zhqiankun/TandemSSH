import { afterEach, expect, it, vi } from "vitest";
import express from "express";
import { createServer, request, type Server } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { AuditJournal } from "../../collaboration/audit/journal.js";
import { historyExportHandler } from "../../collaboration/audit/history-export-http.js";
const owned: string[] = [],
  servers: Server[] = [];
const root = path.resolve("../.cache/history-export-http");
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  for (const p of owned.splice(0)) {
    if (path.dirname(p) !== root) throw Error("cleanup scope");
    await fs.rm(p, { recursive: true, force: true });
  }
});
async function serve(journal: Pick<AuditJournal, "exportHistory">) {
  const app = express();
  app.use(express.json());
  app.post(
    "/export",
    historyExportHandler(() => journal),
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw Error("TCP listener");
  return address.port;
}
function post(port: number, body: unknown) {
  return new Promise<{
    status: number;
    type: string | undefined;
    body: string;
  }>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/export",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("error", reject);
        res.on("end", () =>
          resolve({
            status: res.statusCode!,
            type: res.headers["content-type"],
            body,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}
it("streams the complete redacted task selection over real HTTP", async () => {
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, "export-"));
  owned.push(directory);
  const journal = new AuditJournal(directory, "owner");
  for (let i = 0; i < 61; i++)
    await journal.record("operation.result", {
      taskId: "task",
      output: "API_KEY=http-fixture-secret-" + i,
    });
  await journal.record("operation.result", {
    taskId: "other",
    output: "not-selected",
  });
  const result = await post(await serve(journal), { taskId: "task" });
  expect(result.status).toBe(200);
  expect(result.type).toContain("application/x-ndjson");
  const frames = result.body
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(frames[0]).toMatchObject({ kind: "header", taskId: "task" });
  expect(frames.at(-1)).toMatchObject({
    kind: "summary",
    completed: true,
    records: 61,
  });
  expect(result.body).not.toContain("http-fixture-secret");
  expect(result.body).not.toContain("not-selected");
});
it("rejects user and path overrides before starting a journal scan", async () => {
  const exportHistory = vi.fn();
  const port = await serve({ exportHistory } as unknown as AuditJournal);
  const result = await post(port, { userId: "other", path: "../outside" });
  expect(result.status).toBe(400);
  expect(result.body).toContain("HISTORY_EXPORT_REQUEST_INVALID");
  expect(exportHistory).not.toHaveBeenCalled();
});
it("aborts and releases a running generator when the HTTP client disconnects", async () => {
  let aborted = false,
    released = false;
  const port = await serve({
    async *exportHistory(_query, signal) {
      try {
        yield {
          kind: "header",
          schemaVersion: 1,
          taskId: null,
          retentionDays: 7,
          startedAt: Date.now(),
        };
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
          if (signal.aborted) {
            aborted = true;
            resolve();
          }
        });
        signal.throwIfAborted();
      } finally {
        released = true;
      }
    },
  });
  await new Promise<void>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/export",
        method: "POST",
        headers: { "Content-Type": "application/json" },
      },
      (res) => {
        res.once("data", () => {
          res.destroy();
          resolve();
        });
        res.on("error", () => {});
      },
    );
    req.on("error", reject);
    req.end("{}");
  });
  await vi.waitFor(() => {
    expect(aborted).toBe(true);
    expect(released).toBe(true);
  });
});
