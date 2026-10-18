import assert from "node:assert/strict"
import test from "node:test"
import { addSourceCitationLinks, manufacturerSourceHref } from "./manufacturing-source.ts"

test("source citations point to their matching badges and source pages", () => {
  const sources = [{ id: "equipment:EQ-001" }, { id: "pricing:settings" }]
  assert.equal(
    addSourceCitationLinks("Mesin tersedia [equipment:EQ-001]. Biaya [pricing:settings].", sources, 4),
    "Mesin tersedia [1](#source-4-0). Biaya [2](#source-4-1)."
  )
  assert.deepEqual(
    ["request", "material", "purchase order", "equipment", "pricing settings", "production"].map(manufacturerSourceHref),
    ["/-/requests", "/-/materials", "/-/materials", "/-/equipment", "/-/settings", "/-/production"]
  )
})
