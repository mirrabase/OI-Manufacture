const test = require("node:test")
const assert = require("node:assert/strict")
const {
  buildManufacturerSnapshot,
  greetingResponse,
  publicOverview,
  safeChatResult,
  sourceMap,
} = require("./ai-data")

test("simple greetings get a direct reply without requiring workspace evidence", () => {
  const reply = greetingResponse("hello")
  const indonesianReply = greetingResponse("halo")

  assert.equal(reply.answerType, "conversation")
  assert.match(reply.answer, /^Hi!/)
  assert.deepEqual(reply.sources, [])
  assert.equal(indonesianReply.answer, "Halo! Saya bisa membantu mengecek pesanan, penawaran harga, kesiapan produksi, stok bahan, kapasitas mesin, kualitas, dan perawatan. Apa yang ingin Anda cari tahu?")
  assert.equal(greetingResponse("hello, what is PLA stock?"), null)
})

test("company-specific chat answers require a real source and fabricated references are removed", () => {
  const snapshot = buildManufacturerSnapshot({
    organizationId: "org-1",
    materials: [{ id: "pla", data: { name: "PLA", stock: 4, reserved: 1, reorderAt: 1 } }],
  })
  const sources = sourceMap(snapshot)
  const safe = safeChatResult(
    {
      answer: "PLA has 3 kg available.",
      answerType: "company_data",
      sourceIds: ["material:pla", "made-up:record"],
    },
    sources
  )

  assert.equal(safe.sources.length, 1)
  assert.equal(safe.sources[0].id, "material:pla")
  const clarification = safeChatResult(
    { answer: "There are 90 kg.", answerType: "company_data", sourceIds: [] },
    sources
  )
  assert.equal(clarification.answerType, "clarification")
  assert.match(clarification.answer, /Saya belum menemukan data yang cukup/)
})

test("complete payment filters report empty results without requesting an RFQ ID", () => {
  const result = safeChatResult(
    { answer: "No records found.", answerType: "clarification", sourceIds: [] },
    new Map(),
    "Paid"
  )

  assert.equal(result.answer, "Saya tidak menemukan RFQ yang sudah dibayar pada data yang diperiksa.")
  assert.deepEqual(result.sources, [])
})

test("overview only returns insights tied to deterministic signals and uses signal priority", () => {
  const snapshot = buildManufacturerSnapshot({
    organizationId: "org-1",
    materials: [
      { id: "resin", data: { name: "Resin", stock: 1, reserved: 1, reorderAt: 0.5 } },
      { id: "pla", data: { name: "PLA", stock: 0, reserved: 0, reorderAt: 2 } },
    ],
  })
  const result = publicOverview(snapshot, {
    summary: "Resin is unavailable.",
    insights: [
      {
        signalId: "stock:resin",
        recommendation: "Review incoming supply before committing new work.",
        prevention: "Review reorder levels against planned demand.",
      },
      {
        signalId: "stock:pla",
        recommendation: "This is a real signal but was not included in the model input.",
        prevention: "Monitor it.",
      },
      {
        signalId: "invented:signal",
        recommendation: "Do something.",
        prevention: "Monitor it.",
      },
    ],
  }, ["stock:resin"])

  assert.equal(result.insights.length, 1)
  assert.equal(result.insights[0].priority, "high")
  assert.equal(result.insights[0].title, "Resin is out of available stock")
  assert.match(result.insights[0].reason, /Available stock is 0 kg/)
  assert.equal(result.insights[0].sources[0].id, "material:resin")
  assert.equal(typeof result.summary, "string")
})

test("out-of-scope chat requests get a fixed manufacturing redirect", () => {
  const result = safeChatResult(
    { answer: "A fabricated answer", answerType: "out_of_scope", sourceIds: ["material:pla"] },
    new Map()
  )

  assert.match(result.answer, /manufaktur/)
  assert.match(result.answer, /Saya fokus membantu/)
  assert.deepEqual(result.sources, [])
})
