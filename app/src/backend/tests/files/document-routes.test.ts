import express from "express";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SSHSession } from "../../hosts/file-manager/session";
const docs = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  close: vi.fn(),
}));
vi.mock("../../files/production.js", () => ({
  documents: docs,
  bindFileBrowserDocuments: vi.fn(),
}));
import { registerDocumentRoutes } from "../../hosts/file-manager/document-routes";
let identity: { userId?: string; apiKeyId?: string };
const session = { userId: "owner", activeOperations: 5 } as SSHSession;
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, identity);
  next();
});
registerDocumentRoutes(app, { session });
const server = createServer(app);
let origin = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
async function send(
  method: "GET" | "POST",
  route: string,
  body: Record<string, unknown>,
  status: number,
) {
  const url =
    origin +
    "/ssh/file_manager/ssh/" +
    route +
    (method === "GET"
      ? "?" + new URLSearchParams(body as Record<string, string>)
      : "");
  const response = await fetch(url, {
    method,
    headers:
      method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return result;
}
beforeEach(() => {
  vi.clearAllMocks();
  identity = { userId: "owner" };
  session.activeOperations = 5;
  docs.read.mockResolvedValue({
    content: "",
    document: { documentId: randomUUID() },
  });
  docs.save.mockResolvedValue({ bytes: 0 });
});
describe("trusted file document HTTP contract", () => {
  it("decodes a percent-encoded path exactly once and asks for an editor lease", async () => {
    await send(
      "GET",
      "readFile",
      { sessionId: "session", path: "/中文%2F.txt", editor: "true" },
      200,
    );
    expect(docs.read.mock.calls[0].slice(1)).toEqual([
      "session",
      "/中文%2F.txt",
      undefined,
      true,
    ]);
    expect(session.activeOperations).toBe(5);
  });
  it("rejects the former baseline-free write shape before calling the use case", async () => {
    await send(
      "POST",
      "writeFile",
      { sessionId: "session", path: "/file", content: "test" },
      400,
    );
    expect(docs.save).not.toHaveBeenCalled();
  });
  it("passes an empty draft and an owned immutable baseline", async () => {
    const body = {
      sessionId: "session",
      path: "/file",
      content: "",
      version: randomUUID(),
      requestId: randomUUID(),
    };
    await send("POST", "writeFile", body, 200);
    expect(docs.save.mock.calls[0][1]).toEqual(body);
    expect(docs.save.mock.calls[0][0]).toMatchObject({
      userId: "owner",
      source: "human",
    });
  });
  it.each([{ userId: "other" }, { userId: "owner", apiKeyId: "api" }, {}])(
    "refuses an untrusted or foreign owner: %j",
    async (value) => {
      identity = value;
      await send(
        "GET",
        "readFile",
        { sessionId: "session", path: "/file", editor: "true" },
        400,
      );
      expect(docs.read).not.toHaveBeenCalled();
      expect(session.activeOperations).toBe(5);
    },
  );
  it("closes a logical document using documentId, not a save version", async () => {
    const documentId = randomUUID();
    await send("POST", "closeDocument", { documentId }, 200);
    expect(docs.close.mock.calls[0][1]).toBe(documentId);
    await send("POST", "closeDocument", { version: randomUUID() }, 400);
    expect(docs.close).toHaveBeenCalledOnce();
  });
});
