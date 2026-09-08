import type {
  FileCharset,
  FileTextFormat,
  FileDocumentInfo,
} from "./file-document.js";
export interface FileReadRequest {
  path: string;
  charset?: FileCharset;
}
export interface FileEditRequest {
  version: string;
  content?: string;
  edits?: Array<{ before: string; after: string }>;
  format?: FileTextFormat;
  saveAs?: string;
}
export interface FileBodyView {
  document: FileDocumentInfo;
  content: string;
  offset: number;
  nextOffset?: number;
  complete: boolean;
  redacted: boolean;
  canReplace: boolean;
  contentTrust: "untrusted-file-content";
}
export interface FileChangeReview {
  reviewId: string;
  proposalId: string;
  operationId: string;
  digest: string;
  path: string;
  canonicalPath: string;
  format: FileTextFormat;
  before: string;
  after: string;
  bytes: number;
}
