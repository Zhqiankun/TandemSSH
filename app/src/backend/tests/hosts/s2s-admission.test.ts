import { expect, it } from "vitest";
import { S2SStartAdmission } from "../../hosts/tunnel/s2s-admission.js";
it("reserves pending names atomically and retains slots occupied by live or retrying tunnels", () => {
  const gate=new S2SStartAdmission(),live=new Set(Array.from({length:31},(_,i)=>"live-"+i));
  const release=gate.acquire("pending",live);
  expect(()=>gate.acquire("extra",live)).toThrow("S2S_TUNNEL_LIMIT");
  const retry=gate.acquire("live-0",live);retry();
  expect(()=>gate.acquire("extra",live)).toThrow("S2S_TUNNEL_LIMIT");
  release();release();const next=gate.acquire("extra",live);next();
});
it("counts overlapping same-name starts and does not release another request's slot", () => {
  const gate=new S2SStartAdmission(),releases=Array.from({length:8},()=>gate.acquire("same",[]));
  expect(()=>gate.acquire("same",[])).toThrow("S2S_START_LIMIT");
  releases[0]();releases[0]();const newer=gate.acquire("same",[]);
  expect(()=>gate.acquire("same",[])).toThrow("S2S_START_LIMIT");
  releases.slice(1).forEach(release=>release());newer();
  const all=Array.from({length:32},(_,i)=>gate.acquire("new-"+i,[]));
  expect(()=>gate.acquire("over",[])).toThrow("S2S_TUNNEL_LIMIT");all.forEach(release=>release());
});
