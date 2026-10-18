"use client"

import { useMemo, useState } from "react"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@workspace/ui/components/chart"
import type { CustomerRFQ } from "@/lib/customer-portal"
import type { EquipmentRecord, ProductionOrder } from "@/lib/manufacturing-operations"

type RequestRecord = CustomerRFQ & { id: string }
type Period = "daily" | "weekly" | "monthly"
type TimelinePoint = {
  id: string
  label: string
  status: ProductionOrder["status"]
  machine: string
  startDate: string
  endDate: string
  offset: number
  duration: number
}

const chartConfig = {
  requests: { label: "Requests", color: "var(--chart-1)" },
  scheduled: { label: "Scheduled", color: "var(--chart-2)" },
  running: { label: "In production", color: "var(--chart-1)" },
} satisfies ChartConfig

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function OverviewProduction({ requests, productionOrders, equipment }: {
  requests: RequestRecord[]
  productionOrders: ProductionOrder[]
  equipment: EquipmentRecord[]
}) {
  return <div className="grid gap-4">
    <div className="grid gap-4 lg:grid-cols-3">
      <RequestTrend requests={requests} />
      <ProductionQueue requests={requests} productionOrders={productionOrders} equipment={equipment} />
    </div>
    <ProductionTimeline requests={requests} productionOrders={productionOrders} equipment={equipment} />
  </div>
}

function RequestTrend({ requests }: { requests: RequestRecord[] }) {
  const [period, setPeriod] = useState<Period>("weekly")
  const data = useMemo(() => buildRequestTrend(requests, period, new Date()), [requests, period])
  const periodLabel = period === "daily" ? "per hour today" : period === "weekly" ? "per day this week" : "per day this month"

  return <Card className="min-w-0 lg:col-span-2">
    <CardHeader className="flex min-w-0 flex-row flex-nowrap items-center justify-between gap-2">
      <div className="min-w-0"><CardTitle className="whitespace-nowrap">Request trend</CardTitle><CardDescription className="truncate">Incoming requests {periodLabel}</CardDescription></div>
      <div className="flex shrink-0 flex-nowrap gap-1" aria-label="Request chart time range">
        {(["daily", "weekly", "monthly"] as const).map((value) => <Button key={value} type="button" size="xs" variant={period === value ? "default" : "outline"} aria-pressed={period === value} onClick={() => setPeriod(value)}>{capitalize(value)}</Button>)}
      </div>
    </CardHeader>
    <CardContent className="min-w-0">
      <ChartContainer config={chartConfig} className="h-[250px] w-full aspect-auto">
        <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="fillRequests" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-requests)" stopOpacity={0.8} />
              <stop offset="95%" stopColor="var(--color-requests)" stopOpacity={0.08} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval={period === "daily" ? 2 : period === "monthly" ? 3 : 0} />
          <YAxis allowDecimals={false} width={28} tickLine={false} axisLine={false} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <Area dataKey="requests" type="monotone" stroke="var(--color-requests)" strokeWidth={2} fill="url(#fillRequests)" dot={false} activeDot={{ r: 4 }} />
        </AreaChart>
      </ChartContainer>
    </CardContent>
  </Card>
}

function buildRequestTrend(requests: RequestRecord[], period: Period, now: Date) {
  let buckets: { key: string; label: string }[]
  if (period === "daily") {
    buckets = Array.from({ length: 24 }, (_, hour) => ({ key: String(hour), label: `${String(hour).padStart(2, "0")}:00` }))
  } else if (period === "weekly") {
    const monday = startOfWeek(now)
    buckets = Array.from({ length: 7 }, (_, index) => {
      const day = addDays(monday, index)
      return { key: dateKey(day), label: weekdays[index]! }
    })
  } else {
    const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
    buckets = Array.from({ length: count }, (_, index) => {
      const day = new Date(now.getFullYear(), now.getMonth(), index + 1)
      return { key: dateKey(day), label: String(index + 1) }
    })
  }
  const counts = new Map(buckets.map(({ key }) => [key, 0]))
  for (const request of requests) {
    if (typeof request.submittedAt !== "number") continue
    const submittedAt = new Date(request.submittedAt)
    const key = period === "daily" ? String(submittedAt.getHours()) : dateKey(submittedAt)
    if (counts.has(key)) counts.set(key, counts.get(key)! + 1)
  }
  return buckets.map((bucket) => ({ ...bucket, requests: counts.get(bucket.key) ?? 0 }))
}

