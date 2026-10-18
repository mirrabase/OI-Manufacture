export type Customer = {
  id: string
  name: string
  company: string
  email: string
}

export type Equipment = {
  id: string
  name: string
  manufacturer: string
  model: string
  technology: string
  buildVolume: string
  materials: string[]
  hourlyCost: number
  workingHours: number
  scheduledHours: number
  status: "Available" | "Scheduled" | "Maintenance" | "Offline"
}

export type Material = {
  id: string
  name: string
  category: string
  manufacturer: string
  unitCost: number
  stock: number
  reserved: number
  reorderAt: number
  properties: string
  compatibleEquipment: string[]
}

export type RFQ = {
  id: string
  customerId: string
  product: string
  file: string
  quantity: number
  materialId: string
  received: string
  feasibility: "Received" | "Analyzing" | "Needs Review" | "Feasible" | "Rejected"
  risk: "Low" | "Medium" | "High"
  boundingBox: string
  volume: string
  complexity: string
  notes: string
}

export type Quotation = {
  id: string
  rfqId: string
  customerId: string
  product: string
  quantity: number
  materialCost: number
  machineCost: number
  laborCost: number
  postProcessingCost: number
  overhead: number
  marginPercent: number
  validUntil: string
  status: "Draft" | "Pending Review" | "Sent" | "Accepted" | "Rejected" | "Expired"
}

export type Order = {
  id: string
  quotationId: string
  customerId: string
  product: string
  quantity: number
  materialId: string
  equipmentId: string
  orderDate: string
  dueDate: string
  status: "Confirmed" | "Queued" | "In Production" | "Quality Check" | "Completed" | "Delivered" | "Cancelled"
  priority: "Low" | "Normal" | "High" | "Urgent"
  progress: number
}

export type ProductionJob = {
  id: string
  orderId: string
  equipmentId: string
  materialId: string
  start: string
  end: string
  duration: number
  status: "Queued" | "Running" | "Quality Check" | "Completed" | "Delayed"
}

export type ManufacturingInsight = {
  title: string
  detail: string
  kind: "Capacity" | "Materials" | "Quotations" | "Deadlines"
}

export const demoDate = "2026-10-14"

export const customers: Customer[] = [
  { id: "CUS-001", name: "Nadia Putri", company: "AeroMotion Indonesia", email: "nadia@aeromotion.id" },
  { id: "CUS-002", name: "Rizky Mahendra", company: "Karya Medika Labs", email: "rizky@karyamedika.co.id" },
  { id: "CUS-003", name: "Sarah Wijaya", company: "Urban Mobility Studio", email: "sarah@urbanmobility.id" },
  { id: "CUS-004", name: "Fajar Pratama", company: "Nusa Robotics", email: "fajar@nusarobotics.com" },
  { id: "CUS-005", name: "Dewi Anggraini", company: "Sagara Marine Systems", email: "dewi@sagara-marine.id" },
  { id: "CUS-006", name: "Bima Santoso", company: "Forma Interior Works", email: "bima@forma.id" },
]

export const equipment: Equipment[] = [
  { id: "EQ-001", name: "Printer A", manufacturer: "Bambu Lab", model: "X1 Carbon", technology: "FDM", buildVolume: "256 × 256 × 256 mm", materials: ["PLA", "PETG", "ABS", "ASA", "TPU"], hourlyCost: 42000, workingHours: 10, scheduledHours: 7, status: "Scheduled" },
  { id: "EQ-002", name: "Printer B", manufacturer: "Prusa", model: "MK4", technology: "FDM", buildVolume: "250 × 210 × 220 mm", materials: ["PLA", "PETG", "ASA", "TPU"], hourlyCost: 35000, workingHours: 10, scheduledHours: 5, status: "Scheduled" },
  { id: "EQ-003", name: "Printer C", manufacturer: "Creality", model: "K1 Max", technology: "FDM", buildVolume: "300 × 300 × 300 mm", materials: ["PLA", "PETG", "ABS", "ASA"], hourlyCost: 38000, workingHours: 10, scheduledHours: 3, status: "Available" },
  { id: "EQ-004", name: "Printer D", manufacturer: "OI Manufacturing", model: "Industrial FDM 400", technology: "FDM", buildVolume: "400 × 400 × 450 mm", materials: ["PLA", "PETG", "ABS", "ASA"], hourlyCost: 68000, workingHours: 8, scheduledHours: 8, status: "Maintenance" },
  { id: "EQ-005", name: "Resin A", manufacturer: "Formlabs", model: "Form 4", technology: "MSLA", buildVolume: "200 × 125 × 210 mm", materials: ["Standard Resin", "Tough Resin"], hourlyCost: 55000, workingHours: 9, scheduledHours: 4, status: "Scheduled" },
]

