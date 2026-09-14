// Owns only local TCP -> C2S WebSocket upload flow; the caller owns closure.
function createC2SUploadPump(socket, ws, onError) {
  let closed = false, ready = false, sending = false;
  socket.pause();
  const fail = (error) => { if (!closed) onError(error); };
  const send = (chunk) => {
    if (closed) return;
    if (!ready || sending) { fail(Error("C2S_UPLOAD_FLOW_INVALID")); return; }
    socket.pause();
    sending = true;
    try {
      ws.send(chunk, (error) => {
        sending = false;
        if (closed) return;
        if (error) { fail(error); return; }
        if (!socket.destroyed) socket.resume();
      });
    } catch (error) { sending = false; fail(error); }
  };
  socket.on("data", send);
  return {
    start(initialData) {
      if (closed || ready) return;
      ready = true;
      if (initialData?.length) send(initialData);
      else if (!socket.destroyed) socket.resume();
    },
    close() {
      closed = true;
      socket.pause();
      socket.off("data", send);
    },
  };
}
module.exports = { createC2SUploadPump };
