import { z } from "zod";
const color = z
  .string()
  .max(80)
  .refine((value) => {
    if (
      /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value) ||
      value === "transparent"
    )
      return true;
    const m = value.match(
      /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*(0(?:\.\d+)?|1(?:\.0+)?))?\s*\)$/,
    );
    return (
      !!m &&
      m.slice(1, 4).every((n) => Number(n) <= 255) &&
      (value.startsWith("rgba") ? m[4] !== undefined : m[4] === undefined)
    );
  });
export const terminalColorsSchema = z.object({
  background: color,
  foreground: color,
  cursor: color.optional(),
  cursorAccent: color.optional(),
  selectionBackground: color.optional(),
  selectionForeground: color.optional(),
  black: color,
  red: color,
  green: color,
  yellow: color,
  blue: color,
  magenta: color,
  cyan: color,
  white: color,
  brightBlack: color,
  brightRed: color,
  brightGreen: color,
  brightYellow: color,
  brightBlue: color,
  brightMagenta: color,
  brightCyan: color,
  brightWhite: color,
});
const label = z
  .string()
  .min(1)
  .max(256)
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s));
export const terminalAppearanceSchema = z.object({
  inheritTerminalAppearance: z.boolean().optional(),
  cursorBlink: z.boolean().optional(),
  cursorStyle: z.enum(["block", "underline", "bar"]).optional(),
  fontSize: z.number().min(6).max(72).optional(),
  fontFamily: label.optional(),
  letterSpacing: z.number().min(-5).max(20).optional(),
  lineHeight: z.number().min(0.5).max(3).optional(),
  theme: label.optional(),
  scrollback: z.number().int().min(0).max(1000000).optional(),
  bellStyle: z.enum(["none", "sound", "visual", "both"]).optional(),
  minimumContrastRatio: z.number().min(1).max(21).optional(),
  customThemeColors: terminalColorsSchema.optional(),
});
export const backupTerminalThemeSchema = z.object({
  ref: z.string().uuid(),
  name: label,
  colors: terminalColorsSchema,
});
export type TerminalAppearance = z.infer<typeof terminalAppearanceSchema>;
export type BackupTerminalTheme = z.infer<typeof backupTerminalThemeSchema>;
