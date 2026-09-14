/** Applies only after an owned saved host has been resolved server-side. */
export function savedHostProxySettings(host: {
  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: unknown;
}) {
  const enabled = host.useSocks5 === true;
  return {
    useSocks5: enabled,
    socks5Host: enabled ? host.socks5Host : undefined,
    socks5Port: enabled ? host.socks5Port : undefined,
    socks5Username: enabled ? host.socks5Username : undefined,
    socks5Password: enabled ? host.socks5Password : undefined,
    socks5ProxyChain: enabled ? host.socks5ProxyChain : undefined,
  };
}
