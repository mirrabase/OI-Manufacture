"use client"

import { useMemo, useState } from "react"
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ArrowUpRightIcon,
  BoxesIcon,
  CalendarClockIcon,
  FileTextIcon,
  GaugeIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import {
  customers,
  demoDate,
  equipment,
  findCustomer,
  findEquipment,
  findMaterial,
  formatIDR,
  insights,
  materials,
  orders,
  productionJobs,
  quotationCost,
  quotationPrice,
  quotations,
  rfqs,
} from "@/lib/mock/manufacturer"

type PageKey = "dashboard" | "rfqs" | "quotations" | "orders" | "production" | "materials" | "equipment" | "customers" | "analytics" | "settings"
type DataRow = Record<string, string | number>

const pageInfo: Record<PageKey, { title: string; description: string }> = {
  dashboard: { title: "Overview", description: "A clear view of today’s manufacturing workload and decisions." },
  rfqs: { title: "RFQ Inbox", description: "Review customer requests and assess whether each part is ready to quote." },
  quotations: { title: "Quotations", description: "Track estimated costs, customer approvals, and quote validity." },
  orders: { title: "Orders", description: "Follow accepted work from confirmation through delivery." },
  production: { title: "Production", description: "Plan the production queue against scheduled machine capacity." },
  materials: { title: "Materials", description: "Monitor filament and resin inventory for upcoming work." },
  equipment: { title: "Equipment", description: "Review machine capabilities and planned workload." },
  customers: { title: "Customers", description: "Manage customer relationships and manufacturing history." },
  analytics: { title: "Analytics", description: "Review demo quotation, production, and business performance." },
  settings: { title: "Settings", description: "Configure local workspace defaults for this prototype." },
}

const money = formatIDR
const customerName = (id: string) => findCustomer(id)?.company ?? id
const machineName = (id: string) => findEquipment(id)?.name ?? id
const materialName = (id: string) => findMaterial(id)?.name ?? id

const rfqRows: DataRow[] = rfqs.map((item) => ({
  "RFQ ID": item.id,
  Customer: customerName(item.customerId),
  Product: item.product,
  "File Type": (item.file.split(" · ")[0] ?? item.file).split(".").at(-1)?.toUpperCase() ?? "CAD",
  Quantity: item.quantity,
  "Requested Material": materialName(item.materialId),
  "Received Date": item.received,
  "Feasibility Status": item.feasibility,
  "Risk Level": item.risk,
}))

const quoteRows: DataRow[] = quotations.map((quote) => ({
  "Quotation Number": quote.id,
  Customer: customerName(quote.customerId),
  "Related RFQ": quote.rfqId,
  Product: quote.product,
  Quantity: quote.quantity,
  "Estimated Cost": money(quotationCost(quote)),
  "Quoted Price": money(quotationPrice(quote)),
  Margin: `${quote.marginPercent}%`,
  "Valid Until": quote.validUntil,
  Status: quote.status,
}))

const orderRows: DataRow[] = orders.map((order) => ({
  "Order Number": order.id,
  Customer: customerName(order.customerId),
  Product: order.product,
  Quantity: order.quantity,
  Material: materialName(order.materialId),
  "Assigned Equipment": machineName(order.equipmentId),
  "Order Date": order.orderDate,
  "Due Date": order.dueDate,
  "Production Status": order.status,
}))

const jobRows: DataRow[] = productionJobs.map((job) => {
  const order = orders.find((item) => item.id === job.orderId)
  return {
    "Job ID": job.id,
    Order: job.orderId,
    Product: order?.product ?? "Unlinked job",
    Equipment: machineName(job.equipmentId),
    Material: materialName(job.materialId),
    "Estimated Duration": `${job.duration}h`,
    "Scheduled Start": job.start,
    "Scheduled End": job.end,
    Status: job.status,
  }
})

const materialRows: DataRow[] = materials.map((material) => ({
  Material: material.name,
  Category: material.category,
  Manufacturer: material.manufacturer,
  "Unit Cost": `${money(material.unitCost)} / kg`,
  "Available Stock": `${(material.stock - material.reserved).toFixed(1)} kg`,
  "Reserved Stock": `${material.reserved.toFixed(1)} kg`,
  "Reorder Threshold": `${material.reorderAt} kg`,
  Status: material.stock - material.reserved <= material.reorderAt ? "Low stock" : "In stock",
}))

const equipmentRows: DataRow[] = equipment.map((machine) => ({
  "Machine ID": machine.id,
  "Machine Name": machine.name,
  Manufacturer: machine.manufacturer,
  Model: machine.model,
  Technology: machine.technology,
  "Build Volume": machine.buildVolume,
  "Compatible Materials": machine.materials.join(", "),
  "Hourly Cost": `${money(machine.hourlyCost)} / h`,
  "Working Hours": `${machine.workingHours}h / day`,
  "Scheduled Capacity": `${machine.scheduledHours}h scheduled · ${machine.workingHours - machine.scheduledHours}h available`,
  Status: machine.status,
}))

