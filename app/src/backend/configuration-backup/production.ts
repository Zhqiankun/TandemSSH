import { ConfigurationBackupService } from "./service.js";
import { createCurrentConfigurationBackupRepository } from "../database/repositories/factory.js";
import { journalFor } from "../collaboration/audit/production.js";
import { workflows } from "../collaboration/workflows/production.js";
export const configurationBackups = new ConfigurationBackupService({
  snapshot: (userId) =>
    createCurrentConfigurationBackupRepository().snapshot(userId),
  apply: (userId, request) =>
    workflows.withBackupLock(userId, () =>
      createCurrentConfigurationBackupRepository().apply(userId, request),
    ),
  audit: (userId, type, data) => journalFor(userId).record(type, data),
});
