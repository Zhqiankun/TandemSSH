import { z } from "zod";
/** Portable host creation defaults. Secrets and database credential IDs are excluded. */
export const backupHostDefaultsSchema = z.object({
  useSocks5: z.boolean().optional(),
  socks5Host: z
    .string()
    .max(2048)
    .regex(/^[^\u0000\r\n]*$/)
    .optional(),
  socks5Port: z.number().int().min(1).max(65535).optional(),
  socks5Username: z
    .string()
    .max(256)
    .regex(/^[^\u0000\r\n]*$/)
    .optional(),
  metricsEnabled: z.boolean().optional(),
  statusCheckEnabled: z.boolean().optional(),
  fontSize: z.number().int().min(6).max(72).optional(),
  fontFamily: z
    .string()
    .max(512)
    .regex(/^[^\u0000\r\n]*$/)
    .optional(),
  theme: z
    .string()
    .max(128)
    .regex(/^[^\u0000\r\n]*$/)
    .optional(),
  cursorStyle: z.enum(["block", "underline", "bar"]).optional(),
  cursorBlink: z.boolean().optional(),
  enableSessionLogging: z.boolean().optional(),
  enableCommandHistory: z.boolean().optional(),
});
export type BackupHostDefaults = z.infer<typeof backupHostDefaultsSchema>;
export function restoreHostDefaults(value: BackupHostDefaults) {
  return {
    ...backupHostDefaultsSchema.parse(value),
    useSocks5: false,
    credentialId: null,
  };
}
