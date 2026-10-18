import test from "node:test"
import assert from "node:assert/strict"
const { calculateShippingRates, normalizeRate, searchShippingDestinations } = await import("../src/modules/shipping/provider.ts")

test("searches RajaOngkir destinations on the server and normalizes provider IDs", async () => {
  let requested
  const destinations = await searchShippingDestinations({
    apiKey: "local-key",
    scope: "domestic",
    search: "Bandung",
    fetcher: async (url, options) => {
      requested = { url, options }
      return Response.json({ meta: { status: "success" }, data: [{ id: 42, label: "Coblong, Bandung" }, { id: "bad", label: "Bad" }] })
    },
  })
  assert.deepEqual(destinations, [{ id: 42, label: "Coblong, Bandung" }])
  assert.match(requested.url, /destination\/domestic-destination\?search=Bandung/)
  assert.equal(requested.options.headers.key, "local-key")
})

test("calculates multiple courier rates and converts international rates to IDR", async () => {
  let body
  const rates = await calculateShippingRates({
    apiKey: "local-key",
    scope: "international",
    originId: 10,
    destinationId: 20,
    weightGrams: 1250,
    dimensionsMm: [60, 31, 48],
    fetcher: async (url, options) => {
      body = new URLSearchParams(options.body)
      assert.match(url, /calculate\/international-cost$/)
      return Response.json({ meta: { status: "success" }, data: [
        { code: "jne", name: "JNE", service: "REG", cost: 100, currency: "USD", currency_value: 16000, etd: "5-7 days" },
        { code: "pos", name: "POS", service: "EMS", cost: 90000, currency: "IDR", etd: "7-10 days" },
      ] })
    },
  })
  assert.equal(body.get("weight"), "1250")
  assert.equal(body.get("length"), "6")
  assert.equal(body.get("width"), "4")
  assert.equal(body.get("height"), "5")
  assert.equal(body.get("courier"), "jne:tiki:pos")
  assert.deepEqual(rates.map((rate) => rate.cost), [1_600_000, 90_000])
  assert.ok(rates.every((rate) => rate.currency === "IDR"))
})

test("drops malformed rates and refuses foreign currency without a conversion rate", () => {
  assert.equal(normalizeRate(null), null)
  assert.equal(normalizeRate("invalid"), null)
  assert.equal(normalizeRate({ code: "jne", name: "JNE", service: "REG", cost: 10, currency: "USD" }), null)
  assert.equal(normalizeRate({ code: "jne", name: "JNE", service: "REG", cost: "invalid" }), null)
})

test("normalizes postal destinations and country fields in automatic searches", async () => {
  const domestic = { id: 17578, label: "KARET SEMANGGI, SETIA BUDI, JAKARTA SELATAN, DKI JAKARTA, 12930", zip_code: "12930" }
  assert.deepEqual(await searchShippingDestinations({
    apiKey: "server-key", scope: "auto", search: "12930",
    fetcher: async () => Response.json({ data: [domestic] }),
  }), [{ id: 17578, label: domestic.label, postalCode: "12930", scope: "domestic" }])
  const calls = []
  assert.deepEqual(await searchShippingDestinations({
    apiKey: "server-key", scope: "auto", search: "Singapore",
    fetcher: async (url) => {
      calls.push(url)
      return url.includes("/domestic-")
        ? Response.json({ meta: { message: "Domestic Destinations Data not found" } }, { status: 404 })
        : Response.json({ data: [{ country_id: "152", country_name: "Singapore" }] })
    },
  }), [{ id: 152, label: "Singapore", scope: "international" }])
  assert.equal(calls.length, 2)
})

test("only destination not-found responses become empty results", async () => {
  for (const scope of ["domestic", "international", "auto"]) {
    for (const search of ["12", "12345"]) {
      assert.deepEqual(await searchShippingDestinations({
        apiKey: "server-key", scope, search,
        fetcher: async () => Response.json({ meta: { message: "Domestic Destinations Data not found" } }, { status: 404 }),
      }), [])
    }
  }
  for (const status of [401, 403, 429, 500, 503, 404]) {
    let calls = 0
    await assert.rejects(searchShippingDestinations({
      apiKey: "server-key", scope: "auto", search: "Singapore",
      fetcher: async () => {
        calls++
        return Response.json({ meta: { message: "secret-provider-detail" } }, { status })
      },
    }), (error) => error.code === "unavailable" && !error.message.includes("secret-provider-detail"))
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(searchShippingDestinations({
    apiKey: "server-key", scope: "auto", search: "Singapore",
    fetcher: async () => { calls++; throw new DOMException("server-key", "TimeoutError") },
  }), /could not be reached/)
  assert.equal(calls, 1)
})
