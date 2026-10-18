import { Hono } from "hono"
import { z } from "genkit"
import type { AppDependencies, ServerEnv } from "../shared/types.ts"
import { readJson } from "../shared/http.ts"
import {
  getCustomerShippingRatePreview,
  getCustomerShippingRates,
  saveCustomerShippingAddress,
  searchShippingLocations,
  selectCustomerShippingRate,
} from "../modules/shipping/service.ts"

export function shippingRoutes({
  db,
  env = process.env,
}: Pick<AppDependencies, "db" | "env">) {
  const app = new Hono<ServerEnv>()
  app.post("/locations", async (context) => {
    const body = await readJson(
      context,
      z.object({ scope: z.string(), search: z.string() })
    )
    return context.json(
      await searchShippingLocations({
        uid: context.get("uid"),
        apiKey: env.RAJAONGKIR_API_KEY,
        scope: body.scope,
        search: body.search,
      })
    )
  })

  app.post("/rates", async (context) => {
    const body = await readJson(context, z.object({ rfqId: z.string() }))
    return context.json(
      await getCustomerShippingRates({
        db,
        uid: context.get("uid"),
        apiKey: env.RAJAONGKIR_API_KEY,
        rfqId: body.rfqId,
      })
    )
  })

  app.post("/preview", async (context) => {
    const body = await readJson(
      context,
      z.object({
        organizationId: z.string(),
        destination: z.object({
          id: z.number(),
          label: z.string(),
          scope: z.enum(["domestic", "international"]),
        }),
        weightGrams: z.number(),
        dimensionsMm: z.array(z.number()),
      })
    )
    return context.json(
      await getCustomerShippingRatePreview({
        db,
        uid: context.get("uid"),
        apiKey: env.RAJAONGKIR_API_KEY,
        organizationId: body.organizationId,
        destination: body.destination,
        weightGrams: body.weightGrams,
        dimensionsMm: body.dimensionsMm,
      })
    )
  })

  app.post("/address", async (context) => {
    const body = await readJson(
      context,
      z.object({ rfqId: z.string(), address: z.unknown() })
    )
    return context.json(
      await saveCustomerShippingAddress({
        db,
        uid: context.get("uid"),
        rfqId: body.rfqId,
        address: body.address,
      })
    )
  })

  app.post("/select", async (context) => {
    const body = await readJson(
      context,
      z.object({ rfqId: z.string(), rateId: z.string() })
    )
    await selectCustomerShippingRate({
      db,
      uid: context.get("uid"),
      rfqId: body.rfqId,
      rateId: body.rateId,
    })
    return context.json({ ok: true })
  })
  return app
}
