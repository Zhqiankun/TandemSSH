export const C2S_REMOTE_STREAM_LIMIT = 32;
import type { WebSocket, WebSocketServer } from "ws";
export const C2S_RELAY_CONNECTION_LIMIT = 128;
export const C2S_TRANSPORT_CONNECTION_LIMIT = 256;
/** Called after ws registers the new peer, before any authentication/SSH work. */
export function admitC2SRelay(server: Pick<WebSocketServer, "clients">, ws: WebSocket, limit = C2S_RELAY_CONNECTION_LIMIT): boolean {
  if (server.clients.size <= limit) return true;
  ws.send(JSON.stringify({ type: "error", error: "C2S_CONNECTION_LIMIT" }));
  ws.close(1013, "C2S_CONNECTION_LIMIT");
  return false;
}