const customerRows: DataRow[] = customers.map((customer) => {
  const customerRfqs = rfqs.filter((item) => item.customerId === customer.id)
  const customerOrders = orders.filter((item) => item.customerId === customer.id)
  const totalValue = customerOrders.reduce((total, order) => {
    const quote = quotations.find((item) => item.id === order.quotationId)
    return total + (quote ? quotationPrice(quote) : 0)
  }, 0)
  return {
    "Customer Name": customer.name,
    Company: customer.company,
    Email: customer.email,
    "Total RFQs": customerRfqs.length,
    "Total Orders": customerOrders.length,
    "Total Order Value": money(totalValue),
    "Last Activity": customerRfqs[0]?.received ?? "2026-10-03",
  }
})

const tableRows: Partial<Record<PageKey, DataRow[]>> = {
  rfqs: rfqRows,
  quotations: quoteRows,
  orders: orderRows,
  production: jobRows,
  materials: materialRows,
  equipment: equipmentRows,
  customers: customerRows,
}

function getTableTabs(page: PageKey, rows: DataRow[]) {
  const statusKey = page === "rfqs" ? "Feasibility Status" : page === "orders" ? "Production Status" : "Status"
  const all = { value: "all", label: page === "rfqs" ? "All RFQs" : "All", matches: (_row: DataRow) => true }
  const byStatus = (value: string, label = value) => ({ value, label, matches: (row: DataRow) => row[statusKey] === value })
  const group = (value: string, label: string, statuses: string[]) => ({ value, label, matches: (row: DataRow) => statuses.includes(String(row[statusKey])) })

  if (page === "rfqs") return [
    all,
    { value: "analysis", label: "Awaiting Analysis", matches: (row: DataRow) => ["Received", "Analyzing"].includes(String(row[statusKey])) },
    byStatus("Needs Review"),
    byStatus("Feasible", "Ready for Quotation"),
  ]
  if (page === "quotations") return [all, byStatus("Draft"), group("awaiting", "Awaiting Approval", ["Pending Review", "Sent"]), byStatus("Accepted"), group("closed", "Closed", ["Rejected", "Expired"])]
  if (page === "orders") return [all, group("awaiting", "Awaiting Production", ["Confirmed", "Queued"]), byStatus("In Production"), byStatus("Quality Check"), group("completed", "Completed", ["Completed", "Delivered"]), byStatus("Cancelled")]
  if (page === "production") return [all, byStatus("Queued"), byStatus("Running"), byStatus("Quality Check", "Quality Check"), byStatus("Delayed"), byStatus("Completed")]
  if (page === "materials") return [all, byStatus("Low stock"), byStatus("In stock")]
  if (page === "equipment") return [all, byStatus("Available"), byStatus("Scheduled"), byStatus("Maintenance"), byStatus("Offline")]
  if (page === "customers") return [
    all,
    { value: "active", label: "Active", matches: (row: DataRow) => Number(row["Total RFQs"]) + Number(row["Total Orders"]) > 0 },
    { value: "returning", label: "Returning", matches: (row: DataRow) => Number(row["Total RFQs"]) + Number(row["Total Orders"]) > 1 },
  ]

  return [all, ...[...new Set(rows.map((row) => String(row[statusKey] ?? "")))].filter(Boolean).map((value) => byStatus(value))]
}

