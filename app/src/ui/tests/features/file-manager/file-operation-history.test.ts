import { expect, it } from "vitest";
import {
  fileActionReceipt,
  type SuccessfulFileAction,
} from "../../../features/file-manager/file-operation-history";
it("records only acknowledged destinations when an earlier item fails", async () => {
  const receipts: SuccessfulFileAction[] = [];
  const perform = async (path: string) => {
    if (path === "/source/failed") throw Error("denied");
    return "copied-name.txt";
  };
  for (const path of ["/source/failed", "/source/actual"]) {
    try {
      const name = await perform(path);
      receipts.push(fileActionReceipt(path, "/target/", name));
    } catch {
      /* retain no undo action for failed work */
    }
  }
  expect(receipts).toEqual([
    {
      originalPath: "/source/actual",
      targetPath: "/target/copied-name.txt",
      targetName: "copied-name.txt",
    },
  ]);
});
it("preserves literal destination names and root destinations", () => {
  expect(fileActionReceipt("/source/a", "/", "中文;name")).toEqual({
    originalPath: "/source/a",
    targetPath: "/中文;name",
    targetName: "中文;name",
  });
});
