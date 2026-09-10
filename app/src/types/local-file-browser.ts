import type { DownloadNativeResult } from "./file-download.js";
import type { NativeUploadSelection } from "./upload-source.js";
import type { LocalDownloadTreePreview } from "./download-tree.js";
export interface LocalBrowserRoot {
  id: string;
  path: string;
}
export interface LocalBrowserEntry {
  name: string;
  relativePath: string;
  kind: "file" | "directory" | "link" | "other";
  size: number;
  modifiedAt: number;
  hidden: boolean;
  version: string;
  error?: string;
}
export interface LocalBrowserOptions {
  offset?: number;
  search?: string;
  showHidden?: boolean;
  sort?: "name" | "size" | "modifiedAt";
  order?: "asc" | "desc";
}
export interface LocalBrowserPage {
  rootId: string;
  path: string;
  relativePath: string;
  entries: LocalBrowserEntry[];
  total: number;
  offset: number;
  nextOffset: number | null;
  truncated: boolean;
}
export interface LocalBrowserTarget {
  rootId: string;
  relativePath: string;
  path: string;
}
export interface LocalBrowserSelection {
  rootId: string;
  entries: Array<Pick<LocalBrowserEntry, "relativePath" | "version">>;
}
export interface DesktopLocalBrowserApi {
  choose(): Promise<DownloadNativeResult<LocalBrowserRoot | null>>;
  list(
    id: string,
    relativePath: string,
    options?: LocalBrowserOptions,
  ): Promise<DownloadNativeResult<LocalBrowserPage>>;
  upload(
    id: string,
    entries: LocalBrowserSelection["entries"],
  ): Promise<DownloadNativeResult<NativeUploadSelection>>;
  download(
    id: string,
    relativePath: string,
  ): Promise<DownloadNativeResult<LocalDownloadTreePreview>>;
  release(id: string): Promise<DownloadNativeResult<null>>;
}