const metrics: Record<PageKey, { label: string; value: string; note?: string }[]> = {
  dashboard: [
    { label: "Pending RFQs", value: `${rfqs.filter((item) => ["Received", "Analyzing", "Needs Review"].includes(item.feasibility)).length}`, note: "2 need technical review" },
    { label: "Pending Quotations", value: "2", note: "1 awaiting customer approval" },
    { label: "Active Orders", value: "4", note: "2 in production" },
    { label: "Scheduled Available Capacity", value: "15h", note: "Across 3 available FDM machines" },
  ],
  rfqs: [
    { label: "Total RFQs", value: `${rfqs.length}`, note: "Received this month" },
    { label: "Awaiting Analysis", value: "2", note: "Sample analysis queue" },
    { label: "Needs Review", value: `${rfqs.filter((item) => item.feasibility === "Needs Review").length}`, note: "Technical decision required" },
    { label: "Ready for Quotation", value: `${rfqs.filter((item) => item.feasibility === "Feasible").length}`, note: "Sample feasibility status" },
  ],
  quotations: [
    { label: "Draft Quotations", value: `${quotations.filter((item) => item.status === "Draft").length}` },
    { label: "Awaiting Approval", value: `${quotations.filter((item) => item.status === "Pending Review" || item.status === "Sent").length}` },
    { label: "Accepted", value: `${quotations.filter((item) => item.status === "Accepted").length}` },
    { label: "Total Quoted Value", value: money(quotations.reduce((sum, quote) => sum + quotationPrice(quote), 0)) },
  ],
  orders: [
    { label: "Total Active Orders", value: `${orders.filter((order) => !["Completed", "Delivered", "Cancelled"].includes(order.status)).length}` },
    { label: "In Production", value: `${orders.filter((order) => order.status === "In Production").length}` },
    { label: "Awaiting Production", value: `${orders.filter((order) => order.status === "Queued" || order.status === "Confirmed").length}` },
    { label: "Completed Orders", value: `${orders.filter((order) => order.status === "Completed" || order.status === "Delivered").length}` },
  ],
  production: [
    { label: "Scheduled Jobs", value: `${productionJobs.length}` },
    { label: "Running Jobs", value: `${productionJobs.filter((job) => job.status === "Running").length}` },
    { label: "Scheduled Available Capacity", value: `${equipment.reduce((total, machine) => total + machine.workingHours - machine.scheduledHours, 0)}h` },
    { label: "Delayed Jobs", value: `${productionJobs.filter((job) => job.status === "Delayed").length}` },
  ],
  materials: [
    { label: "Total Materials", value: `${materials.length}` },
    { label: "Low Stock Items", value: `${materials.filter((material) => material.stock - material.reserved <= material.reorderAt).length}` },
    { label: "Inventory Value", value: money(materials.reduce((sum, material) => sum + material.stock * material.unitCost, 0)) },
    { label: "Active Material Types", value: "5 filament · 1 resin" },
  ],
  equipment: [
    { label: "Total Equipment", value: `${equipment.length}` },
    { label: "Available Equipment", value: `${equipment.filter((machine) => machine.status === "Available").length}` },
    { label: "Scheduled Equipment", value: `${equipment.filter((machine) => machine.scheduledHours > 0).length}` },
    { label: "Maintenance Required", value: `${equipment.filter((machine) => machine.status === "Maintenance").length}` },
  ],
  customers: [
    { label: "Total Customers", value: `${customers.length}` },
    { label: "Active Customers", value: "5" },
    { label: "Returning Customers", value: "3" },
    { label: "Outstanding Quotations", value: "3" },
  ],
  analytics: [
    { label: "RFQ Volume", value: `${rfqs.length}`, note: "Demo period: October 2026" },
    { label: "Quote Acceptance Rate", value: "67%", note: "2 of 3 decided quotes" },
    { label: "Average Quotation Value", value: money(Math.round(quotations.reduce((sum, quote) => sum + quotationPrice(quote), 0) / quotations.length)) },
    { label: "Accepted Order Value", value: money(orders.reduce((sum, order) => sum + (quotations.find((quote) => quote.id === order.quotationId) ? quotationPrice(quotations.find((quote) => quote.id === order.quotationId)!) : 0), 0)) },
  ],
  settings: [],
}

const workload = [
  { day: "Mon", scheduled: 21, available: 37 },
  { day: "Tue", scheduled: 27, available: 31 },
  { day: "Wed", scheduled: 24, available: 34 },
  { day: "Thu", scheduled: 32, available: 26 },
  { day: "Fri", scheduled: 29, available: 29 },
  { day: "Sat", scheduled: 16, available: 24 },
]

function StatusBadge({ value }: { value: string }) {
  const variant = ["Feasible", "Accepted", "Available", "Completed", "Delivered", "In stock"].includes(value)
    ? "default"
    : ["Rejected", "Delayed", "Maintenance", "Low stock", "High", "Urgent"].includes(value)
      ? "destructive"
      : "secondary"
  return <Badge variant={variant} className="whitespace-nowrap">{value}</Badge>
}

function Metrics({ page }: { page: PageKey }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics[page].map((metric) => (
        <Card key={metric.label} size="sm" className="min-w-0">
          <CardHeader className="pb-1">
            <CardDescription>{metric.label}</CardDescription>
            <CardTitle className="truncate text-xl tabular-nums">{metric.value}</CardTitle>
          </CardHeader>
          {metric.note ? <CardContent className="text-xs text-muted-foreground">{metric.note}</CardContent> : null}
        </Card>
      ))}
    </div>
  )
}

