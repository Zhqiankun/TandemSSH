/** Host-import boundary: retain definitions, but never import activation. */
export function inactiveImportedHost(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const parse = (value: unknown, fallback: unknown): unknown => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      throw Error("INVALID_IMPORTED_ACTIVATION_CONFIG");
    }
  };
  const stats = parse(record.statsConfig, {});
  const tunnels = parse(record.tunnelConnections, []);
  if (
    !stats ||
    typeof stats !== "object" ||
    Array.isArray(stats) ||
    !Array.isArray(tunnels) ||
    tunnels.some((t) => !t || typeof t !== "object" || Array.isArray(t))
  )
    throw Error("INVALID_IMPORTED_ACTIVATION_CONFIG");
  return {
    ...record,
    enableTunnel: false,
    enableDocker: false,
    enableProxmox: false,
    enableTmuxMonitor: false,
    autostartPassword: null,
    autostartKey: null,
    autostartKeyPassword: null,
    statsConfig: JSON.stringify({
      ...stats,
      metricsEnabled: false,
      statusCheckEnabled: false,
      disableTcpPing: true,
    }),
    tunnelConnections: JSON.stringify(
      tunnels.map((t) => ({ ...t, autoStart: false })),
    ),
  };
}
