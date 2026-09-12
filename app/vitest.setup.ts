import { mkdirSync } from "node:fs";
import path from "node:path";
import { afterEach, vi } from "vitest";

// Fixtures use this workspace-owned root; a clean checkout must not depend
// on another test happening to create it first.
mkdirSync(path.resolve(process.cwd(), "../.cache"), { recursive: true });

if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});
