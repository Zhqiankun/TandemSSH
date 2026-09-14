import { expect, it } from "vitest";
import { historyCompletion } from "@/features/terminal/command-history/completion";
it.each([
  ["echo ", "echo hello", "hello", "echo hello"],
  ["  echo ", "echo hello", "hello", "  echo hello"],
  ["printf ' ", "printf ' value'", "value'", "printf ' value'"],
  ["echo 中", "echo 中文😀", "文😀", "echo 中文😀"],
])("preserves the exact typed line %s", (input, candidate, suffix, line) => {
  expect(historyCompletion(input, candidate)).toEqual({ suffix, line });
});
it.each([
  ["echo  ", "echo hello"],
  ["", "pwd"],
  ["   ", "pwd"],
  ["pwd", "pwd"],
  ["other", "pwd"],
  ["echo", "echo hi\nrm file"],
  ["echo", "echo\rhi"],
  ["echo", "echo\x1b[A"],
  ["echo", "echo\thi"],
])(
  "rejects incompatible or control-bearing completion %s",
  (input, candidate) => {
    expect(historyCompletion(input, candidate)).toBeNull();
  },
);
