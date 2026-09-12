import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { copyToClipboard, readFromClipboard } from "../../lib/clipboard";

describe("copyToClipboard", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    delete (window as { electronClipboard?: unknown }).electronClipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", {
      value,
      configurable: true,
    });
  }

  it("uses the electron bridge when present", async () => {
    const writeText = vi.fn().mockResolvedValue(true);
    (window as { electronClipboard?: unknown }).electronClipboard = {
      writeText,
      readText: vi.fn(),
    };

    const ok = await copyToClipboard("hello");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("uses navigator.clipboard when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });

    const ok = await copyToClipboard("world");

    expect(ok).toBe(true);
    expect(writeText).toHaveBeenCalledWith("world");
  });

  it("falls back to execCommand when navigator.clipboard is undefined (Brave / non-HTTPS)", async () => {
    setClipboard(undefined);
    const execCommand = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand =
      execCommand;

    const ok = await copyToClipboard("fallback");

    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back to execCommand when the async write throws", async () => {
    setClipboard({
      writeText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    const execCommand = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: typeof execCommand }).execCommand =
      execCommand;

    const ok = await copyToClipboard("retry");

    expect(ok).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("returns false when every approach fails", async () => {
    setClipboard(undefined);
    (document as unknown as { execCommand: () => boolean }).execCommand =
      () => {
        throw new Error("no execCommand");
      };

    const ok = await copyToClipboard("nope");

    expect(ok).toBe(false);
  });
});

describe("readFromClipboard", () => {
  const originalClipboard = navigator.clipboard;

  beforeEach(() => {
    delete (window as { electronClipboard?: unknown }).electronClipboard;
  });

  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
    vi.restoreAllMocks();
  });

  function setClipboard(value: unknown) {
    Object.defineProperty(navigator, "clipboard", {
      value,
      configurable: true,
    });
  }

  it("uses the electron bridge when present", async () => {
    const readText = vi.fn().mockResolvedValue("hello");
    (window as { electronClipboard?: unknown }).electronClipboard = {
      writeText: vi.fn(),
      readText,
    };

    const text = await readFromClipboard();

    expect(text).toBe("hello");
    expect(readText).toHaveBeenCalled();
  });

  it("uses navigator.clipboard when available", async () => {
    const readText = vi.fn().mockResolvedValue("world");
    setClipboard({ readText });

    const text = await readFromClipboard();

    expect(text).toBe("world");
    expect(readText).toHaveBeenCalled();
  });

  it("falls back to execCommand when navigator.clipboard.readText is undefined (non-HTTPS)", async () => {
    setClipboard({});
    const execCommand = vi.fn().mockImplementation((command: string) => {
      if (command === "paste") {
        const active = document.activeElement as HTMLTextAreaElement;
        active.value = "fallback";
        return true;
      }
      return false;
    });
    (document as unknown as { execCommand: typeof execCommand }).execCommand =
      execCommand;

    const text = await readFromClipboard();

    expect(text).toBe("fallback");
    expect(execCommand).toHaveBeenCalledWith("paste");
  });

  it("falls back to execCommand when the async read throws", async () => {
    setClipboard({
      readText: vi.fn().mockRejectedValue(new Error("denied")),
    });
    const execCommand = vi.fn().mockImplementation((command: string) => {
      if (command === "paste") {
        const active = document.activeElement as HTMLTextAreaElement;
        active.value = "retry";
        return true;
      }
      return false;
    });
    (document as unknown as { execCommand: typeof execCommand }).execCommand =
      execCommand;

    const text = await readFromClipboard();

    expect(text).toBe("retry");
    expect(execCommand).toHaveBeenCalledWith("paste");
  });

  it("returns an empty string when every approach fails", async () => {
    setClipboard({});
    (document as unknown as { execCommand: () => boolean }).execCommand = () =>
      false;

    const text = await readFromClipboard();

    expect(text).toBe("");
  });
});

describe("legacy clipboard temporary DOM lifecycle", () => {
  it.each(["copy", "paste"])(
    "removes its own textarea when %s throws and preserves existing inputs",
    async (operation) => {
      const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
      const originalCommand = Object.getOwnPropertyDescriptor(
        document,
        "execCommand",
      );
      const bridge = window.electronClipboard;
      const existing = document.createElement("textarea");
      existing.value = "existing draft";
      document.body.appendChild(existing);
      delete window.electronClipboard;
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      Object.defineProperty(document, "execCommand", {
        configurable: true,
        value: () => {
          expect(document.querySelectorAll("textarea")).toHaveLength(2);
          throw Error("clipboard unavailable");
        },
      });
      try {
        const result =
          operation === "copy"
            ? await copyToClipboard("/中文 ' quoted/secret-path")
            : await readFromClipboard();
        expect(result).toBe(operation === "copy" ? false : "");
        expect([...document.querySelectorAll("textarea")]).toEqual([existing]);
        expect(existing.value).toBe("existing draft");
      } finally {
        existing.remove();
        if (original) Object.defineProperty(navigator, "clipboard", original);
        else Reflect.deleteProperty(navigator, "clipboard");
        if (originalCommand)
          Object.defineProperty(document, "execCommand", originalCommand);
        else Reflect.deleteProperty(document, "execCommand");
        if (bridge) window.electronClipboard = bridge;
      }
    },
  );
});