export const materials: Material[] = [
  { id: "MAT-001", name: "PLA", category: "Standard filament", manufacturer: "Polymaker", unitCost: 285000, stock: 18.4, reserved: 5.2, reorderAt: 8, properties: "Density 1.24 g/cm³ · heat resistance 55°C · low flexibility", compatibleEquipment: ["EQ-001", "EQ-002", "EQ-003", "EQ-004"] },
  { id: "MAT-002", name: "PETG", category: "Engineering filament", manufacturer: "eSUN", unitCost: 320000, stock: 6.5, reserved: 1.8, reorderAt: 8, properties: "Density 1.27 g/cm³ · heat resistance 75°C · good toughness", compatibleEquipment: ["EQ-001", "EQ-002", "EQ-003", "EQ-004"] },
  { id: "MAT-003", name: "ABS", category: "Engineering filament", manufacturer: "Polylite", unitCost: 340000, stock: 12.2, reserved: 4, reorderAt: 6, properties: "Density 1.04 g/cm³ · heat resistance 95°C · moderate toughness", compatibleEquipment: ["EQ-001", "EQ-003", "EQ-004"] },
  { id: "MAT-004", name: "ASA", category: "Outdoor filament", manufacturer: "Fiberlogy", unitCost: 410000, stock: 4.1, reserved: 0.8, reorderAt: 5, properties: "Density 1.07 g/cm³ · heat resistance 95°C · UV resistant", compatibleEquipment: ["EQ-001", "EQ-002", "EQ-003", "EQ-004"] },
  { id: "MAT-005", name: "TPU 95A", category: "Flexible filament", manufacturer: "eSUN", unitCost: 465000, stock: 9.7, reserved: 2.1, reorderAt: 4, properties: "Density 1.21 g/cm³ · flexible elastomer · abrasion resistant", compatibleEquipment: ["EQ-001", "EQ-002"] },
  { id: "MAT-006", name: "Tough Resin", category: "Photopolymer resin", manufacturer: "Formlabs", unitCost: 1250000, stock: 3.4, reserved: 0.6, reorderAt: 2, properties: "Tough formulation · high detail · post-cure required", compatibleEquipment: ["EQ-005"] },
]

