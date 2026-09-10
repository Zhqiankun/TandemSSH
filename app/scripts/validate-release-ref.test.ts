import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateReleaseRef } = require("./validate-release-ref.cjs");
describe("release source identity", () => {
  it("accepts a stable tag only when its commit and package version match", () => {
    for (const ref of ["v1.2.3", "refs/tags/v1.2.3"])
      expect(validateReleaseRef(ref, "1.2.3", () => "same-commit")).toBe(
        "v1.2.3",
      );
  });
  it("rejects a same-named branch, unstable tag and a package mismatch", () => {
    for (const ref of [
      "refs/heads/v1.2.3",
      "v1.2.3-alpha.1",
      "v01.2.3",
      "main",
    ])
      expect(() => validateReleaseRef(ref, "1.2.3", () => "same")).toThrow();
    expect(() => validateReleaseRef("v1.2.4", "1.2.3", () => "same")).toThrow(
      "Tag and package version differ",
    );
  });
  it("rejects a checkout containing code outside the published tag", () => {
    expect(() =>
      validateReleaseRef("v1.2.3", "1.2.3", (ref: string) =>
        ref === "HEAD" ? "new-commit" : "tagged-commit",
      ),
    ).toThrow("Checkout does not match");
  });
});

it("allows an alpha preview only through its explicit channel", () => {
  expect(
    validateReleaseRef(
      "refs/tags/v0.1.0-alpha.0",
      "0.1.0-alpha.0",
      () => "same",
      "preview",
    ),
  ).toBe("v0.1.0-alpha.0");
  for (const ref of [
    "v0.1.0",
    "v0.1.0-beta.1",
    "v0.1.0-alpha.01",
    "refs/heads/v0.1.0-alpha.0",
  ])
    expect(() =>
      validateReleaseRef(ref, ref.slice(1), () => "same", "preview"),
    ).toThrow();
  expect(() =>
    validateReleaseRef("v0.1.0-alpha.0", "0.1.0-alpha.0", () => "same"),
  ).toThrow();
});
it("keeps version and checkout verification mandatory for previews", () => {
  expect(() =>
    validateReleaseRef(
      "v0.1.0-alpha.1",
      "0.1.0-alpha.0",
      () => "same",
      "preview",
    ),
  ).toThrow("Tag and package version differ");
  expect(() =>
    validateReleaseRef(
      "v0.1.0-alpha.0",
      "0.1.0-alpha.0",
      (ref: string) => (ref === "HEAD" ? "new" : "tagged"),
      "preview",
    ),
  ).toThrow("Checkout does not match");
  expect(() =>
    validateReleaseRef("v0.1.0", "0.1.0", () => "same", "unknown"),
  ).toThrow("Unknown release channel");
});
