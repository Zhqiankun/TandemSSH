// C2S wire-message limit; bulk data remains streamed in separate messages.
const C2S_MAX_MESSAGE_BYTES = 1024 * 1024;
function c2sWebSocketOptions(options = {}) {
  return { ...options, maxPayload: C2S_MAX_MESSAGE_BYTES, perMessageDeflate: false };
}
module.exports = { C2S_MAX_MESSAGE_BYTES, c2sWebSocketOptions };
