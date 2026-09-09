import { afterEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { fileSftpFixture } from "../../test-helpers/file-sftp-fixture";
import {
  DownloadService,
  type DownloadPorts,
} from "../../files/download-service";
import { DownloadTreeService } from "../../files/download-tree-service";
import { DownloadRecoveryTickets } from "../../files/download-recovery-tickets";
import { DownloadBatchRecoveryTickets } from "../../files/download-batch-recovery-tickets";
const cleanup: Array<() => void | Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});
const actor = { userId: "owner" };
async function fixture() {
  const remote = await fileSftpFixture();
  cleanup.push(remote.close);
  let io = remote.io,
    peer = remote.peerKey();
  const ports: DownloadPorts = {
    target: async (user, session) => {
      if (user !== actor.userId || !["old", "new"].includes(session))
        throw Error("FILE_SESSION_UNAVAILABLE");
      return {
        io,
        key: "fixture",
        connection: session,
        acceptedHostKey: peer,
        check: () => {},
      };
    },
    audit: vi.fn(async () => {}),
  };
  const downloads = new DownloadService(ports),
    trees = new DownloadTreeService(ports, downloads),
    windows = new DownloadRecoveryTickets(downloads, () => true),
    tickets = new DownloadBatchRecoveryTickets(trees, downloads, windows),
    token = randomUUID();
  windows.bind(token);
  cleanup.push(
    () => downloads.dispose(),
    () => trees.dispose(),
    () => windows.close(token),
  );
  const tree = await trees.scan(actor, { sessionId: "old", paths: ["/目录"] }),
    entry = tree.entries.find((e) => e.kind === "file")!,
    source = await trees.prepareEntry(
      actor,
      tree.id,
      entry.id,
      randomUUID(),
      "old",
    );
  await downloads.pause(actor, source.id);
  return {
    remote,
    ports,
    downloads,
    trees,
    windows,
    tickets,
    token,
    tree,
    entry,
    source,
    reconnect: async () => {
      io = (await remote.reconnect()).io;
    },
    changePeer: () => {
      peer = "SHA256:changed";
    },
  };
}
it("issues only authenticated fixed-tree source snapshots and consumes a ticket once", async () => {
  const f = await fixture(),
    ticket = f.tickets.issue(actor.userId, {
      windowToken: f.token,
      kind: "save",
      treeId: f.tree.id,
      sources: [{ entryId: f.entry.id, sourceId: f.source.id }],
    });
  expect(() => f.tickets.claim(randomUUID(), ticket.ticketId)).toThrow(
    "DOWNLOAD_BATCH_TICKET_INVALID",
  );
  const claimed = f.tickets.claim(f.token, ticket.ticketId);
  expect(claimed.source?.members[0].source.sha256).toBe(f.source.sha256);
  expect(claimed.source?.tree.entries.map((e) => e.view.id)).toEqual(
    f.tree.entries.map((e) => e.id),
  );
  expect(() => f.tickets.claim(f.token, ticket.ticketId)).toThrow(
    "DOWNLOAD_BATCH_TICKET_USED",
  );
  await f.tickets.done(f.token, ticket.ticketId, true);
  expect(() => f.downloads.get(actor, f.source.id)).toThrow(
    "DOWNLOAD_NOT_FOUND",
  );
  expect(() => f.trees.get(actor, f.tree.id)).toThrow("DOWNLOAD_NOT_FOUND");
});
it("restores the fixed tree and member on a new SSH connection without directory rescanning", async () => {
  const f = await fixture(),
    tree = f.trees.checkpoint(actor, f.tree.id),
    source = f.downloads.checkpoint(actor, f.source.id);
  await f.remote.write("/目录/新增.txt", "not in the snapshot");
  await f.reconnect();
  const ticket = f.tickets.issue(actor.userId, {
    windowToken: f.token,
    kind: "restore",
    sessionId: "new",
  });
  f.tickets.claim(f.token, ticket.ticketId);
  const reads = f.remote.directoryReads(),
    restored = await f.tickets.restoreTree(f.token, ticket.ticketId, tree);
  expect(restored.entries).toEqual(f.tree.entries);
  expect(f.remote.directoryReads()).toBe(reads);
  const file = await f.tickets.restoreSource(
    f.token,
    ticket.ticketId,
    f.entry.id,
    source,
  );
  expect(file.sha256).toBe(f.source.sha256);
  expect(
    f.tickets.proof(f.token, ticket.ticketId, f.entry.id, file.id)
      .canonicalPath,
  ).toBe(f.entry.path);
  await f.tickets.done(f.token, ticket.ticketId);
  expect(() => f.downloads.get(actor, file.id)).toThrow("DOWNLOAD_NOT_FOUND");
});
it("rejects other users, injected snapshot fields and wrong source members", async () => {
  const f = await fixture();
  expect(() =>
    f.tickets.issue("other", {
      windowToken: f.token,
      kind: "save",
      treeId: f.tree.id,
    }),
  ).toThrow("DOWNLOAD_NOT_FOUND");
  expect(() =>
    f.tickets.issue(actor.userId, {
      windowToken: f.token,
      kind: "restore",
      sessionId: "new",
      source: { userId: "other" },
    }),
  ).toThrow();
  expect(() =>
    f.tickets.issue(actor.userId, {
      windowToken: f.token,
      kind: "save",
      treeId: f.tree.id,
      sources: [{ entryId: randomUUID(), sourceId: f.source.id }],
    }),
  ).toThrow("DOWNLOAD_BATCH_MEMBER_INVALID");
});
it("rejects changed server identity and revokes tickets with their window", async () => {
  const f = await fixture(),
    tree = f.trees.checkpoint(actor, f.tree.id),
    ticket = f.tickets.issue(actor.userId, {
      windowToken: f.token,
      kind: "restore",
      sessionId: "new",
    });
  f.tickets.claim(f.token, ticket.ticketId);
  f.changePeer();
  await expect(
    f.tickets.restoreTree(f.token, ticket.ticketId, tree),
  ).rejects.toThrow("DOWNLOAD_HOST_IDENTITY_CHANGED");
  f.windows.close(f.token);
  expect(() => f.tickets.claim(f.token, ticket.ticketId)).toThrow(
    "DOWNLOAD_BATCH_TICKET_INVALID",
  );
});
