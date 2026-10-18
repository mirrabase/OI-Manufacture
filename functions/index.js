const { initializeApp, getApps } = require("firebase-admin/app")
const { getFirestore } = require("firebase-admin/firestore")
const { defineSecret, defineString } = require("firebase-functions/params")
const { HttpsError, onCall, onRequest } = require("firebase-functions/v2/https")
const { onDocumentUpdated } = require("firebase-functions/v2/firestore")
const { verifyKaseraSignature } = require("./kasera")
const {
  beginKaseraCheckout,
  confirmManualPayment,
  kaseraRequest,
  processKaseraEvent,
  sendRfqEmailForChange,
} = require("./workflow")
const {
  getCustomerShippingRatePreview,
  getCustomerShippingRates,
  saveCustomerShippingAddress,
  searchShippingLocations,
  selectCustomerShippingRate,
} = require("./shipping-workflow")
const { getCustomerProductionLeadTime } = require("./production-estimate")
const { createManufacturerNotifications } = require("./notification-workflow")

if (!getApps().length) initializeApp()
const db = getFirestore()
const apiKey = defineSecret("KASERA_API_KEY")
const webhookSecret = defineSecret("KASERA_WEBHOOK_SECRET")
const resendApiKey = defineSecret("RESEND_API_KEY")
const rajaOngkirApiKey = defineSecret("RAJAONGKIR_API_KEY")
const appOrigin = defineString("CUSTOMER_APP_ORIGIN", {
  default: "http://localhost:3001",
})
const resendFrom = defineString("RESEND_FROM", {
  default: "OI Manufacture <quotes@notify.mirrabase.com>",
})

exports.getCustomerProductionLeadTime = onCall(async (request) => {
  try {
    return await getCustomerProductionLeadTime({
      db,
      uid: request.auth?.uid,
      organizationId: request.data?.organizationId,
      materialName: request.data?.materialName,
      process: request.data?.process,
      dimensionsMm: request.data?.dimensionsMm,
      plannedHours: request.data?.plannedHours,
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error("Production lead time estimate failed:", error.message)
    throw new HttpsError("unavailable", "Production availability could not be estimated.")
  }
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

exports.searchShippingLocations = onCall(
  { secrets: [rajaOngkirApiKey] },
  async (request) => {
    try {
      return await searchShippingLocations({
        uid: request.auth?.uid,
        apiKey: rajaOngkirApiKey.value(),
        scope: request.data?.scope,
        search: request.data?.search,
      })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error("Shipping destination search failed:", error.message)
      throw new HttpsError("unavailable", "Shipping destinations could not be searched.")
    }
  }
)

exports.getCustomerShippingRates = onCall(
  { secrets: [rajaOngkirApiKey] },
  async (request) => {
    try {
      return await getCustomerShippingRates({
        db,
        uid: request.auth?.uid,
        rfqId: request.data?.rfqId,
        apiKey: rajaOngkirApiKey.value(),
      })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error("Shipping rate calculation failed:", error.message)
      throw new HttpsError("unavailable", "Shipping rates could not be calculated.")
    }
  }
)

exports.getCustomerShippingRatePreview = onCall(
  { secrets: [rajaOngkirApiKey] },
  async (request) => {
    try {
      return await getCustomerShippingRatePreview({
        db,
        uid: request.auth?.uid,
        organizationId: request.data?.organizationId,
        destination: request.data?.destination,
        weightGrams: request.data?.weightGrams,
        dimensionsMm: request.data?.dimensionsMm,
        apiKey: rajaOngkirApiKey.value(),
      })
    } catch (error) {
      if (error instanceof HttpsError) throw error
      console.error("Shipping rate preview failed:", error.message)
      throw new HttpsError("unavailable", "Shipping rates could not be calculated.")
    }
  }
)

exports.saveCustomerShippingAddress = onCall(async (request) => {
  try {
    return await saveCustomerShippingAddress({
      db,
      uid: request.auth?.uid,
      rfqId: request.data?.rfqId,
      address: request.data?.address,
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error("Customer shipping address save failed:", error.message)
    throw new HttpsError("internal", "Delivery details could not be saved.")
  }
})

exports.selectCustomerShippingRate = onCall(async (request) => {
  try {
    await selectCustomerShippingRate({
      db,
      uid: request.auth?.uid,
      rfqId: request.data?.rfqId,
      rateId: request.data?.rateId,
    })
    return { ok: true }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    console.error("Shipping service selection failed:", error.message)
    throw new HttpsError("internal", "Shipping service could not be saved.")
  }
})

exports.sendRfqEmailUpdates = onDocumentUpdated(
  { document: "rfqs/{rfqId}", secrets: [resendApiKey] },
  async (event) => {
    await sendRfqEmailForChange({
      before: event.data.before.data(),
      after: event.data.after.data(),
      rfqId: event.params.rfqId,
      apiKey: resendApiKey.value(),
      from: resendFrom.value(),
      appOrigin: appOrigin.value(),
    })
  }
)

exports.createManufacturerNotifications = onDocumentUpdated(
  { document: "rfqs/{rfqId}" },
  async (event) => createManufacturerNotifications(db, event)
)

exports.kaseraWebhook = onRequest(
  { secrets: [apiKey, webhookSecret, resendApiKey] },
  async (request, response) => {
    if (request.method === "GET" || request.method === "HEAD")
      return response.status(200).send("Kasera webhook is ready")
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
      await processKaseraEvent({
        db,
        event,
        payment,
      })
      return response.status(200).send("ok")
    } catch (error) {
      console.error("Kasera webhook processing failed:", error.message)
      return response.status(400).send("Payment event could not be verified")
    }
  }
)

Object.assign(exports, require("./ai-assistant"))
