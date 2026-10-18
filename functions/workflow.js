const { randomUUID } = require("node:crypto")
const { FieldValue } = require("firebase-admin/firestore")
const { HttpsError } = require("firebase-functions/v2/https")
const { isKaseraCheckoutUrl } = require("./kasera")

const PAYMENT_API = "https://pay.kasera.id/v1/transactions"
const formatIDR = (amount) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount)

function shippingAmount(rfq) {
  if (!rfq.shipping?.address) {
    throw new HttpsError("failed-precondition", "Add a delivery address and choose a shipping service before checkout.")
  }
  const selection = rfq.shipping?.selection
  if (!selection) {
    throw new HttpsError("failed-precondition", "Choose a shipping service before checkout.")
  }
  const amount = selection?.cost ?? 0
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new HttpsError("data-loss", "The saved shipping amount is invalid.")
  }
  return amount
}

function productionOrder(rfqId, request, now) {
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
  const allowedPaths = ["/portal/quotes/detail", "/"]
  if (url.origin !== appOrigin || !allowedPaths.includes(url.pathname)) {
    throw new HttpsError(
      "invalid-argument",
      "Payment return URL is not allowed."
    )
  }
  const paramRfqId =
    url.searchParams.get("rfqId") ||
    url.searchParams.get("id") ||
    url.searchParams.get("orderId")
  if (paramRfqId !== rfqId) {
    throw new HttpsError(
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

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character])
}

async function sendResendEmail({
  apiKey,
  from,
  to,
  subject,
  html,
  idempotencyKey,
}) {
  if (!apiKey || !to) {
    console.warn(
      "[Resend] Email skipped because its API key or recipient is missing."
    )
    return null
  }
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
    signal: AbortSignal.timeout(10000),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`Resend rejected the email (HTTP ${response.status}).`)
  }
  return payload?.id || null
}

function emailTemplate({
  heading,
  intro,
  customerName,
  rfqId,
  amount,
  details,
  link,
  totalLabel,
}) {
  const formattedAmount = new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount)
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:9px 0;border-bottom:1px solid #eee;color:#667085">${escapeHtml(label)}</td><td style="padding:9px 0;border-bottom:1px solid #eee;text-align:right;font-weight:600">${escapeHtml(value)}</td></tr>`
    )
    .join("")
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f4f5f7;padding:24px;font-family:Arial,sans-serif;color:#202124">
    <main style="max-width:560px;margin:auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <p style="margin:0 0 8px;color:#667085;font-size:12px">OI MANUFACTURE · ${escapeHtml(rfqId)}</p>
      <h1 style="margin:0 0 16px;font-size:22px">${heading}</h1>
      <p>Halo ${escapeHtml(customerName || "Customer")},</p>
      <p style="line-height:1.6;color:#475467">${intro}</p>
      <table style="width:100%;border-collapse:collapse">
        ${rows}
        <tr><td style="padding:14px 0;font-weight:700">${totalLabel}</td><td style="padding:14px 0;text-align:right;font-weight:700">${formattedAmount}</td></tr>
      </table>
      <p style="margin:24px 0;text-align:center"><a href="${escapeHtml(link)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#165dff;color:#fff;text-decoration:none;font-weight:600">Lihat detail request</a></p>
      <p style="margin:0;color:#667085;font-size:12px">OI Manufacture · Jika ada pertanyaan, balas email ini.</p>
    </main>
  </body>
