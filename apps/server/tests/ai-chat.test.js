import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { initializeApp, deleteApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"

const host = process.env.FIRESTORE_EMULATOR_HOST
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host))
  throw new Error("AI chat tests require a loopback emulator")

test(
  "chat API completes top customer → quotation value, including a repeated selection",
  { skip: !host },
  async (t) => {
    process.env.METADATA_SERVER_DETECTION = "none"
    process.env.GOOGLE_GENAI_API_KEY = "test-key-no-live-provider"
    const firebase = initializeApp({ projectId: "demo-oi-manufacture" })
    const db = getFirestore(firebase)
    const uid = `ai-chat-${randomUUID()}`
    const organizationId = `${uid}-org`
    const refs = []
    try {
      for (const [path, data] of [
        [`manufacturers/${uid}`, { organizationId, active: true }],
        [
          `organizations/${organizationId}`,
          { name: "Chat fixture", active: true },
        ],
        [
          `rfqs/${uid}-a`,
          {
            organizationId,
            status: "Closed",
            customer: { name: "First Customer", email: "first@example.com" },
            quoteTotal: 86000,
            paymentStatus: "Paid",
          },
        ],
        [
          `rfqs/${uid}-b`,
          {
            organizationId,
            status: "Completed",
            customer: { name: "Second Customer", email: "second@example.com" },
            quoteTotal: 84000,
            paymentStatus: "Paid",
          },
        ],
      ]) {
        const ref = db.doc(path)
        refs.push(ref)
        await ref.set(data)
      }
      let calls = 0
      const validate = (schema) => {
        assert.ok(
          schema?.type,
          "Every Gemini tool parameter must have a concrete type"
        )
        for (const required of schema.required ?? [])
          assert.ok(
            schema.properties?.[required],
            `Missing required property ${required}`
          )
        for (const property of Object.values(schema.properties ?? {}))
          validate(property)
        if (schema.items) validate(schema.items)
      }
      t.mock.method(globalThis, "fetch", async (url, options) => {
        assert.match(
          String(url),
          /^https:\/\/generativelanguage.googleapis.com\//
        )
        calls++
        const request = JSON.parse(options.body)
        for (const tool of request.tools)
          for (const declaration of tool.functionDeclarations ??
            tool.function_declarations)
            validate(declaration.parameters)
        assert.ok(
          JSON.stringify(request.contents).includes(
            "bantu gw cari tau top customer gw dong"
          ),
          "The original request must survive a repeated metric selection"
        )
        const part =
          calls === 1
            ? { functionCall: { name: "manufacturerDataCatalog", args: {} } }
            : calls === 2
              ? {
                  functionCall: {
                    name: "analyzeManufacturerRecords",
                    args: {
                      area: "customers",
                      operation: "sum",
                      metric: "paidValueIdr",
                      groupBy: "id",
                      sort: { field: "value", direction: "desc" },
                      filters: [],
                    },
                  },
                }
              : {
                  text: JSON.stringify({
                    answer: "Fabricated total 999999999 [invented:source]",
                    answerType: "company_data",
                    sourceIds: ["invented:source"],
                    recommendation: "review_records",
                  }),
                }
        return Response.json({
          candidates: [
            { content: { role: "model", parts: [part] }, finishReason: "STOP" },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            thoughtsTokenCount: 2,
            totalTokenCount: 17,
          },
        })
      })
      const { createApp } = await import("../src/app.ts")
      const app = createApp({
        db,
        auth: { verifyIdToken: async () => ({ uid }) },
        env: {},
      })
      const send = (messages) =>
        app.request("/api/ai/chat", {
          method: "POST",
          headers: {
            Authorization: "Bearer fixture",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages }),
        })
      const question = {
        role: "user",
        content: "bantu gw cari tau top customer gw dong",
      }
      const clarification = await (await send([question])).json()
      assert.equal(clarification.answerType, "clarification")
      assert.equal(calls, 0)
      const response = await send([
        question,
        { role: "assistant", content: clarification.answer },
        { role: "user", content: "nilai quotation" },
        { role: "user", content: "nilai quotation" },
      ])
      assert.equal(response.status, 200)
      const result = await response.json()
      assert.equal(result.answerType, "company_data")
      assert.ok(
        result.answer.indexOf("First Customer") <
          result.answer.indexOf("Second Customer")
      )
      assert.match(result.answer, /86000/)
      assert.match(result.answer, /84000/)
      assert.doesNotMatch(
        result.answer,
        /999999999|invented:source|first@example.com|second@example.com/
      )
      assert.equal(result.sources.length, 2)
      assert.equal(calls, 3)
    } finally {
      await Promise.all(refs.map((ref) => ref.delete()))
      await deleteApp(firebase)
    }
  }
)
