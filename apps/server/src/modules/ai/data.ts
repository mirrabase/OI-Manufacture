import type { DocumentData } from "firebase-admin/firestore"

export type Source = { id: string; kind: string; label: string }
type RecordRow = { id: string; data: DocumentData }
type SnapshotInput = {
  organizationId: string
  rfqs?: RecordRow[]
  materials?: RecordRow[]
  equipment?: RecordRow[]
  productionOrders?: RecordRow[]
  purchaseOrders?: RecordRow[]
  pricing?: DocumentData | null
  coverage?: Record<string, boolean>
  now?: number
}
type Signal = {
  id: string
  title: string
  priority: "high" | "medium" | "low"
  facts: DocumentData
  sourceIds: string[]
}
export type ManufacturerSnapshot = ReturnType<typeof buildManufacturerSnapshot>
type ChatResult = { answer: string; answerType: string; sourceIds: string[] }
type OverviewResult = {
  insights: { signalId: string; recommendation: string; prevention: string }[]
}

import { createHash } from "node:crypto"

export function customerIdentity(id: string, value: DocumentData) {
  const email = String(value.customer?.email || "")
    .trim()
    .toLowerCase()
  const key = email ? `email:${email}` : `uid:${value.ownerUid || id}`
  return createHash("sha256").update(key).digest("hex")
}

const OVERVIEW_CACHE_TTL_MS = 30 * 60 * 1000

const ACTIVE_REQUEST_STATUSES = new Set([
  "Submitted",
  "Under Review",
  "Quoted",
  "Preparing Production",
  "In Production",
  "Completed",
  "Closed",
])

