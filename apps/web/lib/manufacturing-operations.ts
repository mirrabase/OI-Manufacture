export type EquipmentStatus = "Available" | "Scheduled" | "Maintenance" | "Offline"

export type MaterialRecord = {
  id: string
  organizationId: string
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
  organizationId: string
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
  organizationId: string
  rfqId: string
  status: "Preparing Production" | "Scheduled" | "In Production" | "Completed"
  materialId: string
  equipmentId: string
  plannedGrams: number
  plannedHours: number
  reservedKg: number
  actualGrams?: number
  scheduledStartDate?: string
  estimatedCompletionDate?: string
  createdAt: number
  updatedAt: number
}

export type PurchaseOrder = {
  id: string
  organizationId: string
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

export function getCompatibleEquipment(request: ProductionRequest, material: MaterialRecord | undefined, equipment: EquipmentRecord[]) {
  if (!material) return []
  const requestedMaterial = request.requirements.material.toLowerCase()
  if (requestedMaterial !== "not sure" && material.name.toLowerCase() !== requestedMaterial && !material.name.toLowerCase().startsWith(`${requestedMaterial} `)) return []
  const process = request.requirements.process
  const part = [...request.model.boundingBoxMm].sort((a, b) => b - a)
  return equipment.filter((machine) => {
    const volume = [...machine.buildVolumeMm].sort((a, b) => b - a)
    const supportsProcess = process === "Not sure" || machine.technology === process || (process === "SLA" && machine.technology === "MSLA")
    return machine.status !== "Maintenance" && machine.status !== "Offline"
      && machine.compatibleMaterialIds.includes(material.id)
      && supportsProcess
      && part.every((dimension, index) => dimension <= volume[index]!)
  })
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
  const assignedEquipmentId = plan.status === "Preparing Production" ? "" : plan.equipmentId
  const candidates = getCompatibleEquipment(request, material, equipment.filter((item) => !assignedEquipmentId || item.id === assignedEquipmentId))
  const machine = candidates[0]
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
  if (!machine) blockers.push(assignedEquipmentId ? "The assigned equipment is unavailable or incompatible." : "No compatible equipment is available for this request.")

  return { blockers, warnings, ready: blockers.length === 0 }
}

export function validateMaterial(value: Omit<MaterialRecord, "id" | "organizationId" | "stock" | "reserved">) {
  if (!value.name.trim() || !value.category.trim() || !value.manufacturer.trim()
    || !value.properties.trim() || !Number.isSafeInteger(value.unitCost) || value.unitCost < 0
    || !Number.isFinite(value.reorderAt) || value.reorderAt < 0 || value.reorderAt > 100_000) {
    throw new Error("Enter material details and valid non-negative IDR/kg and reorder values.")
  }
}

export function validateEquipment(value: Omit<EquipmentRecord, "id" | "organizationId" | "scheduledHours" | "activeProductionOrderId">) {
  if (!value.name.trim() || !value.manufacturer.trim() || !value.model.trim() || !value.technology.trim()
    || value.buildVolumeMm.length !== 3 || !value.buildVolumeMm.every((dimension) => Number.isFinite(dimension) && dimension > 0 && dimension <= 2000)
    || !Number.isSafeInteger(value.hourlyCost) || value.hourlyCost < 0 || value.hourlyCost > 10_000_000
    || !Number.isFinite(value.workingHours) || value.workingHours <= 0 || value.workingHours > 24
    || !["Available", "Scheduled", "Maintenance", "Offline"].includes(value.status)) {
    throw new Error("Enter valid equipment details, build dimensions, hourly cost, working hours, and status.")
  }
}