export const rfqs: RFQ[] = [
  { id: "RFQ-2026-014", customerId: "CUS-001", product: "Drone motor mount v2", file: "motor_mount_v2.step · 4.8 MB", quantity: 24, materialId: "MAT-003", received: "2026-10-14", feasibility: "Needs Review", risk: "Medium", boundingBox: "118 × 82 × 36 mm", volume: "42.6 cm³", complexity: "Medium", notes: "Thin wall near the mounting slot may need orientation review." },
  { id: "RFQ-2026-013", customerId: "CUS-002", product: "Diagnostic cartridge housing", file: "cartridge_housing.stl · 2.1 MB", quantity: 120, materialId: "MAT-001", received: "2026-10-13", feasibility: "Analyzing", risk: "Low", boundingBox: "64 × 42 × 18 mm", volume: "18.3 cm³", complexity: "Low", notes: "Snap-fit features need dimensional validation before quotation." },
  { id: "RFQ-2026-012", customerId: "CUS-003", product: "Scooter display enclosure", file: "display_enclosure.step · 8.2 MB", quantity: 36, materialId: "MAT-002", received: "2026-10-12", feasibility: "Feasible", risk: "Low", boundingBox: "146 × 92 × 44 mm", volume: "76.1 cm³", complexity: "Medium", notes: "PETG is compatible with the stated outdoor splash exposure." },
  { id: "RFQ-2026-011", customerId: "CUS-004", product: "Robot gripper finger set", file: "gripper_finger.stl · 1.6 MB", quantity: 80, materialId: "MAT-005", received: "2026-10-10", feasibility: "Feasible", risk: "Medium", boundingBox: "92 × 28 × 16 mm", volume: "12.4 cm³", complexity: "Medium", notes: "Flexible material should suit the contact surface; confirm hardness." },
  { id: "RFQ-2026-010", customerId: "CUS-005", product: "Cable routing clip", file: "routing_clip.step · 940 KB", quantity: 250, materialId: "MAT-004", received: "2026-10-09", feasibility: "Received", risk: "Low", boundingBox: "38 × 24 × 16 mm", volume: "4.8 cm³", complexity: "Low", notes: "ASA requested for UV exposure on deck installations." },
  { id: "RFQ-2026-009", customerId: "CUS-006", product: "Pendant light diffuser", file: "diffuser.stl · 12 MB", quantity: 12, materialId: "MAT-006", received: "2026-10-08", feasibility: "Needs Review", risk: "High", boundingBox: "192 × 192 × 128 mm", volume: "224 cm³", complexity: "High", notes: "Large resin part may exceed preferred build orientation and require segmentation." },
  { id: "RFQ-2026-008", customerId: "CUS-001", product: "Sensor bracket", file: "sensor_bracket.step · 3.3 MB", quantity: 50, materialId: "MAT-002", received: "2026-10-07", feasibility: "Feasible", risk: "Low", boundingBox: "74 × 52 × 28 mm", volume: "26.2 cm³", complexity: "Low", notes: "No critical overhangs in the sample estimate." },
  { id: "RFQ-2026-007", customerId: "CUS-002", product: "Lab vial rack", file: "vial_rack.step · 5.1 MB", quantity: 20, materialId: "MAT-001", received: "2026-10-06", feasibility: "Feasible", risk: "Low", boundingBox: "188 × 126 × 34 mm", volume: "92 cm³", complexity: "Low", notes: "Rack layout is suitable for a flat build orientation." },
  { id: "RFQ-2026-006", customerId: "CUS-005", product: "Deck sensor cover", file: "sensor_cover.stl · 2.7 MB", quantity: 16, materialId: "MAT-004", received: "2026-10-05", feasibility: "Feasible", risk: "Medium", boundingBox: "132 × 88 × 46 mm", volume: "64 cm³", complexity: "Medium", notes: "ASA is requested for UV exposure; verify seal fit after printing." },
  { id: "RFQ-2026-005", customerId: "CUS-002", product: "Lab vial rack", file: "rack_batch.step · 4.4 MB", quantity: 32, materialId: "MAT-001", received: "2026-10-04", feasibility: "Feasible", risk: "Low", boundingBox: "188 × 126 × 34 mm", volume: "92 cm³", complexity: "Low", notes: "Repeat geometry from approved rack sample." },
  { id: "RFQ-2026-004", customerId: "CUS-005", product: "Pump housing prototype", file: "pump_housing.step · 6.8 MB", quantity: 8, materialId: "MAT-003", received: "2026-10-03", feasibility: "Needs Review", risk: "Medium", boundingBox: "166 × 124 × 102 mm", volume: "286 cm³", complexity: "High", notes: "Check wall thickness and fluid contact requirements before production." },
  { id: "RFQ-2026-003", customerId: "CUS-006", product: "Desk cable organizer", file: "cable_organizer.stl · 1.2 MB", quantity: 40, materialId: "MAT-001", received: "2026-10-02", feasibility: "Feasible", risk: "Low", boundingBox: "210 × 48 × 26 mm", volume: "58 cm³", complexity: "Low", notes: "Simple geometry with low support demand." },
  { id: "RFQ-2026-002", customerId: "CUS-003", product: "Handlebar spacer set", file: "spacer_set.step · 860 KB", quantity: 60, materialId: "MAT-002", received: "2026-10-01", feasibility: "Feasible", risk: "Low", boundingBox: "42 × 42 × 24 mm", volume: "16 cm³", complexity: "Low", notes: "Confirm fit tolerance against the mating handlebar assembly." },
]

