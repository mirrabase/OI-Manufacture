import type { Firestore } from "firebase-admin/firestore"
import type { UserRequest, R2Store } from "../../shared/types.ts"
import { FieldValue } from "firebase-admin/firestore"
import { AppError } from "../../shared/errors.ts"
import { applyRfqEffects } from "./effects.ts"

async function activeManufacturerOrganization(db: Firestore, uid: string) {
  const membership = await db.doc(`manufacturers/${uid}`).get()
  const organizationId = membership.data()?.organizationId
  const organization =
    typeof organizationId === "string"
      ? await db.doc(`organizations/${organizationId}`).get()
      : null
  if (
    !membership.exists ||
    membership.data()!.active !== true ||
    !organization?.exists ||
    organization.data()!.active !== true
  ) {
    throw new AppError(
      "permission-denied",
      "An active Manufacturer organization is required."
    )
  }
  return organizationId
}

async function submitCustomerRequest({
  db,
  uid,
  rfqId,
  storage,
  storagePath,
}: UserRequest & { storage: R2Store; storagePath: string }) {
  if (!rfqId || typeof rfqId !== "string")
    throw new AppError("invalid-argument", "Request ID is required.")
  const ref = db.doc(`rfqs/${rfqId}`)
  const snapshot = await ref.get()
  if (!snapshot.exists) throw new AppError("not-found", "Request not found.")
  const rfq = snapshot.data()!
  if (rfq.ownerUid !== uid)
    throw new AppError(
      "permission-denied",
      "You cannot submit another customer's request."
    )
  if (rfq.status !== "Draft")
    throw new AppError(
      "failed-precondition",
      "This request was already submitted. Refresh your request list."
    )
  const key = rfq.model?.storagePath
  if (
    storagePath !== key ||
    !key?.startsWith(`rfqs/${uid}/${rfqId}/`) ||
    !/\.[sS][tT][lL]$/.test(key) ||
    key.split("/").includes("..")
  ) {
    throw new AppError(
      "invalid-argument",
      "The STL upload does not match this request."
    )
  }
  const object = await storage.head(key)
  if (
    !Number.isSafeInteger(object.size) ||
    object.size < 1 ||
    object.size > 50 * 1024 * 1024 ||
    object.size !== rfq.model.size ||
    object.contentType !== "model/stl"
  ) {
    await storage.delete(key).catch(() => {})
    throw new AppError(
      "failed-precondition",
      "The uploaded STL is missing, too large, or does not match the request."
    )
  }
  const now = Date.now()
  await db.runTransaction(async (transaction) => {
    const current = await transaction.get(ref)
    if (
      !current.exists ||
      current.data()!.ownerUid !== uid ||
      current.data()!.status !== "Draft" ||
      current.data()!.model?.storagePath !== key
    ) {
      throw new AppError(
        "failed-precondition",
        "This request changed before it could be submitted. Refresh and try again."
      )
    }
    transaction.update(ref, { status: "Submitted", submittedAt: now })
  })
  const after = await ref.get()
  await applyRfqEffects({ db, rfqId, before: rfq, after })
  return { ok: true }
}

async function setCustomerRequestQuote({
  db,
  uid,
  rfqId,
  quoteTotal,
}: UserRequest & { quoteTotal: number }) {
  if (!Number.isSafeInteger(quoteTotal) || quoteTotal < 1)
    throw new AppError("invalid-argument", "Enter a positive whole IDR amount.")
  const organizationId = await activeManufacturerOrganization(db, uid)
  const ref = db.doc(`rfqs/${rfqId}`)
  let before
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) throw new AppError("not-found", "Request not found.")
    before = snapshot.data()!
    if (before.organizationId !== organizationId)
      throw new AppError(
        "permission-denied",
        "You cannot quote another organization's request."
      )
    if (
      !["Submitted", "Quoted"].includes(before.status) ||
      before.paymentStatus !== "Unpaid" ||
      before.activeKaseraPaymentAttemptId
    ) {
      throw new AppError(
        "failed-precondition",
        "Only an unpaid request without an active checkout can be quoted."
      )
    }
    transaction.update(ref, {
      status: "Quoted",
      quoteTotal,
      paymentStatus: "Unpaid",
      quotedAt: Date.now(),
    })
  })
  const after = await ref.get()
  await applyRfqEffects({ db, rfqId, before, after })
  return { ok: true }
}

