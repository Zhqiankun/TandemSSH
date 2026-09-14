import { describe, expect, it } from "vitest";
import { REDACTED, redact, redactString } from "../../ai/redaction.js";

describe("redact", () => {
  it("drops secret-named fields at any depth", () => {
    const input = {
      name: "web-1",
      password: "hunter2",
      nested: { privateKey: "abc", apiKey: "def", port: 22 },
      list: [{ keyPassword: "xyz", label: "ok" }],
    };

    const output = redact(input) as any;

    expect(output.name).toBe("web-1");
    expect(output.password).toBe(REDACTED);
    expect(output.nested.privateKey).toBe(REDACTED);
    expect(output.nested.apiKey).toBe(REDACTED);
    expect(output.nested.port).toBe(22);
    expect(output.list[0].keyPassword).toBe(REDACTED);
    expect(output.list[0].label).toBe("ok");
  });

  it("keeps a null secret null so absence stays distinguishable", () => {
    const output = redact({ password: null }) as any;
    expect(output.password).toBeNull();
  });

  it("leaves ordinary values untouched", () => {
    const input = { id: 4, enabled: true, tags: ["a", "b"], note: null };
    expect(redact(input)).toEqual(input);
  });

  it("does not recurse forever on a cyclic object", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
  });
});

describe("redactString", () => {
  it("masks private key blocks", () => {
    const text =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc123\n-----END OPENSSH PRIVATE KEY-----";
    expect(redactString(text)).toBe("[redacted private key]");
  });

  it("masks provider api keys", () => {
    expect(redactString("key is sk-abcdefghijklmnopqrst here")).toContain(
      "[redacted api key]",
    );
    expect(redactString("key is sk-ant-abcdefghijklmnopqrst here")).toContain(
      "[redacted api key]",
    );
  });

  it("masks bearer tokens and jwts", () => {
    expect(
      redactString("Authorization: Bearer abcdefghijklmnopqrst"),
    ).toContain("Bearer [redacted]");
    expect(
      redactString("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefgh"),
    ).toContain("[redacted token]");
  });

  it("masks Termix api keys", () => {
    expect(redactString("tmx_abcdefghijklmnopqrstuvwx")).toContain(
      "[redacted token]",
    );
  });

  it("leaves ordinary prose alone", () => {
    const text = "The disk on web-1 is 82 percent full.";
    expect(redactString(text)).toBe(text);
  });
});
it.each(Array.from({ length: 6 }, (_, i) => i + 1))(
  "redacts terminal-wrapped API key names split at %s",
  (index) => {
    const key = "api_key";
    const wrapped = key.slice(0, index) + "\r\r\n" + key.slice(index);
    const output = redactString(
      "prompt$ " + wrapped + "=fixture-desktop-secret; pwd",
    );
    expect(output).not.toContain("fixture-desktop-secret");
    expect(output).toContain("; pwd");
  },
);
it.each(["\r\n", "\r\r\n"])(
  "redacts an unquoted value spanning a terminal wrap %j",
  (wrap) => {
    expect(
      redactString("api_key=fixture-" + wrap + "desktop-secret; pwd"),
    ).toBe("api_key=[redacted]; pwd");
  },
);
it("preserves normal line breaks in non-secret output", () => {
  const text = "first\r\nsecond\r\r\nthird\n";
  expect(redactString(text)).toBe(text);
});
it.each(["api_key=", "--api-key "])(
  "redacts quoted and wrapped values after %s",
  (prefix) => {
    for (const quote of ['"', "'"]) {
      for (const wrap of ["\r\n", "\r\r\n"]) {
        expect(
          redactString(
            prefix +
              quote +
              "first part" +
              wrap +
              "second part" +
              quote +
              "; pwd",
          ),
        ).toBe(prefix + "[redacted]; pwd");
      }
    }
  },
);
it("redacts a wrapped CLI flag and its value", () => {
  expect(redactString("run --api-\r\r\nkey first\r\r\nsecond --verbose")).toBe(
    "run --api-\r\r\nkey [redacted] --verbose",
  );
});
it("does not expose a quoted value after an escaped double quote", () => {
  expect(redactString('password="first \\" second"; pwd')).toBe(
    "password=[redacted]; pwd",
  );
});
