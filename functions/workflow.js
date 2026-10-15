const { randomUUID } = require("node:crypto")
const { FieldValue } = require("firebase-admin/firestore")
const { HttpsError } = require("firebase-functions/v2/https")
const { isKaseraCheckoutUrl } = require("./kasera")

const PAYMENT_API = "https://pay.kasera.id/v1/transactions"

function productionOrder(rfqId, request, now) {
  return {
    rfqId,
    status: "Preparing Production",
    materialId: "",
    equipmentId: "",
    plannedGrams:
      request.estimate?.status === "ready" && request.estimate.gramsPerUnit
        ? Math.round(
            request.estimate.gramsPerUnit * request.requirements.quantity * 1000
          ) / 1000
        : 0,
    plannedHours:
      request.estimate?.status === "ready" && request.estimate.secondsPerUnit
        ? (request.estimate.secondsPerUnit * request.requirements.quantity) /
          3600
        : 0,
    reservedKg: 0,
    createdAt: now,
    updatedAt: now,
  }
}

async function kaseraRequest(apiKey, url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.idempotencyKey
        ? { "Idempotency-Key": options.idempotencyKey }
        : {}),
    },
    signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const error = new Error(`Kasera request failed (${response.status}).`)
    error.status = response.status
    error.payload = payload
    throw error
  }
  return payload
}

function makeReturnUrl(value, appOrigin, rfqId) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new HttpsError(
      "invalid-argument",
      "Return to the customer request page before paying."
    )
  }
  if (url.origin !== appOrigin || url.pathname !== "/portal/quotes/detail") {
    throw new HttpsError(
      "invalid-argument",
      "Payment return URL is not allowed."
    )
  }
  if (
    url.searchParams.get("rfqId") !== rfqId &&
    url.searchParams.get("id") !== rfqId
  ) {
    throw new HttpsError(
      "invalid-argument",
      "Payment return URL does not match this request."
    )
  }
  url.searchParams.set("rfqId", rfqId)
  url.searchParams.delete("id")
  url.searchParams.set("payment", "return")
  return url.toString()
}

