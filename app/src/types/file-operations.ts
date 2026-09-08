import type {
  FileInspectionAction,
  FileDirectoryView,
  FileStatView,
} from "./file-inspection.js";
import type {
  FileCharset,
  FileDocumentInfo,
  FileTextFormat,
} from "./file-document.js";
export interface FileScope {
  kind: "path" | "directory";
  path: string;
  access: Array<"read" | "write">;
}
export interface FileRule {
  id: string;
  effect: "allow" | "confirm" | "deny";
  match: FileScope;
  reason: string;
}
export type FileAction =
  | FileInspectionAction
  | {
      type: "file.read";
      path: string;
      canonicalPath?: string;
      charset?: FileCharset;
      timeoutMs?: number;
    }
  | {
      type: "file.write";
      path: string;
      canonicalPath: string;
      proposalId: string;
      version: string;
      contentHash: string;
      bytes: number;
      format: FileTextFormat;
      timeoutMs?: number;
    };
// Bodies are kept in a file-owned proposal store, never in policy, audit or task DTOs.
export interface FileResultView {
  directory?: FileDirectoryView;
  metadata?: FileStatView;
  document?: FileDocumentInfo;
  bytes?: number;
  temporaryPath?: string;
  commitMayHaveOccurred?: boolean;
  contentAvailable?: boolean;
}
export interface FileExecutionResult {
  status: "succeeded" | "failed" | "unknown";
  result?: FileResultView;
  error?: string;
}
