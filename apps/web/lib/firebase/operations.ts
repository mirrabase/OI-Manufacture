import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDocs,
  onSnapshot,
  runTransaction,
  updateDoc,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { manufacturerDb } from "./client"
import { callApi } from "./api"
import {
  getProductionReadiness,
  getCompatibleEquipment,
  validateEquipment,
  validateMaterial,
  type EquipmentRecord,
  type MaterialRecord,
  type ProductionOrder,
  type PurchaseOrder,
} from "@/lib/manufacturing-operations"
import type { CustomerRFQ } from "@/lib/customer-portal"
import { getCurrentOrganizationId } from "./organization-access"

const materials = collection(manufacturerDb, "materials")
const equipment = collection(manufacturerDb, "equipment")
const purchaseOrders = collection(manufacturerDb, "purchaseOrders")
const productionOrders = collection(manufacturerDb, "productionOrders")
const inventoryMovements = collection(manufacturerDb, "inventoryMovements")

function withId<T>(snapshot: QueryDocumentSnapshot<DocumentData>) {
  return { id: snapshot.id, ...snapshot.data() } as T
}

export function listenToMaterials(organizationId: string, onRows: (rows: MaterialRecord[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(materials, where("organizationId", "==", organizationId)), (snapshot) => onRows(snapshot.docs.map((item) => withId<MaterialRecord>(item))), onError)
}

export function listenToEquipment(organizationId: string, onRows: (rows: EquipmentRecord[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(equipment, where("organizationId", "==", organizationId)), (snapshot) => onRows(snapshot.docs.map((item) => withId<EquipmentRecord>(item))), onError)
}

export function listenToPurchaseOrders(organizationId: string, onRows: (rows: PurchaseOrder[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(purchaseOrders, where("organizationId", "==", organizationId)), (snapshot) => onRows(snapshot.docs.map((item) => withId<PurchaseOrder>(item))), onError)
}

export function listenToProductionOrders(organizationId: string, onRows: (rows: ProductionOrder[]) => void, onError: (error: Error) => void) {
  return onSnapshot(query(productionOrders, where("organizationId", "==", organizationId)), (snapshot) => onRows(snapshot.docs.map((item) => withId<ProductionOrder>(item))), onError)
}

export function listenToProductionOrder(id: string, onValue: (order: ProductionOrder | null) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(manufacturerDb, "productionOrders", id), (snapshot) => onValue(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as ProductionOrder : null), onError)
}

export async function confirmRequestPayment(id: string) {
  await callApi("payments/manual-confirm", { rfqId: id }, true)
}

export async function saveMaterial(value: Omit<MaterialRecord, "id" | "organizationId" | "stock" | "reserved">, id?: string) {
  validateMaterial(value)
  const payload = { ...value, updatedAt: Date.now() }
  if (id) await updateDoc(doc(materials, id), payload)
  else await addDoc(materials, { ...payload, organizationId: await getCurrentOrganizationId(), stock: 0, reserved: 0 })
}

export async function saveEquipment(value: Omit<EquipmentRecord, "id" | "organizationId" | "scheduledHours" | "activeProductionOrderId">, id?: string) {
  validateEquipment(value)
  const payload = { ...value, updatedAt: Date.now() }
  if (id) {
    await runTransaction(manufacturerDb, async (transaction) => {
      const ref = doc(equipment, id)
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists()) throw new Error("Equipment not found.")
      if (snapshot.data().scheduledHours > 0 || snapshot.data().activeProductionOrderId) throw new Error("Equipment cannot be edited while production is queued or running.")
      transaction.update(ref, payload)
    })
  } else await addDoc(equipment, { ...payload, organizationId: await getCurrentOrganizationId(), scheduledHours: 0 })
}

export async function adjustMaterialStock(id: string, deltaKg: number, reason: string) {
  const amount = Math.round(deltaKg * 1000) / 1000
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000 || !reason.trim()) {
    throw new Error("Enter a stock adjustment up to 100,000 kg and a reason.")
  }
  const organizationId = await getCurrentOrganizationId()
  const materialRef = doc(materials, id)
  const movementRef = doc(inventoryMovements)
  await runTransaction(manufacturerDb, async (transaction) => {
    const snapshot = await transaction.get(materialRef)
    if (!snapshot.exists()) throw new Error("Material not found.")
    const material = snapshot.data() as MaterialRecord
    const nextStock = Math.round((material.stock + amount) * 1000) / 1000
    if (nextStock < material.reserved || nextStock > 100_000) throw new Error("Stock cannot be lower than reserved stock or exceed 100,000 kg.")
    transaction.update(materialRef, { stock: nextStock, updatedAt: Date.now() })
    transaction.set(movementRef, { organizationId, type: "adjustment", materialId: id, deltaKg: amount, reservedDeltaKg: 0, reason: reason.trim(), createdAt: Date.now() })
  })
}

