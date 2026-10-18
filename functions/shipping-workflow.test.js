const test = require("node:test")
const assert = require("node:assert/strict")
const { getCustomerShippingRatePreview, getCustomerShippingRates, saveCustomerShippingAddress, selectCustomerShippingRate } = require("./shipping-workflow")

function fakeDb(initial) {
  const documents = new Map(Object.entries(initial))
  const reference = (path) => ({
    path,
    get: async () => ({ exists: documents.has(path), data: () => documents.get(path) }),
    set: async (value) => documents.set(path, value),
  })
  return {
    documents,
    doc: reference,
    runTransaction: async (callback) => callback({
      get: (ref) => ref.get(),
      update: (ref, value) => documents.set(ref.path, { ...documents.get(ref.path), ...value }),
      delete: (ref) => documents.delete(ref.path),
    }),
  }
}

function request(overrides = {}) {
  return {
    ownerUid: "customer-1",
    organizationId: "demo",
    status: "Quoted",
    paymentStatus: "Unpaid",
    quoteTotal: 50_000,
    requirements: { quantity: 2 },
    model: { boundingBoxMm: [60, 31, 48] },
    estimate: { status: "ready", gramsPerUnit: 100.2 },
    shipping: { address: { destination: { scope: "domestic", id: 22, label: "Bandung" } } },
    ...overrides,
  }
}

const rate = { id: "jne:REG:12000:IDR", courierCode: "jne", courierName: "JNE", service: "REG", description: "Regular", cost: 12_000, etd: "2-3 days", currency: "IDR" }

test("previews courier options for the landing-page estimate before an RFQ is submitted", async () => {
  const db = fakeDb({ "organizations/demo": { active: true, shippingOrigin: { destinationId: 11 } } })
  let payload
  const result = await getCustomerShippingRatePreview({
    db,
    uid: "customer-1",
    organizationId: "demo",
    destination: { scope: "domestic", id: 22 },
    weightGrams: 101,
    dimensionsMm: [60, 31, 48],
    apiKey: "server-only-key",
    fetcher: async (_url, options) => {
      payload = new URLSearchParams(options.body)
      return Response.json({ meta: { status: "success" }, data: [{ code: "jne", name: "JNE", service: "REG", description: "Regular", cost: 12_000, etd: "2-3 days", currency: "IDR" }] })
    },
  })
  assert.equal(payload.get("origin"), "11")
  assert.equal(payload.get("destination"), "22")
  assert.equal(payload.get("weight"), "101")
  assert.deepEqual(result.rates, [rate])
  assert.equal(db.documents.size, 1)
})

test("calculates rates from the saved Organization origin and saves a private, expiring quote", async () => {
  const db = fakeDb({
    "rfqs/rfq-1": request(),
    "organizations/demo": { active: true, shippingOrigin: { destinationId: 11 } },
  })
  let payload
  const result = await getCustomerShippingRates({
    db,
    uid: "customer-1",
    rfqId: "rfq-1",
    apiKey: "server-only-key",
    fetcher: async (_url, options) => {
      payload = new URLSearchParams(options.body)
      return Response.json({ meta: { status: "success" }, data: [{ code: "jne", name: "JNE", service: "REG", description: "Regular", cost: 12_000, etd: "2-3 days", currency: "IDR" }] })
    },
  })
  assert.equal(payload.get("origin"), "11")
  assert.equal(payload.get("destination"), "22")
  assert.equal(payload.get("weight"), "201")
  assert.deepEqual(result.rates, [rate])
  assert.equal(db.documents.get("shippingRateQuotes/rfq-1").rates[0].cost, 12_000)
  assert.ok(db.documents.get("shippingRateQuotes/rfq-1").expiresAt > Date.now())
})

test("lets a customer choose shipping after the STL estimate is ready but before the final quote", async () => {
  const db = fakeDb({
    "rfqs/rfq-1": request({ status: "Submitted", quoteTotal: undefined }),
    "organizations/demo": { active: true, shippingOrigin: { destinationId: 11 } },
  })
  await getCustomerShippingRates({
    db,
    uid: "customer-1",
    rfqId: "rfq-1",
    apiKey: "server-only-key",
    fetcher: async () => Response.json({ meta: { status: "success" }, data: [{ code: "jne", name: "JNE", service: "REG", description: "Regular", cost: 12_000, etd: "2-3 days", currency: "IDR" }] }),
  })
  const rates = db.documents.get("shippingRateQuotes/rfq-1")
  assert.equal(rates.quoteTotal, null)
  await selectCustomerShippingRate({ db, uid: "customer-1", rfqId: "rfq-1", rateId: rate.id })
  assert.equal(db.documents.get("rfqs/rfq-1").shipping.selection.cost, 12_000)
})

