import { z } from "zod";
import type { UiPreferences } from "./ui-preferences.js";
/** Portable display settings. No authentication, command behavior or storage origin fields. */
export const desktopAppearanceSchema = z.object({
  theme: z
    .enum([
      "dark",
      "light",
      "system",
      "dracula",
      "catppuccin",
      "nord",
      "solarized",
      "tokyo-night",
      "one-dark",
      "gruvbox",
    ])
    .optional(),
  fontSize: z.enum(["xs", "sm", "md", "lg", "xl"]).optional(),
  accentColor: z
    .string()
    .regex(/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/)
    .transform((value) =>
      value.length === 4
        ? "#" +
          [...value.slice(1)]
            .map((ch) => ch + ch)
            .join("")
            .toLowerCase()
        : value.toLowerCase(),
    )
    .optional(),
  // Stored as JSON text to match user_preferences and localStorage. Destination
  // IDs are bounded and portable across versions; this grants no capabilities.
  hiddenRailTabs: z
    .string()
    .max(4096)
    .transform((raw, ctx) => {
      try {
        const ids = z
          .array(
            z
              .string()
              .max(64)
              .regex(/^[a-z][a-z0-9_-]*$/),
          )
          .max(64)
          .parse(JSON.parse(raw));
        return JSON.stringify([...new Set(ids)]);
      } catch {
        ctx.addIssue({
          code: "custom",
          message: "Invalid navigation visibility settings",
        });
        return z.NEVER;
      }
    })
    .optional(),
  language: z
    .string()
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
    .optional(),
});
export type DesktopAppearance = z.infer<typeof desktopAppearanceSchema>;
export interface DesktopConfiguration {
  layout?: import("./desktop-layout.js").DesktopLayout;
  localTunnels?: unknown[];
  appearance?: DesktopAppearance;
  preferences?: UiPreferences;
}
