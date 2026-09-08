import { afterEach,describe,expect,it,vi } from "vitest";
import { createServer,type Server } from "node:http";
vi.mock("../../database/repositories/factory.js",()=>({createCurrentSettingsRepository:()=>({get:async()=>null})}));
import { providerFetch,readSseLines } from "../../ai/providers/http.js";
const servers:Server[]=[];afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}});
describe("provider HTTP transport compatibility",()=>{
 it("uses the packaged HTTP client and dispatcher together for real loopback requests",async()=>{
  const server=createServer((req,res)=>{expect(req.headers.authorization).toBe("Bearer test-only");res.writeHead(200,{"Content-Type":"text/event-stream"});res.write('data: {"text":"中文模型响应"}\n\n');res.end('data: [DONE]\n\n');});servers.push(server);await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address() as {port:number};
  const response=await providerFetch("http://127.0.0.1:"+address.port+"/chat",{headers:{Authorization:"Bearer test-only"}});expect(response.status).toBe(200);const frames:string[]=[];for await(const frame of readSseLines(response))frames.push(frame);expect(frames).toEqual(['{"text":"中文模型响应"}',"[DONE]"]);
 });
});
