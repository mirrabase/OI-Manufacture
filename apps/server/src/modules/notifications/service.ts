import type { Firestore, DocumentData } from "firebase-admin/firestore"
import { createHash } from "node:crypto"

function getRfqNotificationEvents(
  before: DocumentData = {},
  after: DocumentData
) {
  const events = []

  if (before.status !== "Submitted" && after.status === "Submitted") {
    events.push({
      kind: "request_submitted",
      title: "New request",
      message: "Ready for quotation review.",
    })
  }
  if (before.paymentStatus !== "Paid" && after.paymentStatus === "Paid") {
    events.push({
      kind: "payment_confirmed",
      title: "Payment confirmed",
      message: "Payment is confirmed; prepare this order for production.",
    })
  }

  const productionEvents: Record<
    string,
    { kind: string; title: string; message: string }
  > = {
    "Preparing Production": {
      kind: "production_preparing",
      title: "Production preparation",
      message: "This paid order is ready for production planning.",
    },
    "In Production": {
      kind: "production_started",
      title: "Production started",
      message: "Manufacturing has started for this order.",
    },
    Completed: {
      kind: "order_completed",
      title: "Order completed",
      message: "Manufacturing has marked this order complete.",
    },
  }
  const productionEvent = productionEvents[after.status]
  if (before.status !== after.status && productionEvent) {
    events.push(productionEvent)
  }

  return events
}

function notificationId(eventId: string, recipientUid: string, kind: string) {
  return createHash("sha256")
    .update(`${eventId}:${recipientUid}:${kind}`)
    .digest("hex")
}

async function createManufacturerNotifications(
  db: Firestore,
  {
    before,
    after,
    rfqId,
    eventId,
    createdAt = Date.now(),
  }: {
    before?: DocumentData
    after: DocumentData
    rfqId: string
    eventId: string
    createdAt?: number
  }
) {
  const changes = getRfqNotificationEvents(before, after)
  const organizationId = after.organizationId
  if (!organizationId || !changes.length) return

  const organization = await db.doc(`organizations/${organizationId}`).get()
  if (!organization.exists || organization.data()!.active !== true) return

  const manufacturers = await db
    .collection("manufacturers")
    .where("organizationId", "==", organizationId)
    .get()
  const recipients = manufacturers.docs.filter(
    (snapshot) => snapshot.data()!.active === true
  )
  if (!recipients.length) return

  await Promise.all(
    recipients.flatMap((recipient) =>
      changes.map(async (change) => {
        const ref = db
          .collection("notifications")
          .doc(notificationId(eventId, recipient.id, change.kind))
        await db.runTransaction(async (transaction) => {
          const existing = await transaction.get(ref)
          if (existing.exists) return
          transaction.create(ref, {
            organizationId,
            recipientUid: recipient.id,
            rfqId,
            kind: change.kind,
            title: change.title,
            message: `${after.product || "Customer request"} · RFQ ${rfqId}. ${change.message}`,
            createdAt,
          })
        })
      })
    )
  )
}

export {
  createManufacturerNotifications,
  getRfqNotificationEvents,
  notificationId,
}
