const test = require("node:test")
const assert = require("node:assert/strict")
const { calculateShippingRates, normalizeRate, searchShippingDestinations } = require("./shipping")

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
  assert.equal(normalizeRate({ code: "jne", name: "JNE", service: "REG", cost: 10, currency: "USD" }), null)
  assert.equal(normalizeRate({ code: "jne", name: "JNE", service: "REG", cost: "invalid" }), null)
})
