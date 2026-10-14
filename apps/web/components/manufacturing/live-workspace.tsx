"use client"

import Link from "next/link"
import { useEffect, useState, type ReactNode } from "react"
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from "lucide-react"
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
import { downloadModel, listenToManufacturerRequests, requestEstimate, setCustomerRequestPaid, setCustomerRequestQuote } from "@/lib/firebase/customer-requests"
import { formatIDR, type CustomerRFQ } from "@/lib/customer-portal"
import { EstimatePanel } from "@/components/customer/estimate-panel"

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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [selectedId, setSelectedId] = useState("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  useEffect(() => listenToManufacturerRequests((rows) => { setRequests(rows); setLoading(false); setError("") }, (cause) => { setError(cause.message); setLoading(false) }), [])
  const submitted = requests.filter((request) => request.status === "Submitted")
  const quotations = requests.filter((request) => request.quoteTotal)
  const orders = requests.filter((request) => request.status === "In Production" && request.paymentStatus === "Paid")
  const pricedRequests = requests.filter((request) => (
    (request.status === "Submitted" && request.estimate?.status === "ready" && typeof request.estimate.total === "number")
    || (request.status === "Quoted" && Number.isSafeInteger(request.quoteTotal) && (request.quoteTotal ?? 0) > 0)
    || (request.status === "In Production" && request.paymentStatus === "Paid" && Number.isSafeInteger(request.quoteTotal) && (request.quoteTotal ?? 0) > 0)
  ))
  const records = requests.filter((request) => (status === "all" || request.status === status) && `${request.id} ${request.product} ${request.customer.name} ${request.customer.email}`.toLowerCase().includes(search.toLowerCase()))
  const selected = requests.find((request) => request.id === selectedId)
  return <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
    <div><h1 className="text-xl font-semibold">{page === "dashboard" ? "Overview" : "Requests"}</h1><p className="mt-1 text-sm text-muted-foreground">{useFirebaseEmulator ? "Firebase Emulator · local simulation" : "Live manufacturing requests"} · follow requests from price review through production.</p></div>
    {loading ? <p role="status" className="text-sm">Loading requests…</p> : error ? <p role="alert" className="text-sm text-destructive">Could not load requests: {error}</p> : page === "requests" ? <RequestsView requests={pricedRequests} onReview={setSelectedId} /> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
        ["Awaiting review", String(submitted.length)],
        ["Unpaid quotations", String(quotations.filter((request) => request.paymentStatus !== "Paid").length)],
        ["In Production", String(orders.length)],
        ["Final quoted value", formatIDR(quotations.reduce((sum, request) => sum + (request.quoteTotal ?? 0), 0))],
      ].map(([label, value]) => <Card key={label} size="sm"><CardHeader><CardDescription>{label}</CardDescription><CardTitle>{value}</CardTitle></CardHeader></Card>)}</div>
      <div className="flex flex-wrap gap-3"><Input aria-label="Search customer requests" placeholder="Search requests…" className="max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} /><label className="flex items-center gap-2 text-sm">Status<select className="rounded-md border bg-background p-2" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All</option><option value="Submitted">Submitted</option><option value="Quoted">Quoted</option><option value="In Production">In Production</option></select></label></div>
      <RequestTable requests={records} onReview={setSelectedId} />
    </>}
    {selected ? <RequestReview key={selected.id} request={selected} onClose={() => setSelectedId("")} /> : null}
  </section>
}

function RequestsView({ requests, onReview }: { requests: RequestRecord[]; onReview: (id: string) => void }) {
  const [stage, setStage] = useState("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "Request", direction: "desc" })
  const stages = [
    { value: "all", label: "All requests", matches: (_request: RequestRecord) => true },
    { value: "review", label: "Needs review", matches: (request: RequestRecord) => request.status === "Submitted" },
    { value: "payment", label: "Awaiting payment", matches: (request: RequestRecord) => request.status === "Quoted" },
    { value: "production", label: "In production", matches: (request: RequestRecord) => request.status === "In Production" },
  ]
  const selectedStage = stages.find((item) => item.value === stage) ?? stages[0]!
  const visibleRequests = requests.filter((request) => selectedStage.matches(request) && `${request.id} ${request.product} ${request.customer.name} ${request.customer.email}`.toLowerCase().includes(search.toLowerCase())).sort((left, right) => {
    const a = getRequestSortValue(left, sort.key)
    const b = getRequestSortValue(right, sort.key)
    const result = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))
    return sort.direction === "asc" ? result : -result
  })
  const columns = ["Request", "Customer", "Product", "Quantity", "Estimate", "Final quote", "Status"]
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
          {visibleRequests.length === 0 ? <div className="p-8 text-center text-sm text-muted-foreground">{search ? "No records match this search." : "Requests appear here after the automatic price estimate is ready."}</div> : <Table>
            <TableHeader><TableRow>{columns.map((column) => <TableHead key={column}><button type="button" className="text-left hover:text-foreground" onClick={() => setSort((current) => ({ key: column, direction: current.key === column && current.direction === "asc" ? "desc" : "asc" }))}>{column}{sort.key === column ? (sort.direction === "asc" ? " ↑" : " ↓") : null}</button></TableHead>)}</TableRow></TableHeader>
            <TableBody>{visibleRequests.map((request) => <TableRow key={request.id} className="cursor-pointer" onClick={() => onReview(request.id)}>
              <TableCell className="max-w-64 truncate" title={request.id}>{request.id}</TableCell>
              <TableCell className="max-w-64 truncate">{request.customer.name}</TableCell>
              <TableCell className="max-w-64 truncate">{request.product}</TableCell>
              <TableCell>{request.requirements.quantity}</TableCell>
              <TableCell>{request.estimate?.status === "ready" ? formatIDR(request.estimate.total ?? 0) : "—"}</TableCell>
              <TableCell>{request.quoteTotal ? formatIDR(request.quoteTotal) : "Not quoted"}</TableCell>
              <TableCell><Badge variant={request.status === "In Production" ? "default" : "secondary"}>{request.status}{request.status === "Quoted" ? " · Unpaid" : request.status === "In Production" ? " · Paid" : ""}</Badge></TableCell>
            </TableRow>)}</TableBody>
          </Table>}
        </div>
      </div>
    </TabsContent>
  </Tabs>
}

