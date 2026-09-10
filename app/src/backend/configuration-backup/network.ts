import { z } from "zod";
import type { BackupWarning } from "../../types/configuration-backup.js";
const address = z
  .string()
  .max(2048)
  .refine((s) => !/[\u0000\r\n]/.test(s));
export const backupTunnelSchema = z.object({
  scope: z.enum(["s2s", "c2s"]),
  mode: z.enum(["local", "remote", "dynamic"]),
  sourceHostRef: z.string().uuid(),
  endpointHostRef: z.string().uuid().optional(),
  bindHost: address.default("127.0.0.1"),
  targetHost: address.optional(),
  sourcePort: z.number().int().min(1).max(65535),
  endpointPort: z.number().int().min(0).max(65535),
  maxRetries: z.number().int().min(0).max(100).default(0),
  retryInterval: z.number().int().min(0).max(3600000).default(5000),
});
export const backupNetworkSchema = z.object({
  jumpHostRefs: z.array(z.string().uuid()).max(10).default([]),
  tunnels: z.array(backupTunnelSchema).max(100).default([]),
});
export const backupPresetSchema = z.object({
  ref: z.string().uuid(),
  name: z.string().max(512),
  tunnels: z.array(backupTunnelSchema).max(100),
});
export type BackupTunnel = z.infer<typeof backupTunnelSchema>;
export type BackupNetwork = z.infer<typeof backupNetworkSchema>;
export type BackupPreset = z.infer<typeof backupPresetSchema>;
export function validateNetworkReferences(
  hosts: Array<{ ref: string; network?: BackupNetwork }>,
  presets: BackupPreset[],
) {
  const known = new Map(hosts.map((h) => [h.ref, h]));
  const requireRef = (ref: string) => {
    if (!known.has(ref)) throw Error("BACKUP_HOST_REFERENCE");
  };
  for (const host of hosts) {
    for (const ref of host.network?.jumpHostRefs ?? []) requireRef(ref);
    for (const tunnel of host.network?.tunnels ?? []) {
      requireRef(tunnel.sourceHostRef);
      if (tunnel.sourceHostRef !== host.ref)
        throw Error("BACKUP_HOST_REFERENCE");
      if (tunnel.endpointHostRef) requireRef(tunnel.endpointHostRef);
    }
  }
  for (const preset of presets)
    for (const tunnel of preset.tunnels) {
      requireRef(tunnel.sourceHostRef);
      if (tunnel.endpointHostRef) requireRef(tunnel.endpointHostRef);
    }
  const active = new Set<string>(),
    depths = new Map<string, number>();
  const visit = (ref: string): number => {
    if (active.has(ref)) throw Error("BACKUP_JUMP_CYCLE");
    const saved = depths.get(ref);
    if (saved !== undefined) return saved;
    active.add(ref);
    let depth = 1;
    for (const child of known.get(ref)?.network?.jumpHostRefs ?? [])
      depth = Math.max(depth, 1 + visit(child));
    if (depth > 10) throw Error("BACKUP_JUMP_DEPTH");
    active.delete(ref);
    depths.set(ref, depth);
    return depth;
  };
  for (const ref of known.keys()) visit(ref);
}
function array(
  value: unknown,
  warnings: BackupWarning[],
  at: string,
): unknown[] {
  if (value === undefined || value === null) return [];
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (Array.isArray(parsed)) return parsed;
    warnings.push({ code: "NETWORK_CONFIG_EXCLUDED", path: at });
    return [];
  } catch {
    warnings.push({ code: "NETWORK_CONFIG_EXCLUDED", path: at });
    return [];
  }
}
export function projectNetwork(
  host: Record<string, unknown>,
  hosts: Array<Record<string, unknown>>,
  refs: Map<Record<string, unknown>, string>,
  warnings: BackupWarning[],
  at: string,
  clientPreset = false,
): BackupNetwork {
  const byId = (id: unknown) =>
    hosts.find((h) => h.id !== undefined && String(h.id) === String(id));
  const resolveEndpoint = (value: unknown) => {
    const text = String(value ?? "").trim();
    const id = byId(text);
    if (id) return id;
    const matches = hosts.filter(
      (h) =>
        h.name === text || h.ip === text || `${h.username}@${h.ip}` === text,
    );
    if (matches.length > 1) throw Error("BACKUP_AMBIGUOUS_ENDPOINT");
    return matches.length === 1 ? matches[0] : undefined;
  };
  const jumpHostRefs: string[] = [];
  for (const entry of array(host.jumpHosts, warnings, at + ".jumpHosts")) {
    const target = byId((entry as { hostId?: unknown })?.hostId),
      ref = target && refs.get(target);
    if (!ref) {
      warnings.push({
        code: "NETWORK_REFERENCE_EXCLUDED",
        path: at + ".jumpHosts",
      });
      continue;
    }
    jumpHostRefs.push(ref);
  }
  const tunnels: BackupTunnel[] = [];
  for (const entry of array(
    host.tunnelConnections,
    warnings,
    at + ".tunnels",
  )) {
    if (!entry || typeof entry !== "object") continue;
    const t = entry as Record<string, unknown>,
      scope = clientPreset || t.scope === "c2s" ? "c2s" : "s2s",
      source =
        scope === "s2s"
          ? host
          : t.sourceHostId
            ? byId(t.sourceHostId)
            : undefined,
      endpoint = scope === "s2s" ? resolveEndpoint(t.endpointHost) : undefined;
    const sourceHostRef = source && refs.get(source),
      endpointHostRef = endpoint && refs.get(endpoint);
    if (
      (!clientPreset && source !== host) ||
      !sourceHostRef ||
      (scope === "s2s" &&
        !endpointHostRef &&
        (t.mode ?? t.tunnelType) === "remote" &&
        !["", "127.0.0.1", "localhost"].includes(String(t.endpointHost ?? "")))
    ) {
      warnings.push({
        code: "NETWORK_REFERENCE_EXCLUDED",
        path: at + ".tunnels",
      });
      continue;
    }
    const parsed = backupTunnelSchema.safeParse({
      scope,
      mode: t.mode ?? t.tunnelType ?? "local",
      sourceHostRef,
      endpointHostRef,
      bindHost: t.bindHost ?? "127.0.0.1",
      targetHost:
        t.targetHost ??
        (!endpointHostRef && scope === "s2s"
          ? String(t.endpointHost || "127.0.0.1")
          : undefined),
      sourcePort: t.sourcePort,
      endpointPort: t.endpointPort ?? 0,
      maxRetries: t.maxRetries ?? 0,
      retryInterval: t.retryInterval ?? 5000,
    });
    if (parsed.success) tunnels.push(parsed.data);
    else
      warnings.push({ code: "NETWORK_CONFIG_EXCLUDED", path: at + ".tunnels" });
  }
  return backupNetworkSchema.parse({ jumpHostRefs, tunnels });
}
export function restoreTunnel(t: BackupTunnel, ids: Map<string, number>) {
  const sourceHostId = ids.get(t.sourceHostRef),
    endpointId = t.endpointHostRef ? ids.get(t.endpointHostRef) : undefined;
  if (!sourceHostId || (t.endpointHostRef && !endpointId))
    throw Error("BACKUP_HOST_REFERENCE");
  return {
    scope: t.scope,
    mode: t.mode,
    tunnelType: t.mode === "remote" ? "remote" : "local",
    sourceHostId,
    endpointHost:
      t.scope === "c2s"
        ? String(sourceHostId)
        : endpointId
          ? String(endpointId)
          : "",
    bindHost: t.bindHost,
    targetHost: t.targetHost,
    sourcePort: t.sourcePort,
    endpointPort: t.endpointPort,
    maxRetries: t.maxRetries,
    retryInterval: t.retryInterval,
    autoStart: false,
  };
}
