// No environment variable, persisted setting or client request can enable these
// old side-effect paths. Configuration remains available for explicit migration.
export const legacyAutomationExecutionEnabled = false;
export const legacyRawInputEnabled = false;
export const LEGACY_AUTOMATION_BLOCKED = "LEGACY_AUTOMATION_REQUIRES_MIGRATION";
