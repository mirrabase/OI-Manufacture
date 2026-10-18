import test from "node:test"
import assert from "node:assert/strict"
import {
  analyticsSchema,
  querySchema,
  toolQuerySchema,
  toolAnalyticsSchema,
  parseToolQuery,
  normalizeRows,
  computeResult,
  renderResults,
  needsRankingMetric,
  explicitContacts,
  jakartaDate,
  scanPages,
  modelResultContext,
  companyAnswer,
} from "../src/modules/ai/query.ts"
import {
  createBudget,
  boundedGenerate,
  consumeTool,
  boundedPrompt,
} from "../src/modules/ai/runtime.ts"

const readAt = "2026-10-18T00:00:00.000Z"
const request = (id, email, ownerUid, name = "Same name", extra = {}) => ({
  id,
  data: {
    status: "Closed",
    customer: { name, email, phone: "12345678" },
    ownerUid,
    quoteTotal: 100,
    paymentStatus: "Paid",
    createdAt: 1000,
    ...extra,
  },
})

test("customers follow email/UID identity, retain Closed and legacy records, omit contact by default", () => {
  const raw = [
    request("a", "A@Example.com ", "one"),
    request("b", "a@example.com", "two"),
    request("c", "other@example.com", "one"),
    request("d", "", "no-email"),
    request("e", "", "no-email"),
    request("f", "", undefined),
  ]
  const rows = normalizeRows("customers", raw)
  assert.equal(rows.length, 4)
  assert.equal(rows.find((r) => r.requestCount === 2).paidValueIdr, 200)
  const result = computeResult(
    querySchema.parse({ area: "customers" }),
    rows,
    readAt,
    raw.length
  )
  assert.equal(result.rows.length, 4)
  assert.equal(result.period, "Seluruh riwayat (Asia/Jakarta)")
  assert.equal(JSON.stringify(result).includes("example.com"), false)
  assert.equal(JSON.stringify(result).includes("12345678"), false)
  const contacts = computeResult(
    querySchema.parse({ area: "customers", contacts: true }),
    rows,
    readAt,
    raw.length
  )
  assert.ok(contacts.rows[0].contact)
  assert.equal(explicitContacts("tampilkan kontak pelanggan"), true)
  assert.equal(explicitContacts("customer dengan nilai tertinggi"), false)
})

test("complete ranking includes winner on last page, pagination does not change totals", () => {
  const rows = Array.from({ length: 1201 }, (_, i) => ({
    id: String(i),
    sourceId: `material:${i}`,
    name: `Material ${i}`,
    stockKg: i,
  }))
  const input = analyticsSchema.parse({
    area: "materials",
    operation: "sum",
    metric: "stockKg",
    groupBy: "name",
    limit: 3,
  })
  const result = computeResult(input, rows, readAt, rows.length)
  assert.equal(result.rows[0].group, "Material 1200")
  assert.equal(result.matched, 1201)
  assert.equal(result.nextOffset, 3)
  const total = computeResult(
    analyticsSchema.parse({
      area: "materials",
      operation: "sum",
      metric: "stockKg",
    }),
    rows,
    readAt,
    rows.length
  )
  assert.equal(total.rows[0].value, (1200 * 1201) / 2)
  assert.equal(JSON.stringify(result.rows).length < 2000, true)
})

test("date/status filters use Jakarta boundaries and missing dates are reported", () => {
  const rows = normalizeRows("requests", [
    request("one", "a@b.c", "a", "First", {
      createdAt: Date.parse("2026-10-17T17:00:00Z"),
    }),
    request("two", "d@b.c", "b", "Second", {
      status: "Completed",
      createdAt: Date.parse("2026-10-18T17:00:00Z"),
    }),
    request("three", "x@b.c", "c", "Third", { createdAt: null }),
  ])
  const result = computeResult(
    analyticsSchema.parse({
      area: "requests",
      operation: "count",
      filters: [{ field: "status", op: "eq", value: "Closed" }],
      date: { field: "createdAt", from: "2026-10-18", to: "2026-10-18" },
    }),
    rows,
    readAt,
    3
  )
  assert.equal(result.rows[0].value, 1)
  assert.equal(result.missing.createdAt, 1)
  assert.equal(jakartaDate("2026-10-18"), Date.parse("2026-10-17T17:00:00Z"))
  assert.throws(() => jakartaDate("tomorrow"))
})

