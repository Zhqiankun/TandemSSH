import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DocumentService,
  DocumentError,
  type DocumentActor,
} from "../../files/document-service";
import { decodeDocument, encodeDocument } from "../../files/encoding";
import { HostFileFence } from "../../collaboration/sessions/host-file-fence";
import type { RemoteFileIO, RemoteFileSnapshot } from "../../files/ports";
const actor: DocumentActor = { userId: "owner", source: "human" };
const services: DocumentService[] = [];
afterEach(() => services.splice(0).forEach((s) => s.dispose()));
const deferred = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
};
function fixture(text = "original") {
  const files = new Map<string, RemoteFileSnapshot>(),
    links = new Map<string, string>();
  const put = (p: string, text: string | Buffer) => {
    const bytes = Buffer.isBuffer(text) ? Buffer.from(text) : Buffer.from(text);
    files.set(p, {
      bytes,
      stat: {
        size: bytes.length,
        mtime: 100,
        atime: 100,
        mode: 0o100640,
        uid: 1000,
        gid: 1000,
        kind: "file",
      },
    });
  };
  put("/file", text);
  let connection = "one",
    allowed = true,
    leases = 0;
  const fence = new HostFileFence();
  const io: RemoteFileIO = {
    resolve: async (p) => links.get(p) ?? p,
    stat: async (p) => {
      const file = files.get(p);
      if (!file) throw new DocumentError("FILE_NOT_FOUND");
      return { ...file.stat };
    },
    snapshot: async (p, max, guard) => {
      guard?.();
      const f = files.get(p);
      if (!f) throw new DocumentError("FILE_NOT_FOUND");
      if (f.bytes.length > max) throw new DocumentError("FILE_TOO_LARGE");
      return { bytes: Buffer.from(f.bytes), stat: { ...f.stat } };
    },
    createExclusive: vi.fn(async (p, bytes, meta, guard) => {
      guard();
      if (files.has(p)) throw new DocumentError("FILE_ALREADY_EXISTS");
      put(p, bytes);
      if (meta)
        Object.assign(files.get(p)!.stat, {
          mode: meta.mode,
          uid: meta.uid,
          gid: meta.gid,
        });
    }),
    replace: vi.fn(async (from, to, overwrite, guard) => {
      guard();
      if (!overwrite && files.has(to))
        throw new DocumentError("FILE_ALREADY_EXISTS");
      files.set(to, files.get(from)!);
      files.delete(from);
      return { atomic: true };
    }),
  };
  const audit = vi.fn(async () => {}),
    end = vi.fn();
  const service = new DocumentService({
    target: async (a) => ({
      key: "host",
      connection,
      io,
      acceptedHostKey: "SHA256:trusted",
      hostScope: { userId: a.userId, hostId: 1, identity: "test@host:22" },
      retain: () => {
        leases++;
        return () => {
          leases--;
        };
      },
      check: () => {
        if (!allowed || a.signal?.aborted)
          throw new DocumentError("FILE_REQUEST_CANCELLED");
      },
    }),
    audit,
    beginWrite: (a, t) => {
      const release = fence.acquire(t.hostScope!);
      return () => {
        release();
        end();
      };
    },
  });
  services.push(service);
  const read = () => service.read(actor, "session", "/file", undefined, true);
  return {
    service,
    files,
    links,
    put,
    io,
    audit,
    end,
    fence,
    read,
    leases: () => leases,
    setConnection: (c: string) => {
      connection = c;
    },
    cancel: () => {
      allowed = false;
    },
  };
}
function input(version: string, content = "changed") {
  return {
    sessionId: "session",
    path: "/file",
    version,
    content,
    requestId: crypto.randomUUID(),
  };
}
describe("lossless file text", () => {
  it.each(["test", "", "汉化\r\n下一行\r\n"])(
    "does not guess base64: %s",
    (text) => {
      const d = decodeDocument(Buffer.from(text));
      expect(d.text).toBe(text);
      expect(
        encodeDocument(text, d.format!).bytes.equals(Buffer.from(text)),
      ).toBe(true);
    },
  );
  it.each(["utf8", "utf16le", "utf16be", "gbk", "gb18030"] as const)(
    "roundtrips %s",
    (charset) => {
      const f = {
          charset,
          bom: charset.startsWith("utf"),
          lineEnding: "crlf" as const,
        },
        encoded = encodeDocument("中文\n第二行", f);
      const decoded = decodeDocument(encoded.bytes, charset);
      expect(decoded.text).toBe("中文\r\n第二行");
      expect(decoded.format).toEqual(f);
    },
  );
  it("requires a choice for mixed endings and rejects lossy encoding", () => {
    expect(decodeDocument(Buffer.from("a\nb\r\nc")).format?.lineEnding).toBe(
      "mixed",
    );
    expect(() =>
      encodeDocument("x", { charset: "utf8", bom: false, lineEnding: "mixed" }),
    ).toThrow("FILE_LINE_ENDING_CHOICE_REQUIRED");
    expect(() =>
      encodeDocument("😀", { charset: "gbk", bom: false, lineEnding: "lf" }),
    ).toThrow("FILE_ENCODING_LOSSY");
    expect(decodeDocument(Buffer.from([0, 1, 2])).reason).toBe("binary");
  });
});
describe("versioned file commits", () => {
  it("saves an empty file, preserves mode, and holds one document lease across revisions", async () => {
    const f = fixture(),
      base = await f.read();
    const result = await f.service.save(
      actor,
      input(base.document.version, ""),
    );
    expect(f.files.get("/file")!.bytes.length).toBe(0);
    expect(result.document.mode).toBe(0o640);
    expect(result.document.documentId).toBe(base.document.documentId);
    expect(f.leases()).toBe(1);
    f.service.close(actor, result.document.documentId);
    expect(f.leases()).toBe(0);
    await expect(
      f.service.save(actor, input(result.document.version)),
    ).rejects.toThrow("FILE_BASELINE_EXPIRED");
  });
  it("detects a content conflict even when size and mtime match; keeps the local draft out of audit", async () => {
    const f = fixture(),
      base = await f.read();
    f.put("/file", "modified");
    expect(f.files.get("/file")!.stat.size).toBe(base.document.size);
    let failure: DocumentError | undefined;
    try {
      await f.service.save(
        actor,
        input(base.document.version, "TOP_SECRET_DRAFT"),
      );
    } catch (e) {
      failure = e as DocumentError;
    }
    expect(failure?.message).toBe("FILE_CONFLICT");
    expect(failure?.details.latest?.content).toBe("modified");
    expect(f.io.replace).not.toHaveBeenCalled();
    expect(JSON.stringify(f.audit.mock.calls)).not.toContain(
      "TOP_SECRET_DRAFT",
    );
    expect(f.leases()).toBe(1);
  });
  it("deduplicates identical save requests, rejects changed requests and cross-owner baselines", async () => {
    const f = fixture(),
      base = await f.read(),
      request = input(base.document.version);
    const [one, two] = await Promise.all([
      f.service.save(actor, request),
      f.service.save(actor, request),
    ]);
    expect(one).toEqual(two);
    expect(f.io.replace).toHaveBeenCalledTimes(1);
    await expect(
      f.service.save(actor, { ...request, content: "different" }),
    ).rejects.toThrow("REQUEST_CONFLICT");
    await expect(
      f.service.save(
        { ...actor, userId: "other" },
        input(one.document.version),
      ),
    ).rejects.toThrow("FILE_BASELINE_EXPIRED");
  });
  it("rejects concurrent saves to the same target and fences task authorization until completion", async () => {
    const f = fixture(),
      base = await f.read(),
      gate = deferred(),
      entered = deferred(),
      original = f.io.createExclusive;
    f.io.createExclusive = async (...args) => {
      entered.release();
      await gate.promise;
      return original(...args);
    };
    const pending = f.service.save(actor, input(base.document.version));
    await entered.promise;
    expect(() =>
      f.fence.assertAvailable({ userId: "owner", hostId: 1 }),
    ).toThrow("HOST_FILE_OPERATION_ACTIVE");
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toThrow("FILE_BUSY");
    gate.release();
    await pending;
    expect(() =>
      f.fence.assertAvailable({ userId: "owner", hostId: 1 }),
    ).not.toThrow();
  });
  it("rechecks the original after staging and never truncates on failure", async () => {
    const f = fixture(),
      base = await f.read(),
      original = f.io.createExclusive;
    f.io.createExclusive = async (...args) => {
      await original(...args);
      f.put("/file", "external");
    };
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toMatchObject({
      message: "FILE_CONFLICT",
      details: {
        temporaryPath: expect.stringContaining(".tandem-save-"),
        commitMayHaveOccurred: false,
      },
    });
    expect(f.files.get("/file")!.bytes.toString()).toBe("external");
    expect(f.io.replace).not.toHaveBeenCalled();
  });
  it("stops after editor close and releases the host fence", async () => {
    const f = fixture(),
      base = await f.read(),
      original = f.io.createExclusive;
    f.io.createExclusive = async (...args) => {
      await original(...args);
      f.service.close(actor, base.document.documentId);
    };
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toThrow("FILE_BASELINE_EXPIRED");
    expect(f.files.get("/file")!.bytes.toString()).toBe("original");
    expect(f.end).toHaveBeenCalledOnce();
  });
  it("retains original and reports staged file when permissions or replacement support fail", async () => {
    for (const code of [
      "FILE_PERMISSION_DENIED",
      "FILE_ATOMIC_REPLACE_UNSUPPORTED",
    ]) {
      const f = fixture(),
        base = await f.read();
      f.io.replace = async () => {
        throw new DocumentError(code, { commitMayHaveOccurred: false });
      };
      await expect(
        f.service.save(actor, input(base.document.version)),
      ).rejects.toMatchObject({
        message: code,
        details: {
          commitMayHaveOccurred: false,
          temporaryPath: expect.any(String),
        },
      });
      expect(f.files.get("/file")!.bytes.toString()).toBe("original");
    }
  });
  it("keeps unknown commit status after the server replaces a file but loses the response", async () => {
    const f = fixture(),
      base = await f.read(),
      original = f.io.replace;
    f.io.replace = async (...args) => {
      await original(...args);
      throw new DocumentError("FILE_IO_TIMEOUT");
    };
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toMatchObject({ details: { commitMayHaveOccurred: true } });
    expect(f.files.get("/file")!.bytes.toString()).toBe("changed");
  });
  it("refuses connection changes and symbolic-link retargeting", async () => {
    const f = fixture(),
      base = await f.read();
    f.setConnection("two");
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toThrow("FILE_CONNECTION_CHANGED");
    f.setConnection("one");
    f.put("/other", "other");
    f.links.set("/file", "/other");
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toThrow("FILE_TARGET_CHANGED");
    expect(f.io.createExclusive).not.toHaveBeenCalled();
  });
  it("creates only a non-existing save-as destination without changing the original", async () => {
    const f = fixture(),
      base = await f.read();
    await expect(
      f.service.save(actor, {
        ...input(base.document.version),
        saveAs: "/file",
      }),
    ).rejects.toThrow("FILE_ALREADY_EXISTS");
    const r = await f.service.save(actor, {
      ...input(base.document.version),
      saveAs: "/new",
    });
    expect(r.document.path).toBe("/new");
    expect(f.files.get("/file")!.bytes.toString()).toBe("original");
    expect(f.files.get("/new")!.bytes.toString()).toBe("changed");
  });
  it("aborts before a later write when cancellation arrives during staging", async () => {
    const f = fixture(),
      base = await f.read(),
      original = f.io.createExclusive;
    f.io.createExclusive = async (...args) => {
      await original(...args);
      f.cancel();
    };
    await expect(
      f.service.save(actor, input(base.document.version)),
    ).rejects.toThrow("FILE_REQUEST_CANCELLED");
    expect(f.io.replace).not.toHaveBeenCalled();
  });
});