function RecordsTable({ page, rows, onSelect, showStatusTabs = true }: { page: PageKey; rows: DataRow[]; onSelect: (row: DataRow) => void; showStatusTabs?: boolean }) {
  const [query, setQuery] = useState("")
  const [activeTab, setActiveTab] = useState("all")
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: page === "rfqs" ? "Received Date" : Object.keys(rows[0] ?? {})[0] ?? "", direction: "desc" })
  const tabs = getTableTabs(page, rows)
  const selectedTab = tabs.find((tab) => tab.value === activeTab) ?? tabs[0]!
  const visibleRows = rows.filter((row) => {
    const matchesQuery = Object.values(row).some((value) => String(value).toLowerCase().includes(query.toLowerCase()))
    return matchesQuery && selectedTab.matches(row)
  }).sort((left, right) => {
    if (!sort.key) return 0
    const a = left[sort.key] ?? ""
    const b = right[sort.key] ?? ""
    const comparison = typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true })
    return sort.direction === "asc" ? comparison : -comparison
  })
  const columns = Object.keys(rows[0] ?? {})
  const sortOptions = page === "rfqs" ? ["Received Date", "Customer", "Quantity", "Risk Level"] : columns.slice(0, 4)

  const table = (
    <div className="min-w-0">
      <div className="mb-3 flex w-full min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search records..." className="h-8 pl-8" />
          </div>
          <Select value={sort.key || sortOptions[0]} onValueChange={(value) => setSort((current) => ({ ...current, key: String(value ?? sortOptions[0]) }))}>
            <SelectTrigger className="h-8 w-40 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>{sortOptions.map((column) => <SelectItem key={column} value={column}>{column}</SelectItem>)}</SelectContent>
          </Select>
          <Button type="button" variant="outline" size="icon-sm" className="shrink-0" aria-label={sort.direction === "desc" ? "Sort descending" : "Sort ascending"} title={sort.direction === "desc" ? "Sort descending" : "Sort ascending"} onClick={() => setSort((current) => ({ ...current, direction: current.direction === "desc" ? "asc" : "desc" }))}>{sort.direction === "desc" ? <ArrowDownIcon /> : <ArrowUpIcon />}</Button>
      </div>
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
        {visibleRows.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">No records match this search.</div> : <Table>
          <TableHeader><TableRow>{columns.map((column) => <TableHead key={column}><button type="button" className="text-left hover:text-foreground" onClick={() => setSort((current) => ({ key: column, direction: current.key === column && current.direction === "asc" ? "desc" : "asc" }))}>{column}{sort.key === column ? (sort.direction === "asc" ? " ↑" : " ↓") : null}</button></TableHead>)}</TableRow></TableHeader>
          <TableBody>{visibleRows.map((row, index) => <TableRow key={`${String(row[columns[0] ?? "id"])}-${index}`} className="cursor-pointer" onClick={() => onSelect(row)}>{columns.map((column) => <TableCell key={column} className="max-w-64 truncate">{column.toLowerCase().includes("status") || column === "Risk Level" ? <StatusBadge value={String(row[column])} /> : row[column]}</TableCell>)}</TableRow>)}</TableBody>
        </Table>}
      </div>
    </div>
  )

  if (!showStatusTabs) return table
  return <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value ?? "all"))} className="gap-3">
    <TabsList variant="line" className="h-auto min-h-10 w-full flex-wrap justify-start gap-x-1 gap-y-0 overflow-visible rounded-none border-b p-0">
      {tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className="flex-none gap-1.5 px-3">{tab.label}<span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{rows.filter(tab.matches).length}</span></TabsTrigger>)}
    </TabsList>
    <TabsContent value={activeTab}>{table}</TabsContent>
  </Tabs>
}

function CapacityChart() {
  return (
    <Card>
      <CardHeader><CardTitle>Production Capacity &amp; Workload</CardTitle><CardDescription>Scheduled hours compared with available hours · demo schedule</CardDescription></CardHeader>
      <CardContent className="h-64 pr-4">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={workload}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
            <XAxis dataKey="day" tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={36} />
            <Tooltip contentStyle={{ background: "var(--popover)", borderColor: "var(--border)", borderRadius: 8 }} />
            <Area dataKey="scheduled" name="Scheduled hours" type="monotone" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.2} />
            <Area dataKey="available" name="Available hours" type="monotone" stroke="var(--chart-2)" fill="var(--chart-2)" fillOpacity={0.12} />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}

