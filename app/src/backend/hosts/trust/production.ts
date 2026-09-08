import { createCurrentHostTrustRepository } from "../../database/repositories/factory.js";
import { journalFor } from "../../collaboration/audit/production.js";
import { HostTrustService } from "./service.js";
export const hostTrust = new HostTrustService({
  store: {
    get: (id, userId) => createCurrentHostTrustRepository().get(id, userId),
    compareAndSet: (record, revision) =>
      createCurrentHostTrustRepository().compareAndSet(record, revision),
  },
  audit: (userId, type, data) => journalFor(userId).record(type, data),
});
