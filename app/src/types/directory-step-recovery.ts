/** Private service snapshots travel inside the encrypted task record, never as execution authority. */
export interface DirectoryStepCheckpoint {
  schemaVersion: 1;
  stepId: string;
  direction: "upload";
  remoteTree: unknown;
  nativeSource: unknown;
  entries: number;
  completedEntryIds: string[];
  choices: Array<{
    id: string;
    action: "create" | "merge" | "overwrite" | "skip";
  }>;
}
