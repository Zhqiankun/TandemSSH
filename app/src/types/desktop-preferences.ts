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
  language: z
    .string()
    .regex(/^[a-z]{2}(?:-[A-Z]{2})?$/)
    .optional(),
});
export type DesktopAppearance = z.infer<typeof desktopAppearanceSchema>;
export interface DesktopConfiguration {
  appearance?: DesktopAppearance;
  preferences?: UiPreferences;
}
