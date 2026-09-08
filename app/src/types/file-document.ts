export type FileCharset = "utf8" | "utf16le" | "utf16be" | "gbk" | "gb18030";
export type FileLineEnding = "lf" | "crlf" | "cr" | "mixed" | "none";
export interface FileTextFormat {
  charset: FileCharset;
  bom: boolean;
  lineEnding: FileLineEnding;
}
export interface FileDocumentInfo {
  documentId: string;
  version: string;
  path: string;
  canonicalPath: string;
  hostIdentity?: string;
  size: number;
  mtime: number;
  mode: number;
  viaSymlink: boolean;
  editable: boolean;
  format?: FileTextFormat;
  readOnlyReason?: "binary" | "encoding-required" | "too-large";
}
export interface FileDocumentContent {
  content: string;
  path: string;
  encoding: "utf8" | "base64";
  document: FileDocumentInfo;
}
export interface SaveFileDocument {
  sessionId: string;
  path: string;
  content: string;
  version: string;
  requestId: string;
  format?: FileTextFormat;
  takeover?: boolean;
  saveAs?: string;
}
export interface SavedFileDocument {
  document: FileDocumentInfo;
  bytes: number;
  atomic: boolean;
  warnings: string[];
}
export interface FileDocumentFailure {
  error: string;
  latest?: FileDocumentContent;
  temporaryPath?: string;
  commitMayHaveOccurred?: boolean;
}
