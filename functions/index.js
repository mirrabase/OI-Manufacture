const { initializeApp, getApps } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const { defineSecret, defineString } = require("firebase-functions/params")
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https")
const { verifyKaseraSignature } = require("./kasera")
const {
  beginKaseraCheckout,
  confirmManualPayment,
  kaseraRequest,
  processKaseraEvent,
} = require("./workflow")

if (!getApps().length) initializeApp()
const db = getFirestore()
const apiKey = defineSecret("KASERA_API_KEY")
const webhookSecret = defineSecret("KASERA_WEBHOOK_SECRET")
const appOrigin = defineString("CUSTOMER_APP_ORIGIN", {
  default: "http://localhost:3001",
})

exports.createKaseraCheckout = onCall(
  { secrets: [apiKey] },
  async (request) => {
    try {
      if (
        process.env.FUNCTIONS_EMULATOR &&
        !apiKey.value().startsWith("kp_test_")
      ) {
        throw new HttpsError(
          "failed-precondition",
          "Local checkout requires a Kasera test API key."
        )
      }
      return await beginKaseraCheckout({
        db,
        uid: request.auth?.uid,
        rfqId: request.data?.rfqId,
        returnUrl: request.data?.returnUrl,
        appOrigin: appOrigin.value(),
        apiKey: apiKey.value(),
      })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error("Kasera checkout creation failed:", error.message)
      throw new HttpsError("internal", "Kasera checkout could not be created.")
    }
  }
)

exports.confirmManualPayment = onCall(async (request) => {
  try {
    await confirmManualPayment({
      db,
      uid: request.auth?.uid,
      rfqId: request.data?.rfqId,
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error("Manual payment confirmation failed:", error.message)
    throw new HttpsError("internal", "Payment could not be confirmed.")
  }
})

exports.kaseraWebhook = onRequest(
  { secrets: [apiKey, webhookSecret] },
  async (request, response) => {
    if (request.method !== "POST")
      return response.status(405).send("Method not allowed")
    const rawBody = request.rawBody?.toString("utf8") ?? ""
    if (
      !verifyKaseraSignature(
        rawBody,
        request.get("Kasera-Signature-V1"),
        webhookSecret.value()
      )
    ) {
      return response.status(400).send("Invalid signature")
    }
    let event
    try {
      if (
        process.env.FUNCTIONS_EMULATOR &&
        !apiKey.value().startsWith("kp_test_")
      ) {
        return response
          .status(400)
          .send("Local webhook requires a Kasera test API key")
      }
      event = JSON.parse(rawBody)
      if (
        !event ||
        !["payment.paid", "payment.expired", "payment.failed"].includes(
          event.type
        )
      ) {
        return response.status(400).send("Unsupported event")
      }
      const payment = await kaseraRequest(
        apiKey.value(),
        `https://pay.kasera.id/v1/transactions/${encodeURIComponent(event.data?.payment_request_id || "")}`
      )
      await processKaseraEvent({ db, event, payment })
      return response.status(200).send("ok")
    } catch (error) {
      console.error("Kasera webhook processing failed:", error.message)
      return response.status(400).send("Payment event could not be verified")
    }
  }
)
