import { createHash } from "node:crypto"
import { AggregateField, FieldPath, Timestamp } from "firebase-admin/firestore"
import type {
  DocumentData,
  Firestore,
  Query,
  Transaction,
} from "firebase-admin/firestore"
import { z } from "genkit"
import { buildManufacturerSnapshot, customerIdentity } from "./data.ts"
import type { Source } from "./data.ts"

export const domains = [
  "customers",
  "requests",
  "materials",
  "equipment",
  "production",
  "purchasing",
  "movements",
  "payments",
  "pricing",
  "organization",
  "memberships",
  "notifications",
] as const
export type Domain = (typeof domains)[number]
export type Row = Record<string, unknown> & { id: string; sourceId: string }
export const catalog: Record<
  Domain,
  { collection: string; kind: string; fields: string[] }
> = {
  customers: {
    collection: "rfqs",
    kind: "customer",
    fields: [
      "id",
      "name",
      "requestCount",
      "paidOrders",
      "paidValueIdr",
      "unpaidQuotes",
      "missingPaidQuotes",
      "lastRequestAt",
      "rfqIds",
    ],
  },
  requests: {
    collection: "rfqs",
    kind: "request",
    fields: [
      "id",
      "product",
      "customerId",
      "customerName",
      "status",
      "paymentStatus",
      "requirements",
      "quoteTotalIdr",
      "estimate",
      "createdAt",
      "submittedAt",
      "quotedAt",
      "paidAt",
      "productionStartedAt",
      "completedAt",
    ],
  },
  materials: {
    collection: "materials",
    kind: "material",
    fields: [
      "id",
      "name",
      "category",
      "properties",
      "unitCostIdrPerKg",
      "stockKg",
      "reservedKg",
      "availableKg",
      "reorderAtKg",
    ],
  },
  equipment: {
    collection: "equipment",
    kind: "equipment",
    fields: [
      "id",
      "name",
      "technology",
      "status",
      "hourlyCostIdr",
      "buildVolumeMm",
      "compatibleMaterialIds",
      "workingHoursPerDay",
      "scheduledHours",
      "availableHours",
      "completedJobs",
      "plannedHours",
      "calendarHours",
    ],
  },
  production: {
    collection: "productionOrders",
    kind: "production",
    fields: [
      "id",
      "rfqId",
      "customerId",
      "customerName",
      "status",
      "materialId",
      "equipmentId",
      "plannedGrams",
      "plannedHours",
      "reservedKg",
      "actualGrams",
      "createdAt",
      "scheduledStartDate",
      "estimatedCompletionDate",
      "updatedAt",
      "startedAt",
      "completedAt",
      "calendarHours",
    ],
  },
  purchasing: {
    collection: "purchaseOrders",
    kind: "purchase order",
    fields: [
      "id",
      "materialId",
      "supplier",
      "quantityKg",
      "unitCostIdr",
      "eta",
      "status",
      "createdAt",
    ],
  },
  movements: {
    collection: "inventoryMovements",
    kind: "inventory movement",
    fields: [
      "id",
      "type",
      "materialId",
      "deltaKg",
      "reservedDeltaKg",
      "referenceId",
      "createdAt",
    ],
  },
  payments: {
    collection: "kaseraPaymentAttempts",
    kind: "payment",
    fields: [
      "id",
      "rfqId",
      "quoteTotal",
      "shippingTotal",
      "amount",
      "status",
      "createdAt",
      "updatedAt",
      "expiresAt",
    ],
  },
  pricing: {
    collection: "pricing",
    kind: "pricing settings",
    fields: [
      "id",
      "materialPerKgIdr",
      "machinePerHourIdr",
      "setupIdr",
      "markupPercent",
      "minimumTotalIdr",
      "layerHeightMm",
      "infillPercent",
    ],
  },
  organization: {
    collection: "organizations",
    kind: "organization settings",
    fields: [
      "id",
      "name",
      "active",
      "acceptingRequests",
      "shippingOrigin",
      "createdAt",
    ],
  },
  memberships: {
    collection: "manufacturers",
    kind: "membership",
    fields: ["id", "name", "role", "active", "createdAt"],
  },
  notifications: {
    collection: "notifications",
    kind: "notification",
    fields: ["id", "rfqId", "kind", "title", "createdAt", "readAt"],
  },
}
const field = () => z.string().min(1).max(60)
const filterSchema = () =>
  z.object({
    field: field(),
    op: z.enum(["eq", "ne", "gt", "gte", "lt", "lte", "contains", "in"]),
    value: z.union([
      z.string().max(160),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(160)).max(20),
    ]),
  })