function ProductionQueue({ requests, productionOrders, equipment }: {
  requests: RequestRecord[]
  productionOrders: ProductionOrder[]
  equipment: EquipmentRecord[]
}) {
  const activeOrders = productionOrders.filter((plan) => plan.status !== "Completed")
    .sort((left, right) => queueRank(left.status) - queueRank(right.status) || (left.scheduledStartDate ?? "9999").localeCompare(right.scheduledStartDate ?? "9999"))
  const active = activeOrders.filter((plan) => plan.status === "In Production").length
  const queued = activeOrders.length - active

  return <Card className="min-w-0">
    <CardHeader><CardTitle>Production queue</CardTitle><CardDescription>{active} running · {queued} queued or preparing</CardDescription></CardHeader>
    <CardContent className="grid gap-2">
      {activeOrders.slice(0, 5).map((plan) => {
        const request = requests.find((item) => item.id === plan.rfqId)
        const machine = equipment.find((item) => item.id === plan.equipmentId)
        return <div key={plan.id} className="grid gap-1 rounded-lg border p-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <p className="min-w-0 truncate text-sm font-medium" title={request?.product ?? plan.rfqId}>{request?.product ?? plan.rfqId}</p>
            <Badge variant={plan.status === "In Production" ? "default" : "secondary"}>{plan.status === "In Production" ? "Running" : plan.status === "Scheduled" ? "Scheduled" : "Preparing"}</Badge>
          </div>
          <p className="truncate text-xs text-muted-foreground">{request?.customer.name ?? "Customer"}{machine ? ` · ${machine.name}` : " · Waiting for schedule"}</p>
          {plan.scheduledStartDate ? <p className="text-xs text-muted-foreground">{formatDate(plan.scheduledStartDate)}{plan.estimatedCompletionDate && plan.estimatedCompletionDate !== plan.scheduledStartDate ? ` – ${formatDate(plan.estimatedCompletionDate)}` : ""}</p> : null}
        </div>
      })}
      {!activeOrders.length ? <p className="rounded-lg border border-dashed p-5 text-center text-sm text-muted-foreground">No active production jobs.</p> : null}
      {activeOrders.length > 5 ? <p className="text-xs text-muted-foreground">And {activeOrders.length - 5} more jobs</p> : null}
    </CardContent>
  </Card>
}

