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

it("keeps failed undo receipts and later actions without replaying acknowledged work", async () => {
  const { settleFileUndo } =
    await import("../../../features/file-manager/file-operation-history");
  const receipts = ["one", "two", "three"].map((name) =>
    fileActionReceipt("/source/" + name, "/target", name),
  );
  const action = {
    data: { copiedFiles: receipts },
    description: "first action",
  };
  const later = {
    data: { copiedFiles: [fileActionReceipt("/other", "/target", "later")] },
    description: "later action",
  };
  const completed = new Set<SuccessfulFileAction>();
  for (const receipt of receipts) {
    try {
      await Promise.resolve().then(() => {
        if (receipt === receipts[1]) throw Error("permission denied");
      });
      completed.add(receipt);
    } catch {
      /* rejected item remains available for retry */
    }
  }
  const history = settleFileUndo([action, later], action, completed);
  expect(history[0].data.copiedFiles).toEqual([receipts[1]]);
  expect(history[1]).toBe(later);
  expect(action.data.copiedFiles).toHaveLength(3);
  expect(settleFileUndo(history, history[0], new Set([receipts[1]]))).toEqual([
    later,
  ]);
});
it("does not remove another action or an equal-looking unacknowledged receipt", async () => {
  const { settleFileUndo } =
    await import("../../../features/file-manager/file-operation-history");
  const receipt = fileActionReceipt("/source", "/target", "file");
  const action = { data: { copiedFiles: [receipt] } };
  const other = { data: { copiedFiles: [{ ...receipt }] } };
  expect(settleFileUndo([other], action, new Set([receipt]))).toEqual([other]);
  expect(settleFileUndo([action], action, new Set([{ ...receipt }]))).toEqual([
    action,
  ]);
});
