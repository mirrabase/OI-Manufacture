import type { Context } from "hono"
import type { z } from "genkit"
import { AppError } from "./errors.ts"

export async function readJson<T extends z.ZodType>(
  context: Context,
  schema: T
): Promise<z.infer<T>> {
  let body: unknown
  try {
    body = await context.req.json()
  } catch {
    throw new AppError(
      "invalid-argument",
      "A valid JSON request body is required."
    )
  }
  const result = schema.safeParse(body)
  if (!result.success)
    throw new AppError(
      "invalid-argument",
      "The request body contains invalid or missing fields."
    )
  return result.data
}
