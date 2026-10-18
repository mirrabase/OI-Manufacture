const { createHash } = require("node:crypto")

function getRfqNotificationEvents(before, after) {
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

  const productionEvents = {
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

function notificationId(eventId, recipientUid, kind) {
  return createHash("sha256")
    .update(`${eventId}:${recipientUid}:${kind}`)
    .digest("hex")
}

async function createManufacturerNotifications(db, event) {
  const before = event.data.before.data()
  const after = event.data.after.data()
  const changes = getRfqNotificationEvents(before, after)
  const organizationId = after.organizationId
  if (!organizationId || !changes.length) return

  const organization = await db.doc(`organizations/${organizationId}`).get()
  if (!organization.exists || organization.data().active !== true) return

  const manufacturers = await db
    .collection("manufacturers")
    .where("organizationId", "==", organizationId)
    .get()
  const recipients = manufacturers.docs.filter((snapshot) => snapshot.data().active === true)
  if (!recipients.length) return

  const rfqId = event.params.rfqId
  const eventId = event.id || event.data.after.updateTime.toMillis().toString()
  const createdAt = event.data.after.updateTime.toMillis()
  await Promise.all(
    recipients.flatMap((recipient) =>
      changes.map(async (change) => {
        const ref = db.collection("notifications").doc(
          notificationId(eventId, recipient.id, change.kind)
        )
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

module.exports = {
  createManufacturerNotifications,
  getRfqNotificationEvents,
  notificationId,
}