test("analytics handle missing numeric values, empty sets, groups and comparisons", () => {
  const rows = normalizeRows("materials", [
    { id: "a", data: { name: "A", category: "PLA", stock: 4 } },
    { id: "b", data: { name: "B", category: "PLA" } },
    { id: "c", data: { name: "C", category: "PETG", stock: 2 } },
  ])
  for (const [operation, expected] of [
    ["sum", 6],
    ["average", 3],
    ["min", 2],
    ["max", 4],
  ]) {
    const result = computeResult(
      analyticsSchema.parse({
        area: "materials",
        operation,
        metric: "stockKg",
      }),
      rows,
      readAt,
      3
    )
    assert.equal(result.rows[0].value, expected)
    assert.equal(result.missing.stockKg, 1)
  }
  const compare = computeResult(
    analyticsSchema.parse({
      area: "materials",
      operation: "count",
      compare: [{ field: "category", op: "eq", value: "PLA" }],
    }),
    rows,
    readAt,
    3
  )
  assert.deepEqual(
    compare.rows.map((r) => r.value),
    [3, 2]
  )
  assert.equal(
    computeResult(
      analyticsSchema.parse({ area: "materials", operation: "count" }),
      [],
      readAt,
      0
    ).rows[0].value,
    0
  )
  assert.equal(
    computeResult(
      analyticsSchema.parse({
        area: "materials",
        operation: "average",
        metric: "stockKg",
      }),
      [],
      readAt,
      0
    ).rows[0].value,
    null
  )
})

test("machine metrics derive only recorded production, never actual machine hours", () => {
  const rows = normalizeRows(
    "equipment",
    [{ id: "machine", data: { name: "Printer" } }],
    {
      production: [
        {
          id: "a",
          data: {
            equipmentId: "machine",
            status: "Completed",
            plannedHours: 2,
            startedAt: 1000,
            completedAt: 3_601_000,
          },
        },
        {
          id: "b",
          data: {
            equipmentId: "machine",
            status: "In Production",
            plannedHours: 3,
          },
        },
      ],
    }
  )
  assert.equal(rows[0].completedJobs, 1)
  assert.equal(rows[0].plannedHours, 5)
  assert.equal(rows[0].calendarHours, 1)
  assert.equal("actualHours" in rows[0], false)
})

test("unsupported fields and arbitrary collections are rejected", () => {
  assert.equal(querySchema.safeParse({ area: "secrets" }).success, false)
  for (const field of [
    "ownerUid",
    "organizationId",
    "checkoutUrl",
    "contact",
    "actualHours",
  ]) {
    assert.throws(
      () =>
        computeResult(
          querySchema.parse({ area: "requests", fields: [field] }),
          [],
          readAt,
          0
        ),
      /Field unavailable/
    )
  }
})