function ProductionTimeline({ requests, productionOrders, equipment }: {
  requests: RequestRecord[]
  productionOrders: ProductionOrder[]
  equipment: EquipmentRecord[]
}) {
  const [view, setView] = useState<Period>("weekly")
  const [cursor, setCursor] = useState(() => new Date())
  const activeOrders = productionOrders.filter((plan) => plan.status === "Scheduled" || plan.status === "In Production")
  const range = timelineRange(cursor, view)
  const rangeMs = range.end.getTime() - range.start.getTime()
  // shortcut: timeline bars use date-level spans until production plans store machine shift times.
  const visiblePlans: TimelinePoint[] = activeOrders.flatMap((plan) => {
    const request = requests.find((item) => item.id === plan.rfqId)
    const startedDate = request?.productionStartedAt ? dateKey(new Date(request.productionStartedAt)) : undefined
    const startDate = plan.scheduledStartDate ?? (plan.status === "In Production" ? startedDate : undefined)
    if (!startDate) return []
    const endDate = plan.estimatedCompletionDate ?? (plan.status === "In Production" ? dateKey(new Date()) : startDate)
    const start = new Date(`${startDate}T00:00:00`)
    const end = addDays(new Date(`${endDate}T00:00:00`), 1)
    const clippedStart = new Date(Math.max(start.getTime(), range.start.getTime()))
    const clippedEnd = new Date(Math.min(end.getTime(), range.end.getTime()))
    if (clippedEnd <= clippedStart) return []
    return [{
      id: plan.id,
      label: request?.product ?? plan.rfqId,
      status: plan.status,
      machine: equipment.find((item) => item.id === plan.equipmentId)?.name ?? "Machine assigned",
      startDate,
      endDate,
      offset: clippedStart.getTime() - range.start.getTime(),
      duration: clippedEnd.getTime() - clippedStart.getTime(),
    }]
  })
  const unscheduledOrders = activeOrders.filter((plan) => !plan.scheduledStartDate && !(plan.status === "In Production" && requests.find((item) => item.id === plan.rfqId)?.productionStartedAt))
  const rangeLabel = view === "daily" ? formatDate(dateKey(range.start))
    : `${formatDate(dateKey(range.start))} – ${formatDate(dateKey(addDays(range.end, -1)))}`

  function moveCursor(direction: number) {
    const next = new Date(cursor)
    if (view === "daily") next.setDate(next.getDate() + direction)
    else if (view === "weekly") next.setDate(next.getDate() + direction * 7)
    else {
      next.setDate(1)
      next.setMonth(next.getMonth() + direction)
    }
    setCursor(next)
  }

  return <Card>
    <CardHeader className="flex min-w-0 flex-row flex-nowrap items-center justify-between gap-2">
      <div className="min-w-0"><CardTitle className="whitespace-nowrap">Production timeline</CardTitle><CardDescription className="truncate">{rangeLabel} · Scheduled and running production</CardDescription></div>
      <div className="flex shrink-0 flex-nowrap items-center gap-2">
        <div className="hidden items-center gap-1 sm:flex">
          <Button type="button" size="xs" variant="outline" onClick={() => setCursor(new Date())}>Today</Button>
          <Button type="button" size="icon-xs" variant="outline" aria-label="Previous period" onClick={() => moveCursor(-1)}><ArrowLeftIcon /></Button>
          <Button type="button" size="icon-xs" variant="outline" aria-label="Next period" onClick={() => moveCursor(1)}><ArrowRightIcon /></Button>
        </div>
        <div className="flex flex-nowrap gap-1" aria-label="Timeline date range">
          {(["daily", "weekly", "monthly"] as const).map((value) => <Button key={value} type="button" size="xs" variant={view === value ? "default" : "outline"} aria-pressed={view === value} onClick={() => setView(value)}>{capitalize(value)}</Button>)}
        </div>
      </div>
    </CardHeader>
    <CardContent className="grid gap-3">
      {visiblePlans.length ? <ChartContainer config={chartConfig} className="w-full aspect-auto" style={{ height: Math.max(220, Math.min(560, visiblePlans.length * 48 + 52)) }}>
        <BarChart data={visiblePlans} layout="vertical" margin={{ top: 8, right: 16, bottom: 8, left: 4 }} barCategoryGap="35%">
          <CartesianGrid horizontal={false} />
          <XAxis type="number" dataKey="offset" domain={[0, rangeMs]} ticks={timelineTicks(rangeMs, view)} orientation="top" tickFormatter={(offset) => formatTimelineTick(new Date(range.start.getTime() + Number(offset)), view)} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={150} interval={0} tickLine={false} axisLine={false} />
          <ChartTooltip content={({ active, payload }) => {
            const plan = payload?.find((item) => item.dataKey === "duration")?.payload as TimelinePoint | undefined
            return active && plan ? <div className="grid gap-1 rounded-lg border bg-background px-3 py-2 text-xs shadow-xl">
              <span className="font-medium">{plan.label}</span>
              <span>{formatDate(plan.startDate)} – {formatDate(plan.endDate)}</span>
              <span>{plan.status === "In Production" ? "In production" : "Scheduled"} · {plan.machine}</span>
            </div> : null
          }} />
          <Bar dataKey="offset" stackId="timeline" fill="transparent" isAnimationActive={false} tooltipType="none" />
          <Bar dataKey="duration" stackId="timeline" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {visiblePlans.map((plan) => <Cell key={plan.id} fill={plan.status === "In Production" ? "var(--color-running)" : "var(--color-scheduled)"} />)}
          </Bar>
        </BarChart>
      </ChartContainer> : <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No scheduled production in this date range.</p>}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-sm bg-(--color-scheduled)" />Scheduled</span>
        <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-sm bg-(--color-running)" />In production</span>
      </div>
      {unscheduledOrders.length ? <div className="border-t pt-3">
        <p className="mb-2 text-sm font-medium">Active jobs without a start date</p>
        <div className="flex flex-wrap gap-2">{unscheduledOrders.map((plan) => <Badge key={plan.id} variant="outline">{requests.find((item) => item.id === plan.rfqId)?.product ?? plan.rfqId} · {plan.status}</Badge>)}</div>
      </div> : null}
    </CardContent>
  </Card>
}

function timelineRange(cursor: Date, view: Period) {
  if (view === "daily") {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())
    return { start, end: addDays(start, 1) }
  }
  if (view === "weekly") {
    const start = startOfWeek(cursor)
    return { start, end: addDays(start, 7) }
  }
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  return { start, end: new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1) }
}

function timelineTicks(rangeMs: number, view: Period) {
  const count = view === "daily" ? 6 : view === "weekly" ? 7 : 6
  return Array.from({ length: count + 1 }, (_, index) => Math.round(rangeMs * index / count))
}

function formatTimelineTick(date: Date, view: Period) {
  return view === "daily"
    ? date.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("id-ID", { day: "numeric", month: "short" })
}

function startOfWeek(date: Date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  result.setDate(result.getDate() - (result.getDay() + 6) % 7)
  return result
}

function addDays(date: Date, days: number) {
  const result = new Date(date)
  result.setDate(result.getDate() + days)
  return result
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function formatDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year!, month! - 1, day!).toLocaleDateString("id-ID", { day: "numeric", month: "short" })
}

function queueRank(status: ProductionOrder["status"]) {
  return status === "In Production" ? 0 : status === "Scheduled" ? 1 : status === "Preparing Production" ? 2 : 3
}

function capitalize(value: string) {
  return value[0]!.toUpperCase() + value.slice(1)
}
