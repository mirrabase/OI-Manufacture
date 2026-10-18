import type { Firestore, DocumentData } from "firebase-admin/firestore"
import type { UserRequest } from "../../shared/types.ts"

export type KaseraEvent = {
  id: string
  type: string
  data?: { external_id?: string; payment_request_id?: string; amount?: number }
}
export type KaseraPayment = {
  id: string
  external_id: string
  merchant_ref: string
  currency: string
  amount: number
  net: number
  fee: number
  status: string
  checkout_url: string
  expires_at: string
  paid_at: string
}
import { randomUUID } from "node:crypto"
import { FieldValue } from "firebase-admin/firestore"
import { AppError } from "../../shared/errors.ts"
import { isKaseraCheckoutUrl } from "./kasera.ts"

const PAYMENT_API = "https://pay.kasera.id/v1/transactions"

function shippingAmount(rfq: DocumentData) {
  if (!rfq.shipping?.address) {
    throw new AppError(
      "failed-precondition",
      "Add a delivery address and choose a shipping service before checkout."
    )
  }
  const selection = rfq.shipping?.selection
  if (!selection) {
    throw new AppError(
      "failed-precondition",
      "Choose a shipping service before checkout."
    )
  }
  const amount = selection?.cost ?? 0
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new AppError("data-loss", "The saved shipping amount is invalid.")
  }
  return amount
}