function Overview() {
  return (
    <>
      <CapacityChart />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(18rem,1fr)]">
        <Card className="min-w-0">
          <CardHeader><CardTitle>Orders Requiring Attention</CardTitle><CardDescription>Deadlines and current production status</CardDescription></CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow>{["Order ID", "Customer", "Product", "Assigned Machine", "Due Date", "Status", "Priority"].map((title) => <TableHead key={title}>{title}</TableHead>)}</TableRow></TableHeader>
              <TableBody>{orders.slice(0, 4).map((order) => <TableRow key={order.id}>
                <TableCell>{order.id}</TableCell><TableCell>{customerName(order.customerId)}</TableCell><TableCell className="max-w-48 truncate">{order.product}</TableCell><TableCell>{machineName(order.equipmentId)}</TableCell><TableCell>{order.dueDate}</TableCell><TableCell><StatusBadge value={order.status} /></TableCell><TableCell><StatusBadge value={order.priority} /></TableCell>
              </TableRow>)}</TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Operational Insights</CardTitle><CardDescription>Static sample recommendations</CardDescription></CardHeader>
          <CardContent className="gap-4">
            {insights.map((insight) => <div key={insight.kind} className="flex gap-3"><span className="mt-0.5 text-muted-foreground">{insight.kind === "Capacity" ? <GaugeIcon className="size-4" /> : insight.kind === "Materials" ? <BoxesIcon className="size-4" /> : insight.kind === "Quotations" ? <FileTextIcon className="size-4" /> : <CalendarClockIcon className="size-4" />}</span><div className="min-w-0"><p className="text-sm font-medium">{insight.title}</p><p className="text-xs text-muted-foreground">{insight.detail}</p></div></div>)}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function ProductionViews({ onSelect }: { onSelect: (row: DataRow) => void }) {
  return <div className="space-y-3"><Card><CardHeader className="pb-2"><CardTitle className="text-base">Capacity recommendation</CardTitle><CardDescription>Inferred from scheduled jobs and standard working hours · demo only</CardDescription></CardHeader><CardContent><p className="text-sm">Printer B has 5 scheduled available production hours today and supports PETG.</p></CardContent></Card><Tabs defaultValue="queue" className="gap-3">
    <TabsList><TabsTrigger value="queue">Production Queue</TabsTrigger><TabsTrigger value="schedule">Equipment Schedule</TabsTrigger></TabsList>
    <TabsContent value="queue"><RecordsTable page="production" rows={jobRows} onSelect={onSelect} /></TabsContent>
    <TabsContent value="schedule"><div className="grid gap-3 lg:grid-cols-2">{equipment.map((machine) => <Card key={machine.id}><CardHeader className="pb-2"><div className="flex items-start justify-between gap-2"><div><CardTitle>{machine.name}</CardTitle><CardDescription>{machine.manufacturer} {machine.model} · {machine.technology}</CardDescription></div><StatusBadge value={machine.status} /></div></CardHeader><CardContent><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>{machine.scheduledHours}h scheduled</span><span>{machine.workingHours - machine.scheduledHours}h available</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, machine.scheduledHours / machine.workingHours * 100)}%` }} /></div><p className="mt-3 text-xs text-muted-foreground">Compatible materials: {machine.materials.join(", ")}</p></CardContent></Card>)}</div></TabsContent>
  </Tabs></div>
}

function Analytics() {
  return <div className="grid gap-3 xl:grid-cols-2"><CapacityChart />
    <Card><CardHeader><CardTitle>Quotation Status Distribution</CardTitle><CardDescription>Six sample quotations</CardDescription></CardHeader><CardContent className="space-y-3">{["Draft", "Pending Review", "Sent", "Accepted", "Rejected", "Expired"].map((status) => { const amount = quotations.filter((quote) => quote.status === status).length; return <div key={status} className="grid grid-cols-[7rem_1fr_2rem] items-center gap-3 text-sm"><span>{status}</span><div className="h-2 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${amount / quotations.length * 100}%` }} /></div><span className="text-right tabular-nums text-muted-foreground">{amount}</span></div> })}</CardContent></Card>
    <Card><CardHeader><CardTitle>Business Performance</CardTitle><CardDescription>Mock values derived from quotation records</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Quoted value</p><p className="text-base font-semibold">{money(quotations.reduce((sum, quote) => sum + quotationPrice(quote), 0))}</p></div><div><p className="text-xs text-muted-foreground">Accepted order value</p><p className="text-base font-semibold">{money(orders.reduce((sum, order) => { const quote = quotations.find((item) => item.id === order.quotationId); return sum + (quote ? quotationPrice(quote) : 0) }, 0))}</p></div><div><p className="text-xs text-muted-foreground">Top materials by sample jobs</p><p className="text-base font-semibold">PETG and PLA · 2 jobs each</p></div><div><p className="text-xs text-muted-foreground">Top customers by RFQ volume</p><p className="text-base font-semibold">AeroMotion and Karya Medika · 2 each</p></div></CardContent></Card>
    <Card><CardHeader><CardTitle>Production Performance</CardTitle><CardDescription>Scheduled capacity and sample jobs</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2"><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Scheduled utilization</p><p className="text-base font-semibold">{Math.round(equipment.reduce((sum, machine) => sum + machine.scheduledHours, 0) / equipment.reduce((sum, machine) => sum + machine.workingHours, 0) * 100)}%</p></div><div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Estimated production hours</p><p className="text-base font-semibold">{productionJobs.reduce((sum, job) => sum + job.duration, 0)}h</p></div>{["Queued", "Running", "Quality Check", "Completed", "Delayed"].map((status) => <div key={status} className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{status}</p><p className="text-base font-semibold">{productionJobs.filter((job) => job.status === status).length} jobs</p></div>)}</CardContent></Card>
  </div>
}