function numberOr<T extends number | null = number>(
  value: unknown,
  fallback: T = 0 as T
): number | T {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function cleanRequirementNotes(value: unknown) {
  return String(value || "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email redacted]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[phone redacted]")
    .slice(0, 300)
}

function parseRequestPaymentSearch(search?: string, selectedStatus?: string) {
  const raw = String(search || "").trim()
  const unpaidTerms =
    /\b(?:unpaid|not\s+paid|belum\s+(?:dibayar|bayar|lunas|paid))\b/gi
  const paidTerms =
    /\b(?:paid|dibayar|bayar|lunas|terbayar|payment\s+received)\b/gi
  const withoutUnpaid = raw.replace(unpaidTerms, " ")
  const hasUnpaid = withoutUnpaid !== raw
  const hasPaid =
    /\b(?:paid|dibayar|bayar|lunas|terbayar|payment\s+received)\b/i.test(
      withoutUnpaid
    )
  const paymentStatus =
    selectedStatus ||
    (hasUnpaid !== hasPaid ? (hasUnpaid ? "Unpaid" : "Paid") : undefined)

  if (!paymentStatus && !(hasUnpaid && hasPaid))
    return { search: raw || undefined }

  const cleanedSearch = raw
    .replace(unpaidTerms, " ")
    .replace(paidTerms, " ")
    .replace(/\b(?:rfqs?|requests?|permintaan|and|or|dan|atau|yang)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^-+/, "")
  return { paymentStatus, search: cleanedSearch || undefined }
}

function cleanRequest(id: string, value: DocumentData) {
  const requirements = value.requirements || {}
  const estimate = value.estimate || {}
  return {
    sourceId: `rfq:${id}`,
    kind: "request" as const,
    id,
    customerName: String(value.customer?.name || "Unnamed customer").slice(
      0,
      160
    ),
    customerId: customerIdentity(id, value),
    product: String(value.product || "Unnamed product").slice(0, 160),
    status: String(value.status || "Unknown"),
    paymentStatus: String(value.paymentStatus || "Unpaid"),
    requirements: {
      quantity: numberOr(requirements.quantity),
      material: String(requirements.material || "Not specified").slice(0, 100),
      process: String(requirements.process || "Not specified").slice(0, 100),
      color: String(requirements.color || "").slice(0, 80),
      infillPercent: numberOr(requirements.infillPercent, null),
      notes: cleanRequirementNotes(requirements.notes),
    },
    boundingBoxMm: Array.isArray(value.model?.boundingBoxMm)
      ? (value.model.boundingBoxMm as unknown[])
          .slice(0, 3)
          .map((item: unknown) => numberOr(item))
      : [],
    quoteTotalIdr: numberOr(value.quoteTotal, null),
    estimate: {
      status: String(estimate.status || "Not available"),
      gramsPerUnit: numberOr(estimate.gramsPerUnit, null),
      secondsPerUnit: numberOr(estimate.secondsPerUnit, null),
      totalIdr: numberOr(estimate.total, null),
    },
    createdAt: numberOr(value.createdAt, null),
    submittedAt: numberOr(value.submittedAt, null),
    quotedAt: numberOr(value.quotedAt, null),
    paidAt: numberOr(value.paidAt, null),
    productionStartedAt: numberOr(value.productionStartedAt, null),
    completedAt: numberOr(value.completedAt, null),
  }
}

function cleanMaterial(id: string, value: DocumentData) {
  return {
    sourceId: `material:${id}`,
    kind: "material" as const,
    id,
    name: String(value.name || "Unnamed material").slice(0, 120),
    category: String(value.category || "").slice(0, 80),
    properties: String(value.properties || "").slice(0, 240),
    unitCostIdrPerKg: numberOr(value.unitCost, null),
    stockKg: numberOr(value.stock),
    reservedKg: numberOr(value.reserved),
    availableKg: Math.max(0, numberOr(value.stock) - numberOr(value.reserved)),
    reorderAtKg: numberOr(value.reorderAt),
  }
}

function cleanEquipment(id: string, value: DocumentData) {
  return {
    sourceId: `equipment:${id}`,
    kind: "equipment" as const,
    id,
    name: String(value.name || "Unnamed machine").slice(0, 120),
    hourlyCostIdr: numberOr(value.hourlyCost, null),
    technology: String(value.technology || "Not specified").slice(0, 80),
    status: String(value.status || "Unknown"),
    buildVolumeMm: Array.isArray(value.buildVolumeMm)
      ? (value.buildVolumeMm as unknown[])
          .slice(0, 3)
          .map((item: unknown) => numberOr(item))
      : [],
    compatibleMaterialIds: Array.isArray(value.compatibleMaterialIds)
      ? (value.compatibleMaterialIds as unknown[]).slice(0, 100)
      : [],
    workingHoursPerDay: numberOr(value.workingHours),
    scheduledHours: numberOr(value.scheduledHours),
    availableHours: Math.max(
      0,
      numberOr(value.workingHours) - numberOr(value.scheduledHours)
    ),
  }
}

function cleanPlan(id: string, value: DocumentData) {
  return {
    sourceId: `production:${id}`,
    kind: "production" as const,
    id,
    rfqId: String(value.rfqId || id),
    createdAt: numberOr(value.createdAt, null),
    scheduledStartDate: String(value.scheduledStartDate || ""),
    estimatedCompletionDate: String(value.estimatedCompletionDate || ""),
    updatedAt: numberOr(value.updatedAt, null),
    startedAt: numberOr(value.startedAt, null),
    completedAt: numberOr(value.completedAt, null),
    status: String(value.status || "Unknown"),
    materialId: String(value.materialId || ""),
    equipmentId: String(value.equipmentId || ""),
    plannedGrams: numberOr(value.plannedGrams),
    plannedHours: numberOr(value.plannedHours),
    reservedKg: numberOr(value.reservedKg),
    actualGrams: numberOr(value.actualGrams, null),
  }
}

function cleanPurchaseOrder(id: string, value: DocumentData) {
  return {
    sourceId: `purchaseOrder:${id}`,
    kind: "purchase order" as const,
    id,
    materialId: String(value.materialId || ""),
    supplier: String(value.supplier || "").slice(0, 160),
    unitCostIdr: numberOr(value.unitCost, null),
    createdAt: numberOr(value.createdAt, null),
    quantityKg: numberOr(value.quantity),
    eta: String(value.eta || "Not available"),
    status: String(value.status || "Unknown"),
  }
}

function productionBlockers(
  request: ReturnType<typeof cleanRequest>,
  plan: ReturnType<typeof cleanPlan>,
  materials: ReturnType<typeof cleanMaterial>[],
  equipment: ReturnType<typeof cleanEquipment>[]
) {
  const blockers = []
  const material = materials.find((item) => item.id === plan.materialId)
  const machine = equipment.find((item) => item.id === plan.equipmentId)
  const requiredKg = plan.plannedGrams / 1000

  if (request.paymentStatus !== "Paid")
    blockers.push("Payment is not confirmed.")
  if (!material)
    blockers.push("Production material is not assigned or no longer exists.")
  else {
    const requested = request.requirements.material.toLowerCase()
    const assigned = material.name.toLowerCase()
    if (
      requested !== "not sure" &&
      assigned !== requested &&
      !assigned.startsWith(`${requested} `)
    ) {
      blockers.push(
        `Assigned material does not match requested ${request.requirements.material}.`
      )
    }
    if (requiredKg <= 0) blockers.push("Planned material usage is missing.")
    else if (material.availableKg < requiredKg)
      blockers.push("Available material stock is below the planned usage.")
    if (machine && !machine.compatibleMaterialIds.includes(material.id)) {
      blockers.push("The assigned machine is not configured for this material.")
    }
  }

  if (!machine)
    blockers.push("Production equipment is not assigned or no longer exists.")
  else {
    if (machine.status !== "Available")
      blockers.push(`Assigned equipment is ${machine.status.toLowerCase()}.`)
    if (plan.plannedHours <= 0)
      blockers.push("Planned machine time is missing.")
    else if (plan.plannedHours > machine.availableHours)
      blockers.push("Available machine time is below the planned hours.")
    const process = request.requirements.process
    if (
      process !== "Not sure" &&
      machine.technology !== process &&
      !(process === "SLA" && machine.technology === "MSLA")
    ) {
      blockers.push(`Assigned equipment does not support ${process}.`)
    }
    const part = request.boundingBoxMm.slice().sort((a, b) => b - a)
    const volume = machine.buildVolumeMm.slice().sort((a, b) => b - a)
    if (
      part.length === 3 &&
      volume.length === 3 &&
      part.some((dimension, index) => dimension > volume[index]!)
    ) {
      blockers.push(
        "The part bounding box exceeds the assigned machine build volume."
      )
    }
  }

  return blockers
}

function buildManufacturerSnapshot({
  organizationId,
  rfqs = [],
  materials = [],
  equipment = [],
  productionOrders = [],
  purchaseOrders = [],
  pricing = null,
  coverage = {},
  now = Date.now(),
}: SnapshotInput) {
  const requests = rfqs
    .filter((item) => ACTIVE_REQUEST_STATUSES.has(item.data.status))
    .map((item) => cleanRequest(item.id, item.data))
  const materialRows = materials.map((item) =>
    cleanMaterial(item.id, item.data)
  )
  const equipmentRows = equipment.map((item) =>
    cleanEquipment(item.id, item.data)
  )
  const plans = productionOrders.map((item) => cleanPlan(item.id, item.data))
  const purchaseRows = purchaseOrders.map((item) =>
    cleanPurchaseOrder(item.id, item.data)
  )
  const requestsById = new Map(requests.map((item) => [item.id, item]))
  const signals: Signal[] = []

  const originalMaterials = new Map(materials.map((row) => [row.id, row.data]))
  for (const material of materialRows) {
    const original = originalMaterials.get(material.id)!
    const missing = ["stock", "reserved", "reorderAt"].filter(
      (field) =>
        typeof original[field] !== "number" || !Number.isFinite(original[field])
    )
    if (missing.length) {
      signals.push({
        id: `missing:${material.id}`,
        title: `${material.name} has incomplete inventory data`,
        priority: "medium",
        facts: { missingFields: missing },
        sourceIds: [material.sourceId],
      })
      continue
    }
    if (material.availableKg <= material.reorderAtKg) {
      const incoming = purchaseRows.filter(
        (order) =>
          order.materialId === material.id && order.status === "Ordered"
      )
      signals.push({
        id: `stock:${material.id}`,
        title:
          material.availableKg <= 0
            ? `${material.name} is out of available stock`
            : `${material.name} is at or below its reorder point`,
        priority: material.availableKg <= 0 ? "high" : "medium",
        facts: {
          availableKg: material.availableKg,
          reorderAtKg: material.reorderAtKg,
          incomingPurchaseOrders: incoming.map((order) => ({
            sourceId: order.sourceId,
            quantityKg: order.quantityKg,
            eta: order.eta,
          })),
        },
        sourceIds: [
          material.sourceId,
          ...incoming.map((order) => order.sourceId),
        ],
      })
    }
  }

  for (const request of requests) {
    if (request.status === "Submitted") {
      signals.push({
        id: `review:${request.id}`,
        title: `Request ${request.id} is awaiting review`,
        priority: "medium",
        facts: { product: request.product, submittedAt: request.submittedAt },
        sourceIds: [request.sourceId],
      })
    }
    if (request.status === "Quoted" && request.paymentStatus !== "Paid") {
      signals.push({
        id: `quote:${request.id}`,
        title: `Quotation ${request.id} is still unpaid`,
        priority: "low",
        facts: {
          product: request.product,
          quoteTotalIdr: request.quoteTotalIdr,
          quotedAt: request.quotedAt,
          daysSinceQuote: request.quotedAt
            ? Math.max(0, Math.floor((now - request.quotedAt) / 86_400_000))
            : null,
        },
        sourceIds: [request.sourceId],
      })
    }
  }

  for (const plan of plans.filter(
    (item) => item.status === "Preparing Production"
  )) {
    const request = requestsById.get(plan.rfqId)
    if (!request) continue
    const blockers = productionBlockers(
      request,
      plan,
      materialRows,
      equipmentRows
    )
    if (blockers.length) {
      const relatedMaterial = materialRows.find(
        (item) => item.id === plan.materialId
      )
      const relatedMachine = equipmentRows.find(
        (item) => item.id === plan.equipmentId
      )
      signals.push({
        id: `production:${plan.id}`,
        title: `Production plan ${plan.id} has readiness blockers`,
        priority: "high",
        facts: { blockers },
        sourceIds: [
          request.sourceId,
          plan.sourceId,
          relatedMaterial?.sourceId,
          relatedMachine?.sourceId,
        ].filter((item): item is NonNullable<typeof item> => item != null),
      })
    }
  }

  const pricingRow = pricing
    ? {
        sourceId: "pricing:settings",
        kind: "pricing settings" as const,
        id: "settings",
        name: "Organization pricing settings",
        materialPerKgIdr: numberOr(pricing.materialPerKg, null),
        machinePerHourIdr: numberOr(pricing.machinePerHour, null),
        setupIdr: numberOr(pricing.setup, null),
        markupPercent: numberOr(pricing.markupPercent, null),
        minimumTotalIdr: numberOr(pricing.minimumTotal, null),
        layerHeightMm: numberOr(pricing.layerHeight, null),
        infillPercent: numberOr(pricing.infillPercent, null),
      }
    : null
  const evidence = [
    ...requests,
    ...materialRows,
    ...equipmentRows,
    ...plans,
    ...purchaseRows,
    ...(pricingRow ? [pricingRow] : []),
  ]
  signals.sort(
    (a, b) =>
      ({ high: 0, medium: 1, low: 2 })[a.priority] -
      { high: 0, medium: 1, low: 2 }[b.priority]
  )

  return {
    organizationId,
    asOf: new Date(now).toISOString(),
    requests,
    materials: materialRows,
    equipment: equipmentRows,
    productionOrders: plans,
    purchaseOrders: purchaseRows,
    pricing: pricingRow,
    signals,
    evidence,
    coverage,
  }
}

function evidencePayload(snapshot: ManufacturerSnapshot) {
  return {
    asOf: snapshot.asOf,
    requests: snapshot.requests,
    materials: snapshot.materials,
    equipment: snapshot.equipment,
    productionOrders: snapshot.productionOrders,
    purchaseOrders: snapshot.purchaseOrders,
    pricing: snapshot.pricing,
    coverage: snapshot.coverage,
  }
}

function sourceMap(snapshot: ManufacturerSnapshot) {
  return new Map(
    snapshot.evidence.map((item) => [
      item.sourceId,
      {
        id: item.sourceId,
        kind: item.kind,
        label:
          item.kind === "request"
            ? `${item.product} · ${item.id}`
            : `${("name" in item && item.name) || item.kind} · ${item.id}`,
      },
    ])
  )
}

function overviewFingerprint(
  snapshot: ManufacturerSnapshot,
  selectedSignals = snapshot.signals.slice(0, 5)
) {
  const evidence = sourceMap(snapshot)
  const sourceIds = [
    ...new Set(selectedSignals.flatMap((signal) => signal.sourceIds)),
  ]
  const sources = sourceIds
    .map((id) => evidence.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null)
  return createHash("sha256")
    .update(
      JSON.stringify({
        coverage: snapshot.coverage,
        signalCount: snapshot.signals.length,
        signals: selectedSignals,
        sources,
      })
    )
    .digest("hex")
}

function freshOverviewCache(
  cache: DocumentData | undefined,
  fingerprint: string,
  now = Date.now()
): unknown {
  if (
    !cache ||
    cache.fingerprint !== fingerprint ||
    !Number.isSafeInteger(cache.generatedAt) ||
    cache.generatedAt > now ||
    now - cache.generatedAt >= OVERVIEW_CACHE_TTL_MS ||
    cache.response?.generatedAt !== cache.generatedAt
  ) {
    return null
  }
  return cache.response
}

function safeChatResult(
  result: ChatResult,
  sources: Map<string, Source>,
  verifiedNoPaymentStatus?: string
) {
  const validSources = [...new Set(result.sourceIds)]
    .map((id) => sources.get(id))
    .filter((item): item is NonNullable<typeof item> => item != null)

  if (result.answerType === "out_of_scope") {
    return {
      answer:
        "Saya fokus membantu kebutuhan manufaktur, seperti pesanan dan penawaran harga, produksi, stok bahan, mesin, kualitas, dan perawatan.",
      answerType: "out_of_scope",
      sources: [],
    }
  }
  if (
    verifiedNoPaymentStatus &&
    validSources.length === 0 &&
    ["company_data", "clarification"].includes(result.answerType)
  ) {
    const statusLabel =
      verifiedNoPaymentStatus === "Paid" ? "sudah dibayar" : "belum dibayar"
    return {
      answer: `Saya tidak menemukan RFQ yang ${statusLabel} pada data yang diperiksa.`,
      answerType: "company_data",
      sources: [],
    }
  }
  if (
    result.answerType === "company_data" ||
    [...result.answer.matchAll(/\[([a-zA-Z]+:[^\]\n]+)\]/g)].some(
      (match) => !sources.has(match[1]!)
    )
  ) {
    return {
      answer:
        "Saya belum menemukan data yang cukup untuk memastikan hal itu. Bisa sebutkan nomor RFQ, nama bahan, atau nama mesin yang dimaksud?",
      answerType: "clarification",
      sources: [],
    }
  }

  return {
    answer: result.answer,
    answerType: result.answerType,
    sources: validSources,
  }
}

