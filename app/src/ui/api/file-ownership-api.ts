import { getFileManagerApiForSession } from "@/main-axios";
export async function changeFileOwnership(
  sessionId: string,
  path: string,
  uid: number,
  gid: number,
) {
  const response = await getFileManagerApiForSession(sessionId).post(
    "/ssh/changeOwnership",
    { sessionId, path, uid, gid },
  );
  const result = response.data;
  if (
    result?.success !== true ||
    result.uid !== uid ||
    result.gid !== gid ||
    !Number.isInteger(result.mode)
  )
    throw Error("FILE_OWNERSHIP_UNCONFIRMED");
  return {
    uid: result.uid as number,
    gid: result.gid as number,
    mode: result.mode as number,
  };
}
