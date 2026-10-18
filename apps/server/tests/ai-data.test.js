import test from "node:test"
import assert from "node:assert/strict"
const {
  buildManufacturerSnapshot,
  freshOverviewCache,
  overviewFingerprint,
  parseRequestPaymentSearch,
} = await import("../src/modules/ai/data.ts")

const now = 1_700_000_000_000

test("RFQ payment searches become structured filters and retain specific record terms", () => {
  assert.deepEqual(parseRequestPaymentSearch("paid requests"), {
    paymentStatus: "Paid",
    search: undefined,
  })
  assert.deepEqual(parseRequestPaymentSearch("RFQ-001 belum dibayar"), {
    paymentStatus: "Unpaid",
    search: "001",
  })
  assert.deepEqual(parseRequestPaymentSearch("paid dan unpaid requests"), {
    paymentStatus: undefined,
    search: undefined,
  })
})

test("manufacturer snapshot keeps relevant production facts and omits customer contact data", () => {
  const snapshot = buildManufacturerSnapshot({
    organizationId: "org-1",
    now,
    rfqs: [
      {
        id: "rfq-1",
        data: {
          customer: { name: "Private Customer", email: "private@example.com" },
          shipping: { address: { addressLine: "Private address" } },
          product: "Custom bracket",
          status: "Submitted",
          paymentStatus: "Unpaid",
          requirements: {
            quantity: 10,
            material: "PLA",
            process: "FDM",
            notes:
              "Needs a reinforced mounting tab; contact private@example.com at +628123456789",
          },
          model: { boundingBoxMm: [80, 30, 5] },
          createdAt: now - 1000,
          submittedAt: now - 500,
        },
      },
      {
        id: "rfq-draft",
        data: { product: "Draft", status: "Draft", requirements: {} },
      },
      {
        id: "rfq-quote",
        data: {
          product: "Fixture",
          status: "Quoted",
          paymentStatus: "Unpaid",
          quoteTotal: 12000,
          quotedAt: now - 3 * 86_400_000,
          requirements: { quantity: 1, material: "PETG", process: "FDM" },
          model: { boundingBoxMm: [20, 20, 20] },
        },
      },
      {
        id: "rfq-prod",
        data: {
          product: "Production part",
          status: "Preparing Production",
          paymentStatus: "Paid",
          requirements: { quantity: 4, material: "PLA", process: "FDM" },
          model: { boundingBoxMm: [100, 50, 40] },
        },
      },
    ],
    materials: [
      {
        id: "petg",
        data: { name: "PETG", stock: 2, reserved: 1, reorderAt: 1 },
      },
      {
        id: "pla",
        data: { name: "PLA", stock: 0.2, reserved: 0, reorderAt: 1 },
      },
    ],
    equipment: [
      {
        id: "printer-1",
        data: {
          name: "Printer 1",
          technology: "FDM",
          status: "Maintenance",
          buildVolumeMm: [220, 220, 250],
          compatibleMaterialIds: ["pla"],
          workingHours: 8,
          scheduledHours: 2,
        },
      },
    ],
    productionOrders: [
      {
        id: "rfq-prod",
        data: {
          rfqId: "rfq-prod",
          status: "Preparing Production",
          materialId: "pla",
          equipmentId: "printer-1",
          plannedGrams: 500,
          plannedHours: 2,
        },
      },
    ],
    purchaseOrders: [
      {
        id: "po-1",
        data: {
          materialId: "petg",
          quantity: 5,
          eta: "2023-11-20",
          status: "Ordered",
        },
      },
    ],
    pricing: {
      materialPerKg: 100000,
      machinePerHour: 50000,
      markupPercent: 20,
    },
  })

  const json = JSON.stringify(snapshot)
  assert.equal(
    snapshot.requests.some((item) => item.id === "rfq-draft"),
    false
  )
  assert.equal(json.includes("private@example.com"), false)
  assert.equal(json.includes("Private Customer"), true)
  assert.equal(json.includes("Private address"), false)
  assert.equal(json.includes("reinforced mounting tab"), true)
  assert.equal(json.includes("private@example.com"), false)
  assert.equal(json.includes("+628123456789"), false)
  assert.equal(
    snapshot.signals.some((item) => item.id === "stock:petg"),
    true
  )
  assert.equal(
    snapshot.signals.some((item) => item.id === "review:rfq-1"),
    true
  )
  assert.equal(
    snapshot.signals.some((item) => item.id === "quote:rfq-quote"),
    true
  )
  assert.equal(
    snapshot.requests.find((item) => item.id === "rfq-prod").paymentStatus,
    "Paid"
  )

  const productionSignal = snapshot.signals.find(
    (item) => item.id === "production:rfq-prod"
  )
  assert.ok(productionSignal)
  assert.equal(productionSignal.priority, "high")
  assert.equal(
    productionSignal.facts.blockers.includes(
      "Available material stock is below the planned usage."
    ),
    true
  )
  assert.equal(
    productionSignal.facts.blockers.includes(
      "Assigned equipment is maintenance."
    ),
    true
  )
  assert.equal(productionSignal.sourceIds.includes("rfq:rfq-prod"), true)
  assert.equal(
    snapshot.evidence.some((item) => item.sourceId === "pricing:settings"),
    true
  )
})