function greetingResponse(message: string) {
  const normalized = String(message || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?,]+$/g, "")
  if (
    !/^(hi|hello|hey|halo|hai|good morning|good afternoon|good evening|selamat pagi|selamat siang|selamat sore|selamat malam)( bro| there| team)?$/.test(
      normalized
    )
  ) {
    return null
  }

  const english =
    /^(hi|hello|hey|good morning|good afternoon|good evening)/.test(normalized)
  return {
    answer: english
      ? "Hi! I can help with RFQs, quotes, production readiness, materials, machines, quality, and maintenance. What are you working on?"
      : "Halo! Saya bisa membantu mengecek pesanan, penawaran harga, kesiapan produksi, stok bahan, kapasitas mesin, kualitas, dan perawatan. Apa yang ingin Anda cari tahu?",
    answerType: "conversation",
    sources: [],
  }
}

function overviewSignalReason(signal: Signal) {
  if (signal.id.startsWith("missing:"))
    return `Inventory fields are missing: ${signal.facts.missingFields.join(", ")}. Available stock cannot be verified.`
  if (signal.id.startsWith("stock:")) {
    const { availableKg, reorderAtKg, incomingPurchaseOrders } = signal.facts
    const incoming = incomingPurchaseOrders?.length
      ? ` An ordered purchase is recorded for ${incomingPurchaseOrders
          .map(
            (order: { quantityKg: number; eta: string }) =>
              `${order.quantityKg} kg${order.eta !== "Not available" ? ` (ETA ${order.eta})` : ""}`
          )
          .join(", ")}.`
      : " No ordered incoming purchase is recorded in the available data."
    return `Available stock is ${availableKg} kg against a reorder point of ${reorderAtKg} kg.${incoming}`
  }
  if (signal.id.startsWith("review:")) {
    return "The request is in Submitted status and is awaiting review."
  }
  if (signal.id.startsWith("quote:")) {
    const age = signal.facts.daysSinceQuote
    return age === null
      ? "The quotation is unpaid, and its quote date is not available."
      : `The quotation is unpaid ${age} day${age === 1 ? "" : "s"} after it was issued.`
  }
  if (signal.id.startsWith("production:")) {
    return `The recorded readiness blockers are: ${signal.facts.blockers.join(" ")}`
  }
  return signal.title
}

