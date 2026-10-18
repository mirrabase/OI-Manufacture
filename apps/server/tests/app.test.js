import test from "node:test"
import assert from "node:assert/strict"
import { initializeApp, getApps } from "firebase-admin/app"

if (!getApps().length) initializeApp({ projectId: "demo-oi-manufacture" })
const { createApp } = await import("../src/app.ts")

test("Hono protects API routes and only issues an upload URL for the owner's draft STL", async () => {
  const rfq = {
    ownerUid: "customer-1",
    status: "Draft",
    model: { storagePath: "rfqs/customer-1/rfq-1/model.stl", contentType: "model/stl", size: 128 },
  }
  const storageCalls = []
  const app = createApp({
    db: { doc: () => ({ get: async () => ({ exists: true, data: () => rfq }) }) },
    auth: {
      async verifyIdToken(token) {
        if (token === "customer-token") return { uid: "customer-1" }
        if (token === "other-token") return { uid: "customer-2" }
        throw new Error("invalid token")
      },
    },
    storage: {
      async createUploadUrl(value) {
        storageCalls.push(value)
        return { url: "https://r2.example/upload", headers: { "Content-Type": value.contentType } }
      },
    },
    env: {},
  })

  assert.equal((await app.request("/health")).status, 200)
  assert.equal((await app.request("/api/storage/upload-url", { method: "POST" })).status, 401)
  const body = JSON.stringify({ rfqId: "rfq-1", size: 128 })
  const wrongOwner = await app.request("/api/storage/upload-url", {
    method: "POST", headers: { Authorization: "Bearer other-token", "Content-Type": "application/json" }, body,
  })
  assert.equal(wrongOwner.status, 403)
  assert.equal(storageCalls.length, 0)

  const response = await app.request("/api/storage/upload-url", {
    method: "POST", headers: { Authorization: "Bearer customer-token", "Content-Type": "application/json" }, body,
  })
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    url: "https://r2.example/upload",
    headers: { "Content-Type": "model/stl" },
    requiresAuth: false,
  })
  assert.equal(storageCalls[0].key, rfq.model.storagePath)
  assert.equal(storageCalls[0].contentType, "model/stl")
})

test("Hono shipping searches preserve server credentials and safely report provider failures", async (t) => {
  const app = createApp({ auth: { verifyIdToken: async () => ({ uid: "customer-1" }) }, env: { RAJAONGKIR_API_KEY: "server-key" } })
  let fetcher
  t.mock.method(globalThis, "fetch", (...args) => fetcher(...args))
  const request = (search) => app.request("/api/shipping/locations", {
    method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "auto", search, uid: null, apiKey: "attacker-key", fetcher: {}, db: {} }),
  })
  fetcher = async (_url, options) => {
    assert.equal(options.headers.key, "server-key")
    return Response.json({ data: [{ id: 17578, label: "KARET SEMANGGI, 12930", zip_code: "12930" }] })
  }
  const domestic = await request("12930")
  assert.equal(domestic.status, 200)
  assert.deepEqual(await domestic.json(), { destinations: [{ id: 17578, label: "KARET SEMANGGI, 12930", postalCode: "12930", scope: "domestic" }] })

  fetcher = async () => Response.json({ meta: { message: "Domestic Destinations Data not found" } }, { status: 404 })
  for (const search of ["12", "12345"]) {
    const response = await request(search)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { destinations: [] })
  }
  fetcher = async (url) => url.includes("/domestic-")
    ? Response.json({ data: [] })
    : Response.json({ data: [{ country_id: "152", country_name: "Singapore" }] })
  const country = await request("Singapore")
  assert.equal(country.status, 200)
  assert.deepEqual(await country.json(), { destinations: [{ id: 152, label: "Singapore", scope: "international" }] })

  for (const [status, message] of [[401, /credentials/], [403, /credentials/], [429, /limit/], [500, /temporarily unavailable/], [503, /temporarily unavailable/]]) {
    fetcher = async () => Response.json({ meta: { message: "server-key attacker-key" } }, { status })
    const response = await request("Singapore")
    assert.equal(response.status, 503)
    const result = await response.json()
    assert.match(result.error.message, message)
    assert.doesNotMatch(JSON.stringify(result), /server-key|attacker-key/)
  }
  fetcher = async () => { throw new DOMException("server-key", "TimeoutError") }
  const timeout = await request("Singapore")
  assert.equal(timeout.status, 503)
  assert.match((await timeout.json()).error.message, /could not be reached/)
})

