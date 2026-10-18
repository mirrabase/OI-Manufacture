import { Hono } from "hono"
import { z } from "genkit"
import type { ServerEnv } from "../shared/types.ts"
import { readJson } from "../shared/http.ts"
import {
  manufacturerChat,
  manufacturerOverview,
} from "../modules/ai/service.ts"

export function aiRoutes() {
  const app = new Hono<ServerEnv>()
  app.post("/chat", async (context) => {
    const body = await readJson(
      context,
      z.object({
        messages: z.array(
          z.object({ role: z.enum(["user", "assistant"]), content: z.string() })
        ),
      })
    )
    return context.json(await manufacturerChat(body, context.get("uid")))
  })

  app.post("/overview", async (context) =>
    context.json(await manufacturerOverview(context.get("uid")))
  )
  return app
}
