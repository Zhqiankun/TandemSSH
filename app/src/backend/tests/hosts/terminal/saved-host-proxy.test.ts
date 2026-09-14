import { expect, it } from "vitest";
import { savedHostProxySettings } from "../../../hosts/terminal/saved-host-proxy.js";
const stale = { useSocks5: true, socks5Host: "old-proxy", socks5Port: 1080,
  socks5Username: "old-user", socks5Password: "old-secret", socks5ProxyChain: [{ host: "old-chain" }] };
it.each([false, undefined])("clears stale client proxy settings when saved proxy enablement is %s", useSocks5 => {
  const merged = { ...stale, ...savedHostProxySettings({ useSocks5 }) };
  expect(merged).toEqual({ useSocks5: false, socks5Host: undefined, socks5Port: undefined,
    socks5Username: undefined, socks5Password: undefined, socks5ProxyChain: undefined });
  expect(stale.socks5Host).toBe("old-proxy");
});
it("replaces a stale authenticated chain with the saved unauthenticated proxy", () => {
  const saved = { useSocks5: true, socks5Host: "new-proxy", socks5Port: 1081 };
  expect({ ...stale, ...savedHostProxySettings(saved) }).toEqual({ ...saved,
    socks5Username: undefined, socks5Password: undefined, socks5ProxyChain: undefined });
});