function publicOverview(
  snapshot: ManufacturerSnapshot,
  result: OverviewResult,
  allowedSignalIds = snapshot.signals.map((signal) => signal.id)
) {
  const evidence = sourceMap(snapshot)
  const signals = new Map(snapshot.signals.map((signal) => [signal.id, signal]))
  const allowedSignals = new Set(allowedSignalIds)
  const seenSignals = new Set<string>()
  const insights = result.insights
    .map((item) => {
      if (!allowedSignals.has(item.signalId) || seenSignals.has(item.signalId))
        return null
      const signal = signals.get(item.signalId)
      if (!signal) return null
      const sources = signal.sourceIds
        .map((id) => evidence.get(id))
        .filter((item): item is NonNullable<typeof item> => item != null)
      if (!sources.length) return null
      seenSignals.add(item.signalId)
      return {
        id: signal.id,
        priority: signal.priority,
        title: signal.title,
        reason: overviewSignalReason(signal),
        recommendation: item.recommendation,
        prevention: item.prevention,
        sources,
      }
    })
    .filter((item): item is NonNullable<typeof item> => item != null)

  const summary = insights.length
    ? `Ada ${snapshot.signals.length} sinyal operasional yang perlu ditinjau berdasarkan data workspace.`
    : "AI belum menghasilkan insight yang terhubung ke sinyal operasional. Refresh untuk mencoba lagi."
  const limited = Object.values(snapshot.coverage).some(Boolean)
  return {
    signalCount: snapshot.signals.length,
    summary: limited
      ? `${summary} Pemeriksaan dibatasi maksimal 80 record per daftar.`
      : summary,
    insights,
  }
}

export {
  buildManufacturerSnapshot,
  evidencePayload,
  freshOverviewCache,
  greetingResponse,
  overviewFingerprint,
  parseRequestPaymentSearch,
  productionBlockers,
  publicOverview,
  safeChatResult,
  sourceMap,
}