async function beginKaseraCheckout({
  db,
  uid,
  rfqId,
  returnUrl,
  appOrigin,
  apiKey,
  paymentApiUrl = PAYMENT_API,
}) {
  if (!uid)
    throw new HttpsError("unauthenticated", "Sign in to pay for this request.")
  if (typeof rfqId !== "string" || !rfqId.trim())
    throw new HttpsError("invalid-argument", "Request ID is required.")
  const kaseraReturnUrl = makeReturnUrl(returnUrl, appOrigin, rfqId)
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const prepared = await db.runTransaction(async (transaction) => {
    const rfqSnapshot = await transaction.get(rfqRef)
    if (!rfqSnapshot.exists)
      throw new HttpsError("not-found", "Request not found.")
    const rfq = rfqSnapshot.data()
    if (rfq.ownerUid !== uid)
      throw new HttpsError(
        "permission-denied",
        "You cannot pay for another customer's request."
      )
    if (
      rfq.status !== "Quoted" ||
      rfq.paymentStatus !== "Unpaid" ||
      !Number.isSafeInteger(rfq.quoteTotal) ||
      rfq.quoteTotal < 1
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Only an unpaid quotation can be paid."
      )
    }

    const activeId = rfq.activeKaseraPaymentAttemptId
    const activeRef = activeId
      ? db.doc(`kaseraPaymentAttempts/${activeId}`)
      : null
    const activeSnapshot = activeRef ? await transaction.get(activeRef) : null
    const active = activeSnapshot?.exists ? activeSnapshot.data() : null
    const now = Date.now()
    if (
      active &&
      active.status === "pending" &&
      active.expiresAt > now &&
      active.checkoutUrl
    ) {
      return { attemptId: activeId, attempt: active, rfq }
    }
    if (active && active.status === "creating")
      return { attemptId: activeId, attempt: active, rfq }

    if (active && active.status === "pending" && active.expiresAt <= now) {
      transaction.update(activeRef, { status: "expired", updatedAt: now })
    }
    const attemptId = randomUUID()
    const attemptRef = db.doc(`kaseraPaymentAttempts/${attemptId}`)
    const attempt = {
      rfqId,
      ownerUid: uid,
      quoteTotal: rfq.quoteTotal,
      status: "creating",
      createdAt: now,
      updatedAt: now,
    }
    transaction.create(attemptRef, attempt)
    transaction.update(rfqRef, { activeKaseraPaymentAttemptId: attemptId })
    return { attemptId, attempt, rfq }
  })

  if (prepared.attempt.checkoutUrl && prepared.attempt.status === "pending") {
    return {
      checkoutUrl: prepared.attempt.checkoutUrl,
      expiresAt: prepared.attempt.expiresAt,
    }
  }

  const requestBody = {
    amount: prepared.rfq.quoteTotal,
    fee_bearer: "customer",
    description: `Manufacturing request ${rfqId}`.slice(0, 255),
    external_id: prepared.attemptId,
    merchant_ref: rfqId,
    customer: {
      ...(prepared.rfq.customer?.name
        ? { name: prepared.rfq.customer.name }
        : {}),
      ...(prepared.rfq.customer?.email
        ? { email: prepared.rfq.customer.email }
        : {}),
    },
    checkout: {},
    return_url: kaseraReturnUrl,
  }
  let payment
  try {
    payment = await kaseraRequest(apiKey, paymentApiUrl, {
      method: "POST",
      body: JSON.stringify(requestBody),
      idempotencyKey: prepared.attemptId,
    })
  } catch (error) {
    if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      const attemptRef = db.doc(`kaseraPaymentAttempts/${prepared.attemptId}`)
      await db.runTransaction(async (transaction) => {
        const [attemptSnapshot, rfqSnapshot] = await Promise.all([
          transaction.get(attemptRef),
          transaction.get(rfqRef),
        ])
        if (!attemptSnapshot.exists || !rfqSnapshot.exists) return
        transaction.update(attemptRef, {
          status: "failed",
          updatedAt: Date.now(),
        })
        if (
          rfqSnapshot.data().activeKaseraPaymentAttemptId === prepared.attemptId
        ) {
          transaction.update(rfqRef, {
            activeKaseraPaymentAttemptId: FieldValue.delete(),
          })
        }
      })
      throw new HttpsError(
        "failed-precondition",
        "Kasera rejected this quotation or payment setup. Check the amount limits and enabled methods."
      )
    }
    throw new HttpsError(
      "unavailable",
      "Kasera could not create checkout. Retry in a moment."
    )
  }
  if (
    !isKaseraCheckoutUrl(payment?.checkout_url) ||
    payment?.currency !== "IDR" ||
    payment?.net !== prepared.rfq.quoteTotal ||
    !Number.isSafeInteger(payment?.amount) ||
    !Number.isFinite(Date.parse(payment?.expires_at))
  ) {
    throw new HttpsError(
      "data-loss",
      "Kasera returned an invalid checkout response."
    )
  }
  const attemptRef = db.doc(`kaseraPaymentAttempts/${prepared.attemptId}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef)
    if (
      !snapshot.exists ||
      snapshot.data().status === "paid" ||
      snapshot.data().status === "duplicatePaid"
    )
      return
    transaction.update(attemptRef, {
      paymentRequestId: payment.id,
      checkoutUrl: payment.checkout_url,
      amount: payment.amount,
      net: payment.net,
      expiresAt: Date.parse(payment.expires_at),
      status: "pending",
      updatedAt: Date.now(),
    })
  })
  return {
    checkoutUrl: payment.checkout_url,
    expiresAt: Date.parse(payment.expires_at),
  }
}

async function confirmManualPayment({ db, uid, rfqId }) {
  if (!uid)
    throw new HttpsError(
      "unauthenticated",
      "Sign in as Manufacturer to confirm payment."
    )
  if (typeof rfqId !== "string" || !rfqId.trim())
    throw new HttpsError("invalid-argument", "Request ID is required.")
  const allowlist = await db.doc(`manufacturers/${uid}`).get()
  if (!allowlist.exists || allowlist.data().active !== true)
    throw new HttpsError(
      "permission-denied",
      "Only an active Manufacturer can confirm external payment."
    )
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const planRef = db.doc(`productionOrders/${rfqId}`)
  await db.runTransaction(async (transaction) => {
    const rfqSnapshot = await transaction.get(rfqRef)
    if (!rfqSnapshot.exists)
      throw new HttpsError("not-found", "Request not found.")
    const rfq = rfqSnapshot.data()
    const planSnapshot = await transaction.get(planRef)
    const activeId = rfq.activeKaseraPaymentAttemptId
    const activeRef = activeId
      ? db.doc(`kaseraPaymentAttempts/${activeId}`)
      : null
    const activeSnapshot = activeRef ? await transaction.get(activeRef) : null
    const active = activeSnapshot?.exists ? activeSnapshot.data() : null
    if (
      active &&
      ["creating", "pending"].includes(active.status) &&
      (!active.expiresAt || active.expiresAt > Date.now())
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Kasera checkout is still active. Wait for it to expire before confirming an external payment."
      )
    }
    if (
      rfq.status !== "Quoted" ||
      rfq.paymentStatus !== "Unpaid" ||
      !Number.isSafeInteger(rfq.quoteTotal) ||
      rfq.quoteTotal < 1
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Only an unpaid, quoted request can be confirmed as paid."
      )
    }
    if (planSnapshot.exists)
      throw new HttpsError(
        "already-exists",
        "A production plan already exists for this request."
      )
    const now = Date.now()
    transaction.update(rfqRef, {
      status: "Preparing Production",
      paymentStatus: "Paid",
      paymentConfirmedBy: "manufacturer",
      paidAt: now,
      activeKaseraPaymentAttemptId: FieldValue.delete(),
    })
    transaction.create(planRef, productionOrder(rfqId, rfq, now))
  })
}

async function processKaseraEvent({ db, event, payment }) {
  const data = event.data || {}
  const attemptId = data.external_id
  if (!event.id || !attemptId || typeof data.payment_request_id !== "string") {
    throw new Error("Kasera event is missing its payment reference.")
  }
  const attemptRef = db.doc(`kaseraPaymentAttempts/${attemptId}`)
  const eventRef = db.doc(`kaseraWebhookEvents/${event.id}`)
  const attemptSnapshot = await attemptRef.get()
  if (!attemptSnapshot.exists)
    throw new Error("Kasera payment attempt was not found.")
  const attempt = attemptSnapshot.data()
  const rfqRef = db.doc(`rfqs/${attempt.rfqId}`)
  const planRef = db.doc(`productionOrders/${attempt.rfqId}`)
  await db.runTransaction(async (transaction) => {
    const [eventSnapshot, attemptCurrent, rfqSnapshot, planSnapshot] =
      await Promise.all([
        transaction.get(eventRef),
        transaction.get(attemptRef),
        transaction.get(rfqRef),
        transaction.get(planRef),
      ])
    if (eventSnapshot.exists) return
    if (!attemptCurrent.exists || !rfqSnapshot.exists)
      throw new Error("Kasera payment request no longer exists.")
    const currentAttempt = attemptCurrent.data()
    const rfq = rfqSnapshot.data()
    const now = Date.now()
    if (
      payment.id !== data.payment_request_id ||
      payment.external_id !== attemptId ||
      payment.merchant_ref !== attempt.rfqId ||
      payment.currency !== "IDR" ||
      payment.amount !== data.amount ||
      payment.net !== attempt.quoteTotal
    ) {
      throw new Error("Kasera transaction does not match the quoted request.")
    }
    transaction.create(eventRef, {
      type: event.type,
      attemptId,
      paymentRequestId: payment.id,
      receivedAt: now,
    })

    if (payment.status === "expired" || payment.status === "failed") {
      transaction.update(attemptRef, { status: payment.status, updatedAt: now })
      if (rfq.activeKaseraPaymentAttemptId === attemptId) {
        transaction.update(rfqRef, {
          activeKaseraPaymentAttemptId: FieldValue.delete(),
        })
      }
      return
    }
    if (payment.status !== "succeeded")
      throw new Error("Kasera transaction is not paid.")

    if (rfq.paymentStatus === "Paid") {
      if (rfq.kaseraPaymentRequestId !== payment.id) {
        transaction.update(rfqRef, {
          paymentReviewRequired: true,
          paymentReviewReason:
            "Another payment was received after this request was already marked Paid. Review the Kasera transaction.",
        })
        transaction.update(attemptRef, {
          status: "duplicatePaid",
          paymentRequestId: payment.id,
          amount: payment.amount,
          updatedAt: now,
        })
      } else {
        transaction.update(attemptRef, {
          status: "paid",
          paymentRequestId: payment.id,
          amount: payment.amount,
          updatedAt: now,
        })
      }
    } else if (
      rfq.status === "Quoted" &&
      rfq.paymentStatus === "Unpaid" &&
      rfq.quoteTotal === currentAttempt.quoteTotal &&
      !planSnapshot.exists
    ) {
      transaction.update(rfqRef, {
        status: "Preparing Production",
        paymentStatus: "Paid",
        paymentConfirmedBy: "kasera",
        kaseraPaymentRequestId: payment.id,
        paidAt: Date.parse(payment.paid_at) || now,
        activeKaseraPaymentAttemptId: FieldValue.delete(),
      })
      transaction.create(planRef, productionOrder(attempt.rfqId, rfq, now))
      transaction.update(attemptRef, {
        status: "paid",
        paymentRequestId: payment.id,
        amount: payment.amount,
        updatedAt: now,
      })
    } else {
      transaction.update(rfqRef, {
        paymentReviewRequired: true,
        paymentReviewReason:
          "A Kasera payment arrived for a quotation that has changed or is no longer unpaid. Review the transaction.",
      })
      transaction.update(attemptRef, {
        status: "needsReview",
        paymentRequestId: payment.id,
        amount: payment.amount,
        updatedAt: now,
      })
    }
    if (currentAttempt.status === "creating")
      transaction.update(attemptRef, {
        checkoutUrl: payment.checkout_url || "",
      })
  })
}

module.exports = {
  beginKaseraCheckout,
  confirmManualPayment,
  processKaseraEvent,
  kaseraRequest,
}