export const querySchema = z.object({
  area: z.enum(domains),
  fields: z.array(field()).max(12).optional(),
  filters: z.array(filterSchema()).max(10).default([]),
  search: z.string().trim().max(120).optional(),
  recordId: z
    .string()
    .min(1)
    .max(150)
    .regex(/^[^/]+$/)
    .optional(),
  date: z
    .object({
      field: field(),
      from: z.string().max(40).optional(),
      to: z.string().max(40).optional(),
    })
    .optional(),
  sort: z
    .object({ field: field(), direction: z.enum(["asc", "desc"]) })
    .optional(),
  offset: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(20).default(20),
  contacts: z.boolean().default(false),
})
export const analyticsSchema = querySchema.extend({
  operation: z.enum(["count", "sum", "average", "min", "max"]),
  metric: field().optional(),
  groupBy: field().optional(),
  compare: z.array(filterSchema()).max(10).optional(),
})
// Gemini's Genkit converter supports concrete types, not $ref or union-valued tool parameters.
const toolFilterSchema = () =>
  filterSchema().extend({
    value: z
      .object({
        text: z.string().max(160).optional(),
        number: z.number().finite().optional(),
        boolean: z.boolean().optional(),
        list: z.array(z.string().max(160)).max(20).optional(),
      })
      .describe("Set exactly one typed value: text, number, boolean, or list."),
  })
export const toolQuerySchema = querySchema.extend({
  filters: z.array(toolFilterSchema()).max(10).default([]),
})
export const toolAnalyticsSchema = analyticsSchema.extend({
  filters: z.array(toolFilterSchema()).max(10).default([]),
  compare: z.array(toolFilterSchema()).max(10).optional(),
})
export function parseToolQuery(input: unknown) {
  const decode = ({
    field,
    op,
    value,
  }: z.infer<ReturnType<typeof toolFilterSchema>>) => {
    const values = Object.values(value).filter((value) => value !== undefined)
    if (values.length !== 1)
      throw new Error("A filter requires exactly one typed value")
    return { field, op, value: values[0]! }
  }
  if (input && typeof input === "object" && "operation" in input) {
    const parsed = toolAnalyticsSchema.parse(input)
    return analyticsSchema.parse({
      ...parsed,
      filters: parsed.filters.map(decode),
      compare: parsed.compare?.map(decode),
    })
  }
  const parsed = toolQuerySchema.parse(input)
  return querySchema.parse({ ...parsed, filters: parsed.filters.map(decode) })
}

