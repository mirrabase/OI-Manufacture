import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { initializeApp, deleteApp } from "firebase-admin/app"
import { getFirestore } from "firebase-admin/firestore"
const {
  completeProduction,
  setCustomerRequestQuote,
  startProduction,
  submitCustomerRequest,
} = await import("../src/modules/rfqs/service.ts")

process.env.METADATA_SERVER_DETECTION = "none"
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:18080"
process.env.GCLOUD_PROJECT ||= "demo-oi-manufacture"
const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT }, `rfq-workflow-${randomUUID()}`)
const db = getFirestore(app)
const organizationId = `workflow-${randomUUID()}`
const manufacturerUid = `manufacturer-${randomUUID()}`
const customerUid = `customer-${randomUUID()}`
const rfqId = `RFQ-${randomUUID()}`
const materialId = `material-${rfqId}`
const equipmentId = `equipment-${rfqId}`
const filePath = `rfqs/${customerUid}/${rfqId}/model.stl`

test("Hono RFQ workflows authorize ownership and complete quotation-to-production transitions", async () => {
  await db.doc(`organizations/${organizationId}`).set({ name: "Workflow test", active: true })
  await db.doc(`manufacturers/${manufacturerUid}`).set({ organizationId, active: true, role: "owner" })
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  await rfqRef.set({
    organizationId,
    ownerUid: customerUid,
    customer: { name: "Workflow test customer", email: "" },
    product: "Workflow test part",
    requirements: { quantity: 1, material: "PLA", process: "FDM" },
    model: { name: "model.stl", size: 128, contentType: "model/stl", storagePath: filePath },
    status: "Draft",
    paymentStatus: "Unpaid",
    createdAt: Date.now(),
  })
  const storage = { head: async () => ({ size: 128, contentType: "model/stl" }) }

  await assert.rejects(
    submitCustomerRequest({ db, uid: "another-customer", rfqId, storage, storagePath: filePath }),
    { code: "permission-denied" },
  )
  await submitCustomerRequest({ db, uid: customerUid, rfqId, storage, storagePath: filePath })
  assert.equal((await rfqRef.get()).data().status, "Submitted")

  await setCustomerRequestQuote({ db, uid: manufacturerUid, rfqId, quoteTotal: 42_000 })
  assert.equal((await rfqRef.get()).data().quoteTotal, 42_000)
  await assert.rejects(
    startProduction({ db, uid: "another-manufacturer", rfqId }),
    { code: "permission-denied" },
  )

  await rfqRef.update({ status: "Preparing Production", paymentStatus: "Paid", paidAt: Date.now() })
  await db.doc(`materials/${materialId}`).set({ organizationId, name: "PLA", stock: 2, reserved: 0.5 })
  await db.doc(`equipment/${equipmentId}`).set({ organizationId, name: "Test printer", status: "Scheduled", scheduledHours: 1 })
  await db.doc(`productionOrders/${rfqId}`).set({
    rfqId, organizationId, status: "Scheduled", materialId, equipmentId,
    plannedGrams: 500, plannedHours: 1, reservedKg: 0.5, createdAt: Date.now(), updatedAt: Date.now(),
  })

  await startProduction({ db, uid: manufacturerUid, rfqId })
  assert.equal((await rfqRef.get()).data().status, "In Production")
  assert.equal((await db.doc(`equipment/${equipmentId}`).get()).data().activeProductionOrderId, rfqId)
  await completeProduction({ db, uid: manufacturerUid, rfqId, actualGrams: 200 })

  assert.equal((await rfqRef.get()).data().status, "Completed")
  assert.equal((await db.doc(`materials/${materialId}`).get()).data().stock, 1.8)
  assert.equal((await db.doc(`materials/${materialId}`).get()).data().reserved, 0)
  assert.equal((await db.doc(`equipment/${equipmentId}`).get()).data().scheduledHours, 0)
  assert.equal((await db.doc(`productionOrders/${rfqId}`).get()).data().actualGrams, 200)
})

test.after(async () => {
  const [notifications, movements] = await Promise.all([
    db.collection("notifications").where("rfqId", "==", rfqId).get(),
    db.collection("inventoryMovements").where("referenceId", "==", rfqId).get(),
  ])
  await Promise.all([
    ...notifications.docs.map((item) => item.ref.delete()),
    ...movements.docs.map((item) => item.ref.delete()),
    db.doc(`rfqs/${rfqId}`).delete(),
    db.doc(`productionOrders/${rfqId}`).delete(),
    db.doc(`materials/${materialId}`).delete(),
    db.doc(`equipment/${equipmentId}`).delete(),
    db.doc(`manufacturers/${manufacturerUid}`).delete(),
    db.doc(`organizations/${organizationId}`).delete(),
  ])
  await deleteApp(app)
})
