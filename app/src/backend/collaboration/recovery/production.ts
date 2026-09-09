import { aiTasks } from "../../ai/tasks/production.js";
import { taskRuntime } from "../tasks/production.js";
import { taskRecoveryStore } from "./store-production.js";
import { TaskRecoveryService } from "./service.js";
export const taskRecovery = new TaskRecoveryService(
  taskRuntime,
  taskRecoveryStore,
  aiTasks,
);