function EquipmentViews({ onSelect }: { onSelect: (row: DataRow) => void }) {
  const [activeTab, setActiveTab] = useState("all")
  const tabs = getTableTabs("equipment", equipmentRows)
  const selectedTab = tabs.find((tab) => tab.value === activeTab) ?? tabs[0]!
  const filteredRows = equipmentRows.filter(selectedTab.matches)
  const visibleEquipment = equipment.filter((machine) => filteredRows.some((row) => row["Machine ID"] === machine.id))

  return <Tabs value={activeTab} onValueChange={(value) => setActiveTab(String(value ?? "all"))} className="gap-3">
    <TabsList variant="line" className="h-auto min-h-10 w-full flex-wrap justify-start gap-x-1 gap-y-0 overflow-visible rounded-none border-b p-0">{tabs.map((tab) => <TabsTrigger key={tab.value} value={tab.value} className="flex-none gap-1.5 px-3">{tab.label}<span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{equipmentRows.filter(tab.matches).length}</span></TabsTrigger>)}</TabsList>
    <TabsContent value={activeTab}><Tabs defaultValue="table" className="gap-3">
    <TabsList><TabsTrigger value="table">Table view</TabsTrigger><TabsTrigger value="cards">Card view</TabsTrigger></TabsList>
    <TabsContent value="table"><RecordsTable page="equipment" rows={filteredRows} onSelect={onSelect} showStatusTabs={false} /></TabsContent>
    <TabsContent value="cards"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{visibleEquipment.map((machine) => <Card key={machine.id} className="cursor-pointer" onClick={() => onSelect(equipmentRows.find((row) => row["Machine ID"] === machine.id) ?? {})}>
      <CardHeader><div className="flex items-start justify-between gap-2"><div><CardTitle>{machine.name}</CardTitle><CardDescription>{machine.manufacturer} {machine.model}</CardDescription></div><StatusBadge value={machine.status} /></div></CardHeader>
      <CardContent className="gap-2 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Technology</span><span>{machine.technology}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Build volume</span><span>{machine.buildVolume}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Scheduled capacity</span><span>{machine.scheduledHours}h / {machine.workingHours}h</span></div><p className="pt-1 text-xs text-muted-foreground">{machine.materials.join(" · ")}</p></CardContent>
    </Card>)}</div></TabsContent>
  </Tabs></TabsContent>
  </Tabs>
}

