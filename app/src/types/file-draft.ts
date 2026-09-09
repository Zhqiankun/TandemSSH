import type { FileTextFormat } from "./file-document.js";
export interface FileDraftSnapshot {
  revision: string;
  savedAt: number;
  hostIdentity: string;
  path: string;
  canonicalPath: string;
  original: string;
  content: string;
  format: FileTextFormat;
}
export interface FileDraftWrite {
  sessionId: string;
  version: string;
  expectedRevision: string | null;
  original: string;
  content: string;
}
