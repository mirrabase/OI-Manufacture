export type EquipmentStatus = "Available" | "Scheduled" | "Maintenance" | "Offline"

export type MaterialRecord = {
  id: string
  name: string
  category: string
  manufacturer: string
  unitCost: number
  stock: number
  reserved: number
  reorderAt: number
  properties: string
}

export type EquipmentRecord = {
  id: string
  name: string
  manufacturer: string
  model: string
  technology: string
  buildVolumeMm: [number, number, number]
  compatibleMaterialIds: string[]
  hourlyCost: number
  workingHours: number
  scheduledHours: number
  status: EquipmentStatus
  activeProductionOrderId?: string
}

export type ProductionOrder = {
  id: string
  rfqId: string
  status: "Preparing Production" | "Scheduled" | "In Production" | "Completed"
  materialId: string
  equipmentId: string
  plannedGrams: number
  plannedHours: number
  reservedKg: number
  actualGrams?: number
  createdAt: number
  updatedAt: number
}

export type PurchaseOrder = {
  id: string
  supplier: string
  materialId: string
  quantity: number
  unitCost?: number
  eta: string
  status: "Ordered" | "Received" | "Cancelled"
  createdAt: number
  receivedAt?: number
}

export type ProductionRequest = {
  id: string
  status: string
  paymentStatus?: string
  requirements: { process: string; quantity: number; material: string }
  model: { boundingBoxMm: [number, number, number] }
}

export function getProductionReadiness(
  request: ProductionRequest,
  plan: ProductionOrder,
  materials: MaterialRecord[],
  equipment: EquipmentRecord[],
) {
  const blockers: string[] = []
  const warnings: string[] = []
  const material = materials.find((item) => item.id === plan.materialId)
  const machine = equipment.find((item) => item.id === plan.equipmentId)
  const requiredKg = plan.plannedGrams / 1000

  if (request.paymentStatus !== "Paid") blockers.push("Payment has not been confirmed.")
  if (!material) blockers.push("Select a production material.")
  else {
    const requestedMaterial = request.requirements.material.toLowerCase()
    const inventoryMaterial = material.name.toLowerCase()
    if (requestedMaterial !== "not sure" && inventoryMaterial !== requestedMaterial && !inventoryMaterial.startsWith(`${requestedMaterial} `)) {
      blockers.push(`${material.name} does not match the requested ${request.requirements.material}.`)
    }
    if (!Number.isFinite(requiredKg) || requiredKg <= 0) blockers.push("Enter the planned filament usage in grams.")
    else if (material.stock - material.reserved < requiredKg) {
      blockers.push(`Short ${(requiredKg - (material.stock - material.reserved)).toFixed(3)} kg of ${material.name}.`)
    }
    if (material.stock - material.reserved - requiredKg <= material.reorderAt) warnings.push(`${material.name} will be at or below its reorder threshold.`)
  }

  if (!Number.isFinite(plan.plannedHours) || plan.plannedHours <= 0) blockers.push("Enter the planned machine time in hours.")
  if (!machine) blockers.push("Assign compatible equipment.")
  else {
    if (machine.status !== "Available") blockers.push(`${machine.name} is ${machine.status.toLowerCase()}.`)
    if (plan.plannedHours > machine.workingHours - machine.scheduledHours) blockers.push(`${machine.name} does not have enough working hours available.`)
    if (material && !machine.compatibleMaterialIds.includes(material.id)) blockers.push(`${machine.name} is not configured for ${material.name}.`)
    const process = request.requirements.process
    const supportsProcess = process === "Not sure"
      || machine.technology === process
      || (process === "SLA" && machine.technology === "MSLA")
    if (!supportsProcess) blockers.push(`${machine.name} does not support ${process}.`)
    const part = [...request.model.boundingBoxMm].sort((a, b) => b - a)
    const volume = [...machine.buildVolumeMm].sort((a, b) => b - a)
    if (part.some((dimension, index) => dimension > volume[index]!)) blockers.push(`${request.id}'s bounding box exceeds ${machine.name}'s build volume.`)
  }

  return { blockers, warnings, ready: blockers.length === 0 }
}

export function validateMaterial(value: Omit<MaterialRecord, "id" | "stock" | "reserved">) {
  if (!value.name.trim() || !value.category.trim() || !value.manufacturer.trim()
    || !value.properties.trim() || !Number.isSafeInteger(value.unitCost) || value.unitCost < 0
    || !Number.isFinite(value.reorderAt) || value.reorderAt < 0 || value.reorderAt > 100_000) {
    throw new Error("Enter material details and valid non-negative IDR/kg and reorder values.")
  }
}

export function validateEquipment(value: Omit<EquipmentRecord, "id" | "scheduledHours" | "activeProductionOrderId">) {
  if (!value.name.trim() || !value.manufacturer.trim() || !value.model.trim() || !value.technology.trim()
    || value.buildVolumeMm.length !== 3 || !value.buildVolumeMm.every((dimension) => Number.isFinite(dimension) && dimension > 0 && dimension <= 2000)
    || !Number.isSafeInteger(value.hourlyCost) || value.hourlyCost < 0 || value.hourlyCost > 10_000_000
    || !Number.isFinite(value.workingHours) || value.workingHours <= 0 || value.workingHours > 24
    || !["Available", "Scheduled", "Maintenance", "Offline"].includes(value.status)) {
    throw new Error("Enter valid equipment details, build dimensions, hourly cost, working hours, and status.")
  }
}
