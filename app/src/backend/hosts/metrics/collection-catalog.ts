import type { MonitoringCommandTemplate } from "../../../types/monitoring.js";

/** Fixed, read-only templates. No API accepts a command string. */
export const MONITORING_COMMANDS = [
  {
    id: "cpu.1",
    widget: "cpu",
    template: "cat /proc/stat",
    timeoutMs: 15000,
  },
  {
    id: "cpu.2",
    widget: "cpu",
    template: "cat /proc/loadavg",
    timeoutMs: 15000,
  },
  {
    id: "cpu.3",
    widget: "cpu",
    template: "nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo",
    timeoutMs: 15000,
  },
  {
    id: "disk.1",
    widget: "disk",
    template: "df -hT -P | tail -n +2",
    timeoutMs: 15000,
  },
  {
    id: "disk.2",
    widget: "disk",
    template: "df -TB1 -P | tail -n +2",
    timeoutMs: 15000,
  },
  {
    id: "disk.3",
    widget: "disk",
    template: "df -hT -P -- {path} | tail -n +2",
    timeoutMs: 15000,
  },
  {
    id: "disk.4",
    widget: "disk",
    template: "df -TB1 -P -- {path} | tail -n +2",
    timeoutMs: 15000,
  },
  {
    id: "firewall.1",
    widget: "firewall",
    template: "iptables-save 2>/dev/null",
    timeoutMs: 15000,
  },
  {
    id: "firewall.2",
    widget: "firewall",
    template: "nft list ruleset 2>/dev/null",
    timeoutMs: 15000,
  },
  {
    id: "login_stats.1",
    widget: "login_stats",
    template: "last -n 20 -F -w | grep -v 'reboot' | grep -v 'wtmp' | head -20",
    timeoutMs: 15000,
  },
  {
    id: "login_stats.2",
    widget: "login_stats",
    template:
      "grep 'Failed password' /var/log/auth.log 2>/dev/null | tail -10 || grep 'authentication failure' /var/log/secure 2>/dev/null | tail -10 || echo ''",
    timeoutMs: 15000,
  },
  {
    id: "memory.1",
    widget: "memory",
    template: "cat /proc/meminfo",
    timeoutMs: 15000,
  },
  {
    id: "network.1",
    widget: "network",
    template:
      "ip -o addr show 2>/dev/null | awk '{print $2,$4}' | grep -v '^lo' || true",
    timeoutMs: 15000,
  },
  {
    id: "network.2",
    widget: "network",
    template:
      "ip -o link show 2>/dev/null | awk '{gsub(/:/, \"\", $2); print $2,$9}' || true",
    timeoutMs: 15000,
  },
  {
    id: "network.3",
    widget: "network",
    template: "cat /proc/net/dev",
    timeoutMs: 15000,
  },
  {
    id: "ports.1",
    widget: "ports",
    template: "ss -tulnp 2>/dev/null",
    timeoutMs: 15000,
  },
  {
    id: "ports.2",
    widget: "ports",
    template: "netstat -tulnp 2>/dev/null",
    timeoutMs: 15000,
  },
  {
    id: "processes.1",
    widget: "processes",
    template: "(ps aux --sort=-%cpu 2>/dev/null || ps aux) | head -n 11",
    timeoutMs: 15000,
  },
  {
    id: "processes.2",
    widget: "processes",
    template: "ps aux | wc -l",
    timeoutMs: 15000,
  },
  {
    id: "processes.3",
    widget: "processes",
    template: "ps aux | grep -c ' R '",
    timeoutMs: 15000,
  },
  {
    id: "system.1",
    widget: "system",
    template: "hostname",
    timeoutMs: 15000,
  },
  {
    id: "system.2",
    widget: "system",
    template: "uname -r",
    timeoutMs: 15000,
  },
  {
    id: "system.3",
    widget: "system",
    template: "cat /etc/os-release | grep '^PRETTY_NAME=' | cut -d'\"' -f2",
    timeoutMs: 15000,
  },
  {
    id: "temperature.1",
    widget: "temperature",
    template:
      'for zone in /sys/class/thermal/thermal_zone*; do [ -r "$zone/temp" ] || continue; label="$(cat "$zone/type" 2>/dev/null || basename "$zone")"; value="$(cat "$zone/temp" 2>/dev/null || true)"; [ -n "$value" ] && printf "%s\\t%s\\n" "$label" "$value"; done',
    timeoutMs: 10000,
  },
  {
    id: "temperature.2",
    widget: "temperature",
    template: "sensors 2>/dev/null",
    timeoutMs: 10000,
  },
  {
    id: "uptime.1",
    widget: "uptime",
    template: "cat /proc/uptime",
    timeoutMs: 15000,
  },
] as const satisfies readonly MonitoringCommandTemplate[];
export type MonitoringCommandId = (typeof MONITORING_COMMANDS)[number]["id"];
export function monitoringCommand(
  id: MonitoringCommandId,
  args?: { path: string },
) {
  const entry = MONITORING_COMMANDS.find((command) => command.id === id);
  if (!entry) throw Error("MONITORING_COMMAND_UNKNOWN");
  if (!entry.template.includes("{path}")) {
    if (args) throw Error("MONITORING_ARGUMENT_INVALID");
    return { ...entry, command: entry.template };
  }
  const value = args?.path;
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw Error("MONITORING_PATH_INVALID");
  const quoted = "'" + value.replaceAll("'", "'\"'\"'") + "'";
  return { ...entry, command: entry.template.replace("{path}", () => quoted) };
}
