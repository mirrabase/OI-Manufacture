import { Hono } from "hono"
import { z } from "genkit"
import type { AppDependencies, ServerEnv } from "../shared/types.ts"
import { readJson } from "../shared/http.ts"
import {
  completeProduction,
  setCustomerRequestQuote,
  startProduction,
  submitCustomerRequest,
} from "../modules/rfqs/service.ts"

export function rfqsRoutes({
  db,
  storage,
}: Pick<AppDependencies, "db" | "storage">) {
  const app = new Hono<ServerEnv>()
  app.post("/:rfqId/submit", async (context) => {
    const body = await readJson(context, z.object({ storagePath: z.string() }))
    return context.json(
      await submitCustomerRequest({
        db,
        uid: context.get("uid"),
        rfqId: context.req.param("rfqId"),
        storage,
        storagePath: body.storagePath,
      })
    )
  })

  app.put("/:rfqId/quote", async (context) => {
    const body = await readJson(context, z.object({ quoteTotal: z.number() }))
    return context.json(
      await setCustomerRequestQuote({
        db,
        uid: context.get("uid"),
        rfqId: context.req.param("rfqId"),
        quoteTotal: body.quoteTotal,
      })
    )
  })

  app.post("/:rfqId/production/start", async (context) =>
    context.json(
      await startProduction({
        db,
        uid: context.get("uid"),
        rfqId: context.req.param("rfqId"),
      })
    )
  )

  app.post("/:rfqId/production/complete", async (context) => {
    const body = await readJson(context, z.object({ actualGrams: z.number() }))
    return context.json(
      await completeProduction({
        db,
        uid: context.get("uid"),
        rfqId: context.req.param("rfqId"),
        actualGrams: body.actualGrams,
      })
    )
  })
  return app
}