export async function createPurchaseOrder(value: { supplier: string; materialId: string; quantity: number; unitCost?: number; eta: string }) {
  if (!value.supplier.trim() || !value.materialId || !Number.isFinite(value.quantity) || value.quantity <= 0 || value.quantity > 100_000
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.eta) || (value.unitCost !== undefined && (!Number.isSafeInteger(value.unitCost) || value.unitCost < 0 || value.unitCost > 10_000_000))) {
    throw new Error("Enter a supplier, material, positive quantity, and expected delivery date.")
  }
  await addDoc(purchaseOrders, { ...value, organizationId: await getCurrentOrganizationId(), supplier: value.supplier.trim(), status: "Ordered", createdAt: Date.now() })
}

export async function receivePurchaseOrder(id: string) {
  const organizationId = await getCurrentOrganizationId()
  const orderRef = doc(purchaseOrders, id)
  const movementRef = doc(inventoryMovements, `po-${id}`)
  await runTransaction(manufacturerDb, async (transaction) => {
    const orderSnapshot = await transaction.get(orderRef)
    if (!orderSnapshot.exists()) throw new Error("Purchase order not found.")
    const order = orderSnapshot.data() as PurchaseOrder
    if (order.status === "Received") return
    if (order.status !== "Ordered") throw new Error("Only ordered purchases can be received.")
    const materialRef = doc(materials, order.materialId)
    const materialSnapshot = await transaction.get(materialRef)
    if (!materialSnapshot.exists()) throw new Error("The linked material no longer exists.")
    const material = materialSnapshot.data() as MaterialRecord
    const nextStock = Math.round((material.stock + order.quantity) * 1000) / 1000
    if (nextStock > 100_000) throw new Error("Received stock exceeds the 100,000 kg limit.")
    const now = Date.now()
    transaction.update(materialRef, { stock: nextStock, updatedAt: now })
    transaction.update(orderRef, { status: "Received", receivedAt: now })
    transaction.set(movementRef, { organizationId, type: "purchaseReceipt", materialId: order.materialId, deltaKg: order.quantity, reservedDeltaKg: 0, referenceId: id, createdAt: now })
  })
}

export async function cancelPurchaseOrder(id: string) {
  await runTransaction(manufacturerDb, async (transaction) => {
    const orderRef = doc(purchaseOrders, id)
    const snapshot = await transaction.get(orderRef)
    if (!snapshot.exists()) throw new Error("Purchase order not found.")
    if (snapshot.data().status !== "Ordered") throw new Error("Only ordered purchases can be cancelled.")
    transaction.update(orderRef, { status: "Cancelled", updatedAt: Date.now() })
  })
}

export async function updateProductionOrder(id: string, value: Pick<ProductionOrder, "materialId" | "plannedGrams" | "plannedHours">) {
  if (!Number.isFinite(value.plannedGrams) || value.plannedGrams < 0 || value.plannedGrams > 100_000_000
    || !Number.isFinite(value.plannedHours) || value.plannedHours < 0 || value.plannedHours > 10_000) {
    throw new Error("Enter valid planned filament and machine time values.")
  }
  await runTransaction(manufacturerDb, async (transaction) => {
    const ref = doc(productionOrders, id)
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists() || snapshot.data().status !== "Preparing Production") throw new Error("Only orders preparing for production can be edited.")
    transaction.update(ref, { ...value, updatedAt: Date.now() })
  })
}

function addBusinessDays(date: string, days: number) {
  const result = new Date(`${date}T12:00:00Z`)
  let remaining = days
  while (result.getUTCDay() === 0 || result.getUTCDay() === 6) result.setUTCDate(result.getUTCDate() + 1)
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1)
    if (result.getUTCDay() !== 0 && result.getUTCDay() !== 6) remaining--
  }
  return result.toISOString().slice(0, 10)
}