it("binds drafts to the human editor baseline and accepted server key", async () => {
  const f = fixture("original\r\n"),
    opened = await f.read();
  const context = await f.service.draftContext(
    actor,
    "session",
    opened.document.version,
    "original\n",
  );
  expect(context.binding).toMatchObject({
    userId: "owner",
    acceptedHostKey: "SHA256:trusted",
    hostIdentity: "test@host:22",
    path: "/file",
  });
  await expect(
    f.service.draftContext(
      actor,
      "session",
      opened.document.version,
      "wrong original",
    ),
  ).rejects.toThrow("FILE_DRAFT_BASE_CHANGED");
  await expect(
    f.service.draftContext(
      { ...actor, userId: "other" },
      "session",
      opened.document.version,
    ),
  ).rejects.toThrow("FILE_VERSION_EXPIRED");
  await expect(
    f.service.draftContext(
      { ...actor, source: "mcp", taskId: "task" },
      "session",
      opened.document.version,
    ),
  ).rejects.toThrow("TRUSTED_UI_REQUIRED");
  f.setConnection("new");
  await expect(
    f.service.draftContext(actor, "session", opened.document.version),
  ).rejects.toThrow("FILE_CONNECTION_CHANGED");
  f.setConnection("one");
  f.service.close(actor, opened.document.documentId);
  await expect(
    f.service.draftContext(actor, "session", opened.document.version),
  ).rejects.toThrow("FILE_VERSION_EXPIRED");
  expect(f.io.createExclusive).not.toHaveBeenCalled();
});