</html>`
}

function emailDetails(rfq) {
  return [
    ["Produk / part", rfq.product || "3D Printed Part"],
    ...(rfq.requirements?.material
      ? [["Material", rfq.requirements.material]]
      : []),
    ...(rfq.requirements?.color ? [["Color", rfq.requirements.color]] : []),
    ...(rfq.requirements?.infillPercent !== undefined
      ? [["Infill", `${rfq.requirements.infillPercent}%`]]
      : []),
    ["Jumlah", `${rfq.requirements?.quantity || 1} unit`],
  ]
}

async function sendQuoteEmail({ apiKey, from, rfq, rfqId, appOrigin }) {
  const html = emailTemplate({
    heading: "Quotation Anda Siap",
    intro:
      "Manufacturer telah menerbitkan harga final untuk request Anda. Buka detail request untuk meninjau quotation dan melanjutkan pembayaran melalui Kasera.",
    customerName: rfq.customer?.name,
    rfqId,
    amount: rfq.quoteTotal,
    details: emailDetails(rfq),
    link: `${appOrigin}/?orderId=${encodeURIComponent(rfqId)}`,
    totalLabel: "Total quotation",
  })
  return sendResendEmail({
    apiKey,
    from,
    to: rfq.customer?.email,
    subject: `Quotation siap · ${rfqId}`,
    html,
    idempotencyKey: `quote_${rfqId}_${rfq.quotedAt || "na"}_${rfq.quoteTotal}`,
  })
}

async function sendReceiptEmail({
  apiKey,
  from,
  to,
  customerName,
  rfqId,
  product,
  quantity,
  material,
  color,
  infillPercent,
  shippingSelection,
  amount,
  paidAt,
  paymentId,
  appOrigin = "http://localhost:3001",
}) {
  const rfq = { product, requirements: { quantity, material, color, infillPercent } }
  const html = emailTemplate({
    heading: "Pembayaran Dikonfirmasi",
    intro:
      "Pembayaran untuk request Anda telah dikonfirmasi. Pesanan kini masuk ke tahap persiapan produksi.",
    customerName,
    rfqId,
    amount,
    details: [
      ...emailDetails(rfq),
      ...(shippingSelection
        ? [["Shipping", `${shippingSelection.courierName} · ${shippingSelection.service}`], ["Estimated shipping cost", formatIDR(shippingSelection.cost)]]
        : []),
      ...(paymentId ? [["ID transaksi", paymentId]] : []),
      ...(paidAt
        ? [["Dikonfirmasi pada", new Date(paidAt).toLocaleString("id-ID")]]
        : []),
    ],
    link: `${appOrigin}/?orderId=${encodeURIComponent(rfqId)}`,
    totalLabel: "Total dibayar",
  })
  return sendResendEmail({
    apiKey,
    from,
    to,
    subject: `Pembayaran dikonfirmasi · ${rfqId}`,
    html,
    idempotencyKey: `paid_${rfqId}_${paidAt || paymentId || "confirmed"}`,
  })
}

async function sendRfqEmailForChange({
  before,
  after,
  rfqId,
  apiKey,
  from,
  appOrigin = "http://localhost:3001",
}) {
  if (!after) return null
  const quoteChanged =
    after.status === "Quoted" &&
    after.paymentStatus === "Unpaid" &&
    Number.isSafeInteger(after.quoteTotal) &&
    after.quoteTotal > 0 &&
    (before?.status !== "Quoted" ||
      before.quoteTotal !== after.quoteTotal ||
      before.quotedAt !== after.quotedAt)
  if (quoteChanged) {
    return sendQuoteEmail({ apiKey, from, rfq: after, rfqId, appOrigin })
  }
  if (
    after.paymentStatus === "Paid" &&
    before?.paymentStatus !== "Paid" &&
    Number.isSafeInteger(after.quoteTotal) &&
    after.quoteTotal > 0
  ) {
    return sendReceiptEmail({
      apiKey,
      from,
      to: after.customer?.email,
      customerName: after.customer?.name,
      rfqId,
      product: after.product,
      quantity: after.requirements?.quantity,
      material: after.requirements?.material,
      color: after.requirements?.color,
      infillPercent: after.requirements?.infillPercent,
      shippingSelection: after.shipping?.selection,
      amount: after.quoteTotal + (after.shipping?.selection?.cost ?? 0),
      paidAt: after.paidAt,
      paymentId: after.kaseraPaymentRequestId,
      appOrigin,
    })
  }
  return null
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
      typeof rfq.organizationId !== "string" ||
      !Number.isSafeInteger(rfq.quoteTotal) ||
      rfq.quoteTotal < 1
    ) {
      throw new HttpsError(
        "failed-precondition",
        "Only an unpaid quotation can be paid."
      )
    }
    const shippingTotal = shippingAmount(rfq)
    const paymentTotal = rfq.quoteTotal + shippingTotal
    if (!Number.isSafeInteger(paymentTotal)) {
      throw new HttpsError("failed-precondition", "The payment total is outside the supported amount range.")
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
    payment?.amount !== prepared.attempt.amount ||
    !Number.isSafeInteger(payment?.amount) ||
    !Number.isSafeInteger(payment?.fee) ||
    payment.fee < 0 ||
    !Number.isSafeInteger(payment?.net) ||
    payment.net < 0 ||
    payment.amount !== payment.fee + payment.net ||
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
  const membership = await db.doc(`manufacturers/${uid}`).get()
  const organizationId = membership.data()?.organizationId
  const organization = typeof organizationId === "string"
    ? await db.doc(`organizations/${organizationId}`).get()
    : null
  if (
    !membership.exists ||
    membership.data().active !== true ||
    !organization?.exists ||
    organization.data().active !== true
  )
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
    if (rfq.organizationId !== organizationId)
      throw new HttpsError(
        "permission-denied",
        "You cannot confirm payment for another organization."
      )
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
    shippingAmount(rfq)
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

async function processKaseraEvent({
  db,
  event,
  payment,
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

module.exports = {
  beginKaseraCheckout,
  confirmManualPayment,
  processKaseraEvent,
  sendQuoteEmail,
  sendReceiptEmail,
  sendRfqEmailForChange,
  kaseraRequest,
}