export async function scheduleProduction(id: string, requestedStartDate: string) {
  const parsedStartDate = new Date(`${requestedStartDate}T12:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate) || Number.isNaN(parsedStartDate.getTime()) || parsedStartDate.toISOString().slice(0, 10) !== requestedStartDate) {
    throw new Error("Choose a valid production start date.")
  }
  const organizationId = await getCurrentOrganizationId()
  const machineRefs = (await getDocs(query(equipment, where("organizationId", "==", organizationId)))).docs.map((item) => doc(equipment, item.id))
  const planRef = doc(productionOrders, id)
  const requestRef = doc(manufacturerDb, "rfqs", id)
  const movementRef = doc(inventoryMovements)
  await runTransaction(manufacturerDb, async (transaction) => {
    const [planSnapshot, requestSnapshot] = await Promise.all([transaction.get(planRef), transaction.get(requestRef)])
    if (!planSnapshot.exists() || !requestSnapshot.exists()) throw new Error("Production order not found.")
    const plan = { id, ...planSnapshot.data() } as ProductionOrder
    const rfq = requestSnapshot.data() as CustomerRFQ
    if (plan.status !== "Preparing Production" || rfq.status !== "Preparing Production" || rfq.paymentStatus !== "Paid") throw new Error("This order is not ready to schedule.")
    const materialRef = doc(materials, plan.materialId)
    const [materialSnapshot, ...machineSnapshots] = await Promise.all([transaction.get(materialRef), ...machineRefs.map((ref) => transaction.get(ref))])
    if (!materialSnapshot.exists()) throw new Error("Select an existing production material.")
    const material = { id: materialSnapshot.id, ...materialSnapshot.data() } as MaterialRecord
    const requestWithId = { ...rfq, id }
    const machines = machineSnapshots.filter((snapshot) => snapshot.exists()).map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }) as EquipmentRecord)
    const readiness = getProductionReadiness(requestWithId, { ...plan, equipmentId: "" }, [material], machines)
    if (!readiness.ready) throw new Error(readiness.blockers.join(" "))
    const machine = getCompatibleEquipment(requestWithId, material, machines)
      .sort((left, right) => (left.scheduledHours || 0) / left.workingHours - (right.scheduledHours || 0) / right.workingHours || left.name.localeCompare(right.name))[0]
    if (!machine) throw new Error("No compatible equipment has an available production slot.")
    const equipmentRef = doc(equipment, machine.id)
    const requiredKg = Math.round((plan.plannedGrams / 1000) * 1000) / 1000
    // shortcut: queue uses aggregate hours, split by daily capacity until date-specific machine shifts are stored.
    const queueDays = Math.ceil(machine.scheduledHours / machine.workingHours)
    const scheduledStartDate = addBusinessDays(requestedStartDate, queueDays)
    const estimatedCompletionDate = addBusinessDays(scheduledStartDate, Math.max(0, Math.ceil(plan.plannedHours / machine.workingHours) - 1))
    const nextScheduledHours = Math.round((machine.scheduledHours + plan.plannedHours) * 100) / 100
    if (nextScheduledHours > 100_000) throw new Error("This machine's production queue is full.")
    const now = Date.now()
    transaction.update(materialRef, { reserved: Math.round((material.reserved + requiredKg) * 1000) / 1000, updatedAt: now })
    transaction.update(equipmentRef, {
      status: "Scheduled",
      scheduledHours: nextScheduledHours,
      updatedAt: now,
    })
    transaction.update(planRef, { status: "Scheduled", equipmentId: machine.id, scheduledStartDate, estimatedCompletionDate, reservedKg: requiredKg, updatedAt: now })
    transaction.set(movementRef, { organizationId, type: "reservation", materialId: material.id, deltaKg: 0, reservedDeltaKg: requiredKg, referenceId: id, createdAt: now })
  })
}

export async function unscheduleProduction(id: string) {
  const organizationId = await getCurrentOrganizationId()
  await runTransaction(manufacturerDb, async (transaction) => {
    const planRef = doc(productionOrders, id)
    const snapshot = await transaction.get(planRef)
    if (!snapshot.exists()) throw new Error("Production order not found.")
    const plan = { id, ...snapshot.data() } as ProductionOrder
    if (plan.status !== "Scheduled") throw new Error("Only scheduled production can be unscheduled.")
    const materialRef = doc(materials, plan.materialId)
    const machineRef = doc(equipment, plan.equipmentId)
    const [materialSnapshot, machineSnapshot] = await Promise.all([transaction.get(materialRef), transaction.get(machineRef)])
    if (!materialSnapshot.exists() || !machineSnapshot.exists()) throw new Error("The reserved material or machine is missing.")
    const material = materialSnapshot.data() as MaterialRecord
    const machine = machineSnapshot.data() as EquipmentRecord
    const now = Date.now()
    const remainingScheduledHours = Math.max(0, Math.round((machine.scheduledHours - plan.plannedHours) * 100) / 100)
    transaction.update(materialRef, { reserved: Math.max(0, Math.round((material.reserved - plan.reservedKg) * 1000) / 1000), updatedAt: now })
    transaction.update(machineRef, {
      status: machine.status === "Maintenance" || machine.status === "Offline" ? machine.status : remainingScheduledHours > 0 || machine.activeProductionOrderId ? "Scheduled" : "Available",
      scheduledHours: remainingScheduledHours,
      ...(machine.activeProductionOrderId === id ? { activeProductionOrderId: deleteField() } : {}),
      updatedAt: now,
    })
    transaction.update(planRef, { status: "Preparing Production", equipmentId: "", scheduledStartDate: deleteField(), estimatedCompletionDate: deleteField(), reservedKg: 0, updatedAt: now })
    transaction.set(doc(inventoryMovements), { organizationId, type: "release", materialId: plan.materialId, deltaKg: 0, reservedDeltaKg: -plan.reservedKg, referenceId: id, createdAt: now })
  })
}

export async function startProduction(id: string) {
  await callApi(`rfqs/${encodeURIComponent(id)}/production/start`, {}, true)
}

export async function completeProduction(id: string, actualGrams: number) {
  await callApi(`rfqs/${encodeURIComponent(id)}/production/complete`, { actualGrams }, true)
}