async function startProduction({ db, uid, rfqId }: UserRequest) {
  const organizationId = await activeManufacturerOrganization(db, uid)
  const requestRef = db.doc(`rfqs/${rfqId}`)
  const planRef = db.doc(`productionOrders/${rfqId}`)
  let before
  await db.runTransaction(async (transaction) => {
    const [planSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(planRef),
      transaction.get(requestRef),
    ])
    if (!planSnapshot.exists || !requestSnapshot.exists)
      throw new AppError("not-found", "Production order not found.")
    before = requestSnapshot.data()!
    const plan = planSnapshot.data()!
    if (before.organizationId !== organizationId)
      throw new AppError(
        "permission-denied",
        "You cannot start another organization's production."
      )
    if (
      before.paymentStatus !== "Paid" ||
      plan.status !== "Scheduled" ||
      before.status !== "Preparing Production"
    ) {
      throw new AppError(
        "failed-precondition",
        "Schedule this paid order before starting production."
      )
    }
    const machineRef = db.doc(`equipment/${plan.equipmentId}`)
    const machineSnapshot = await transaction.get(machineRef)
    if (!machineSnapshot.exists)
      throw new AppError(
        "failed-precondition",
        "The assigned machine is missing."
      )
    const activeId = machineSnapshot.data()!.activeProductionOrderId
    if (activeId && activeId !== rfqId) {
      const activePlan = await transaction.get(
        db.doc(`productionOrders/${activeId}`)
      )
      if (activePlan.exists && activePlan.data()!.status === "In Production")
        throw new AppError(
          "failed-precondition",
          "This machine is already running another production order."
        )
    }
    const now = Date.now()
    transaction.update(machineRef, {
      status: "Scheduled",
      activeProductionOrderId: rfqId,
      updatedAt: now,
    })
    transaction.update(planRef, { status: "In Production", updatedAt: now })
    transaction.update(requestRef, {
      status: "In Production",
      productionStartedAt: now,
    })
  })
  const after = await requestRef.get()
  await applyRfqEffects({ db, rfqId, before, after })
  return { ok: true }
}

async function completeProduction({
  db,
  uid,
  rfqId,
  actualGrams,
}: UserRequest & { actualGrams: number }) {
  if (
    !Number.isFinite(actualGrams) ||
    actualGrams <= 0 ||
    actualGrams > 100_000_000
  )
    throw new AppError(
      "invalid-argument",
      "Enter actual filament usage in grams."
    )
  const organizationId = await activeManufacturerOrganization(db, uid)
  const planRef = db.doc(`productionOrders/${rfqId}`)
  const requestRef = db.doc(`rfqs/${rfqId}`)
  let before
  await db.runTransaction(async (transaction) => {
    const [planSnapshot, requestSnapshot] = await Promise.all([
      transaction.get(planRef),
      transaction.get(requestRef),
    ])
    if (!planSnapshot.exists || !requestSnapshot.exists)
      throw new AppError("not-found", "Production order not found.")
    const plan = planSnapshot.data()!
    before = requestSnapshot.data()!
    if (before.organizationId !== organizationId)
      throw new AppError(
        "permission-denied",
        "You cannot complete another organization's production."
      )
    if (
      before.paymentStatus !== "Paid" ||
      plan.status !== "In Production" ||
      before.status !== "In Production"
    ) {
      throw new AppError(
        "failed-precondition",
        "Only active, paid production can be completed."
      )
    }
    const materialRef = db.doc(`materials/${plan.materialId}`)
    const machineRef = db.doc(`equipment/${plan.equipmentId}`)
    const [materialSnapshot, machineSnapshot] = await Promise.all([
      transaction.get(materialRef),
      transaction.get(machineRef),
    ])
    if (!materialSnapshot.exists || !machineSnapshot.exists)
      throw new AppError(
        "failed-precondition",
        "The assigned material or machine is missing."
      )
    const material = materialSnapshot.data()!
    const machine = machineSnapshot.data()!
    const actualKg = Math.round((actualGrams / 1000) * 1000) / 1000
    const remainingReservations = Math.max(
      0,
      material.reserved - plan.reservedKg
    )
    const nextStock = Math.round((material.stock - actualKg) * 1000) / 1000
    if (nextStock < remainingReservations)
      throw new AppError(
        "failed-precondition",
        "Actual usage exceeds unreserved stock. Adjust inventory before completing this job."
      )
    const now = Date.now()
    const remainingScheduledHours = Math.max(
      0,
      Math.round((machine.scheduledHours - plan.plannedHours) * 100) / 100
    )
    transaction.update(materialRef, {
      stock: nextStock,
      reserved: remainingReservations,
      updatedAt: now,
    })
    transaction.update(machineRef, {
      status: remainingScheduledHours > 0 ? "Scheduled" : "Available",
      activeProductionOrderId: FieldValue.delete(),
      scheduledHours: remainingScheduledHours,
      updatedAt: now,
    })
    transaction.update(planRef, {
      status: "Completed",
      reservedKg: 0,
      actualGrams,
      updatedAt: now,
    })
    transaction.update(requestRef, { status: "Completed", completedAt: now })
    transaction.create(db.collection("inventoryMovements").doc(), {
      organizationId,
      type: "consumption",
      materialId: plan.materialId,
      deltaKg: -actualKg,
      reservedDeltaKg: -plan.reservedKg,
      referenceId: rfqId,
      createdAt: now,
    })
  })
  const after = await requestRef.get()
  await applyRfqEffects({ db, rfqId, before, after })
  return { ok: true }
}

export {
  activeManufacturerOrganization,
  completeProduction,
  setCustomerRequestQuote,
  startProduction,
  submitCustomerRequest,
}
