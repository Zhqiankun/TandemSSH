import { TaskRecoveryStore } from "./store.js";
export const taskRecoveryStore = new TaskRecoveryStore(
  process.env.DATA_DIR || "./db/data",
);
