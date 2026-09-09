import { FileDraftStore } from "./store.js";
import { SystemDraftKey } from "./system-key.js";
const root = process.env.DATA_DIR || "./db/data";
export const fileDrafts = new FileDraftStore(root, new SystemDraftKey(root));
