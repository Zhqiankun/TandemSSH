import { z } from "zod";
/** Portable dashboard arrangement, independent of React or machine-specific state. */
export const desktopLayoutSchema = z.object({
  dashboardSlots: z
    .array(
      z.object({
        key: z.string().min(1).max(128),
        id: z.enum([
          "stats_bar",
          "counters_bar",
          "quick_actions",
          "host_status",
          "recent_activity",
          "network_graph",
          "service_links",
          "homepage_preview",
        ]),
        panel: z.enum(["main", "side"]),
        order: z.number().finite().min(-100000).max(100000),
        height: z.number().finite().min(1).max(10000).nullable(),
      }),
    )
    .max(128)
    .refine((rows) => new Set(rows.map((row) => row.key)).size === rows.length)
    .nullable()
    .optional(),
  dashboardMainWidthPct: z
    .number()
    .finite()
    .min(1)
    .max(99)
    .nullable()
    .optional(),
  dashboardView: z.enum(["dashboard", "homepage"]).nullable().optional(),
});
export type DesktopLayout = z.infer<typeof desktopLayoutSchema>;
