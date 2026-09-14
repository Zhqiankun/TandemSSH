import { expect, it, vi } from "vitest";
import { createServer, connect, type Socket } from "node:net";
import { once } from "node:events";
import { createRequire } from "node:module";
const { C2S_LOCAL_CONNECTION_LIMIT } = createRequire(import.meta.url)("../electron/c2s-session.cjs");
it("bounds real local listener clients and permits reuse after a peer closes", async () => {
  expect(C2S_LOCAL_CONNECTION_LIMIT).toBe(32);
  const peers=new Set<Socket>(), clients: Socket[]=[];
  const server=createServer(s=>{peers.add(s);s.on("error",()=>{});s.once("close",()=>peers.delete(s));s.pipe(s);});
  server.maxConnections=C2S_LOCAL_CONNECTION_LIMIT;server.listen(0,"127.0.0.1");await once(server,"listening");
  const dial=()=>{const s=connect((server.address() as {port:number}).port,"127.0.0.1");s.on("error",()=>{});clients.push(s);return s;};
  try {
    for(let i=0;i<32;i++){const accepted=once(server,"connection");dial();await accepted;}
    const extra=dial();await once(extra,"close");expect(peers.size).toBe(32);
    const echo=once(clients[0],"data");clients[0].write("existing");expect(String((await echo)[0])).toBe("existing");
    clients[0].destroy();await vi.waitFor(()=>expect(peers.size).toBe(31));
    const accepted=once(server,"connection"),next=dial();await accepted;
    const reply=once(next,"data");next.write("replacement");expect(String((await reply)[0])).toBe("replacement");
    expect(peers.size).toBe(32);
  } finally {for(const s of clients)s.destroy();for(const s of peers)s.destroy();await new Promise<void>(r=>server.close(()=>r()));}
},10000);
