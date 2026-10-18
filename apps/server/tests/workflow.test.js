import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { randomUUID } from "node:crypto"
import { initializeApp, deleteApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
const {
  beginKaseraCheckout,
  confirmManualPayment,
  processKaseraEvent,
} = await import("../src/modules/payments/service.ts")

process.env.METADATA_SERVER_DETECTION = "none"
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:18080"
process.env.GCLOUD_PROJECT ||= "demo-oi-manufacture"
const app = initializeApp(
  { projectId: process.env.GCLOUD_PROJECT || "demo-oi-manufacture" },
  `payment-check-${randomUUID()}`
)
const db = getFirestore(app)
const rfqIds = []
const attemptIds = []
const eventIds = []
const orderIds = []

test.before(async () => {
  await db.doc("organizations/demo").set(
    { name: "Demo Organization", active: true, acceptingRequests: true },
    { merge: true }
  )
})

test.after(async () => {
  await Promise.all([
    ...rfqIds.map((id) => db.doc(`rfqs/${id}`).delete()),
    ...orderIds.map((id) => db.doc(`productionOrders/${id}`).delete()),
    ...attemptIds.map((id) => db.doc(`kaseraPaymentAttempts/${id}`).delete()),
    ...eventIds.map((id) => db.doc(`kaseraWebhookEvents/${id}`).delete()),
    db.doc("manufacturers/payment-check-manufacturer").delete(),
  ])
  await deleteApp(app)
})

function newRequest(overrides = {}) {
  const id = `payment-check-${randomUUID()}`
  rfqIds.push(id)
  return {
    id,
    organizationId: "demo",
    ownerUid: "payment-check-customer",
    customer: { name: "Test Customer" },
    product: "Payment check",
    requirements: { quantity: 1 },
    status: "Quoted",
    paymentStatus: "Unpaid",
    quoteTotal: 50_000,
    shipping: {
      address: { recipientName: "Test Customer", phone: "08123456789", addressLine: "Test street 1", postalCode: "40123", destination: { scope: "domestic", id: 123, label: "Bandung" } },
      selection: { id: "test:FREE:0:IDR", courierCode: "test", courierName: "Test courier", service: "FREE", description: "Test fixture", cost: 0, etd: "1 day", currency: "IDR" },
    },
    createdAt: Date.now(),
    ...overrides,
  }
}

function paymentEvent(
  attemptId,
  paymentId,
  amount,
  id = `evt-${randomUUID()}`
) {
  eventIds.push(id)
  return {
    id,
    type: "payment.paid",
    data: {
      payment_request_id: paymentId,
      external_id: attemptId,
      merchant_ref: rfqForAttempt.get(attemptId),
      amount,
      currency: "IDR",
    },
  }
}

const rfqForAttempt = new Map()

function paymentRecord(
  attemptId,
  rfqId,
  amount,
  fee = 600,
  net = 49_400,
  status = "succeeded"
) {
  return {
    id: `payreq-${attemptId}`,
    status,
    currency: "IDR",
    amount,
    fee,
    net,
    external_id: attemptId,
    merchant_ref: rfqId,
    paid_at: status === "succeeded" ? new Date().toISOString() : null,
  }
}

test("creates one hosted checkout for the owner's exact quote and records Kasera fees", async () => {
  const rfq = newRequest()
  await db.doc(`rfqs/${rfq.id}`).set(rfq)
  let calls = 0
  let payload
  let idempotencyKey
  const server = createServer(async (request, response) => {
    calls++
    idempotencyKey = request.headers["idempotency-key"]
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    payload = JSON.parse(Buffer.concat(chunks).toString())
    attemptIds.push(payload.external_id)
    if (payload.amount === 99_999) {
      response.writeHead(422, { "content-type": "application/json" })
      response.end(JSON.stringify({ error: "amount_too_large" }))
      return
    }
    response.writeHead(201, { "content-type": "application/json" })
    response.end(
      JSON.stringify({
        id: `payreq-${payload.external_id}`,
        currency: "IDR",
        amount: rfq.quoteTotal,
        fee: 600,
        net: rfq.quoteTotal - 600,
        checkout_url: `https://pay.kasera.id/p/${payload.external_id}`,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      })
    )
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const paymentApiUrl = `http://127.0.0.1:${server.address().port}/v1/transactions`
    const args = {
      db,
      uid: rfq.ownerUid,
      rfqId: rfq.id,
      returnUrl: `http://localhost:3001/portal/quotes/detail?id=${rfq.id}`,
      appOrigin: "http://localhost:3001",
      apiKey: "kp_test_local",
      paymentApiUrl,
    }
    const first = await beginKaseraCheckout(args)
    const second = await beginKaseraCheckout(args)
    assert.equal(first.checkoutUrl, `https://pay.kasera.id/p/${idempotencyKey}`)
    assert.equal(second.checkoutUrl, first.checkoutUrl)
    assert.equal(calls, 1)
    assert.equal(
      idempotencyKey,
      (await db.doc(`rfqs/${rfq.id}`).get()).data().activeKaseraPaymentAttemptId
    )
    assert.equal(payload.amount, rfq.quoteTotal)
    assert.equal("fee_bearer" in payload, false)
    assert.equal(payload.merchant_ref, rfq.id)
    assert.match(payload.return_url, new RegExp(`rfqId=${rfq.id}`))
    await db
      .doc(`kaseraPaymentAttempts/${idempotencyKey}`)
      .update({ expiresAt: Date.now() - 1 })
    const previousAttemptId = idempotencyKey
    const retry = await beginKaseraCheckout(args)
    assert.equal(calls, 2)
    assert.notEqual(idempotencyKey, previousAttemptId)
    assert.equal(retry.checkoutUrl, `https://pay.kasera.id/p/${idempotencyKey}`)
    assert.equal(
      (await db.doc(`rfqs/${rfq.id}`).get()).data()
        .activeKaseraPaymentAttemptId,
      idempotencyKey
    )

    await assert.rejects(
      beginKaseraCheckout({ ...args, uid: "somebody-else" }),
      { code: "permission-denied" }
    )
    const noDelivery = newRequest()
    delete noDelivery.shipping
    await db.doc(`rfqs/${noDelivery.id}`).set(noDelivery)
    await assert.rejects(
      beginKaseraCheckout({
        ...args,
        rfqId: noDelivery.id,
        returnUrl: `http://localhost:3001/portal/quotes/detail?id=${noDelivery.id}`,
      }),
      { code: "failed-precondition" }
    )
    const draft = newRequest({ status: "Submitted", quoteTotal: null })
    await db.doc(`rfqs/${draft.id}`).set(draft)
    await assert.rejects(
      beginKaseraCheckout({
        ...args,
        rfqId: draft.id,
        returnUrl: `http://localhost:3001/portal/quotes/detail?id=${draft.id}`,
      }),
      { code: "failed-precondition" }
    )
    const rejected = newRequest({ quoteTotal: 99_999 })
    await db.doc(`rfqs/${rejected.id}`).set(rejected)
    await assert.rejects(
      beginKaseraCheckout({
        ...args,
        rfqId: rejected.id,
        returnUrl: `http://localhost:3001/portal/quotes/detail?id=${rejected.id}`,
      }),
      { code: "failed-precondition" }
    )
    const rootReq = newRequest()
    await db.doc(`rfqs/${rootReq.id}`).set(rootReq)
    const rootCheckout = await beginKaseraCheckout({
      ...args,
      rfqId: rootReq.id,
      returnUrl: `http://localhost:3001/?orderId=${rootReq.id}`,
    })
    assert.match(rootCheckout.checkoutUrl, /^https:\/\/pay\.kasera\.id\/p\//)
    assert.equal(
      payload.return_url,
      `http://localhost:3001/?orderId=${rootReq.id}&payment=return`
    )
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("charges the selected shipping amount without changing the Manufacturer quotation", async () => {
  const rfq = newRequest({ shipping: {
    address: { recipientName: "Customer", phone: "0812345678", addressLine: "Main street 1", postalCode: "40123", destination: { scope: "domestic", id: 123, label: "Bandung" } },
    selection: { id: "jne:REG:12000:IDR", courierCode: "jne", courierName: "JNE", service: "REG", description: "Regular", cost: 12_000, etd: "2-3 days", currency: "IDR" },
  } })
  await db.doc(`rfqs/${rfq.id}`).set(rfq)
  let payload
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    payload = JSON.parse(Buffer.concat(chunks).toString())
    response.writeHead(201, { "content-type": "application/json" })
    response.end(JSON.stringify({
      id: `payreq-${payload.external_id}`,
      currency: "IDR",
      amount: payload.amount,
      fee: 600,
      net: payload.amount - 600,
      checkout_url: `https://pay.kasera.id/p/${payload.external_id}`,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    }))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const paymentApiUrl = `http://127.0.0.1:${server.address().port}/v1/transactions`
    const args = {
      db,
      uid: rfq.ownerUid,
      rfqId: rfq.id,
      returnUrl: `http://localhost:3001/?orderId=${rfq.id}`,
      appOrigin: "http://localhost:3001",
      apiKey: "kp_test_local",
      paymentApiUrl,
    }
    const unselected = newRequest({ shipping: { address: rfq.shipping.address } })
    await db.doc(`rfqs/${unselected.id}`).set(unselected)
    await assert.rejects(beginKaseraCheckout({ ...args, rfqId: unselected.id, returnUrl: `http://localhost:3001/?orderId=${unselected.id}` }), { code: "failed-precondition" })
    const checkout = await beginKaseraCheckout(args)
    assert.match(checkout.checkoutUrl, /^https:\/\/pay\.kasera\.id\/p\//)
    assert.equal(payload.amount, 62_000)
    assert.equal((await db.doc(`rfqs/${rfq.id}`).get()).data().quoteTotal, 50_000)
    const attemptId = payload.external_id
    attemptIds.push(attemptId)
    orderIds.push(rfq.id)
    const paymentId = `payreq-${attemptId}`
    rfqForAttempt.set(attemptId, rfq.id)
    const event = paymentEvent(attemptId, paymentId, 62_000)
    await processKaseraEvent({
      db,
      event,
      payment: { ...paymentRecord(attemptId, rfq.id, 62_000, 600, 61_400), id: paymentId },
    })
    const paid = (await db.doc(`rfqs/${rfq.id}`).get()).data()
    assert.equal(paid.paymentStatus, "Paid")
    assert.equal(paid.shipping.selection.cost, 12_000)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test("a verified paid event creates production once and flags a second successful payment", async () => {
  const rfq = newRequest()
  await db.doc(`rfqs/${rfq.id}`).set(rfq)
  orderIds.push(rfq.id)
  const attemptId = `attempt-${randomUUID()}`
  const paymentId = `payreq-${randomUUID()}`
  attemptIds.push(attemptId)
  rfqForAttempt.set(attemptId, rfq.id)
  await db
    .doc(`kaseraPaymentAttempts/${attemptId}`)
    .set({
      rfqId: rfq.id,
      organizationId: rfq.organizationId,
      ownerUid: rfq.ownerUid,
      quoteTotal: rfq.quoteTotal,
      amount: rfq.quoteTotal,
      fee: 600,
      net: rfq.quoteTotal - 600,
      status: "creating",
    })
  await db
    .doc(`rfqs/${rfq.id}`)
    .update({ activeKaseraPaymentAttemptId: attemptId })
  const event = paymentEvent(attemptId, paymentId, 50_000)
  await processKaseraEvent({
    db,
    event,
    payment: { ...paymentRecord(attemptId, rfq.id, 50_000), id: paymentId },
  })
  await processKaseraEvent({
    db,
    event,
    payment: { ...paymentRecord(attemptId, rfq.id, 50_000), id: paymentId },
  })
  const paid = (await db.doc(`rfqs/${rfq.id}`).get()).data()
  assert.equal(paid.paymentStatus, "Paid")
  assert.equal(paid.status, "Preparing Production")
  assert.equal(paid.kaseraPaymentRequestId, paymentId)
  assert.equal((await db.doc(`productionOrders/${rfq.id}`).get()).exists, true)

  const secondAttemptId = `attempt-${randomUUID()}`
  attemptIds.push(secondAttemptId)
  rfqForAttempt.set(secondAttemptId, rfq.id)
  await db
    .doc(`kaseraPaymentAttempts/${secondAttemptId}`)
    .set({
      rfqId: rfq.id,
      organizationId: rfq.organizationId,
      ownerUid: rfq.ownerUid,
      quoteTotal: rfq.quoteTotal,
      amount: rfq.quoteTotal,
      fee: 600,
      net: rfq.quoteTotal - 600,
      status: "pending",
    })
  const secondPaymentId = `payreq-${randomUUID()}`
  await processKaseraEvent({
    db,
    event: paymentEvent(secondAttemptId, secondPaymentId, 50_000),
    payment: {
      ...paymentRecord(secondAttemptId, rfq.id, 50_000),
      id: secondPaymentId,
    },
  })
  assert.equal(
    (await db.doc(`rfqs/${rfq.id}`).get()).data().paymentReviewRequired,
    true
  )
  assert.equal(
    (await db.doc(`kaseraPaymentAttempts/${secondAttemptId}`).get()).data()
      .status,
    "duplicatePaid"
  )
})

test("rejects a mismatched amount and only active Manufacturer can use manual fallback", async () => {
  const rfq = newRequest()
  await db.doc(`rfqs/${rfq.id}`).set(rfq)
  orderIds.push(rfq.id)
  const attemptId = `attempt-${randomUUID()}`
  const paymentId = `payreq-${randomUUID()}`
  attemptIds.push(attemptId)
  rfqForAttempt.set(attemptId, rfq.id)
  await db
    .doc(`kaseraPaymentAttempts/${attemptId}`)
    .set({
      rfqId: rfq.id,
      organizationId: rfq.organizationId,
      ownerUid: rfq.ownerUid,
      quoteTotal: rfq.quoteTotal,
      amount: rfq.quoteTotal,
      fee: 600,
      net: rfq.quoteTotal - 600,
      status: "pending",
    })
  await db
    .doc(`rfqs/${rfq.id}`)
    .update({ activeKaseraPaymentAttemptId: attemptId })
  await assert.rejects(
    processKaseraEvent({
      db,
      event: paymentEvent(attemptId, paymentId, 50_604),
      payment: { ...paymentRecord(attemptId, rfq.id, 50_000), id: paymentId },
    }),
    /does not match/
  )
  assert.equal(
    (await db.doc(`rfqs/${rfq.id}`).get()).data().paymentStatus,
    "Unpaid"
  )
  await assert.rejects(
    confirmManualPayment({ db, uid: rfq.ownerUid, rfqId: rfq.id }),
    { code: "permission-denied" }
  )

  await db.doc("manufacturers/payment-check-manufacturer").set({ active: true, organizationId: rfq.organizationId })
  const unquoted = newRequest({ status: "Submitted", quoteTotal: null })
  await db.doc(`rfqs/${unquoted.id}`).set(unquoted)
  await assert.rejects(
    confirmManualPayment({ db, uid: "payment-check-manufacturer", rfqId: unquoted.id }),
    { code: "failed-precondition" }
  )
  await assert.rejects(
    confirmManualPayment({
      db,
      uid: "payment-check-manufacturer",
      rfqId: rfq.id,
    }),
    { code: "failed-precondition" }
  )
  await db
    .doc(`kaseraPaymentAttempts/${attemptId}`)
    .update({ status: "expired", expiresAt: Date.now() - 1 })
  await confirmManualPayment({
    db,
    uid: "payment-check-manufacturer",
    rfqId: rfq.id,
  })
  assert.equal(
    (await db.doc(`rfqs/${rfq.id}`).get()).data().paymentConfirmedBy,
    "manufacturer"
  )
  assert.equal(
    (await db.doc(`productionOrders/${rfq.id}`).get()).data().status,
    "Preparing Production"
  )
})
