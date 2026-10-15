"use client"

import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"
import { AlertTriangleIcon, ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
import { onAuthStateChanged } from "firebase/auth"
import { doc, getDoc } from "firebase/firestore"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { manufacturerAuth, manufacturerDb, useFirebaseEmulator } from "@/lib/firebase/client"
import { downloadModel, listenToManufacturerRequests, requestEstimate, setCustomerRequestQuote } from "@/lib/firebase/customer-requests"
import { formatIDR, type CustomerRFQ } from "@/lib/customer-portal"
import { EstimatePanel } from "@/components/customer/estimate-panel"
import { getProductionReadiness, type EquipmentRecord, type MaterialRecord, type ProductionOrder } from "@/lib/manufacturing-operations"
import {
  completeProduction,
  confirmRequestPayment,
  listenToEquipment,
  listenToMaterials,
  listenToProductionOrders,
  scheduleProduction,
  startProduction,
  unscheduleProduction,
  updateProductionOrder,
} from "@/lib/firebase/operations"

type RequestRecord = CustomerRFQ & { id: string }

export function ManufacturerAccess({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<"loading" | "allowed" | "denied">("loading")
  const [error, setError] = useState("")
  useEffect(() => {
    let current = 0
    const unsubscribe = onAuthStateChanged(manufacturerAuth, (user) => {
      const generation = ++current
      setAccess("loading")
      if (!user) { setAccess("denied"); return }
      void getDoc(doc(manufacturerDb, "manufacturers", user.uid)).then((snapshot) => {
        if (generation === current) setAccess(snapshot.data()?.active === true ? "allowed" : "denied")
      }).catch((cause) => { if (generation === current) { setError(cause.message); setAccess("denied") } })
    })
    return () => { current++; unsubscribe() }
  }, [])
  if (access === "loading") return <section className="p-6 text-sm text-muted-foreground">Checking Manufacturer access…</section>
  if (access === "denied") return <section className="grid max-w-xl gap-4 p-6"><h1 className="text-xl font-semibold">Manufacturer sign-in required</h1><p className="text-sm text-muted-foreground">Sign in with an active Manufacturer account to review customer requests and manage pricing.</p>{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<Button render={<Link href="/login" />}>{useFirebaseEmulator ? "Open local Manufacturer login" : "Sign in"}</Button></section>
  return children
}

export function LiveWorkspace({ page }: { page: "dashboard" | "requests" }) {
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [materials, setMaterials] = useState<MaterialRecord[]>([])
  const [equipment, setEquipment] = useState<EquipmentRecord[]>([])
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  useEffect(() => {
    const errorHandler = (cause: Error) => setError(cause.message)
    const stops = [
      listenToManufacturerRequests((rows) => { setRequests(rows); setLoading(false); setError("") }, (cause) => { setError(cause.message); setLoading(false) }),
      listenToMaterials(setMaterials, errorHandler),
      listenToEquipment(setEquipment, errorHandler),
      listenToProductionOrders(setProductionOrders, errorHandler),
    ]
    return () => stops.forEach((stop) => stop())
  }, [])
  const submitted = requests.filter((request) => request.status === "Submitted")
  const quotations = requests.filter((request) => request.quoteTotal)
  const orders = requests.filter((request) => ["Preparing Production", "In Production"].includes(request.status) && request.paymentStatus === "Paid")
  const needsAttention = productionOrders.filter((plan) => plan.status === "Preparing Production").filter((plan) => {
    const request = requests.find((item) => item.id === plan.id)
    return request && !getProductionReadiness(request, plan, materials, equipment).ready
  })
  const records = requests.filter((request) => (status === "all" || request.status === status) && `${request.id} ${request.product} ${request.customer.name} ${request.customer.email}`.toLowerCase().includes(search.toLowerCase()))
  const selected = requests.find((request) => request.id === selectedId)
  return <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
    <div><h1 className="text-xl font-semibold">{page === "dashboard" ? "Overview" : "Requests"}</h1><p className="mt-1 text-sm text-muted-foreground">Review customer requests and track production.</p></div>
    {loading ? <p role="status" className="text-sm">Loading requests…</p> : error ? <p role="alert" className="text-sm text-destructive">Could not load requests: {error}</p> : page === "requests" ? <RequestsView requests={requests} productionOrders={productionOrders} materials={materials} equipment={equipment} onReview={setSelectedId} /> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Awaiting review", String(submitted.length)],
        ["Unpaid quotations", String(quotations.filter((request) => request.paymentStatus !== "Paid").length)],
        ["Preparing production", String(orders.filter((request) => request.status === "Preparing Production").length)],
        ["Needs attention", String(needsAttention.length)],
        ["In Production", String(orders.filter((request) => request.status === "In Production").length)],
        ["Final quoted value", formatIDR(quotations.reduce((sum, request) => sum + (request.quoteTotal ?? 0), 0))],
      ].map(([label, value]) => <Card key={label} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>)}</div>
      <div className="flex flex-wrap gap-3"><Input aria-label="Search customer requests" placeholder="Search requests…" className="max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} /><label className="flex items-center gap-2 text-sm">Status<select className="rounded-md border bg-background p-2" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="Submitted">Submitted</option><option value="Quoted">Quoted</option><option value="Preparing Production">Preparing Production</option><option value="In Production">In Production</option><option value="Completed">Completed</option></select></label></div>
      <RequestTable requests={records} onReview={setSelectedId} />
    </>}
    {selected ? <RequestReview key={selected.id} request={selected} materials={materials} equipment={equipment} plan={productionOrders.find((item) => item.id === selected.id)} onClose={() => setSelectedId("")} /> : null}
  </section>
}

function RequestsView({ requests, productionOrders, materials, equipment, onReview }: { requests: RequestRecord[]; productionOrders: ProductionOrder[]; materials: MaterialRecord[]; equipment: EquipmentRecord[]; onReview: (id: string) => void }) {
  const [stage, setStage] = useState("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "Request", direction: "desc" })
  const stages = [
    { value: "all", label: "All requests", matches: (_request: RequestRecord) => true },
    { value: "review", label: "Needs review", matches: (request: RequestRecord) => request.status === "Submitted" },
    { value: "payment", label: "Awaiting payment", matches: (request: RequestRecord) => request.status === "Quoted" },
    { value: "preparing", label: "Preparing production", matches: (request: RequestRecord) => request.status === "Preparing Production" },
    { value: "production", label: "In production", matches: (request: RequestRecord) => request.status === "In Production" },
    { value: "completed", label: "Completed", matches: (request: RequestRecord) => request.status === "Completed" },
  ]
  const selectedStage = stages.find((item) => item.value === stage) ?? stages[0]!
  const visibleRequests = requests.filter((request) => selectedStage.matches(request) && `${request.id} ${request.product} ${request.customer.name} ${request.customer.email}`.toLowerCase().includes(search.toLowerCase())).sort((left, right) => {
    const a = getRequestSortValue(left, sort.key, productionOrders, materials, equipment)
    const b = getRequestSortValue(right, sort.key, productionOrders, materials, equipment)
    const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))
    return sort.direction === "asc" ? result : -result
  })
  const columns = ["Request", "Customer", "Product", "Quantity", "Estimate", "Final quote", "Status", "Production readiness"]
  return <Tabs value={stage} onValueChange={(value) => setStage(String(value ?? "all"))} className="gap-3">
    <TabsList variant="line" className="h-auto min-h-10 w-full flex-wrap justify-start gap-x-1 gap-y-0 overflow-visible rounded-none border-b p-0">{stages.map((item) => <TabsTrigger key={item.value} value={item.value} className="flex-none gap-1.5 px-3">{item.label}<span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{requests.filter(item.matches).length}</span></TabsTrigger>)}</TabsList>
    <TabsContent value={stage} className="gap-3">
      <div className="min-w-0">
        <div className="mb-3 flex w-full min-w-0 items-center gap-2">
          <div className="relative min-w-0 flex-1"><SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search requests" placeholder="Search requests..." className="h-8 pl-8" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <Select value={sort.key} onValueChange={(value) => setSort((current) => ({ ...current, key: String(value ?? "Request") }))}>
          <SelectTrigger className="h-8 w-40 shrink-0"><SelectValue /></SelectTrigger>
          <SelectContent>{columns.map((field) => <SelectItem key={field} value={field}>{field}</SelectItem>)}</SelectContent>
        </Select>
        <Button type="button" variant="outline" size="icon-sm" className="shrink-0" aria-label={sort.direction === "desc" ? "Sort descending" : "Sort ascending"} title={sort.direction === "desc" ? "Sort descending" : "Sort ascending"} onClick={() => setSort((current) => ({ ...current, direction: current.direction === "desc" ? "asc" : "desc" }))}>{sort.direction === "desc" ? <ArrowDownIcon /> : <ArrowUpIcon />}</Button>
        </div>
        <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
          {visibleRequests.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{search ? "No records match this search." : "Customer requests appear here after submission."}</div> : <Table>
            <TableHeader><TableRow>{columns.map((column) => <TableHead key={column}><button type="button" className="text-left hover:text-foreground" onClick={() => setSort((current) => ({ key: column, direction: current.key === column && current.direction === "asc" ? "desc" : "asc" }))}>{column}{sort.key === column ? (sort.direction === "asc" ? " ↑" : " ↓") : null}</button></TableHead>)}</TableRow></TableHeader>
            <TableBody>{visibleRequests.map((request) => <TableRow key={request.id} className="cursor-pointer" onClick={() => onReview(request.id)}>
              <TableCell className="max-w-64 truncate" title={request.id}>{request.id}</TableCell>
              <TableCell className="max-w-64 truncate">{request.customer.name}</TableCell>
              <TableCell className="max-w-64 truncate">{request.product}</TableCell>
              <TableCell>{request.requirements.quantity}</TableCell>
              <TableCell>{request.estimate?.status === "ready" ? formatIDR(request.estimate.total ?? 0) : "—"}</TableCell>
              <TableCell>{request.quoteTotal ? formatIDR(request.quoteTotal) : "Not quoted"}</TableCell>
              <TableCell><Badge variant={request.status === "In Production" || request.status === "Completed" ? "default" : "secondary"}>{request.status}{request.status === "Quoted" ? " · Unpaid" : request.paymentStatus === "Paid" ? " · Paid" : ""}</Badge></TableCell>
              <TableCell>{productionReadinessLabel(request, productionOrders, materials, equipment)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>}
        </div>
      </div>
    </TabsContent>
  </Tabs>
}

function getRequestSortValue(request: RequestRecord, key: string, plans: ProductionOrder[], materials: MaterialRecord[], equipment: EquipmentRecord[]): string | number {
  switch (key) {
    case "Customer": return request.customer.name
    case "Product": return request.product
    case "Quantity": return request.requirements.quantity
    case "Estimate": return request.estimate?.total ?? 0
    case "Final quote": return request.quoteTotal ?? 0
    case "Status": return request.status
    case "Production readiness": return productionReadinessLabel(request, plans, materials, equipment)
    default: return request.id
  }
}

function RequestTable({ requests, onReview }: { requests: RequestRecord[]; onReview: (id: string) => void }) {
  return <Card><CardContent>{requests.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Request", "Customer", "Product", "Quantity", "Estimate", "Final quote", "Status", "Review"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{requests.map((request) => <TableRow key={request.id}><TableCell className="max-w-52 truncate" title={request.id}>{request.id}</TableCell><TableCell>{request.customer.name}</TableCell><TableCell>{request.product}</TableCell><TableCell>{request.requirements.quantity}</TableCell><TableCell>{request.estimate?.status === "ready" ? formatIDR(request.estimate.total ?? 0) : request.estimate?.status === "unsupported" || request.estimate?.status === "failed" ? "Manual review" : "—"}</TableCell><TableCell>{request.quoteTotal ? formatIDR(request.quoteTotal) : "Not quoted"}</TableCell><TableCell><Badge variant={request.status === "In Production" || request.status === "Completed" ? "default" : "secondary"}>{request.status}{request.status === "Quoted" ? " · Unpaid" : request.paymentStatus === "Paid" ? " · Paid" : ""}</Badge></TableCell><TableCell><Button type="button" variant="outline" size="sm" onClick={() => onReview(request.id)}>Review</Button></TableCell></TableRow>)}</TableBody></Table></div> : <p className="py-8 text-center text-sm text-muted-foreground">No requests in this view.</p>}</CardContent></Card>
}

function productionReadinessLabel(request: RequestRecord, plans: ProductionOrder[], materials: MaterialRecord[], equipment: EquipmentRecord[]) {
  const plan = plans.find((item) => item.id === request.id)
  if (request.paymentStatus !== "Paid") return "—"
  if (!plan) return "Plan unavailable"
  if (plan.status === "Scheduled") return "Scheduled"
  if (plan.status === "In Production") return "In production"
  if (plan.status === "Completed") return "Completed"
  const readiness = getProductionReadiness(request, plan, materials, equipment)
  return readiness.ready ? "Ready to schedule" : readiness.blockers[0] ?? "Needs review"
}

function RequestReview({ request, materials, equipment, plan, onClose }: { request: RequestRecord; materials: MaterialRecord[]; equipment: EquipmentRecord[]; plan?: ProductionOrder; onClose: () => void }) {
  const [amount, setAmount] = useState(String(request.quoteTotal ?? request.estimate?.total ?? ""))
  const [action, setAction] = useState("")
  const [error, setError] = useState("")
  const [materialId, setMaterialId] = useState("")
  const [equipmentId, setEquipmentId] = useState("")
  const [plannedGrams, setPlannedGrams] = useState("")
  const [plannedHours, setPlannedHours] = useState("")
  const [actualGrams, setActualGrams] = useState("")
  useEffect(() => { if (request.quoteTotal) setAmount(String(request.quoteTotal)) }, [request.quoteTotal])
  useEffect(() => { if (request.estimate?.total) setAmount((current) => current || String(request.estimate?.total)) }, [request.estimate?.total])
  useEffect(() => {
    if (!plan) return
    setMaterialId(plan.materialId)
    setEquipmentId(plan.equipmentId)
    setPlannedGrams(plan.plannedGrams ? String(plan.plannedGrams) : "")
    setPlannedHours(plan.plannedHours ? String(plan.plannedHours) : "")
    setActualGrams(plan.actualGrams ? String(plan.actualGrams) : String(plan.plannedGrams || ""))
  }, [plan])
  const paid = request.paymentStatus === "Paid"
  const calculating = request.estimate?.status === "processing" || (request.estimateRequestedAt ?? 0) > (request.estimate?.requestedAt ?? 0)
  async function run(name: string, operation: () => Promise<void>) {
    setAction(name); setError("")
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not complete this action.") } finally { setAction("") }
  }
  const details = [
    ["Customer", `${request.customer.name} · ${request.customer.email}`],
    ["Product", request.product], ["Status", `${request.status} · ${request.paymentStatus ?? "Unpaid"}`],
    ["Requirements", `${request.requirements.quantity} units · ${request.requirements.process} · ${request.requirements.material}`],
    ["Uploaded file", request.model.name], ["Dimensions", `${request.model.boundingBoxMm.map((value) => value.toFixed(1)).join(" × ")} mm · source units ${request.requirements.unit}`],
    ["Notes", request.requirements.notes || "No additional notes"],
  ]
  const plannedOrder = plan ? { ...plan, materialId, equipmentId, plannedGrams: Number(plannedGrams), plannedHours: Number(plannedHours) } : null
  const readiness = plannedOrder ? getProductionReadiness(request, plannedOrder, materials, equipment) : null
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}><SheetContent className="data-[side=right]:w-[min(96vw,42rem)] overflow-y-auto data-[side=right]:sm:max-w-2xl"><SheetHeader><SheetTitle>{request.product}</SheetTitle><SheetDescription>{request.id}</SheetDescription></SheetHeader><div className="grid gap-4 px-4 pb-6">
    {details.map(([label, value]) => <div key={label} className="border-b pb-2"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-sm">{value}</p></div>)}
    <Button variant="outline" disabled={Boolean(action)} onClick={() => void run("download", () => downloadModel(request.model.storagePath, request.model.name, true))}>{action === "download" ? "Preparing STL…" : "Download customer STL"}</Button>
    <EstimatePanel request={request} asManufacturer />
    {!paid ? <Button variant="outline" disabled={Boolean(action) || calculating} onClick={() => void run("estimate", () => requestEstimate(request.id))}>{calculating ? "Calculating…" : "Recalculate estimate with current settings"}</Button> : null}
    <Card><CardHeader><CardTitle>Final quotation</CardTitle><CardDescription>Review the sliced result, orientation, tolerances, and customer notes before publishing.</CardDescription></CardHeader><CardContent className="grid gap-3"><label className="grid gap-1.5 text-sm">Total quotation (IDR)<Input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={paid || Boolean(action) || Boolean(request.activeKaseraPaymentAttemptId)} /></label><Button disabled={paid || Boolean(action) || Boolean(request.activeKaseraPaymentAttemptId) || !Number.isSafeInteger(Number(amount)) || Number(amount) < 1} onClick={() => void run("quote", () => setCustomerRequestQuote(request.id, Number(amount)))}>{action === "quote" ? "Saving…" : request.quoteTotal ? "Update final quotation" : "Publish final quotation"}</Button><p className="text-xs text-muted-foreground">Saved quotation: {request.quoteTotal ? formatIDR(request.quoteTotal) : "Not published"}. Kasera adds its fee at checkout; quote changes are locked while checkout is pending.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Payment: {paid ? "Paid" : request.quoteTotal ? "Unpaid" : "No final quotation yet"}</CardTitle></CardHeader><CardContent className="grid gap-3">{request.paymentReviewRequired ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{request.paymentReviewReason || "Review this payment in Kasera before proceeding."}</p> : null}{paid ? <p className="text-sm">Payment confirmed · production is being prepared.</p> : request.status === "Quoted" && request.quoteTotal ? <><p className="text-sm text-muted-foreground">Customer can pay through Kasera. Use manual confirmation only for external payments you have verified. Manual confirmation is blocked while an active Kasera checkout is open.</p><Button disabled={Boolean(action)} onClick={() => void run("payment", () => confirmRequestPayment(request.id))}>{action === "payment" ? "Confirming…" : "Confirm external payment received"}</Button></> : <p className="text-sm text-muted-foreground">Publish the final quotation before confirming payment.</p>}</CardContent></Card>
    {paid ? <Card><CardHeader><CardTitle>Production plan</CardTitle><CardDescription>Resource blockers are only visible to the Manufacturer. Customers see a neutral production status.</CardDescription></CardHeader><CardContent className="grid gap-3">
      {!plan ? <p role="status" className="text-sm text-muted-foreground">Production plan is not available yet. Refresh this request after payment confirmation.</p> : <>
        <Badge variant={plan.status === "In Production" || plan.status === "Completed" ? "default" : "secondary"}>{plan.status}</Badge>
        {plan.status === "Preparing Production" ? <>
          <label className="grid gap-1.5 text-sm"><span>Material</span><Select value={materialId || "none"} onValueChange={(value) => setMaterialId(String(value ?? "none") === "none" ? "" : String(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select material</SelectItem>{materials.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {Math.max(0, item.stock - item.reserved).toFixed(3)} kg available</SelectItem>)}</SelectContent></Select></label>
          <label className="grid gap-1.5 text-sm"><span>Equipment</span><Select value={equipmentId || "none"} onValueChange={(value) => setEquipmentId(String(value ?? "none") === "none" ? "" : String(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Select equipment</SelectItem>{equipment.map((item) => <SelectItem key={item.id} value={item.id}>{item.name} · {item.status} · {item.technology}</SelectItem>)}</SelectContent></Select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm"><span>Planned filament (grams, total order)</span><Input type="number" min="0" step="0.001" value={plannedGrams} onChange={(event) => setPlannedGrams(event.target.value)} /></label><label className="grid gap-1.5 text-sm"><span>Planned machine time (hours, total order)</span><Input type="number" min="0" step="0.01" value={plannedHours} onChange={(event) => setPlannedHours(event.target.value)} /></label></div>
          {readiness?.blockers.length ? <div className="grid gap-1 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"><p className="flex items-center gap-2 font-medium"><AlertTriangleIcon className="size-4" /> Needs attention</p>{readiness.blockers.map((item) => <p key={item}>{item}</p>)}<Link className="text-primary underline" href="/-/materials">Open Materials and Purchasing</Link></div> : null}
          {readiness?.warnings.map((item) => <p key={item} className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm">{item}</p>)}
          <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(action)} onClick={() => void run("plan", () => updateProductionOrder(request.id, { materialId, equipmentId, plannedGrams: Number(plannedGrams || 0), plannedHours: Number(plannedHours || 0) }))}>{action === "plan" ? "Saving…" : "Save plan"}</Button><Button disabled={Boolean(action) || !readiness?.ready} onClick={() => void run("schedule", async () => { await updateProductionOrder(request.id, { materialId, equipmentId, plannedGrams: Number(plannedGrams), plannedHours: Number(plannedHours) }); await scheduleProduction(request.id, request) })}>{action === "schedule" ? "Scheduling…" : "Schedule and reserve stock"}</Button></div>
        </> : null}
        {plan.status === "Scheduled" ? <><p className="text-sm">{materials.find((item) => item.id === plan.materialId)?.name ?? "Material"}: {plan.reservedKg.toFixed(3)} kg reserved · {equipment.find((item) => item.id === plan.equipmentId)?.name ?? "Equipment"} assigned.</p><div className="flex flex-wrap gap-2"><Button variant="outline" disabled={Boolean(action)} onClick={() => void run("unschedule", () => unscheduleProduction(request.id))}>{action === "unschedule" ? "Releasing…" : "Unschedule"}</Button><Button disabled={Boolean(action)} onClick={() => void run("start", () => startProduction(request.id))}>{action === "start" ? "Starting…" : "Start production"}</Button></div></> : null}
        {plan.status === "In Production" ? <><p className="text-sm">{equipment.find((item) => item.id === plan.equipmentId)?.name ?? "Assigned machine"} · {materials.find((item) => item.id === plan.materialId)?.name ?? "Assigned material"} · {plan.plannedHours.toFixed(2)} hours planned.</p><label className="grid gap-1.5 text-sm"><span>Actual filament usage (grams)</span><Input type="number" min="0.001" step="0.001" value={actualGrams} onChange={(event) => setActualGrams(event.target.value)} /></label><Button disabled={Boolean(action) || !Number.isFinite(Number(actualGrams)) || Number(actualGrams) <= 0} onClick={() => void run("complete", () => completeProduction(request.id, Number(actualGrams)))}>{action === "complete" ? "Completing…" : "Complete production"}</Button></> : null}
        {plan.status === "Completed" ? <p className="text-sm">Production complete · {plan.actualGrams?.toFixed(3)} g consumed.</p> : null}
      </>}
    </CardContent></Card> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div></SheetContent></Sheet>
}