export const quotations: Quotation[] = [
  { id: "QT-2026-031", rfqId: "RFQ-2026-012", customerId: "CUS-003", product: "Scooter display enclosure", quantity: 36, materialCost: 518400, machineCost: 410400, laborCost: 360000, postProcessingCost: 180000, overhead: 220000, marginPercent: 32, validUntil: "2026-10-26", status: "Sent" },
  { id: "QT-2026-030", rfqId: "RFQ-2026-011", customerId: "CUS-004", product: "Robot gripper finger set", quantity: 80, materialCost: 228480, machineCost: 224000, laborCost: 320000, postProcessingCost: 160000, overhead: 180000, marginPercent: 28, validUntil: "2026-10-24", status: "Accepted" },
  { id: "QT-2026-029", rfqId: "RFQ-2026-008", customerId: "CUS-001", product: "Sensor bracket", quantity: 50, materialCost: 419200, machineCost: 315000, laborCost: 250000, postProcessingCost: 125000, overhead: 160000, marginPercent: 30, validUntil: "2026-10-22", status: "Accepted" },
  { id: "QT-2026-028", rfqId: "RFQ-2026-009", customerId: "CUS-006", product: "Pendant light diffuser", quantity: 12, materialCost: 840000, machineCost: 1320000, laborCost: 540000, postProcessingCost: 360000, overhead: 420000, marginPercent: 35, validUntil: "2026-10-21", status: "Pending Review" },
  { id: "QT-2026-027", rfqId: "RFQ-2026-007", customerId: "CUS-002", product: "Lab vial rack", quantity: 20, materialCost: 312000, machineCost: 294000, laborCost: 180000, postProcessingCost: 90000, overhead: 120000, marginPercent: 30, validUntil: "2026-10-19", status: "Draft" },
  { id: "QT-2026-026", rfqId: "RFQ-2026-006", customerId: "CUS-005", product: "Deck sensor cover", quantity: 16, materialCost: 510000, machineCost: 448000, laborCost: 240000, postProcessingCost: 128000, overhead: 160000, marginPercent: 32, validUntil: "2026-10-16", status: "Expired" },
  { id: "QT-2026-025", rfqId: "RFQ-2026-005", customerId: "CUS-002", product: "Lab vial rack", quantity: 32, materialCost: 499200, machineCost: 392000, laborCost: 240000, postProcessingCost: 120000, overhead: 140000, marginPercent: 30, validUntil: "2026-10-18", status: "Accepted" },
  { id: "QT-2026-024", rfqId: "RFQ-2026-004", customerId: "CUS-005", product: "Pump housing prototype", quantity: 8, materialCost: 652800, machineCost: 640000, laborCost: 360000, postProcessingCost: 220000, overhead: 240000, marginPercent: 32, validUntil: "2026-10-17", status: "Accepted" },
  { id: "QT-2026-023", rfqId: "RFQ-2026-003", customerId: "CUS-006", product: "Desk cable organizer", quantity: 40, materialCost: 696000, machineCost: 378000, laborCost: 250000, postProcessingCost: 120000, overhead: 150000, marginPercent: 28, validUntil: "2026-10-15", status: "Accepted" },
  { id: "QT-2026-022", rfqId: "RFQ-2026-002", customerId: "CUS-003", product: "Handlebar spacer set", quantity: 60, materialCost: 307200, machineCost: 252000, laborCost: 210000, postProcessingCost: 96000, overhead: 120000, marginPercent: 30, validUntil: "2026-10-14", status: "Accepted" },
]

