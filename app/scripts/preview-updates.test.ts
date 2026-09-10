import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  selectPreviewFeed,
  discoverUpdateFeed,
  ATOM_URL,
} = require("../electron/update-feed.cjs");
const {
  UpdateCheckSchedule,
  CHECK_INTERVAL_MS,
} = require("../electron/update-schedule.cjs");
const { validateUpdateInfo } = require("../electron/update-service.cjs");
const { createHash } = require("node:crypto");
const prefix = "https://github.com/Zhqiankun/TandemSSH/releases/";
const feed = (tags: string[]) =>
  "<feed>" +
  tags.map((t) => `<entry><link href="${prefix}tag/${t}"/></entry>`).join("") +
  "</feed>";
afterEach(() => vi.useRealTimers());
describe("preview update discovery", () => {
  it("selects the highest compatible version instead of feed publication order", () => {
    expect(
      selectPreviewFeed(
        feed(["v0.1.0-alpha.0", "v0.1.0-alpha.2", "v0.1.0-alpha.1"]),
        "0.1.0-alpha.1",
      ),
    ).toBe(prefix + "download/v0.1.0-alpha.2/");
    expect(selectPreviewFeed(feed(["v0.1.0", "v0.2.0-alpha.1"]), "0.1.0")).toBe(
      prefix + "download/v0.1.0/",
    );
    expect(
      selectPreviewFeed(feed(["v0.1.0", "v0.1.0-alpha.2"]), "0.1.0-alpha.1"),
    ).toBe(prefix + "download/v0.1.0/");
  });
  it("ignores foreign URLs and unsupported tags", () => {
    const xml = feed(["v01.0.0", "v9.0.0-beta.1", "v1.0.0?other=1"]).replace(
      "</feed>",
      '<entry><link href="https://other.invalid/Zhqiankun/TandemSSH/releases/tag/v9.0.0"/></entry></feed>',
    );
    expect(() => selectPreviewFeed(xml, "0.1.0-alpha.1")).toThrow(
      "UPDATE_NOT_PUBLISHED",
    );
  });
  it("bounds the downloaded feed before XML parsing and uses a fixed endpoint", async () => {
    const fetcher = vi.fn(async () => new Response(feed(["v0.1.0-alpha.1"])));
    expect(await discoverUpdateFeed("0.1.0-alpha.0", fetcher)).toBe(
      prefix + "download/v0.1.0-alpha.1/",
    );
    expect(fetcher).toHaveBeenCalledWith(
      ATOM_URL,
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        credentials: "omit",
      }),
    );
    await expect(
      discoverUpdateFeed(
        "0.1.0-alpha.0",
        async () => new Response("x".repeat(1024 * 1024 + 1)),
      ),
    ).rejects.toThrow("UPDATE_METADATA_INVALID");
  });
  it("validates alpha installer metadata with the same repository and digest rules", () => {
    const version = "0.1.0-alpha.2",
      info = {
        version,
        files: [
          {
            url:
              prefix +
              "download/v" +
              version +
              "/TandemSSH-" +
              version +
              "-x64.exe",
            size: 2 * 1024 * 1024,
            sha512: createHash("sha512").update("fixture").digest("base64"),
          },
        ],
      };
    expect(validateUpdateInfo(info).version).toBe(version);
    expect(() =>
      validateUpdateInfo({ ...info, version: "0.1.0-alpha.3" }),
    ).toThrow("UPDATE_METADATA_INVALID");
  });
});
describe("main-process twenty-minute update checks", () => {
  it("checks after startup and every twenty minutes without duplicate schedules", async () => {
    vi.useFakeTimers();
    const check = vi.fn(async () => {}),
      schedule = new UpdateCheckSchedule(check);
    schedule.setEnabled(true);
    schedule.setEnabled(true);
    await vi.advanceTimersByTimeAsync(4999);
    expect(check).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    schedule.dispose();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(check).toHaveBeenCalledTimes(2);
  });
  it("does not overlap slow checks or restart after being disabled", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const check = vi.fn(
        () => new Promise<void>((resolve) => (finish = resolve)),
      ),
      schedule = new UpdateCheckSchedule(check);
    schedule.setEnabled(true);
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(check).toHaveBeenCalledOnce();
    schedule.setEnabled(false);
    finish();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledOnce();
    expect(schedule.snapshot().automaticChecks).toBe(false);
  });
});
