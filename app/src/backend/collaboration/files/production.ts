import { taskRuntime } from "../tasks/production.js";
import { automatedDocuments } from "../../files/production.js";
import { FileAutomation } from "./automation.js";
export const fileAutomation = new FileAutomation(
  taskRuntime,
  automatedDocuments,
);