export type RecordQuery = z.infer<typeof querySchema>
export type AnalyticsQuery = z.infer<typeof analyticsSchema>
export type Result = {
  area: Domain
  readAt: string
  complete: boolean
  scanned: number
  matched: number
  missing: Record<string, number>
  filters: unknown
  period: string
  rows: Row[]
  nextOffset: number | null
  sources: Source[]
  operation?: string
  metric?: string
}
export type QuerySession = ReturnType<typeof createQuerySession>
export function createQuerySession(
  db: Firestore,
  organizationId: string,
  uid: string,
  contactsAllowed = false
) {
  return {
    db,
    organizationId,
    uid,
    contactsAllowed,
    readTime: Timestamp.now(),
    deadline: Date.now() + 45_000,
    reads: 0,
    aggregateQueries: 0,
    aggregatedRecords: 0,
    cache: new Map<string, Promise<Result>>(),
    raw: new Map<string, { id: string; data: DocumentData }[]>(),
  }
}
function checkDeadline(session: QuerySession) {
  if (Date.now() >= session.deadline)
    throw new Error("Query deadline exceeded; no complete result is available")
}
export async function scanPages(
  query: Query,
  tx: Transaction,
  session: Pick<QuerySession, "deadline" | "reads">
) {
  const rows: { id: string; data: DocumentData }[] = []
  let cursor
  while (true) {
    if (Date.now() >= session.deadline)
      throw new Error(
        "Query deadline exceeded; no complete result is available"
      )
    const page: FirebaseFirestore.QuerySnapshot = await tx.get(
      cursor
        ? query.orderBy(FieldPath.documentId()).startAfter(cursor).limit(500)
        : query.orderBy(FieldPath.documentId()).limit(500)
    )
    session.reads += page.size
    rows.push(...page.docs.map((doc) => ({ id: doc.id, data: doc.data() })))
    if (page.size < 500) return rows
    cursor = page.docs.at(-1)
  }
}
export async function readDomains(session: QuerySession, areas: Domain[]) {
  for (const area of areas) {
    const sibling =
      area === "customers"
        ? "requests"
        : area === "requests"
          ? "customers"
          : null
    if (sibling && !session.raw.has(area) && session.raw.has(sibling))
      session.raw.set(area, session.raw.get(sibling)!)
  }
  const pending = [...new Set(areas)].filter((area) => !session.raw.has(area))
  if (!pending.length) return
  await session.db.runTransaction(
    async (tx) => {
      const loaded = new Map<string, { id: string; data: DocumentData }[]>()
      for (const area of pending) {
        checkDeadline(session)
        const spec = catalog[area]
        if (area === "pricing" || area === "organization") {
          const doc = await tx.get(
            session.db.doc(`${spec.collection}/${session.organizationId}`)
          )
          session.reads++
          loaded.set(
            area,
            doc.exists ? [{ id: doc.id, data: doc.data()! }] : []
          )
        } else {
          let query = session.db
            .collection(spec.collection)
            .where("organizationId", "==", session.organizationId)
          if (area === "notifications")
            query = query.where("recipientUid", "==", session.uid)
          loaded.set(area, await scanPages(query, tx, session))
        }
      }
      checkDeadline(session)
      for (const [area, rows] of loaded) session.raw.set(area, rows)
    },
    { readOnly: true, readTime: session.readTime }
  )
}
function pick(row: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.map((key) => [key, row[key] ?? null]))
}
export function normalizeRows(
  area: Domain,
  raw: { id: string; data: DocumentData }[],
  related: {
    requests?: { id: string; data: DocumentData }[]
    production?: { id: string; data: DocumentData }[]
  } = {}
): Row[] {
  if (area === "customers") {
    const groups = new Map<string, Row>()
    for (const { id, data } of [...raw].sort(
      (a, b) =>
        (b.data.submittedAt ?? b.data.createdAt ?? 0) -
        (a.data.submittedAt ?? a.data.createdAt ?? 0)
    )) {
      if (
        ![
          "Submitted",
          "Under Review",
          "Quoted",
          "Preparing Production",
          "In Production",
          "Completed",
          "Closed",
        ].includes(data.status)
      )
        continue
      const key = customerIdentity(id, data)
      const current = groups.get(key) ?? {
        id: key,
        sourceId: `customer:${key}`,
        name: String(data.customer?.name || "Unnamed customer").slice(0, 160),
        requestCount: 0,
        paidOrders: 0,
        paidValueIdr: 0,
        unpaidQuotes: 0,
        missingPaidQuotes: 0,
        lastRequestAt: 0,
        rfqIds: [],
        contact: pick(data.customer || {}, ["email", "phone"]),
        address: data.shipping?.address ?? null,
      }
      current.requestCount = Number(current.requestCount) + 1
      ;(current.rfqIds as string[]).push(id)
      if (
        typeof data.quoteTotal === "number" &&
        Number.isFinite(data.quoteTotal) &&
        data.quoteTotal
      ) {
        const key =
          data.paymentStatus === "Paid" ? "paidOrders" : "unpaidQuotes"
        current[key] = Number(current[key]) + 1
        if (data.paymentStatus === "Paid")
          current.paidValueIdr = Number(current.paidValueIdr) + data.quoteTotal
      }
      if (
        data.paymentStatus === "Paid" &&
        (typeof data.quoteTotal !== "number" ||
          !Number.isFinite(data.quoteTotal))
      )
        current.missingPaidQuotes = Number(current.missingPaidQuotes) + 1
      current.lastRequestAt = Math.max(
        Number(current.lastRequestAt),
        data.submittedAt ?? data.createdAt ?? 0
      )
      groups.set(key, current)
    }
    return [...groups.values()]
  }
  const snapshotKey = {
    requests: "rfqs",
    materials: "materials",
    equipment: "equipment",
    production: "productionOrders",
    purchasing: "purchaseOrders",
  }[area as string]
  if (snapshotKey || area === "pricing") {
    const snapshot = buildManufacturerSnapshot({
      organizationId: "",
      [snapshotKey || "pricing"]: area === "pricing" ? raw[0]?.data : raw,
    })
    let rows = snapshot.evidence.map((row) => ({ ...row })) as Row[]
    const requestsById = new Map(related.requests?.map((r) => [r.id, r]))
    const duration = (plan: DocumentData) => {
      const request = requestsById.get(String(plan.rfqId ?? plan.id))?.data
      const startedAt = plan.startedAt ?? request?.productionStartedAt ?? null
      const completedAt = plan.completedAt ?? request?.completedAt ?? null
      return {
        startedAt,
        completedAt,
        calendarHours:
          typeof startedAt === "number" &&
          typeof completedAt === "number" &&
          completedAt >= startedAt
            ? (completedAt - startedAt) / 3_600_000
            : null,
      }
    }
    if (area === "production")
      rows = rows.map((row) => {
        const request = requestsById.get(String(row.rfqId))
        return {
          ...row,
          customerId: request
            ? customerIdentity(request.id, request.data)
            : null,
          customerName: request?.data.customer?.name ?? null,
          ...duration(row),
        }
      })
    const jobsByMachine = new Map<string, DocumentData[]>()
    for (const plan of related.production ?? []) {
      const key = String(plan.data.equipmentId)
      const jobs = jobsByMachine.get(key) ?? []
      jobs.push({ ...plan.data, id: plan.id })
      jobsByMachine.set(key, jobs)
    }
    if (area === "equipment")
      rows = rows.map((row) => {
        const jobs = jobsByMachine.get(row.id) ?? []
        const planned = jobs.map((p) => p.plannedHours)
        const finished = jobs.filter((p) => p.status === "Completed")
        const durations = finished.map((p) => duration(p).calendarHours)
        return {
          ...row,
          completedJobs: finished.length,
          plannedHours: planned.every(
            (v) => typeof v === "number" && Number.isFinite(v)
          )
            ? planned.reduce((a, b) => a + b, 0)
            : null,
          calendarHours: durations.every((v) => v !== null)
            ? durations.reduce<number>((a, b) => a + b!, 0)
            : null,
        }
      })
    const rawNames: Record<string, string> = {
      quoteTotalIdr: "quoteTotal",
      stockKg: "stock",
      reservedKg: "reserved",
      reorderAtKg: "reorderAt",
      unitCostIdrPerKg: "unitCost",
      hourlyCostIdr: "hourlyCost",
      workingHoursPerDay: "workingHours",
      scheduledHours: "scheduledHours",
      plannedGrams: "plannedGrams",
      plannedHours: "plannedHours",

      actualGrams: "actualGrams",
      quantityKg: "quantity",
      unitCostIdr: "unitCost",
    }
    const byId = new Map(raw.map((r) => [r.id, r.data]))
    return rows.map((row) => {
      const data = byId.get(row.id) ?? {}
      for (const [field, rawField] of Object.entries(rawNames)) {
        const storedField =
          area === "production" && field === "reservedKg"
            ? "reservedKg"
            : rawField
        if (
          field in row &&
          !(area === "equipment" && field === "plannedHours") &&
          (typeof data[storedField] !== "number" ||
            !Number.isFinite(data[storedField]))
        )
          row[field] = null
      }
      if (
        area === "materials" &&
        (row.stockKg === null || row.reservedKg === null)
      )
        row.availableKg = null
      if (
        area === "equipment" &&
        (row.workingHoursPerDay === null || row.scheduledHours === null)
      )
        row.availableHours = null
      return row
    })
  }
  return raw.map(({ id, data }) => ({
    ...pick(
      data,
      catalog[area].fields.filter((f) => f !== "id")
    ),
    ...(area === "organization"
      ? {
          shippingOrigin: data.shippingOrigin
            ? pick(data.shippingOrigin, [
                "name",
                "phone",
                "addressLine",
                "postalCode",
                "destinationId",
                "destinationLabel",
              ])
            : null,
        }
      : {}),
    id:
      area === "memberships"
        ? createHash("sha256").update(id).digest("hex")
        : id,
    sourceId: `${area}:${area === "memberships" ? createHash("sha256").update(id).digest("hex") : id}`,
  }))
}
export function jakartaDate(value: string, end = false) {
  if (
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(
      value
    )
  )
    throw new Error("Use an ISO date; dates without time use Asia/Jakarta")
  const day = Date.parse(`${value.slice(0, 10)}T00:00:00Z`)
  if (
    !Number.isFinite(day) ||
    new Date(day).toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    throw new Error("Invalid date")
  const date = Date.parse(
    value.length === 10
      ? `${value}T${end ? "23:59:59.999" : "00:00:00.000"}+07:00`
      : value
  )
  if (!Number.isFinite(date)) throw new Error("Invalid date")
  return date
}
function matches(row: Row, filters: RecordQuery["filters"]) {
  return filters.every(({ field, op, value }) => {
    const actual = row[field]
    if (actual == null) return false
    switch (op) {
      case "eq":
        return actual === value
      case "ne":
        return actual !== value
      case "contains":
        return String(actual)
          .toLowerCase()
          .includes(String(value).toLowerCase())
      case "in":
        return Array.isArray(value) && value.includes(String(actual))
      case "gt":
        return (
          typeof actual === "number" &&
          typeof value === "number" &&
          actual > value
        )
      case "gte":
        return (
          typeof actual === "number" &&
          typeof value === "number" &&
          actual >= value
        )
      case "lt":
        return (
          typeof actual === "number" &&
          typeof value === "number" &&
          actual < value
        )
      case "lte":
        return (
          typeof actual === "number" &&
          typeof value === "number" &&
          actual <= value
        )
    }
  })
}
export function computeResult(
  input: RecordQuery | AnalyticsQuery,
  all: Row[],
  readAt: string,
  scanned: number
): Result {
  const analytics = "operation" in input ? input : null
  const allowed = [
    ...catalog[input.area].fields,
    ...(input.area === "customers" && input.contacts
      ? ["contact", "address"]
      : []),
  ]
  for (const key of [
    ...(input.fields ?? []),
    ...input.filters.map((f) => f.field),
    ...(input.sort ? [input.sort.field] : []),
    ...(input.date ? [input.date.field] : []),
    ...(analytics?.metric ? [analytics.metric] : []),
    ...(analytics?.groupBy ? [analytics.groupBy] : []),
    ...(analytics?.compare?.map((f) => f.field) ?? []),
  ]) {
    if (
      !allowed.includes(key) &&
      !(analytics && input.sort?.field === key && key === "value")
    )
      throw new Error(`Field unavailable: ${key}`)
  }
  if (analytics && analytics.operation !== "count" && !analytics.metric)
    throw new Error("A numeric metric is required")
  if (
    input.date?.from &&
    input.date.to &&
    jakartaDate(input.date.from) > jakartaDate(input.date.to, true)
  )
    throw new Error("Date range is reversed")
  if (
    analytics?.groupBy &&
    [
      "requirements",
      "estimate",
      "rfqIds",
      "contact",
      "address",
      "shippingOrigin",
      "compatibleMaterialIds",
      "buildVolumeMm",
    ].includes(analytics.groupBy)
  )
    throw new Error("Grouping requires a scalar field")
  const missing: Record<string, number> = {}
  const rows = all.filter((row) => {
    if (input.recordId && row.id !== input.recordId) return false
    if (!matches(row, input.filters)) return false
    if (input.date) {
      const rawDate = row[input.date.field]
      let value =
        typeof rawDate === "number" && Number.isFinite(rawDate) ? rawDate : null
      if (typeof rawDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        try {
          value = jakartaDate(rawDate)
        } catch {
          value = null
        }
      }
      if (value === null) {
        missing[input.date.field] = (missing[input.date.field] || 0) + 1
        return false
      }
      if (input.date.from && value < jakartaDate(input.date.from)) return false
      if (input.date.to && value > jakartaDate(input.date.to, true))
        return false
    }
    return (
      !input.search ||
      JSON.stringify(pick(row, allowed))
        .toLowerCase()
        .includes(input.search.toLowerCase())
    )
  })
  if (input.area === "customers") {
    const missingQuotes = rows.reduce(
      (total, row) => total + Number(row.missingPaidQuotes ?? 0),
      0
    )
    if (missingQuotes) missing.paidValueIdr = missingQuotes
  }
  if (!analytics)
    for (const field of input.fields ?? allowed) {
      const absent = rows.filter((row) => row[field] == null).length
      if (absent) missing[field] = absent
    }
  if (analytics?.groupBy) {
    const absent = rows.filter((row) => row[analytics.groupBy!] == null).length
    if (absent) missing[analytics.groupBy] = absent
  }
  let output: Row[] = rows.map((row) => ({
    ...pick(row, input.fields ?? allowed),
    id: row.id,
    sourceId: row.sourceId,
  }))
  if (analytics) {
    const groups = new Map<string, Row[]>()
    for (const row of rows) {
      const key = analytics.groupBy
        ? String(row[analytics.groupBy] ?? "(missing)")
        : "all"
      const members = groups.get(key) ?? []
      members.push(row)
      groups.set(key, members)
    }
    if (!analytics.groupBy && !groups.size) groups.set("all", [])
    output = [...groups].flatMap(([group, members]) => {
      const sets = analytics.compare
        ? ([
            ["current", members],
            [
              "comparison",
              members.filter((r) => matches(r, analytics.compare!)),
            ],
          ] as const)
        : ([["current", members]] as const)
      return sets.map(([cohort, selected]) => {
        const values = selected
          .map((r) => r[analytics.metric!])
          .filter(
            (v): v is number => typeof v === "number" && Number.isFinite(v)
          )
        const absent =
          analytics.operation === "count" ? 0 : selected.length - values.length
        if (absent)
          missing[analytics.metric!] =
            (missing[analytics.metric!] || 0) + absent
        const total = values.reduce((a, b) => a + b, 0)
        if (!Number.isFinite(total))
          throw new Error("Numeric total is outside the supported range")
        const value =
          analytics.operation === "count"
            ? selected.length
            : !values.length
              ? null
              : analytics.operation === "sum"
                ? total
                : analytics.operation === "average"
                  ? total / values.length
                  : values.reduce((a, b) =>
                      analytics.operation === "min"
                        ? Math.min(a, b)
                        : Math.max(a, b)
                    )
        const id = createHash("sha256")
          .update(JSON.stringify({ input, group, cohort, readAt }))
          .digest("hex")
          .slice(0, 24)
        return {
          id,
          sourceId: `analytics:${id}`,
          group,
          ...(analytics.groupBy === "customerId"
            ? { name: String(selected[0]?.customerName ?? group) }
            : analytics.groupBy === "id"
              ? { name: String(selected[0]?.name ?? group) }
              : {}),
          cohort,
          value,
          records: selected.length,
          missing: absent,
        }
      })
    })
  }
  const sort =
    input.sort ??
    (analytics
      ? { field: "value", direction: "desc" }
      : { field: "id", direction: "asc" })
  output.sort((a, b) => {
    const x = a[sort.field],
      y = b[sort.field]
    if (x == null || y == null)
      return x == null ? (y == null ? a.id.localeCompare(b.id) : 1) : -1
    const comparison =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y))
    return (
      (sort.direction === "asc" ? comparison : -comparison) ||
      a.id.localeCompare(b.id)
    )
  })
  const selected = output.slice(input.offset, input.offset + input.limit)
  return {
    area: input.area,
    readAt,
    complete: true,
    scanned,
    matched: rows.length,
    missing,
    filters: input,
    period: input.date
      ? `${input.date.from ?? "awal"} – ${input.date.to ?? "sekarang"} (Asia/Jakarta)`
      : "Seluruh riwayat (Asia/Jakarta)",
    rows: selected,
    nextOffset:
      input.offset + selected.length < output.length
        ? input.offset + selected.length
        : null,
    sources: selected.map((r) => ({
      id: r.sourceId,
      kind: analytics ? `analytics:${input.area}` : catalog[input.area].kind,
      label: String(r.name ?? r.product ?? r.group ?? r.id).slice(0, 160),
    })),
    ...(analytics
      ? {
          operation: analytics.operation,
          metric: analytics.metric ?? "records",
        }
      : {}),
  }
}
export function queryRecords(
  session: QuerySession,
  input: RecordQuery | AnalyticsQuery
): Promise<Result> {
  if (input.contacts && !session.contactsAllowed)
    throw new Error("Customer contacts require an explicit contact request")
  const key = JSON.stringify(input)
  const existing = session.cache.get(key)
  if (existing) return existing
  const pending = (async () => {
    checkDeadline(session)
    // Firestore count avoids reading documents when no normalization or relation is required.
    if (
      "operation" in input &&
      input.operation === "count" &&
      !input.groupBy &&
      !input.compare &&
      !input.date &&
      !input.search &&
      !input.recordId &&
      !input.filters.length &&
      [
        "materials",
        "purchasing",
        "movements",
        "payments",
        "memberships",
        "notifications",
      ].includes(input.area)
    ) {
      let query = session.db
        .collection(catalog[input.area].collection)
        .where("organizationId", "==", session.organizationId)
      if (input.area === "notifications")
        query = query.where("recipientUid", "==", session.uid)
      const aggregate = await session.db.runTransaction(
        (tx) => tx.get(query.aggregate({ count: AggregateField.count() })),
        { readOnly: true, readTime: session.readTime }
      )
      session.aggregateQueries++
      session.aggregatedRecords += aggregate.data().count
      checkDeadline(session)
      const result = computeResult(
        input,
        [],
        session.readTime.toDate().toISOString(),
        0
      )
      result.matched = aggregate.data().count
      if (result.rows[0]) {
        result.rows[0].value = result.matched
        result.rows[0].records = result.matched
      }
      return result
    }
    const related: Domain[] =
      input.area === "equipment"
        ? ["production", "requests"]
        : input.area === "production"
          ? ["requests"]
          : []
    let raw = session.raw.get(input.area)
    if (
      !raw &&
      input.recordId &&
      !["customers", "pricing", "organization"].includes(input.area)
    ) {
      await readDomains(session, related)
      let query = session.db
        .collection(catalog[input.area].collection)
        .where("organizationId", "==", session.organizationId)
        .where(FieldPath.documentId(), "==", input.recordId)
      if (input.area === "notifications")
        query = query.where("recipientUid", "==", session.uid)
      raw = await session.db.runTransaction(
        (tx) => scanPages(query, tx, session),
        { readOnly: true, readTime: session.readTime }
      )
    } else {
      await readDomains(session, [input.area, ...related])
      raw = session.raw.get(input.area)!
    }
    const result = computeResult(
      input,
      normalizeRows(input.area, raw, {
        requests: session.raw.get("requests"),
        production: session.raw.get("production"),
      }),
      session.readTime.toDate().toISOString(),
      raw.length
    )
    checkDeadline(session)
    return result
  })()
  session.cache.set(key, pending)
  return pending
}
const cell = (value: unknown): string =>
  (typeof value === "object" && value !== null
    ? JSON.stringify(value)
    : String(value ?? "—")
  )
    .replace(/[|\n\r]/g, " ")
    .replace(/[[\]<>`*_]/g, "")
    .slice(0, 700)
export function renderResults(results: Result[]) {
  return results
    .map((r) => {
      if (!r.complete)
        throw new Error("Incomplete query cannot be rendered as a total")
      const fields = [
        ...new Set(r.rows.flatMap((row) => Object.keys(row))),
      ].filter((f) => !["id", "sourceId"].includes(f))
      return `${r.area}${r.operation ? ` · ${r.operation}(${r.metric})` : ""}\n\n${r.period}. Dibaca ${r.readAt}; diperiksa ${r.scanned}, cocok ${r.matched}. Filter: ${cell(r.filters)}.\n\n${r.rows.length ? `| ${fields.join(" | ")} | Sumber |\n| ${fields.map(() => "---").join(" | ")} | --- |\n${r.rows.map((row) => `| ${fields.map((f) => cell(row[f])).join(" | ")} | [${row.sourceId}] |`).join("\n")}` : "Tidak ada record yang cocok."}${Object.keys(r.missing).length ? `\n\nData hilang: ${cell(r.missing)}; nilai tersebut tidak dimasukkan ke perhitungan.` : ""}${r.nextOffset !== null ? `\n\nHalaman berikutnya: offset ${r.nextOffset}. Perhitungan mencakup seluruh record yang cocok.` : ""}`
    })
    .join("\n\n")
}
export function needsRankingMetric(message: string) {
  return (
    /\b(top|terbaik|teratas|paling)\b/i.test(message) &&
    /\b(customers?|pelanggan|machines?|mesin)\b/i.test(message) &&
    !/\b(nilai|value|revenue|omzet|paid|lunas|jumlah|count|jobs?|pesanan|requests?|rfq|jam|hours?|durasi|duration|stock|stok|biaya|cost|kapasitas|capacity)\b/i.test(
      message
    )
  )
}
export function explicitContacts(message: string) {
  return /\b(kontak|contact|email|e-mail|telepon|phone|alamat|address|whatsapp)\b/i.test(
    message
  )
}

export function modelResultContext(results: Result[], maxCharacters = 8000) {
  let remaining = 20
  const summaries = [...results].reverse().map((result) => {
    const rows = result.rows
      .slice(0, remaining)
      .map(
        ({ contact: _contact, address: _address, rfqIds: _rfqIds, ...row }) =>
          row
      )
    remaining -= rows.length
    return {
      area: result.area,
      matched: result.matched,
      scanned: result.scanned,
      complete: result.complete,
      period: result.period,
      operation: result.operation,
      metric: result.metric,
      missing: result.missing,
      rows,
    }
  })
  const serialize = () =>
    JSON.stringify(summaries, (_key, value) =>
      typeof value === "string"
        ? value.slice(0, 160)
        : Array.isArray(value)
          ? value.slice(0, 20)
          : value
    )
  let serialized = serialize()
  while (serialized.length > maxCharacters) {
    const summary = summaries.findLast((item) => item.rows.length)
    if (!summary) throw new Error("Assistant context budget exhausted")
    summary.rows.pop()
    serialized = serialize()
  }
  return serialized
}

export const recommendationSchema = z.enum([
  "none",
  "review_records",
  "check_missing_data",
  "review_capacity",
  "verify_payment_history",
  "review_reorder_levels",
])
const recommendations: Record<z.infer<typeof recommendationSchema>, string> = {
  none: "",
  review_records:
    "Saran: tinjau record sumber sebelum mengambil keputusan operasional.",
  check_missing_data:
    "Saran: lengkapi data yang belum tercatat sebelum membandingkan hasil.",
  review_capacity:
    "Saran: periksa jadwal dan kapasitas mesin sebelum menjanjikan tanggal produksi.",
  verify_payment_history:
    "Saran: periksa riwayat pembayaran dan tindak lanjut sebelum menghubungi pelanggan.",
  review_reorder_levels:
    "Saran: periksa pembelian masuk dan kebutuhan produksi sebelum memesan bahan.",
}
export function companyAnswer(
  results: Result[],
  recommendation: z.infer<typeof recommendationSchema> = "none"
) {
  const suggestion = recommendations[recommendationSchema.parse(recommendation)]
  return {
    answer: `${renderResults(results)}${suggestion ? `\n\n${suggestion}` : ""}`,
    answerType: "company_data",
    sources: [
      ...new Map(
        results.flatMap((r) => r.sources).map((source) => [source.id, source])
      ).values(),
    ],
  }
}