test("materials at zero available stock get high priority and preserve inbound purchase order evidence", () => {
  const snapshot = buildManufacturerSnapshot({
    organizationId: "org-1",
    now,
    materials: [
      {
        id: "resin",
        data: { name: "Resin", stock: 1, reserved: 1, reorderAt: 0.5 },
      },
    ],
    purchaseOrders: [
      {
        id: "po-resin",
        data: {
          materialId: "resin",
          quantity: 3,
          eta: "2023-11-20",
          status: "Ordered",
        },
      },
    ],
  })
  const signal = snapshot.signals.find((item) => item.id === "stock:resin")

  assert.equal(signal.priority, "high")
  assert.deepEqual(signal.sourceIds, [
    "material:resin",
    "purchaseOrder:po-resin",
  ])
  assert.equal(signal.facts.incomingPurchaseOrders[0].quantityKg, 3)
})

test("overview fingerprint stays stable for the same signals and changes with operational facts", () => {
  const materials = [
    {
      id: "resin",
      data: { name: "Resin", stock: 1, reserved: 0, reorderAt: 2 },
    },
  ]
  const first = buildManufacturerSnapshot({
    organizationId: "org-1",
    now,
    materials,
  })
  const same = buildManufacturerSnapshot({
    organizationId: "org-1",
    now: now + 10_000,
    materials,
  })
  const changed = buildManufacturerSnapshot({
    organizationId: "org-1",
    now: now + 10_000,
    materials: [
      {
        id: "resin",
        data: { name: "Resin", stock: 0.5, reserved: 0, reorderAt: 2 },
      },
    ],
  })

  assert.equal(overviewFingerprint(first), overviewFingerprint(same))
  assert.notEqual(overviewFingerprint(first), overviewFingerprint(changed))
})

test("overview cache is reused only for matching signals within 30 minutes", () => {
  const generatedAt = now
  const response = { generatedAt, summary: "Cached insight", insights: [] }
  const cache = { fingerprint: "current-signals", generatedAt, response }

  assert.equal(
    freshOverviewCache(cache, "current-signals", now + 29 * 60_000),
    response
  )
  assert.equal(
    freshOverviewCache(cache, "current-signals", now + 30 * 60_000),
    null
  )
  assert.equal(freshOverviewCache(cache, "changed-signals", now + 1_000), null)
  assert.equal(
    freshOverviewCache(
      { ...cache, generatedAt: now + 1 },
      "current-signals",
      now
    ),
    null
  )
})

test("Highlights report missing inventory fields instead of claiming zero stock", () => {
  const snapshot = buildManufacturerSnapshot({
    organizationId: "org",
    materials: [{ id: "legacy", data: { name: "Legacy PLA", reorderAt: 2 } }],
  })
  assert.equal(
    snapshot.signals.some((signal) => signal.id === "stock:legacy"),
    false
  )
  assert.deepEqual(snapshot.signals[0].facts.missingFields, [
    "stock",
    "reserved",
  ])
})
