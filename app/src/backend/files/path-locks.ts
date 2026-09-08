/** Owned by the file use cases; all commits to one canonical target share this lock. */
export class FilePathLocks {
  private readonly held = new Set<string>();
  acquire(key: string): () => void {
    if (this.held.has(key)) throw Error("FILE_BUSY");
    this.held.add(key);
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.held.delete(key);
      }
    };
  }
}

/** Shared only by the production file use cases that commit to canonical targets. */
export const fileCommitLocks = new FilePathLocks();
