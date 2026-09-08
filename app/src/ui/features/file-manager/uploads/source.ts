import {
  UPLOAD_CHUNK_BYTES,
  UPLOAD_MAX_CHUNKS,
  type UploadManifest,
} from "@/types/file-upload";
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(Error("UPLOAD_SOURCE_UNAVAILABLE"));
    reader.readAsArrayBuffer(blob);
  });
}
export async function chunkHash(blob: Blob) {
  const bytes = await blobBytes(blob),
    hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function uploadManifest(
  file: File,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  expected?: UploadManifest,
): Promise<UploadManifest> {
  if (
    !Number.isSafeInteger(file.size) ||
    file.size < 0 ||
    file.size > UPLOAD_CHUNK_BYTES * UPLOAD_MAX_CHUNKS
  )
    throw Error("FILE_TOO_LARGE");
  if (
    expected &&
    (file.name !== expected.name ||
      file.size !== expected.size ||
      file.lastModified !== expected.lastModified)
  )
    throw Error("UPLOAD_SOURCE_CHANGED");
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += UPLOAD_CHUNK_BYTES) {
    if (signal.aborted) throw Error("UPLOAD_CANCELLED");
    const end = Math.min(offset + UPLOAD_CHUNK_BYTES, file.size),
      hash = await chunkHash(file.slice(offset, end));
    if (expected && hash !== expected.hashes[hashes.length])
      throw Error("UPLOAD_SOURCE_CHANGED");
    hashes.push(hash);
    progress(end);
  }
  if (signal.aborted) throw Error("UPLOAD_CANCELLED");
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    hashes,
  };
}
