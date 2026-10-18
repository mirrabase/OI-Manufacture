"use client"

import { useMemo, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  SearchIcon,
} from "lucide-react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
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
  materials,
  orders,
  productionJobs,
  quotationCost,
  quotationPrice,
  quotations,
  rfqs,
} from "@/lib/mock/manufacturer"
import { LiveWorkspace } from "./live-workspace"
import { CustomerWorkspace } from "./customer-workspace"
import { InventoryWorkspace } from "./inventory-workspace"
import { OrganizationSettings } from "./organization-settings"

type PageKey = "dashboard" | "requests" | "rfqs" | "quotations" | "orders" | "production" | "materials" | "equipment" | "customers" | "settings"
type DataRow = Record<string, string | number>

const pageInfo: Record<PageKey, { title: string; description: string }> = {
  dashboard: { title: "Overview", description: "A clear view of today’s manufacturing workload and decisions." },
  requests: { title: "Requests", description: "Track customer requests from price review through production." },
  rfqs: { title: "RFQ Inbox", description: "Review customer requests and assess whether each part is ready to quote." },
  quotations: { title: "Quotations", description: "Track estimated costs, customer approvals, and quote validity." },
  orders: { title: "Orders", description: "Paid customer requests move into production orders here." },
  production: { title: "Production", description: "Review paid customer requests that are ready for production." },
  materials: { title: "Materials", description: "Monitor filament and resin inventory for upcoming work." },
  equipment: { title: "Equipment", description: "Review machine capabilities and planned workload." },
  customers: { title: "Customers", description: "Manage customer relationships and manufacturing history." },
  settings: { title: "Settings", description: "Configure local workspace defaults for this prototype." },
}

const money = formatIDR
const customerName = (id: string) => findCustomer(id)?.company ?? id
const machineName = (id: string) => findEquipment(id)?.name ?? id
const materialName = (id: string) => findMaterial(id)?.name ?? id

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

const tableRows: Partial<Record<PageKey, DataRow[]>> = {
  materials: materialRows,
  equipment: equipmentRows,
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
  if (page === "materials") return [all, byStatus("Low stock"), byStatus("In stock")]
  if (page === "equipment") return [all, byStatus("Available"), byStatus("Scheduled"), byStatus("Maintenance"), byStatus("Offline")]
  return [all, ...[...new Set(rows.map((row) => String(row[statusKey] ?? "")))].filter(Boolean).map((value) => byStatus(value))]
}

const metrics: Partial<Record<PageKey, { label: string; value: string; note?: string }[]>> = {
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
  settings: [],
}

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
      {metrics[page]?.map((metric) => (
        <Card key={metric.label} size="sm" className="min-w-0">
          <CardHeader>
            <CardDescription className="text-xs font-normal">{metric.label}</CardDescription>
            <CardTitle className="truncate text-xl font-semibold tabular-nums">{metric.value}</CardTitle>
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
  if (page === "dashboard" || page === "requests") return <LiveWorkspace key={page} page={page} />
  if (page === "materials" || page === "equipment") return <InventoryWorkspace page={page} />
  if (page === "customers") return <CustomerWorkspace />
  if (page === "settings") return <OrganizationSettings />
  return <DemoWorkspacePage page={page} />
}

function DemoWorkspacePage({ page }: { page: PageKey }) {
  const [selected, setSelected] = useState<DataRow | null>(null)
  const info = pageInfo[page]
  const rows = tableRows[page] ?? []
  return <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
    <div><h1 className="text-xl font-semibold">{info.title}</h1><p className="mt-1 text-sm text-muted-foreground">{info.description}</p><Badge variant="outline" className="mt-2">Demo data · not connected to customer requests</Badge></div>
    <Metrics page={page} />
    {page === "equipment" ? <EquipmentViews onSelect={setSelected} /> : null}
    {rows.length > 0 && page !== "equipment" ? <RecordsTable page={page} rows={rows} onSelect={setSelected} /> : null}
    <DetailSheet row={selected} onClose={() => setSelected(null)} />
  </main>
}
