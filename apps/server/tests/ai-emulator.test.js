import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { initializeApp, deleteApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
import {
  querySchema,
  analyticsSchema,
  createQuerySession,
  queryRecords,
  renderResults,
} from "../src/modules/ai/query.ts"
import { cachedOverview } from "../src/modules/ai/overview-cache.ts"

const host = process.env.FIRESTORE_EMULATOR_HOST
if (host && !/^(127\.0\.0\.1|localhost):\d+$/.test(host))
  throw new Error("AI integration tests require a loopback emulator")
test(
  "Firestore: complete scans, aggregates, org isolation, contacts, deduplication and overview leases",
  { skip: !host },
  async () => {
    process.env.METADATA_SERVER_DETECTION = "none"
    const app = initializeApp(
      { projectId: "demo-oi-manufacture" },
      `ai-test-${randomUUID()}`
    )
    const db = getFirestore(app)
    const org = `ai-test-${randomUUID()}`
    const otherOrg = `${org}-other`
    const refs = []
    try {
      for (let start = 0; start < 1002; start += 400) {
        const batch = db.batch()
        for (let i = start; i < Math.min(start + 400, 1002); i++) {
          const ref = db
            .collection("materials")
            .doc(`${org}-${String(i).padStart(4, "0")}`)
          refs.push(ref)
          batch.create(ref, {
            organizationId: i === 1001 ? otherOrg : org,
            name: `Material ${i}`,
            stock: i === 1001 ? 999999 : i,
            reserved: 0,
          })
        }
        await batch.commit()
      }
      for (const [collection, id, data] of [
        [
          "rfqs",
          `${org}-rfq`,
          {
            status: "Closed",
            customer: {
              name: "Customer",
              email: "private@example.com",
              phone: "08123456789",
            },
            ownerUid: "private-uid",
            quoteTotal: 500,
            paymentStatus: "Paid",
            createdAt: Date.now(),
          },
        ],
        [
          "notifications",
          `${org}-self`,
          { recipientUid: "self", title: "Own notice" },
        ],
        [
          "notifications",
          `${org}-other`,
          { recipientUid: "someone-else", title: "Private notice" },
        ],
      ]) {
        const ref = db.collection(collection).doc(id)
        refs.push(ref)
        await ref.set({ organizationId: org, ...data })
      }
      const session = createQuerySession(db, org, "self")
      const input = analyticsSchema.parse({
        area: "materials",
        operation: "sum",
        metric: "stockKg",
        groupBy: "name",
        limit: 1,
      })
      const first = queryRecords(session, input)
      assert.equal(queryRecords(session, input), first)
      const result = await first
      assert.equal(result.scanned, 1001)
      assert.equal(result.matched, 1001)
      assert.equal(result.rows[0].value, 1000)
      assert.equal(session.reads, 1001)
      const total = await queryRecords(
        session,
        analyticsSchema.parse({
          area: "materials",
          operation: "sum",
          metric: "stockKg",
        })
      )
      assert.equal(total.rows[0].value, 500500)
      assert.equal(session.reads, 1001)
      const late = db.collection("materials").doc(`${org}-late`)
      refs.push(late)
      await late.set({
        organizationId: org,
        name: "After snapshot",
        stock: 888888,
      })
      const aggregate = await queryRecords(
        session,
        analyticsSchema.parse({ area: "materials", operation: "count" })
      )
      assert.equal(aggregate.rows[0].value, 1001)
      assert.equal(session.reads, 1001)
      assert.equal(session.aggregateQueries, 1)
      assert.equal(session.aggregatedRecords, 1001)
      const notifications = await queryRecords(
        session,
        querySchema.parse({ area: "notifications" })
      )
      assert.equal(notifications.matched, 1)
      assert.equal(notifications.rows[0].title, "Own notice")
      const customer = await queryRecords(
        session,
        querySchema.parse({ area: "customers" })
      )
      assert.equal(customer.rows[0].paidValueIdr, 500)
      assert.equal(
        JSON.stringify(customer).includes("private@example.com"),
        false
      )
      await assert.rejects(
        async () =>
          queryRecords(
            session,
            querySchema.parse({ area: "customers", contacts: true })
          ),
        /explicit contact/
      )
      const contacts = await queryRecords(
        createQuerySession(db, org, "self", true),
        querySchema.parse({ area: "customers", contacts: true })
      )
      assert.equal(contacts.rows[0].contact.email, "private@example.com")
      const foreign = await queryRecords(
        session,
        querySchema.parse({ area: "materials", recordId: `${org}-1001` })
      )
      assert.equal(foreign.matched, 0)
      assert.equal(renderResults([foreign]).includes("999999"), false)

      const cacheRef = db.doc(`organizations/${org}/aiCache/overview`)
      refs.push(cacheRef)
      let generated = 0
      const validate = (value) => (value?.generatedAt ? value : null)
      const generate = async () => {
        generated++
        return {
          generatedAt: Date.now(),
          insights: [{ title: "same generation" }],
        }
      }
      const [a, b] = await Promise.all([
        cachedOverview(cacheRef, "facts-1", generate, validate),
        cachedOverview(cacheRef, "facts-1", generate, validate),
      ])
      assert.equal(generated, 1)
      assert.deepEqual(a, b)
      await cachedOverview(cacheRef, "facts-2", generate, validate)
      assert.equal(generated, 2)
      await assert.rejects(
        cachedOverview(
          cacheRef,
          "facts-3",
          async () => {
            throw new Error("Provider unavailable")
          },
          validate
        )
      )
      const preserved = (await cacheRef.get()).data()
      assert.equal(
        preserved.response.generatedAt,
        (await cachedOverview(cacheRef, "facts-2", generate, validate))
          .generatedAt
      )
      assert.equal(preserved.leaseUntil, 0)
      assert.equal(generated, 2)
    } finally {
      for (let start = 0; start < refs.length; start += 400) {
        const batch = db.batch()
        refs.slice(start, start + 400).forEach((ref) => batch.delete(ref))
        await batch.commit()
      }
      await deleteApp(app)
    }
  }
)
