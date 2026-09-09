import { MonitoringCollectionRuntime } from "./collection-runtime.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { journalFor } from "../../collaboration/audit/production.js";
export async function authorizeMonitoring(
  hostId: number,
  userId: string,
): Promise<void> {
  if (
    !userId ||
    DataCrypto.getUserDataKey(userId) === null ||
    !(
      await PermissionManager.getInstance().canAccessHost(
        userId,
        hostId,
        "view",
      )
    ).hasAccess
  )
    throw Error("MONITORING_DENIED");
}
export const monitoringCollections = new MonitoringCollectionRuntime({
  authorize: authorizeMonitoring,
  audit: (userId, type, data) => journalFor(userId).record(type, data),
});
