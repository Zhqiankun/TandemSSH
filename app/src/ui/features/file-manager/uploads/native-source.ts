import type {
  DesktopUploadSourceApi,
  NativeUploadEntry,
  UploadSource,
} from "@/types/upload-source";
function value<T>(
  result: { ok: true; value: T } | { ok: false; error: string },
): T {
  if (result.ok === false) throw Error(result.error);
  return result.value;
}
/** Owned by uploads: adapts one native selection entry to the existing chunk reader. */
export function nativeUploadSource(
  api: DesktopUploadSourceApi,
  selectionId: string,
  entry: NativeUploadEntry,
): UploadSource {
  if (entry.kind !== "file" || entry.error)
    throw Error("UPLOAD_SOURCE_UNAVAILABLE");
  return {
    name: entry.name,
    size: entry.size,
    lastModified: entry.lastModified,
    verify: async () => {
      const current = value(await api.check(selectionId, entry.id));
      if (
        current.size !== entry.size ||
        current.lastModified !== entry.lastModified
      )
        throw Error("UPLOAD_SOURCE_CHANGED");
    },
    slice: async (start, end) => {
      const bytes = value(
        await api.chunk(selectionId, entry.id, start, end - start),
      );
      return new Blob([Uint8Array.from(bytes)]);
    },
  };
}
