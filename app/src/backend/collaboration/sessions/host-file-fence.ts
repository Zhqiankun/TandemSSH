export interface FileHostScope {
  userId: string;
  hostId?: number;
  identity?: string;
}
export class HostFileFence {
  private readonly holds = new Map<symbol, FileHostScope>();
  acquire(scope: FileHostScope): () => void {
    const token = Symbol("manual-file-write");
    this.holds.set(token, { ...scope });
    return () => {
      this.holds.delete(token);
    };
  }
  assertAvailable(scope: FileHostScope): void {
    for (const active of this.holds.values())
      if (
        active.userId === scope.userId &&
        ((active.hostId !== undefined && active.hostId === scope.hostId) ||
          (!!active.identity && active.identity === scope.identity))
      )
        throw Error("HOST_FILE_OPERATION_ACTIVE");
  }
}
export const hostFileFence = new HostFileFence();
