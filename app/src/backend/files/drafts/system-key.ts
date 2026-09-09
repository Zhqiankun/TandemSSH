import { SystemRecordKey } from "../../privacy/system-record-key.js";
/** Preserve the existing draft service and account derivation for stored-key compatibility. */
export class SystemDraftKey extends SystemRecordKey {
  constructor(root: string) {
    super(root, "TandemSSH file drafts", "FILE_DRAFT_KEY_FAILED");
  }
}
