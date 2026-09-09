/** Service snapshots are encrypted task data, never execution authority. */
interface DirectoryCheckpointBase {
  schemaVersion: 1;
  stepId: string;
  remoteTree: unknown;
  entries: number;
  completedEntryIds: string[];
  choices: Array<{
    id: string;
    action: "create" | "merge" | "overwrite" | "skip";
  }>;
}
export type DirectoryStepCheckpoint = DirectoryCheckpointBase &
  (
    | { direction: "upload"; nativeSource: unknown }
    | {
        direction: "download";
        path: string;
        canonicalRoot: string;
        nativeTarget: unknown;
      }
  );