function productionOrder(rfqId: string, request: DocumentData, now: number) {
  return {
    rfqId,
    organizationId: request.organizationId,
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

async function kaseraRequest(
  apiKey: string | undefined,
  url: string,
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<KaseraPayment> {
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
    const error = Object.assign(
      new Error(`Kasera request failed (${response.status}).`),
      { status: response.status, payload }
    )
    throw error
  }
  return payload
}

function makeReturnUrl(value: string, appOrigin: string, rfqId: string) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new AppError(
      "invalid-argument",
      "Return to the customer request page before paying."
    )
  }
  const allowedPaths = ["/portal/quotes/detail", "/"]
  if (url.origin !== appOrigin || !allowedPaths.includes(url.pathname)) {
    throw new AppError("invalid-argument", "Payment return URL is not allowed.")
  }
  const paramRfqId =
    url.searchParams.get("rfqId") ||
    url.searchParams.get("id") ||
    url.searchParams.get("orderId")
  if (paramRfqId !== rfqId) {
    throw new AppError(
      "invalid-argument",
      "Payment return URL does not match this request."
    )
  }
  if (url.pathname === "/") {
    url.searchParams.set("orderId", rfqId)
    url.searchParams.delete("rfqId")
    url.searchParams.delete("id")
  } else {
    url.searchParams.set("rfqId", rfqId)
    url.searchParams.delete("id")
    url.searchParams.delete("orderId")
  }
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
}: UserRequest & {
  returnUrl: string
  appOrigin: string
  apiKey?: string
  paymentApiUrl?: string
}) {
  if (!uid)
    throw new AppError("unauthenticated", "Sign in to pay for this request.")
  if (typeof rfqId !== "string" || !rfqId.trim())
    throw new AppError("invalid-argument", "Request ID is required.")
  const kaseraReturnUrl = makeReturnUrl(returnUrl, appOrigin, rfqId)
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const prepared = await db.runTransaction(async (transaction) => {
    const rfqSnapshot = await transaction.get(rfqRef)
    if (!rfqSnapshot.exists)
      throw new AppError("not-found", "Request not found.")
    const rfq = rfqSnapshot.data()!
    if (rfq.ownerUid !== uid)
      throw new AppError(
        "permission-denied",
        "You cannot pay for another customer's request."
      )
    if (
      rfq.status !== "Quoted" ||
      rfq.paymentStatus !== "Unpaid" ||
      typeof rfq.organizationId !== "string" ||
      !Number.isSafeInteger(rfq.quoteTotal) ||
      rfq.quoteTotal < 1
    ) {
      throw new AppError(
        "failed-precondition",
        "Only an unpaid quotation can be paid."
      )
    }
    const shippingTotal = shippingAmount(rfq)
    const paymentTotal = rfq.quoteTotal + shippingTotal
    if (!Number.isSafeInteger(paymentTotal)) {
      throw new AppError(
        "failed-precondition",
        "The payment total is outside the supported amount range."
      )
    }

    const activeId = rfq.activeKaseraPaymentAttemptId
    const activeRef = activeId
      ? db.doc(`kaseraPaymentAttempts/${activeId}`)
      : null
    const activeSnapshot = activeRef ? await transaction.get(activeRef) : null
    const active = activeSnapshot?.exists ? activeSnapshot.data()! : null
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
      transaction.update(activeRef!, { status: "expired", updatedAt: now })
    }
    const attemptId = randomUUID()
    const attemptRef = db.doc(`kaseraPaymentAttempts/${attemptId}`)
    const attempt: {
      rfqId: string
      organizationId: string
      ownerUid: string
      quoteTotal: number
      shippingTotal: number
      amount: number
      status: string
      createdAt: number
      updatedAt: number
      checkoutUrl?: string
      expiresAt?: number
    } = {
      rfqId,
      organizationId: rfq.organizationId,
      ownerUid: uid,
      quoteTotal: rfq.quoteTotal,
      shippingTotal,
      amount: paymentTotal,
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
    amount: prepared.attempt.amount,
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
    if (
      error instanceof Error &&
      "status" in error &&
      typeof error.status === "number" &&
      error.status >= 400 &&
      error.status < 500 &&
      error.status !== 429
    ) {
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
          rfqSnapshot.data()!.activeKaseraPaymentAttemptId ===
          prepared.attemptId
        ) {
          transaction.update(rfqRef, {
            activeKaseraPaymentAttemptId: FieldValue.delete(),
          })
        }
      })
      throw new AppError(
        "failed-precondition",
        "Kasera rejected this quotation or payment setup. Check the amount limits and enabled methods."
      )
    }
    throw new AppError(
      "unavailable",
      "Kasera could not create checkout. Retry in a moment."
    )
  }
  if (
    !isKaseraCheckoutUrl(payment?.checkout_url) ||
    payment?.currency !== "IDR" ||
    payment?.amount !== prepared.attempt.amount ||
    !Number.isSafeInteger(payment?.amount) ||
    !Number.isSafeInteger(payment?.fee) ||
    payment.fee < 0 ||
    !Number.isSafeInteger(payment?.net) ||
    payment.net < 0 ||
    payment.amount !== payment.fee + payment.net ||
    !Number.isFinite(Date.parse(payment?.expires_at))
  ) {
    throw new AppError(
      "data-loss",
      "Kasera returned an invalid checkout response."
    )
  }
  const attemptRef = db.doc(`kaseraPaymentAttempts/${prepared.attemptId}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(attemptRef)
    if (
      !snapshot.exists ||
      snapshot.data()!.status === "paid" ||
      snapshot.data()!.status === "duplicatePaid"
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

async function confirmManualPayment({ db, uid, rfqId }: UserRequest) {
  if (!uid)
    throw new AppError(
      "unauthenticated",
      "Sign in as Manufacturer to confirm payment."
    )
  if (typeof rfqId !== "string" || !rfqId.trim())
    throw new AppError("invalid-argument", "Request ID is required.")
  const membership = await db.doc(`manufacturers/${uid}`).get()
  const organizationId = membership.data()?.organizationId
  const organization =
    typeof organizationId === "string"
      ? await db.doc(`organizations/${organizationId}`).get()
      : null
  if (
    !membership.exists ||
    membership.data()!.active !== true ||
    !organization?.exists ||
    organization.data()!.active !== true
  )
    throw new AppError(
      "permission-denied",
      "Only an active Manufacturer can confirm external payment."
    )
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const planRef = db.doc(`productionOrders/${rfqId}`)
  await db.runTransaction(async (transaction) => {
    const rfqSnapshot = await transaction.get(rfqRef)
    if (!rfqSnapshot.exists)
      throw new AppError("not-found", "Request not found.")
    const rfq = rfqSnapshot.data()!
    if (rfq.organizationId !== organizationId)
      throw new AppError(
        "permission-denied",
        "You cannot confirm payment for another organization."
      )
    const planSnapshot = await transaction.get(planRef)
    const activeId = rfq.activeKaseraPaymentAttemptId
    const activeRef = activeId
      ? db.doc(`kaseraPaymentAttempts/${activeId}`)
      : null
    const activeSnapshot = activeRef ? await transaction.get(activeRef) : null
    const active = activeSnapshot?.exists ? activeSnapshot.data()! : null
    if (
      active &&
      ["creating", "pending"].includes(active.status) &&
      (!active.expiresAt || active.expiresAt > Date.now())
    ) {
      throw new AppError(
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
      throw new AppError(
        "failed-precondition",
        "Only an unpaid, quoted request can be confirmed as paid."
      )
    }
    shippingAmount(rfq)
    if (planSnapshot.exists)
      throw new AppError(
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

async function processKaseraEvent({
  db,
  event,
  payment,
}: {
  db: Firestore
  event: KaseraEvent
  payment: KaseraPayment
}) {
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
  const attempt = attemptSnapshot.data()!
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
    const currentAttempt = attemptCurrent.data()!
    const rfq = rfqSnapshot.data()!
    const now = Date.now()
    if (
      payment.id !== data.payment_request_id ||
      payment.external_id !== attemptId ||
      payment.merchant_ref !== attempt.rfqId ||
      payment.currency !== "IDR" ||
      typeof attempt.organizationId !== "string" ||
      attempt.organizationId !== rfq.organizationId ||
      payment.amount !== data.amount ||
      payment.amount !== currentAttempt.amount ||
      payment.net !== currentAttempt.net ||
      !Number.isSafeInteger(payment.amount) ||
      !Number.isSafeInteger(payment.net) ||
      !Number.isSafeInteger(payment.fee) ||
      payment.fee < 0 ||
      payment.net < 0 ||
      payment.amount !== payment.fee + payment.net ||
      currentAttempt.quoteTotal !== rfq.quoteTotal ||
      (currentAttempt.shippingTotal ?? 0) !==
        (rfq.shipping?.selection?.cost ?? 0) ||
      currentAttempt.amount !==
        currentAttempt.quoteTotal + (currentAttempt.shippingTotal ?? 0)
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

export {
  beginKaseraCheckout,
  confirmManualPayment,
  processKaseraEvent,
  kaseraRequest,
}
