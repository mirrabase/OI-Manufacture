import { Hono } from "hono"
import { z } from "genkit"
import type { AppDependencies, ServerEnv } from "../shared/types.ts"
import { AppError } from "../shared/errors.ts"
import { readJson } from "../shared/http.ts"
import {
  beginKaseraCheckout,
  confirmManualPayment,
  kaseraRequest,
  processKaseraEvent,
} from "../modules/payments/service.ts"
import { verifyKaseraSignature } from "../modules/payments/kasera.ts"
import { applyRfqEffects } from "../modules/rfqs/effects.ts"

export function paymentsRoutes({
  db,
  env = process.env,
}: Pick<AppDependencies, "db" | "env">) {
  const app = new Hono<ServerEnv>()
  app.post("/payments/kasera/checkout", async (context) => {
    const body = await readJson(
      context,
      z.object({ rfqId: z.string(), returnUrl: z.string() })
    )
    if (
      process.env.FIRESTORE_EMULATOR_HOST &&
      !env.KASERA_API_KEY?.startsWith("kp_test_")
    ) {
      throw new AppError(
        "failed-precondition",
        "Local checkout requires a Kasera test API key."
      )
    }
    return context.json(
      await beginKaseraCheckout({
        db,
        uid: context.get("uid"),
        rfqId: body.rfqId,
        returnUrl: body.returnUrl,
        apiKey: env.KASERA_API_KEY,
        appOrigin: env.CUSTOMER_APP_ORIGIN || "http://localhost:3001",
      })
    )
  })

  app.post("/payments/manual-confirm", async (context) => {
    const body = await readJson(context, z.object({ rfqId: z.string() }))
    const ref = db.doc(`rfqs/${body.rfqId}`)
    const beforeSnapshot = await ref.get()
    const before = beforeSnapshot.data()!
    await confirmManualPayment({
      db,
      uid: context.get("uid"),
      rfqId: body.rfqId,
    })
    const after = await ref.get()
    await applyRfqEffects({ db, rfqId: body.rfqId, before, after, env })
    return context.json({ ok: true })
  })

  app.on(["GET", "HEAD", "POST"], "/webhooks/kasera", async (context) => {
    if (["GET", "HEAD"].includes(context.req.method))
      return context.body("Kasera webhook is ready", 200)
    const rawBody = await context.req.text()
    if (
      !verifyKaseraSignature(
        rawBody,
        context.req.header("Kasera-Signature-V1"),
        env.KASERA_WEBHOOK_SECRET || ""
      )
    )
      return context.text("Invalid signature", 400)
    let event
    try {
      if (
        process.env.FIRESTORE_EMULATOR_HOST &&
        !env.KASERA_API_KEY?.startsWith("kp_test_")
      )
        return context.text("Local webhook requires a Kasera test API key", 400)
      event = JSON.parse(rawBody)
      if (
        !event ||
        !["payment.paid", "payment.expired", "payment.failed"].includes(
          event.type
        )
      )
        return context.text("Unsupported event", 400)
      const attempt = await db
        .doc(`kaseraPaymentAttempts/${event.data?.external_id}`)
        .get()
      const rfqId = attempt.data()?.rfqId
      const ref = typeof rfqId === "string" ? db.doc(`rfqs/${rfqId}`) : null
      const beforeSnapshot = ref ? await ref.get() : null
      const before = beforeSnapshot?.data()!
      const payment = await kaseraRequest(
        env.KASERA_API_KEY,
        `https://pay.kasera.id/v1/transactions/${encodeURIComponent(event.data?.payment_request_id || "")}`
      )
      await processKaseraEvent({ db, event, payment })
      if (ref && before)
        await applyRfqEffects({
          db,
          rfqId,
          before,
          after: await ref.get(),
          env,
        })
      return context.text("ok")
    } catch (error) {
      console.error(
        "Kasera webhook processing failed:",
        error instanceof Error ? error.message : "unknown error"
      )
      return context.text("Payment event could not be verified", 400)
    }
  })
  return app
}
