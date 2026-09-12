import { z } from "zod";
const cursor = z
  .object({
    updatedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?$/),
    id: z.number().int().positive().safe(),
  })
  .strict();
export function parseConversationCursor(
  value: unknown,
): z.infer<typeof cursor> | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 256)
    throw Error("INVALID_CONVERSATION_CURSOR");
  try {
    return cursor.parse(JSON.parse(value));
  } catch {
    throw Error("INVALID_CONVERSATION_CURSOR");
  }
}
