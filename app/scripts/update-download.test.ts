import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { createServer, request } from "node:http";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  HttpExecutor,
  CancellationToken,
  configureRequestUrl,
} from "builder-util-runtime";
import type { DownloadOptions } from "builder-util-runtime";
const require = createRequire(import.meta.url);
const { NsisUpdater } = require("electron-updater/out/NsisUpdater.js");
const { UpdateService, FEED_URL } = require("../electron/update-service.cjs");
const cache = path.resolve("../.cache");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

/** Uses the real updater downloader and digest stream; only HTTP routing is local. */
class FixtureHttp extends HttpExecutor<ClientRequest> {
  constructor(private readonly port: number) {
    super();
  }
  createRequest(
    options: RequestOptions,
    callback: (response: IncomingMessage) => void,
  ) {
    if (
      (options.hostname ?? options.host) !== "github.com" ||
      !options.path?.startsWith("/Zhqiankun/TandemSSH/releases/")
    )
      throw Error("Unexpected update destination");
    return request(
      {
        ...options,
        protocol: "http:",
        hostname: "127.0.0.1",
        host: "127.0.0.1",
        port: this.port,
        agent: false,
      },
      callback,
    );
  }
  download(
    url: URL,
    destination: string,
    options: DownloadOptions,
  ): Promise<string> {
    return options.cancellationToken.createPromise(
      (resolve, reject, onCancel) => {
        const requestOptions: RequestOptions = {
          headers: options.headers ?? undefined,
        };
        configureRequestUrl(url, requestOptions);
        this.doDownload(
          requestOptions,
          {
            destination,
            options,
            onCancel,
            callback: (error) => (error ? reject(error) : resolve(destination)),
            responseHandler: null,
          },
          0,
        );
      },
    );
  }
}
async function fixture({
  corrupt = false,
  slow = false,
  version = "0.1.0",
} = {}) {
  await mkdir(cache, { recursive: true });
  const root = await mkdtemp(path.join(cache, "update-download-"));
  cleanup.push(async () => {
    if (
      path.dirname(root) !== cache ||
      !path.basename(root).startsWith("update-download-")
    )
      throw Error("Invalid test cleanup path");
    await rm(root, { recursive: true, force: true });
  });
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x6b),
    wire = Buffer.from(bytes);
  if (corrupt) wire[123] ^= 1;
  const artifact = `/Zhqiankun/TandemSSH/releases/download/v${version}/TandemSSH-${version}-x64.exe`;
  const manifest = {
    version,
    files: [
      {
        url: "https://github.com" + artifact,
        size: bytes.length,
        sha512: createHash("sha512").update(bytes).digest("base64"),
      },
    ],
  };
  let binaryRequests = 0,
    firstBinary!: () => void;
  const binaryStarted = new Promise<void>((resolve) => {
    firstBinary = resolve;
  });
  const server = createServer((req, res) => {
    const pathname = new URL(req.url!, "http://127.0.0.1").pathname;
    if (pathname === new URL(FEED_URL).pathname + "latest.yml") {
      res.writeHead(200, { "Content-Type": "application/yaml" });
      res.end(JSON.stringify(manifest));
    } else if (pathname === artifact) {
      binaryRequests++;
      res.writeHead(200, {
        "Content-Length": wire.length,
        "Content-Type": "application/octet-stream",
      });
      if (!slow) {
        res.end(wire);
        firstBinary();
        return;
      }
      let offset = 64 * 1024;
      res.write(wire.subarray(0, offset));
      firstBinary();
      const timer = setInterval(() => {
        res.write(wire.subarray(offset, offset + 64 * 1024));
        offset += 64 * 1024;
        if (offset >= wire.length) {
          clearInterval(timer);
          res.end();
        }
      }, 5);
      res.once("close", () => clearInterval(timer));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw Error("Fixture listener missing");
  const config = path.join(root, "app-update.yml");
  await writeFile(config, "updaterCacheDirName: cache\n");
  const app = {
    name: "TandemSSH",
    version: "0.1.0-alpha.0",
    isPackaged: true,
    appUpdateConfigPath: config,
    userDataPath: root,
    baseCachePath: root,
    whenReady: async () => {},
    quit: vi.fn(),
    relaunch: vi.fn(),
    onQuit: vi.fn(),
  };
  const updater = new NsisUpdater(undefined, app);
  updater.httpExecutor = new FixtureHttp(address.port);
  const service = new UpdateService({
    currentVersion: app.version,
    packaged: true,
    installed: true,
    resolveFeed: async () => FEED_URL,
    loadUpdater: () => ({ autoUpdater: updater, CancellationToken }),
    openRelease: async () => {},
  });
  return {
    service,
    updater,
    app,
    bytes,
    binaryStarted,
    binaryRequests: () => binaryRequests,
  };
}

describe("real updater HTTP download", () => {
  it("downloads and verifies a newer alpha without requiring a stable release", async () => {
    const f = await fixture({ version: "0.1.0-alpha.2" });
    expect(await f.service.check()).toMatchObject({
      status: "available",
      latestVersion: "0.1.0-alpha.2",
    });
    expect(await f.service.download()).toMatchObject({ status: "downloaded" });
    expect((await readFile(f.updater.installerPath)).equals(f.bytes)).toBe(
      true,
    );
  });
  it("compares versions and verifies downloaded bytes before offering installation", async () => {
    const f = await fixture();
    expect(await f.service.check()).toMatchObject({
      status: "available",
      currentVersion: "0.1.0-alpha.0",
      latestVersion: "0.1.0",
    });
    expect(f.binaryRequests()).toBe(0);
    expect(await f.service.download()).toMatchObject({ status: "downloaded" });
    expect((await readFile(f.updater.installerPath)).equals(f.bytes)).toBe(
      true,
    );
    expect(f.binaryRequests()).toBe(1);
    expect(f.app.quit).not.toHaveBeenCalled();
    expect(f.app.onQuit).not.toHaveBeenCalled();
    await f.service.download();
    expect(f.binaryRequests()).toBe(1);
  });
  it("rejects a changed installer body using the real SHA-512 verifier", async () => {
    const f = await fixture({ corrupt: true });
    expect((await f.service.check()).status).toBe("available");
    expect(await f.service.download()).toMatchObject({
      status: "error",
      error: "UPDATE_DOWNLOAD_FAILED",
    });
    expect(f.updater.installerPath).toBeNull();
    await expect(f.service.install()).rejects.toThrow("UPDATE_NOT_DOWNLOADED");
    expect(f.app.quit).not.toHaveBeenCalled();
  });
  it("cancels a streamed download and retries to a fully verified file", async () => {
    const f = await fixture({ slow: true });
    await f.service.check();
    const downloading = f.service.download();
    await f.binaryStarted;
    f.service.cancel();
    expect(await downloading).toMatchObject({ status: "available" });
    expect(f.updater.installerPath).toBeNull();
    expect(await f.service.download()).toMatchObject({ status: "downloaded" });
    expect((await readFile(f.updater.installerPath)).equals(f.bytes)).toBe(
      true,
    );
    expect(f.binaryRequests()).toBe(2);
    expect(f.app.quit).not.toHaveBeenCalled();
  });
});
