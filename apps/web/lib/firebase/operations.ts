import {
  addDoc,
  collection,
  deleteField,
  doc,
  onSnapshot,
  runTransaction,
  updateDoc,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore"
import { httpsCallable } from "firebase/functions"
import { manufacturerDb, manufacturerFunctions } from "./client"
import {
  getProductionReadiness,
  validateEquipment,
  validateMaterial,
  type EquipmentRecord,
  type MaterialRecord,
  type ProductionOrder,
  type ProductionRequest,
  type PurchaseOrder,
} from "@/lib/manufacturing-operations"
import type { CustomerRFQ } from "@/lib/customer-portal"

const materials = collection(manufacturerDb, "materials")
const equipment = collection(manufacturerDb, "equipment")
const purchaseOrders = collection(manufacturerDb, "purchaseOrders")
const productionOrders = collection(manufacturerDb, "productionOrders")
const inventoryMovements = collection(manufacturerDb, "inventoryMovements")

function withId<T>(snapshot: QueryDocumentSnapshot<DocumentData>) {
  return { id: snapshot.id, ...snapshot.data() } as T
}

export function listenToMaterials(onRows: (rows: MaterialRecord[]) => void, onError: (error: Error) => void) {
  return onSnapshot(materials, (snapshot) => onRows(snapshot.docs.map((item) => withId<MaterialRecord>(item))), onError)
}

export function listenToEquipment(onRows: (rows: EquipmentRecord[]) => void, onError: (error: Error) => void) {
  return onSnapshot(equipment, (snapshot) => onRows(snapshot.docs.map((item) => withId<EquipmentRecord>(item))), onError)
}

export function listenToPurchaseOrders(onRows: (rows: PurchaseOrder[]) => void, onError: (error: Error) => void) {
  return onSnapshot(purchaseOrders, (snapshot) => onRows(snapshot.docs.map((item) => withId<PurchaseOrder>(item))), onError)
}

export function listenToProductionOrders(onRows: (rows: ProductionOrder[]) => void, onError: (error: Error) => void) {
  return onSnapshot(productionOrders, (snapshot) => onRows(snapshot.docs.map((item) => withId<ProductionOrder>(item))), onError)
}

export function listenToProductionOrder(id: string, onValue: (order: ProductionOrder | null) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(manufacturerDb, "productionOrders", id), (snapshot) => onValue(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } as ProductionOrder : null), onError)
}

export async function confirmRequestPayment(id: string) {
  const confirm = httpsCallable<{ rfqId: string }, { ok: true }>(manufacturerFunctions, "confirmManualPayment")
  await confirm({ rfqId: id })
}

export async function saveMaterial(value: Omit<MaterialRecord, "id" | "stock" | "reserved">, id?: string) {
  validateMaterial(value)
  const payload = { ...value, updatedAt: Date.now() }
  if (id) await updateDoc(doc(materials, id), payload)
  else await addDoc(materials, { ...payload, stock: 0, reserved: 0 })
}

export async function saveEquipment(value: Omit<EquipmentRecord, "id" | "scheduledHours" | "activeProductionOrderId">, id?: string) {
  validateEquipment(value)
  const payload = { ...value, updatedAt: Date.now() }
  if (id) await updateDoc(doc(equipment, id), payload)
  else await addDoc(equipment, { ...payload, scheduledHours: 0 })
}

export async function adjustMaterialStock(id: string, deltaKg: number, reason: string) {
  const amount = Math.round(deltaKg * 1000) / 1000
  if (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 100_000 || !reason.trim()) {
    throw new Error("Enter a stock adjustment up to 100,000 kg and a reason.")
  }
  const materialRef = doc(materials, id)
  const movementRef = doc(inventoryMovements)
  await runTransaction(manufacturerDb, async (transaction) => {
    const snapshot = await transaction.get(materialRef)
    if (!snapshot.exists()) throw new Error("Material not found.")
    const material = snapshot.data() as MaterialRecord
    const nextStock = Math.round((material.stock + amount) * 1000) / 1000
    if (nextStock < material.reserved || nextStock > 100_000) throw new Error("Stock cannot be lower than reserved stock or exceed 100,000 kg.")
    transaction.update(materialRef, { stock: nextStock, updatedAt: Date.now() })
    transaction.set(movementRef, { type: "adjustment", materialId: id, deltaKg: amount, reservedDeltaKg: 0, reason: reason.trim(), createdAt: Date.now() })
  })
}

export async function createPurchaseOrder(value: { supplier: string; materialId: string; quantity: number; unitCost?: number; eta: string }) {
  if (!value.supplier.trim() || !value.materialId || !Number.isFinite(value.quantity) || value.quantity <= 0 || value.quantity > 100_000
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.eta) || (value.unitCost !== undefined && (!Number.isSafeInteger(value.unitCost) || value.unitCost < 0 || value.unitCost > 10_000_000))) {
    throw new Error("Enter a supplier, material, positive quantity, and expected delivery date.")
  }
  await addDoc(purchaseOrders, { ...value, supplier: value.supplier.trim(), status: "Ordered", createdAt: Date.now() })
}