test("only the request owner can save a live service from the private rate quote", async () => {
  const rfq = request()
  const db = fakeDb({
    "rfqs/rfq-1": rfq,
    "shippingRateQuotes/rfq-1": {
      ownerUid: "customer-1",
      organizationId: "demo",
      scope: "domestic",
      destinationId: 22,
      quoteTotal: 50_000,
      weightGrams: 201,
      dimensionsMm: [60, 31, 48],
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      rates: [rate],
    },
  })
  await assert.rejects(selectCustomerShippingRate({ db, uid: "someone-else", rfqId: "rfq-1", rateId: rate.id }), { code: "permission-denied" })
  await assert.rejects(selectCustomerShippingRate({ db, uid: "customer-1", rfqId: "rfq-1", rateId: "fabricated:service:1" }), { code: "invalid-argument" })
  await selectCustomerShippingRate({ db, uid: "customer-1", rfqId: "rfq-1", rateId: rate.id })
  assert.deepEqual(db.documents.get("rfqs/rfq-1").shipping.selection, {
    ...rate,
    weightGrams: 201,
    dimensionsMm: [60, 31, 48],
    estimatedAt: db.documents.get("shippingRateQuotes/rfq-1").createdAt,
  })
})

test("saves an existing quote's delivery address and invalidates any old shipping rates", async () => {
  const rfq = request({ shipping: undefined })
  const db = fakeDb({
    "rfqs/rfq-1": rfq,
    "shippingRateQuotes/rfq-1": { ownerUid: "customer-1", rates: [rate] },
  })
  const address = {
    recipientName: "  Customer One  ",
    phone: " 08123456789 ",
    addressLine: "  Semanggi Avenue 1 ",
    postalCode: " 12930 ",
    destination: { scope: "domestic", id: 17578, label: " Karet Semanggi, Jakarta Selatan " },
  }
  const result = await saveCustomerShippingAddress({ db, uid: "customer-1", rfqId: "rfq-1", address })
  assert.deepEqual(result.address, {
    recipientName: "Customer One",
    phone: "08123456789",
    addressLine: "Semanggi Avenue 1",
    postalCode: "12930",
    destination: { scope: "domestic", id: 17578, label: "Karet Semanggi, Jakarta Selatan" },
  })
  assert.deepEqual(db.documents.get("rfqs/rfq-1").shipping, { address: result.address })
  assert.equal(db.documents.has("shippingRateQuotes/rfq-1"), false)
})

test("only the request owner can add delivery details before checkout starts", async () => {
  const address = { recipientName: "Customer", phone: "08123456789", addressLine: "Street 1", postalCode: "12930", destination: { scope: "domestic", id: 17578, label: "Semanggi" } }
  const rfq = request({ shipping: undefined, status: "Submitted" })
  const db = fakeDb({ "rfqs/rfq-1": rfq })
  await assert.rejects(saveCustomerShippingAddress({ db, uid: "another-user", rfqId: "rfq-1", address }), { code: "permission-denied" })
  await saveCustomerShippingAddress({ db, uid: "customer-1", rfqId: "rfq-1", address })
  db.documents.set("rfqs/rfq-1", request({ shipping: undefined, status: "Draft" }))
  await assert.rejects(saveCustomerShippingAddress({ db, uid: "customer-1", rfqId: "rfq-1", address }), { code: "failed-precondition" })
  await assert.rejects(saveCustomerShippingAddress({ db, uid: "customer-1", rfqId: "rfq-1", address: { ...address, destination: { ...address.destination, id: "17578" } } }), { code: "invalid-argument" })
})

test("requires a selected shipping rate when a destination was saved", async () => {
  const db = fakeDb({ "rfqs/rfq-1": request({ activeKaseraPaymentAttemptId: "active" }) })
  await assert.rejects(selectCustomerShippingRate({ db, uid: "customer-1", rfqId: "rfq-1", rateId: rate.id }), { code: "failed-precondition" })
})
