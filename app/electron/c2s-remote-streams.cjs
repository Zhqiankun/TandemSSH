const C2S_REMOTE_STREAM_LIMIT = 32;
function remoteStreamAdmission(streams, id) {
  if (streams.has(id)) return "duplicate";
  return streams.size >= C2S_REMOTE_STREAM_LIMIT ? "full" : "allowed";
}
module.exports = { C2S_REMOTE_STREAM_LIMIT, remoteStreamAdmission };