test("top customer and top machine require metric; server alone renders numbers and citations", () => {
  for (const question of [
    "top customer",
    "mesin terbaik",
    "pelanggan paling top",
  ])
    assert.equal(needsRankingMetric(question), true)
  for (const question of [
    "top customer by paid value",
    "top machine completed jobs",
    "top mesin jam rencana",
  ])
    assert.equal(needsRankingMetric(question), false)
  const result = computeResult(
    analyticsSchema.parse({ area: "materials", operation: "count" }),
    [],
    readAt,
    0
  )
  const answer = renderResults([result])
  assert.match(answer, /\| 0 \|/)
  assert.match(answer, /\[analytics:/)
  assert.throws(
    () => renderResults([{ ...result, complete: false }]),
    /Incomplete/
  )
})

test("scan iterates 500-document pages and refuses a partial total on deadline", async () => {
  const calls = []
  const query = {
    orderBy() {
      return this
    },
    startAfter() {
      return this
    },
    limit(n) {
      assert.equal(n, 500)
      return this
    },
  }
  const tx = {
    async get() {
      calls.push(1)
      const count = calls.length < 3 ? 500 : 1
      return {
        size: count,
        docs: Array.from({ length: count }, (_, i) => ({
          id: `${calls.length}-${i}`,
          data: () => ({}),
        })),
      }
    },
  }
  const session = { deadline: Date.now() + 1000, reads: 0 }
  const rows = await scanPages(query, tx, session)
  assert.equal(rows.length, 1001)
  assert.equal(session.reads, 1001)
  assert.equal(calls.length, 3)
  await assert.rejects(
    scanPages(query, tx, { deadline: 0, reads: 0 }),
    /deadline/
  )
})

test("generation counts every call and token usage, retries transient provider errors only once", async () => {
  const budget = createBudget()
  const attempts = []
  const response = await boundedGenerate(budget, async (fallback) => {
    attempts.push(fallback)
    if (!fallback) throw Object.assign(new Error("temporary"), { status: 503 })
    return { usage: { inputTokens: 20, outputTokens: 10, thoughtsTokens: 2 } }
  })
  assert.deepEqual(attempts, [false, true])
  assert.equal(budget.calls, 2)
  assert.deepEqual(budget.usage, [{ unavailable: true }, response.usage])
  await assert.rejects(
    boundedGenerate(budget, async () => {
      throw Object.assign(new Error("temporary"), { status: 503 })
    })
  )
  assert.equal(budget.calls, 3)
  const validationBudget = createBudget()
  await assert.rejects(
    boundedGenerate(validationBudget, async () => {
      throw Object.assign(new Error("invalid"), { status: 400 })
    })
  )
  assert.equal(validationBudget.calls, 1)
  await boundedGenerate(budget, async () => ({ usage: {} }))
  await assert.rejects(
    boundedGenerate(budget, async () => ({ usage: {} })),
    /budget/
  )
  for (let i = 0; i < 8; i++) consumeTool(validationBudget)
  assert.throws(() => consumeTool(validationBudget), /budget/)
  assert.throws(() => boundedPrompt("system", "a".repeat(24_000)), /context/)
})

test("model context stays bounded as data grows and removes contacts and full histories", () => {
  const rows = Array.from({ length: 1200 }, (_, i) => ({
    id: String(i),
    sourceId: `customer:${i}`,
    name: `Customer ${i}`,
    rfqIds: Array(1000).fill("rfq-private-history"),
    contact: { email: "private@example.com" },
    address: "Private street",
    requestCount: i,
  }))
  const input = querySchema.parse({
    area: "customers",
    contacts: true,
    sort: { field: "requestCount", direction: "asc" },
  })
  const small = computeResult(input, rows.slice(0, 20), readAt, 20)
  const large = computeResult(input, rows, readAt, 1200)
  const payload = modelResultContext([large, small], 8000)
  const parsed = JSON.parse(payload)
  assert.ok(parsed.reduce((total, r) => total + r.rows.length, 0) <= 20)
  assert.ok(payload.length <= 8000)
  assert.equal(payload.includes("private@example.com"), false)
  assert.equal(payload.includes("Private street"), false)
  assert.equal(payload.includes("rfq-private-history"), false)
  assert.ok(
    Math.abs(
      modelResultContext([large]).length - modelResultContext([small]).length
    ) < 50
  )
  assert.equal(
    companyAnswer([small], "review_records").answer.includes("Saran:"),
    true
  )
  assert.throws(() =>
    companyAnswer([small], "There are 900 fake customers [customer:0]")
  )
  assert.throws(() => jakartaDate("2026-02-30"), /Invalid date/)
})

test("calendar duration uses production timestamps stored on the related RFQ", () => {
  const requests = [
    request("job", "customer@example.com", "customer", "Customer", {
      productionStartedAt: 1000,
      completedAt: 7_201_000,
    }),
  ]
  const production = [
    {
      id: "job",
      data: {
        rfqId: "job",
        equipmentId: "printer",
        status: "Completed",
        plannedHours: 1,
        reservedKg: 2,
      },
    },
  ]
  const equipment = normalizeRows(
    "equipment",
    [{ id: "printer", data: { name: "Printer" } }],
    { requests, production }
  )
  assert.equal(equipment[0].calendarHours, 2)
  const jobs = normalizeRows("production", production, { requests })
  assert.equal(jobs[0].calendarHours, 2)
  assert.equal(jobs[0].reservedKg, 2)
  assert.equal(jobs[0].customerId, normalizeRows("customers", requests)[0].id)
})

test("operational catalog excludes private payment, membership and nested organization fields", () => {
  const payment = normalizeRows("payments", [
    {
      id: "p",
      data: {
        amount: 100,
        checkoutUrl: "private-checkout",
        apiKey: "private-key",
        ownerUid: "private-owner",
      },
    },
  ])
  const organization = normalizeRows("organization", [
    {
      id: "org",
      data: {
        name: "Factory",
        apiKey: "private-key",
        shippingOrigin: { destinationId: 42, apiKey: "private-key" },
      },
    },
  ])
  const memberships = normalizeRows("memberships", [
    {
      id: "private-uid",
      data: { name: "Operator", active: true, email: "private@example.com" },
    },
  ])
  const json = JSON.stringify([payment, organization, memberships])
  for (const secret of [
    "private-key",
    "private-checkout",
    "private-owner",
    "private-uid",
    "private@example.com",
  ])
    assert.equal(json.includes(secret), false)
  assert.equal(organization[0].shippingOrigin.destinationId, 42)
})

test("date filters include recorded production schedules and purchase ETA dates", () => {
  const rows = normalizeRows("purchasing", [
    { id: "p", data: { eta: "2026-10-18", quantity: 3 } },
  ])
  const result = computeResult(
    querySchema.parse({
      area: "purchasing",
      date: { field: "eta", from: "2026-10-18", to: "2026-10-18" },
    }),
    rows,
    readAt,
    1
  )
  assert.equal(result.matched, 1)
})

test("Genkit tool input schemas inline reused fields for Gemini", async () => {
  const { toJsonSchema } = await import("genkit/schema")
  for (const schema of [toolQuerySchema, toolAnalyticsSchema]) {
    const json = toJsonSchema({ schema })
    assert.equal(JSON.stringify(json).includes('"$ref"'), false)
    assert.equal(JSON.stringify(json).includes('"anyOf"'), false)
    assert.equal(json.properties.filters.items.properties.field.type, "string")
    assert.equal(json.properties.date.properties.field.type, "string")
    assert.equal(json.properties.sort.properties.field.type, "string")
    if (json.properties.compare)
      assert.equal(json.properties.compare.items.type, "object")
  }
})

test("typed tool filters retain zero, false, text and list values and reject ambiguous values", () => {
  const input = {
    area: "requests",
    filters: [
      { field: "quoteTotalIdr", op: "gte", value: { number: 0 } },
      { field: "paymentStatus", op: "eq", value: { text: "Paid" } },
      { field: "status", op: "in", value: { list: ["Completed", "Closed"] } },
    ],
  }
  assert.deepEqual(
    parseToolQuery(input).filters.map((f) => f.value),
    [0, "Paid", ["Completed", "Closed"]]
  )
  assert.equal(
    parseToolQuery({
      area: "memberships",
      filters: [{ field: "active", op: "eq", value: { boolean: false } }],
    }).filters[0].value,
    false
  )
  for (const value of [{}, { text: "Paid", number: 1 }])
    assert.throws(
      () =>
        parseToolQuery({
          area: "requests",
          filters: [{ field: "status", op: "eq", value }],
        }),
      /exactly one/
    )
})
