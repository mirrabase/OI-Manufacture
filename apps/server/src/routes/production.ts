import { Hono } from "hono"
import { z } from "genkit"
import type { AppDependencies, ServerEnv } from "../shared/types.ts"
import { readJson } from "../shared/http.ts"
import { getCustomerProductionLeadTime } from "../modules/production/service.ts"

export function productionRoutes({ db }: Pick<AppDependencies, "db">) {
  const app = new Hono<ServerEnv>()
  app.post("/lead-time", async (context) => {
    const body = await readJson(
      context,
      z.object({
        organizationId: z.string(),
        materialName: z.string(),
        process: z.string(),
        dimensionsMm: z.array(z.number()),
        plannedHours: z.number(),
      })
    )
    return context.json(
      await getCustomerProductionLeadTime({
        db,
        uid: context.get("uid"),
        organizationId: body.organizationId,
        materialName: body.materialName,
        process: body.process,
        dimensionsMm: body.dimensionsMm,
        plannedHours: body.plannedHours,
      })
    )
  })
  return app
}