function getRequestSortValue(request: RequestRecord, key: string): string | number {
  switch (key) {
    case "Customer": return request.customer.name
    case "Product": return request.product
    case "Quantity": return request.requirements.quantity
    case "Estimate": return request.estimate?.total ?? 0
    case "Final quote": return request.quoteTotal ?? 0
    case "Status": return request.status
    default: return request.id
  }
}

function RequestTable({ requests, onReview }: { requests: RequestRecord[]; onReview: (id: string) => void }) {
  return <Card><CardContent>{requests.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow>{["Request", "Customer", "Product", "Quantity", "Estimate", "Final quote", "Status", "Review"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{requests.map((request) => <TableRow key={request.id}><TableCell className="max-w-52 truncate" title={request.id}>{request.id}</TableCell><TableCell>{request.customer.name}</TableCell><TableCell>{request.product}</TableCell><TableCell>{request.requirements.quantity}</TableCell><TableCell>{request.estimate?.status === "ready" ? formatIDR(request.estimate.total ?? 0) : "—"}</TableCell><TableCell>{request.quoteTotal ? formatIDR(request.quoteTotal) : "Not quoted"}</TableCell><TableCell><Badge variant={request.status === "In Production" ? "default" : "secondary"}>{request.status}{request.status === "Quoted" ? " · Unpaid" : request.status === "In Production" ? " · Paid" : ""}</Badge></TableCell><TableCell><Button type="button" variant="outline" size="sm" onClick={() => onReview(request.id)}>Review</Button></TableCell></TableRow>)}</TableBody></Table></div> : <p className="py-8 text-center text-sm text-muted-foreground">No requests in this view.</p>}</CardContent></Card>
}

function RequestReview({ request, onClose }: { request: RequestRecord; onClose: () => void }) {
  const [amount, setAmount] = useState(String(request.quoteTotal ?? request.estimate?.total ?? ""))
  const [action, setAction] = useState("")
  const [error, setError] = useState("")
  useEffect(() => { if (request.quoteTotal) setAmount(String(request.quoteTotal)) }, [request.quoteTotal])
  useEffect(() => { if (request.estimate?.total) setAmount((current) => current || String(request.estimate?.total)) }, [request.estimate?.total])
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
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}><SheetContent className="data-[side=right]:w-[min(96vw,42rem)] overflow-y-auto data-[side=right]:sm:max-w-2xl"><SheetHeader><SheetTitle>{request.product}</SheetTitle><SheetDescription>{request.id}</SheetDescription></SheetHeader><div className="grid gap-4 px-4 pb-6">
    {details.map(([label, value]) => <div key={label} className="border-b pb-2"><p className="text-xs text-muted-foreground">{label}</p><p className="break-words text-sm">{value}</p></div>)}
    <Button variant="outline" disabled={Boolean(action)} onClick={() => void run("download", () => downloadModel(request.model.storagePath, request.model.name, true))}>{action === "download" ? "Preparing STL…" : "Download customer STL"}</Button>
    <EstimatePanel request={request} asManufacturer />
    {!paid ? <Button variant="outline" disabled={Boolean(action) || calculating} onClick={() => void run("estimate", () => requestEstimate(request.id))}>{calculating ? "Calculating…" : "Recalculate estimate with current settings"}</Button> : null}
    <Card><CardHeader><CardTitle>Final quotation</CardTitle><CardDescription>Review the sliced result, orientation, tolerances, and customer notes before publishing.</CardDescription></CardHeader><CardContent className="grid gap-3"><label className="grid gap-1.5 text-sm">Total quotation (IDR)<Input type="number" min="1" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={paid || Boolean(action)} /></label><Button disabled={paid || Boolean(action) || !Number.isSafeInteger(Number(amount)) || Number(amount) < 1} onClick={() => void run("quote", () => setCustomerRequestQuote(request.id, Number(amount)))}>{action === "quote" ? "Saving…" : request.quoteTotal ? "Update final quotation" : "Publish final quotation"}</Button><p className="text-xs text-muted-foreground">Saved quotation: {request.quoteTotal ? formatIDR(request.quoteTotal) : "Not published"}. Customer sees this amount immediately. Payment is coordinated outside the portal.</p></CardContent></Card>
    <Card><CardHeader><CardTitle>Payment: {paid ? "Paid" : request.quoteTotal ? "Unpaid" : "No final quotation yet"}</CardTitle></CardHeader><CardContent>{paid ? <p className="text-sm">Payment confirmed · this request is in the In production tab.</p> : request.status === "Quoted" && request.quoteTotal ? <Button disabled={Boolean(action)} onClick={() => void run("payment", () => setCustomerRequestPaid(request.id))}>{action === "payment" ? "Confirming…" : "Confirm payment received · start production"}</Button> : <p className="text-sm text-muted-foreground">Publish the final quotation before confirming payment.</p>}</CardContent></Card>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div></SheetContent></Sheet>
}
