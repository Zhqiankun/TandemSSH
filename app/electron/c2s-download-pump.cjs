// Owns only C2S WebSocket -> local TCP flow; the caller owns socket closure.
function createC2SDownloadPump(socket, ws, onError) {
  let closed = false, waiting = false;
  const drain = () => {
    if (closed || !waiting) return;
    waiting = false;
    if (ws.readyState === 1) ws.resume();
  };
  socket.on("drain", drain);
  return {
    write(chunk) {
      if (closed) return;
      try {
        if (!socket.write(chunk) && !waiting) {
          waiting = true;
          ws.pause();
        }
      } catch (error) { if (!closed) onError(error); }
    },
    close() {
      closed = true;
      waiting = false;
      socket.off("drain", drain);
    },
  };
}
module.exports = { createC2SDownloadPump };
