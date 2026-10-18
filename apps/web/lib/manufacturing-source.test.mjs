import assert from "node:assert/strict"
import test from "node:test"
import {
  addSourceCitationLinks,
  manufacturerSourceHref,
} from "./manufacturing-source.ts"

test("source citations point to their matching badges and source pages", () => {
  const sources = [{ id: "equipment:EQ-001" }, { id: "pricing:settings" }]
  assert.equal(
    addSourceCitationLinks(
      "Mesin tersedia [equipment:EQ-001]. Biaya [pricing:settings].",
      sources,
      4
    ),
    "Mesin tersedia [1](#source-4-0). Biaya [2](#source-4-1)."
  )
  assert.deepEqual(
    [
      "request",
      "material",
      "purchase order",
      "equipment",
      "pricing settings",
      "production",
    ].map(manufacturerSourceHref),
    [
      "/-/requests",
      "/-/materials",
      "/-/materials",
      "/-/equipment",
      "/-/settings",
      "/-/production",
    ]
  )
})

test("customer and analytic citations route to the relevant workspace", () => {
  assert.equal(manufacturerSourceHref("customer"), "/-/customers")
  assert.equal(manufacturerSourceHref("analytics:customers"), "/-/customers")
  assert.equal(manufacturerSourceHref("analytics:requests"), "/-/requests")
  assert.equal(manufacturerSourceHref("analytics:equipment"), "/-/equipment")
})
