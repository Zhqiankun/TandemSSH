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
