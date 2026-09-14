/** Presentation-only inventory for imported host drafts. Never returns values. */
const groups = {
  authentication: ["authType", "credentialId", "credentialAlias", "credentialName", "password", "key", "keyPassword", "sudoPassword"],
  proxy: ["useSocks5", "socks5Host", "socks5Port", "socks5Username", "socks5Password", "socks5ProxyChain"],
  jump: ["jumpHosts", "parentHostId"],
  terminal: ["terminalConfig", "quickActions", "defaultPath", "forceKeyboardInteractive"],
  tunnels: ["tunnelConnections", "enableTunnel"],
  monitoring: ["statsConfig", "enableTmuxMonitor"],
  docker: ["dockerConfig", "enableDocker"],
  proxmox: ["proxmoxConfig", "proxmoxStatsConfig", "enableProxmox", "enableProxmoxStats"],
  portKnocking: ["portKnockSequence"],
} as const;

export function importedSettingGroups(host: Record<string, unknown>): Array<keyof typeof groups> {
  return (Object.keys(groups) as Array<keyof typeof groups>).filter(group =>
    groups[group].some(field => Object.hasOwn(host, field) && host[field] !== undefined && host[field] !== null),
  );
}