test("request fields cannot replace server dependencies or the authenticated owner", async () => {
  const rfq = { ownerUid: "other-customer" }
  const paths = []
  const db = {
    doc: (path) => { paths.push(path); return { get: async () => ({ exists: true, data: () => path.startsWith("shippingRateQuotes/") ? { ownerUid: "other-customer", expiresAt: Date.now() + 60000 } : rfq }) } },
    runTransaction: async (run) => run({ get: async (ref) => ref.get() }),
  }
  const app = createApp({ db, auth: { verifyIdToken: async () => ({ uid: "customer-1" }) }, env: { KASERA_API_KEY: "kp_test_server" } })
  for (const route of ["shipping/rates", "shipping/address", "shipping/select", "payments/kasera/checkout"]) {
    const response = await app.request(`/api/${route}`, {
      method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
      body: JSON.stringify({ rfqId: "rfq-1", rateId: "jne:REG", returnUrl: "http://localhost:3001/?rfqId=rfq-1", uid: "other-customer", db: {}, apiKey: "attacker-key", paymentApiUrl: "https://attacker.invalid", address: {
        recipientName: "Name", phone: "123", addressLine: "Street", postalCode: "12930", destination: { scope: "domestic", id: 17578, label: "Jakarta" },
      } }),
    })
    assert.equal(response.status, 403, route)
  }
  assert.ok(paths.every((path) => path === "rfqs/rfq-1" || path === "shippingRateQuotes/rfq-1"))
})

test("unexpected server errors remain generic", async () => {
  const app = createApp({
    db: { doc: () => { throw new Error("private-server-detail") } },
    auth: { verifyIdToken: async () => ({ uid: "customer-1" }) }, env: {},
  })
  const response = await app.request("/api/shipping/rates", {
    method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify({ rfqId: "rfq-1" }),
  })
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: { code: "internal", message: "The request could not be completed." } })
})

test("HTTP validation rejects malformed input before calling a service", async (t) => {
  const app = createApp({ auth: { verifyIdToken: async () => ({ uid: "customer-1" }) }, env: {} })
  t.mock.method(globalThis, "fetch", () => { throw new Error("Provider must not be called") })
  for (const body of ["{", "null", "[]", JSON.stringify({ scope: "auto", search: 12930 }), JSON.stringify({ scope: "auto" })]) {
    const response = await app.request("/api/shipping/locations", {
      method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body,
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, "invalid-argument")
  }
  assert.equal(globalThis.fetch.mock.callCount(), 0)
  assert.equal((await app.request("/api/webhooks/kasera")).status, 200)
  assert.equal((await app.request("/api/shipping/locations", { method: "POST" })).status, 401)
})


test("intentional user-facing AI errors retain a useful message", async () => {
  const { UserFacingError } = await import("genkit")
  const app = createApp({
    db: { doc: () => { throw new UserFacingError("UNAVAILABLE", "Asisten sedang tidak tersedia. Silakan coba lagi.") } },
    auth: { verifyIdToken: async () => ({ uid: "customer-1" }) }, env: {},
  })
  const response = await app.request("/api/shipping/rates", {
    method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body: JSON.stringify({ rfqId: "rfq-1" }),
  })
  assert.equal(response.status, 503)
  assert.match((await response.json()).error.message, /Asisten sedang tidak tersedia/)
})
