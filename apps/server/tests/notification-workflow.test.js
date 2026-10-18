import test from "node:test"
import assert from "node:assert/strict"
const {
  getRfqNotificationEvents,
  notificationId,
} = await import("../src/modules/notifications/service.ts")

test("creates notifications only for actionable RFQ transitions", () => {
  assert.deepEqual(
    getRfqNotificationEvents(
      { status: "Draft", paymentStatus: "Unpaid" },
      { status: "Submitted", paymentStatus: "Unpaid" }
    ).map(({ kind }) => kind),
    ["request_submitted"]
  )
  assert.deepEqual(
    getRfqNotificationEvents(
      { status: "Submitted", paymentStatus: "Unpaid" },
      { status: "Quoted", paymentStatus: "Unpaid", quoteTotal: 50_000 }
    ),
    []
  )
  assert.deepEqual(
    getRfqNotificationEvents(
      { status: "Quoted", paymentStatus: "Unpaid" },
      { status: "Preparing Production", paymentStatus: "Paid" }
    ).map(({ kind }) => kind),
    ["payment_confirmed", "production_preparing"]
  )
})

test("notification document IDs are stable and scoped to each recipient and event", () => {
  assert.equal(notificationId("event-1", "user-1", "payment_confirmed"), notificationId("event-1", "user-1", "payment_confirmed"))
  assert.notEqual(notificationId("event-1", "user-1", "payment_confirmed"), notificationId("event-1", "user-2", "payment_confirmed"))
  assert.notEqual(notificationId("event-1", "user-1", "payment_confirmed"), notificationId("event-2", "user-1", "payment_confirmed"))
})
