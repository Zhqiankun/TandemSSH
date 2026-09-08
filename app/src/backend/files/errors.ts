import type { FileDocumentContent } from "../../types/file-document.js";
export class DocumentError extends Error {
  constructor(
    code: string,
    public details: {
      latest?: FileDocumentContent;
      temporaryPath?: string;
      commitMayHaveOccurred?: boolean;
    } = {},
  ) {
    super(code);
  }
}
