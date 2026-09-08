export interface RemoteFileStat {
  size: number;
  mtime: number;
  atime: number;
  mode: number;
  uid: number;
  gid: number;
  kind: "file" | "directory" | "symlink" | "other";
}
export interface RemoteFileSnapshot {
  bytes: Buffer;
  stat: RemoteFileStat;
}
export interface RemoteFileIO {
  list?(
    path: string,
    maximumEntries: number,
    guard: () => void,
  ): Promise<Array<{ name: string; stat: RemoteFileStat }>>;
  resolve(path: string): Promise<string>;
  stat(path: string): Promise<RemoteFileStat>;
  snapshot(
    path: string,
    maximumBytes: number,
    guard?: () => void,
  ): Promise<RemoteFileSnapshot>;
  createExclusive(
    path: string,
    bytes: Buffer,
    metadata: RemoteFileStat | undefined,
    guard: () => void,
  ): Promise<void>;
  replace(
    from: string,
    to: string,
    allowOverwrite: boolean,
    guard: () => void,
  ): Promise<{ atomic: boolean }>;
}
export interface FileDocumentTarget {
  acceptedHostKey?: string;
  key: string;
  connection: string;
  io: RemoteFileIO;
  retain?: () => () => void;
  hostScope?: { userId: string; hostId?: number; identity?: string };
  check: (
    action: "read" | "write",
    requestedPath: string,
    canonicalPath: string,
  ) => void;
}

export interface RemoteTransferIO extends RemoteFileIO {
  readAt(
    path: string,
    offset: number,
    length: number,
    guard: () => void,
  ): Promise<{ bytes: Buffer; stat: RemoteFileStat }>;
  inspectFile(
    path: string,
    guard: () => void,
    limit?: number,
  ): Promise<{
    stat: RemoteFileStat;
    sha256: string;
    hashes: string[];
    bytes: number;
  }>;
  writeAt(
    path: string,
    offset: number,
    bytes: Buffer,
    guard: () => void,
  ): Promise<void>;
  truncate(path: string, size: number, guard: () => void): Promise<void>;
  remove(path: string, guard: () => void): Promise<void>;
}