export const orders: Order[] = [
  { id: "ORD-2026-018", quotationId: "QT-2026-030", customerId: "CUS-004", product: "Robot gripper finger set", quantity: 80, materialId: "MAT-005", equipmentId: "EQ-002", orderDate: "2026-10-12", dueDate: "2026-10-18", status: "In Production", priority: "High", progress: 64 },
  { id: "ORD-2026-017", quotationId: "QT-2026-029", customerId: "CUS-001", product: "Sensor bracket", quantity: 50, materialId: "MAT-002", equipmentId: "EQ-003", orderDate: "2026-10-10", dueDate: "2026-10-16", status: "Quality Check", priority: "Urgent", progress: 92 },
  { id: "ORD-2026-016", quotationId: "QT-2026-025", customerId: "CUS-002", product: "Lab vial rack", quantity: 32, materialId: "MAT-001", equipmentId: "EQ-001", orderDate: "2026-10-09", dueDate: "2026-10-20", status: "Queued", priority: "Normal", progress: 8 },
  { id: "ORD-2026-015", quotationId: "QT-2026-024", customerId: "CUS-005", product: "Pump housing prototype", quantity: 8, materialId: "MAT-003", equipmentId: "EQ-004", orderDate: "2026-10-08", dueDate: "2026-10-15", status: "In Production", priority: "High", progress: 48 },
  { id: "ORD-2026-014", quotationId: "QT-2026-023", customerId: "CUS-006", product: "Desk cable organizer", quantity: 40, materialId: "MAT-001", equipmentId: "EQ-003", orderDate: "2026-10-04", dueDate: "2026-10-12", status: "Completed", priority: "Normal", progress: 100 },
  { id: "ORD-2026-013", quotationId: "QT-2026-022", customerId: "CUS-003", product: "Handlebar spacer set", quantity: 60, materialId: "MAT-002", equipmentId: "EQ-001", orderDate: "2026-10-02", dueDate: "2026-10-11", status: "Delivered", priority: "Low", progress: 100 },
]

export const productionJobs: ProductionJob[] = [
  { id: "JOB-2026-042", orderId: "ORD-2026-018", equipmentId: "EQ-002", materialId: "MAT-005", start: "2026-10-14 08:00", end: "2026-10-14 13:00", duration: 5, status: "Running" },
  { id: "JOB-2026-041", orderId: "ORD-2026-017", equipmentId: "EQ-003", materialId: "MAT-002", start: "2026-10-14 08:00", end: "2026-10-14 11:00", duration: 3, status: "Quality Check" },
  { id: "JOB-2026-040", orderId: "ORD-2026-016", equipmentId: "EQ-001", materialId: "MAT-001", start: "2026-10-14 13:00", end: "2026-10-14 17:00", duration: 4, status: "Queued" },
  { id: "JOB-2026-039", orderId: "ORD-2026-015", equipmentId: "EQ-004", materialId: "MAT-003", start: "2026-10-14 07:00", end: "2026-10-14 15:00", duration: 8, status: "Delayed" },
  { id: "JOB-2026-038", orderId: "ORD-2026-014", equipmentId: "EQ-003", materialId: "MAT-001", start: "2026-10-13 09:00", end: "2026-10-13 12:00", duration: 3, status: "Completed" },
  { id: "JOB-2026-037", orderId: "ORD-2026-013", equipmentId: "EQ-001", materialId: "MAT-002", start: "2026-10-12 08:00", end: "2026-10-12 12:00", duration: 4, status: "Completed" },
]

export const insights: ManufacturingInsight[] = [
  { kind: "Capacity", title: "Printer B has room today", detail: "5 scheduled available production hours · supports PETG and TPU." },
  { kind: "Materials", title: "PETG is below reorder threshold", detail: "6.5 kg available against an 8 kg reorder point." },
  { kind: "Quotations", title: "2 quotations need a decision", detail: "One draft and one customer approval are waiting." },
  { kind: "Deadlines", title: "2 orders are due within 48 hours", detail: "ORD-2026-017 and ORD-2026-015 need close monitoring." },
]

export const quotationCost = (quote: Quotation) =>
  quote.materialCost + quote.machineCost + quote.laborCost + quote.postProcessingCost + quote.overhead

export const quotationPrice = (quote: Quotation) =>
  Math.round(quotationCost(quote) * (1 + quote.marginPercent / 100))

export const formatIDR = (amount: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount)

export const findCustomer = (id: string) => customers.find((customer) => customer.id === id)
export const findMaterial = (id: string) => materials.find((material) => material.id === id)
export const findEquipment = (id: string) => equipment.find((machine) => machine.id === id)
