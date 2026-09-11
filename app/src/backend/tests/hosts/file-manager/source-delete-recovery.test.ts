import { expect, it } from "vitest";
import {
  SourceDeletionError,
  canFinalizeFromDestination,
  isRecoverableTransferError,
} from "../../../hosts/file-manager/transfer-errors.js";
it("does not recover a move from destination completeness without confirmed source deletion", () => {
  expect(canFinalizeFromDestination({})).toBe(true);
  expect(canFinalizeFromDestination({ moveRequested: false })).toBe(true);
  expect(canFinalizeFromDestination({ moveRequested: true })).toBe(false);
  expect(
    canFinalizeFromDestination({ moveRequested: true, sourceDeleted: false }),
  ).toBe(false);
  expect(
    canFinalizeFromDestination({ moveRequested: true, sourceDeleted: true }),
  ).toBe(true);
});
it("does not classify a source cleanup failure as a retryable connection failure", () => {
  expect(
    isRecoverableTransferError(
      new SourceDeletionError(Error("connection lost")),
    ),
  ).toBe(false);
});