function SettingsPage() {
  const [saved, setSaved] = useState(false)
  return <div className="grid gap-3 xl:grid-cols-2">{[
    { title: "General", icon: Settings2Icon, fields: [["Workspace Name", "OI Manufacturing"], ["Company Name", "OI Manufacture Indonesia"], ["Currency", "IDR · Indonesian Rupiah"], ["Timezone", "Asia/Jakarta"]] },
    { title: "Manufacturing Defaults", icon: ActivityIcon, fields: [["Default Process", "FDM 3D Printing"], ["Default Material", "PLA"], ["Standard Working Hours", "08:00–17:00"], ["Default Lead Time", "7 business days"]] },
    { title: "Pricing Configuration", icon: ArrowUpRightIcon, fields: [["Default Margin", "30%"], ["Labor Hourly Rate", "Rp 45.000"], ["Overhead Percentage", "12%"], ["Minimum Order Value", "Rp 150.000"]] },
    { title: "Quotation Preferences", icon: FileTextIcon, fields: [["Quotation Validity", "14 days"], ["Quotation Prefix", "QT-{YYYY}-"], ["Default Terms", "50% deposit · balance before delivery"], ["Currency Display", "IDR"]] },
    { title: "Equipment Scheduling Defaults", icon: GaugeIcon, fields: [["Working Days", "Monday–Saturday"], ["Daily Working Hours", "08:00–18:00"], ["Scheduling Buffer", "10%"]] },
  ].map(({ title, icon: Icon, fields }) => <Card key={title}><CardHeader><CardTitle className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" />{title}</CardTitle><CardDescription>Local demo configuration</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="grid gap-1.5"><Label htmlFor={label}>{label}</Label><Input id={label} defaultValue={value} onChange={() => setSaved(false)} className="h-8" /></div>)}</CardContent></Card>)}<div className="flex items-center gap-3"><Button type="button" onClick={() => setSaved(true)}>Save local changes</Button><span className="text-xs text-muted-foreground">{saved ? "Changes held in this page session only." : "Nothing is sent to a backend."}</span></div></div>
}

function DetailSheet({ row, onClose }: { row: DataRow | null; onClose: () => void }) {
  const content = useMemo(() => {
    if (!row) return null
    const id = String(row["RFQ ID"] ?? row["Order Number"] ?? row["Quotation Number"] ?? row["Machine ID"] ?? row["Customer Name"] ?? row.Material ?? "Record")
    const relatedRfq = rfqs.find((item) => item.id === id)
    const relatedQuote = quotations.find((item) => item.id === id)
    const relatedOrder = orders.find((item) => item.id === id)
    const relatedMachine = equipment.find((item) => item.id === id)
    const relatedMaterial = materials.find((item) => item.name === row.Material)
    const relatedCustomer = customers.find((item) => item.company === row.Company)
    const details: string[][] = relatedRfq
      ? [
          ["Customer request", `${customerName(relatedRfq.customerId)} requested ${relatedRfq.quantity} units of ${relatedRfq.product}.`],
          ["Uploaded file", relatedRfq.file],
          ["Manufacturing requirements", `${materialName(relatedRfq.materialId)} · quantity ${relatedRfq.quantity} · sample FDM estimate`],
          ["Sample geometry estimate", `${relatedRfq.boundingBox} bounding box · ${relatedRfq.volume} volume · ${relatedRfq.complexity} complexity`],
          ["Technical feasibility", relatedRfq.notes],
          ["Sample recommendation", "Confirm orientation and tolerance requirements with the customer before final pricing."],
          ["Review status", relatedRfq.feasibility],
        ]
      : relatedQuote
        ? [
            ["Quotation summary", `${customerName(relatedQuote.customerId)} · ${relatedQuote.rfqId} · ${relatedQuote.product} · ${relatedQuote.quantity} units`],
            ["Status and validity", `${relatedQuote.status} · valid until ${relatedQuote.validUntil}`],
            ["Material cost", money(relatedQuote.materialCost)],
            ["Machine cost", money(relatedQuote.machineCost)],
            ["Labor cost", money(relatedQuote.laborCost)],
            ["Post-processing cost", money(relatedQuote.postProcessingCost)],
            ["Overhead", money(relatedQuote.overhead)],
            ["Estimated total cost", money(quotationCost(relatedQuote))],
            ["Margin and selling price", `${relatedQuote.marginPercent}% · ${money(quotationPrice(relatedQuote))}`],
            ["Manufacturing routing", "Preparation → Printing → Post-processing → Quality inspection"],
            ["Sample recommendation", "Printer C has capacity for this queue; confirm material compatibility and tolerance before sending."],
          ]
        : relatedOrder
          ? [
              ["Order summary", `${relatedOrder.product} · ${relatedOrder.quantity} units · ${relatedOrder.status}`],
              ["Customer", `${customerName(relatedOrder.customerId)} · ${findCustomer(relatedOrder.customerId)?.email ?? ""}`],
              ["Linked quotation", relatedOrder.quotationId],
              ["Production progress", `${relatedOrder.progress}% complete · sample estimate`],
              ["Assigned equipment", `${machineName(relatedOrder.equipmentId)} · ${findEquipment(relatedOrder.equipmentId)?.model ?? ""}`],
              ["Material requirements", `${materialName(relatedOrder.materialId)} · ${findMaterial(relatedOrder.materialId)?.stock ?? 0} kg stock on hand`],
              ["Estimated completion", relatedOrder.dueDate],
              ["Activity timeline", `${relatedOrder.orderDate}: order confirmed · ${relatedOrder.status}: current sample stage`],
            ]
          : relatedMachine
            ? [
                ["Specifications", `${relatedMachine.manufacturer} ${relatedMachine.model} · ${relatedMachine.technology}`],
                ["Build volume", relatedMachine.buildVolume],
                ["Supported materials", relatedMachine.materials.join(", ")],
                ["Operating rate", `${money(relatedMachine.hourlyCost)} per machine hour`],
                ["Scheduled workload", `${relatedMachine.scheduledHours}h of ${relatedMachine.workingHours}h working hours`],
                ["Available capacity", `${relatedMachine.workingHours - relatedMachine.scheduledHours} scheduled available hours · inferred from demo jobs`],
                ["Assigned production jobs", productionJobs.filter((job) => job.equipmentId === relatedMachine.id).map((job) => job.id).join(", ") || "No sample job assigned"],
                ["Recommendation", "This machine has sufficient sample capacity for the next compatible order."],
              ]
            : relatedMaterial
              ? [
                  ["Material", `${relatedMaterial.name} · ${relatedMaterial.category} · ${relatedMaterial.manufacturer}`],
                  ["Properties", relatedMaterial.properties],
                  ["Compatible equipment", relatedMaterial.compatibleEquipment.map(machineName).join(", ")],
                  ["Unit pricing", `${money(relatedMaterial.unitCost)} per kg`],
                  ["Inventory", `${relatedMaterial.stock} kg on hand · ${relatedMaterial.reserved} kg reserved · ${(relatedMaterial.stock - relatedMaterial.reserved).toFixed(1)} kg available`],
                  ["Reorder threshold", `${relatedMaterial.reorderAt} kg`],
                  ["Supplier", `${relatedMaterial.manufacturer} · sample supplier record`],
                  ["Contextual recommendation", "Material suggestions are sample guidance and are not engineering certification."],
                ]
              : relatedCustomer
                ? [
                    ["Customer profile", `${relatedCustomer.name} · ${relatedCustomer.company} · ${relatedCustomer.email}`],
                    ["Quotation history", quotations.filter((quote) => quote.customerId === relatedCustomer.id).map((quote) => quote.id).join(", ") || "No sample quotation"],
                    ["Order history", orders.filter((order) => order.customerId === relatedCustomer.id).map((order) => order.id).join(", ") || "No sample order"],
                    ["Frequently ordered materials", [...new Set(orders.filter((order) => order.customerId === relatedCustomer.id).map((order) => materialName(order.materialId)))].join(", ") || "No sample material"],
                    ["Recent activity", rfqs.filter((item) => item.customerId === relatedCustomer.id).map((item) => `${item.received}: ${item.id}`).join(" · ") || "No sample activity"],
                  ]
                : Object.entries(row).map(([key, value]) => [key, String(value)])
    return { id, details }
  }, [row])
  return <Sheet open={Boolean(row)} onOpenChange={(open) => !open && onClose()}><SheetContent className="w-[min(92vw,30rem)] overflow-y-auto sm:max-w-lg"><SheetHeader><SheetTitle>{content?.id}</SheetTitle><SheetDescription>Sample record details · demo data</SheetDescription></SheetHeader><div className="space-y-4 px-4 pb-6">{content?.details.map(([label, value]) => <div key={label} className="border-b pb-3"><p className="mb-1 text-xs font-medium text-muted-foreground">{label}</p><p className="text-sm">{value}</p></div>)}</div></SheetContent></Sheet>
}

export function WorkspacePage({ page }: { page: PageKey }) {
  const [selected, setSelected] = useState<DataRow | null>(null)
  const info = pageInfo[page]
  const rows = tableRows[page] ?? []
  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
    <div className="flex flex-wrap items-start justify-between gap-3 pt-1"><div><h1 className="text-xl font-semibold tracking-tight">{info.title}</h1><p className="mt-1 text-sm text-muted-foreground">{info.description}</p></div>{page === "analytics" ? <Badge variant="outline">Demo Data · Oct 2026</Badge> : null}{page === "rfqs" ? <Button type="button" variant="outline" size="sm" disabled title="File uploads are not part of this demo">New RFQ · demo only</Button> : null}</div>
    {!tableRows[page] && page !== "settings" ? <Metrics page={page} /> : null}
    {page === "dashboard" ? <Overview /> : null}
    {page === "production" ? <ProductionViews onSelect={setSelected} /> : null}
    {page === "analytics" ? <Analytics /> : null}
    {page === "settings" ? <SettingsPage /> : null}
    {page === "equipment" ? <EquipmentViews onSelect={setSelected} /> : null}
    {rows.length && page !== "equipment" && page !== "production" ? <RecordsTable page={page} rows={rows} onSelect={setSelected} /> : null}
    {page === "rfqs" ? <Card><CardHeader><CardTitle>Feasibility review guide</CardTitle><CardDescription>Values below are sample estimates, not CAD analysis results.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><div><p className="text-sm font-medium">Geometry</p><p className="text-xs text-muted-foreground">Bounding box, approximate model volume, and complexity appear in each RFQ detail.</p></div><div><p className="text-sm font-medium">Process suggestion</p><p className="text-xs text-muted-foreground">FDM is the initial assumed process for compatible filament requests.</p></div><div><p className="text-sm font-medium">Technical review</p><p className="text-xs text-muted-foreground">Confirm tolerances, orientation, and functional requirements before quoting.</p></div></CardContent></Card> : null}
    {page === "quotations" ? <Card><CardHeader><CardTitle>Quotation detail preview</CardTitle><CardDescription>Sample recommendation: PETG can be a tougher alternative to PLA when the part needs more impact resistance.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">Material</p><p className="text-sm font-medium">{money(518400)}</p></div><div><p className="text-xs text-muted-foreground">Machine + labor</p><p className="text-sm font-medium">{money(770400)}</p></div><div><p className="text-xs text-muted-foreground">Cost + 32% margin</p><p className="text-sm font-medium">{money(quotationPrice(quotations[0]!))}</p></div><Button variant="outline" size="sm" disabled title="No PDF generator is connected">Download PDF · demo only</Button></CardContent></Card> : null}
    {page === "materials" ? <Card><CardHeader><CardTitle>Material recommendation</CardTitle><CardDescription>Contextual sample suggestion, not an engineering certification.</CardDescription></CardHeader><CardContent><p className="text-sm">PETG may be a suitable alternative to PLA for applications requiring greater toughness. Confirm operating conditions and part requirements before selecting a material.</p></CardContent></Card> : null}
    {page === "equipment" ? <Card><CardHeader><CardTitle>Capacity note</CardTitle><CardDescription>Availability is inferred from sample scheduled jobs and working hours, not live telemetry.</CardDescription></CardHeader><CardContent><p className="text-sm">Printer C has 7 scheduled available production hours today and supports PLA, PETG, ABS, and ASA.</p></CardContent></Card> : null}
    {page === "customers" ? <Card><CardHeader><CardTitle>Customer activity</CardTitle><CardDescription>History is linked to the shared RFQ, quotation, and order sample records.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3"><p className="text-sm">3 returning customer accounts</p><p className="text-sm">Most active: AeroMotion Indonesia</p><p className="text-sm">Latest demo activity: {demoDate}</p></CardContent></Card> : null}
    {page === "orders" ? <Card><CardHeader><CardTitle>Order progress</CardTitle><CardDescription>Production progress is a fixed sample estimate.</CardDescription></CardHeader><CardContent className="grid gap-3 sm:grid-cols-3">{orders.slice(0, 3).map((order) => <div key={order.id} className="rounded-lg border p-3"><div className="mb-2 flex justify-between text-sm"><span>{order.id}</span><span>{order.progress}%</span></div><div className="h-1.5 rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${order.progress}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{order.status} · due {order.dueDate}</p></div>)}</CardContent></Card> : null}
    <DetailSheet row={selected} onClose={() => setSelected(null)} />
  </main>
}