export async function receivePurchaseOrder(id: string) {
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
    transaction.set(movementRef, { type: "purchaseReceipt", materialId: order.materialId, deltaKg: order.quantity, reservedDeltaKg: 0, referenceId: id, createdAt: now })
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

export async function updateProductionOrder(id: string, value: Pick<ProductionOrder, "materialId" | "equipmentId" | "plannedGrams" | "plannedHours">) {
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

export async function scheduleProduction(id: string, request: ProductionRequest) {
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
    const equipmentRef = doc(equipment, plan.equipmentId)
    const [materialSnapshot, equipmentSnapshot] = await Promise.all([transaction.get(materialRef), transaction.get(equipmentRef)])
    if (!materialSnapshot.exists() || !equipmentSnapshot.exists()) throw new Error("Select an existing material and machine.")
    const material = { id: materialSnapshot.id, ...materialSnapshot.data() } as MaterialRecord
    const machine = { id: equipmentSnapshot.id, ...equipmentSnapshot.data() } as EquipmentRecord
    const readiness = getProductionReadiness({ ...rfq, id }, plan, [material], [machine])
    if (!readiness.ready) throw new Error(readiness.blockers.join(" "))
    const requiredKg = Math.round((plan.plannedGrams / 1000) * 1000) / 1000
    const now = Date.now()
    transaction.update(materialRef, { reserved: Math.round((material.reserved + requiredKg) * 1000) / 1000, updatedAt: now })
    transaction.update(equipmentRef, {
      status: "Scheduled",
      scheduledHours: Math.round((machine.scheduledHours + plan.plannedHours) * 100) / 100,
      activeProductionOrderId: id,
      updatedAt: now,
    })
    transaction.update(planRef, { status: "Scheduled", reservedKg: requiredKg, updatedAt: now })
    transaction.set(movementRef, { type: "reservation", materialId: material.id, deltaKg: 0, reservedDeltaKg: requiredKg, referenceId: id, createdAt: now })
  })
}

export async function unscheduleProduction(id: string) {
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
    transaction.update(materialRef, { reserved: Math.max(0, Math.round((material.reserved - plan.reservedKg) * 1000) / 1000), updatedAt: now })
    transaction.update(machineRef, {
      status: "Available",
      scheduledHours: Math.max(0, Math.round((machine.scheduledHours - plan.plannedHours) * 100) / 100),
      activeProductionOrderId: deleteField(),
      updatedAt: now,
    })
    transaction.update(planRef, { status: "Preparing Production", reservedKg: 0, updatedAt: now })
    transaction.set(doc(inventoryMovements), { type: "release", materialId: plan.materialId, deltaKg: 0, reservedDeltaKg: -plan.reservedKg, referenceId: id, createdAt: now })
  })
}

export async function startProduction(id: string) {
  await runTransaction(manufacturerDb, async (transaction) => {
    const planRef = doc(productionOrders, id)
    const requestRef = doc(manufacturerDb, "rfqs", id)
    const [planSnapshot, requestSnapshot] = await Promise.all([transaction.get(planRef), transaction.get(requestRef)])
    if (!planSnapshot.exists() || !requestSnapshot.exists() || planSnapshot.data().status !== "Scheduled" || requestSnapshot.data().status !== "Preparing Production") {
      throw new Error("Schedule this order before starting production.")
    }
    const now = Date.now()
    transaction.update(planRef, { status: "In Production", updatedAt: now })
    transaction.update(requestRef, { status: "In Production", productionStartedAt: now })
  })
}

export async function completeProduction(id: string, actualGrams: number) {
  if (!Number.isFinite(actualGrams) || actualGrams <= 0 || actualGrams > 100_000_000) throw new Error("Enter actual filament usage in grams.")
  const actualKg = Math.round((actualGrams / 1000) * 1000) / 1000
  await runTransaction(manufacturerDb, async (transaction) => {
    const planRef = doc(productionOrders, id)
    const requestRef = doc(manufacturerDb, "rfqs", id)
    const [planSnapshot, requestSnapshot] = await Promise.all([transaction.get(planRef), transaction.get(requestRef)])
    if (!planSnapshot.exists() || !requestSnapshot.exists()) throw new Error("Production order not found.")
    const plan = { id, ...planSnapshot.data() } as ProductionOrder
    if (plan.status !== "In Production" || requestSnapshot.data().status !== "In Production") throw new Error("Only active production can be completed.")
    const materialRef = doc(materials, plan.materialId)
    const machineRef = doc(equipment, plan.equipmentId)
    const [materialSnapshot, machineSnapshot] = await Promise.all([transaction.get(materialRef), transaction.get(machineRef)])
    if (!materialSnapshot.exists() || !machineSnapshot.exists()) throw new Error("The assigned material or machine is missing.")
    const material = materialSnapshot.data() as MaterialRecord
    const remainingReservations = Math.max(0, material.reserved - plan.reservedKg)
    const nextStock = Math.round((material.stock - actualKg) * 1000) / 1000
    if (nextStock < remainingReservations) throw new Error("Actual usage exceeds unreserved stock. Adjust inventory before completing this job.")
    const now = Date.now()
    transaction.update(materialRef, { stock: nextStock, reserved: remainingReservations, updatedAt: now })
    transaction.update(machineRef, {
      status: "Available",
      activeProductionOrderId: deleteField(),
      scheduledHours: Math.max(0, Math.round((machineSnapshot.data().scheduledHours - plan.plannedHours) * 100) / 100),
      updatedAt: now,
    })
    transaction.update(planRef, { status: "Completed", reservedKg: 0, actualGrams, updatedAt: now })
    transaction.update(requestRef, { status: "Completed", completedAt: now })
    transaction.set(doc(inventoryMovements), { type: "consumption", materialId: plan.materialId, deltaKg: -actualKg, reservedDeltaKg: -plan.reservedKg, referenceId: id, createdAt: now })
  })
}
