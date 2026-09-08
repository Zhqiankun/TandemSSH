// TandemSSH modification: process-level desktop boundary. This module owns
// service listeners and optional startup work, never user-created SSH tunnels.
type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function resolveRuntimePolicy(env: RuntimeEnvironment) {
  const desktop = env.ELECTRON_EMBEDDED === "true";
  return Object.freeze({
    desktop,
    upstreamUpdates: false,
    opkssh:
      env.ENABLE_OPKSSH === "true" ||
      (!desktop && env.ENABLE_OPKSSH !== "false"),
    guacamole:
      env.ENABLE_GUACAMOLE === "true" ||
      (!desktop && env.ENABLE_GUACAMOLE !== "false"),
  });
}

// Capture the launch boundary before starter loads persisted .env settings.
// A stored setting must not turn an embedded desktop into a public server.
export const runtimePolicy = resolveRuntimePolicy(process.env);

export function serviceListenOptions(
  port: number,
  fallbackHost?: string,
  policy = runtimePolicy,
): { port: number; host?: string } {
  const host = policy.desktop ? "127.0.0.1" : fallbackHost;
  return host ? { port, host } : { port };
}
