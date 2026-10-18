"use client"

import Link from "next/link"
import dynamic from "next/dynamic"
import { useEffect, useMemo, useState } from "react"
import { onAuthStateChanged, signInAnonymously, type User } from "firebase/auth"
import { httpsCallable } from "firebase/functions"
import { ArrowLeftIcon, ArrowRightIcon, FileUpIcon, PlusIcon, UploadCloudIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { auth, functions } from "@/lib/firebase/client"
import { downloadModel, listenToCustomerRequests, submitCustomerRequest } from "@/lib/firebase/customer-requests"
import { formatIDR, type CustomerRFQ, type ManufacturingRequirements, type UploadedModelMetadata } from "@/lib/customer-portal"
import { readCustomerProfile, saveCustomerProfile } from "@/lib/customer-profile"
import { DEMO_ORGANIZATION_ID } from "@/lib/organization"

import { EstimatePanel } from "./estimate-panel"
import { QuoteShippingPanel } from "./quote-shipping-panel"

const ModelPreview = dynamic(() => import("./model-preview"), { ssr: false, loading: () => <div className="grid h-72 place-items-center rounded-xl bg-muted text-sm text-muted-foreground">Loading 3D preview…</div> })
const MAX_FILE_SIZE = 50 * 1024 * 1024

type Page = "home" | "quotes" | "new" | "quote-detail" | "orders" | "order-detail"
type RequestRecord = CustomerRFQ & { id: string }

function formatSize(bytes: number) { return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }

export function CustomerPortal({ page }: { page: Page }) {
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  useEffect(() => onAuthStateChanged(auth, (nextUser) => {
    if (nextUser) { setUser(nextUser); setAuthReady(true); return }
    void signInAnonymously(auth).catch((cause) => { setError(cause instanceof Error ? cause.message : "Could not start a guest session."); setAuthReady(true) })
  }), [])
  useEffect(() => {
    if (!user) { setRequests([]); return }
    return listenToCustomerRequests(user.uid, (rows) => { setRequests(rows); setLoading(false); setError("") }, (cause) => { setError(cause.message); setLoading(false) })
  }, [user])

  if (!authReady) return <main className="mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">Loading your workspace…</main>
  if (!user) return <main className="mx-auto max-w-xl px-4 py-16 text-center"><h1 className="text-xl font-semibold">Guest session unavailable</h1><p role="alert" className="mt-2 text-sm text-destructive">{error || "Could not connect to the request service."}</p></main>

  if (page === "new") return <QuoteWizard user={user!} />
  if (loading) return <main className="mx-auto max-w-6xl px-4 py-12 text-sm text-muted-foreground">Loading requests…</main>
  if (error) return <main className="mx-auto max-w-6xl px-4 py-12"><p role="alert" className="text-sm text-destructive">Could not load requests: {error}</p><Button className="mt-3" onClick={() => window.location.reload()}>Retry</Button></main>
  if (page === "quote-detail") return <QuoteDetail requests={requests} error={error} uid={user.uid} />
  if (page === "order-detail") return <OrderDetail requests={requests} />
  if (page === "quotes") return <QuotesPage requests={requests} error={error} />
  if (page === "orders") return <OrdersPage requests={requests} />
  return <HomePage user={user!} requests={requests} error={error} />
}

function Heading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-4"><div>{eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-primary">{eyebrow}</p> : null}<h1 className="mt-1 text-2xl font-semibold tracking-tight">{title}</h1>{detail ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{detail}</p> : null}</div>{action}</div>
}

function HomePage({ user, requests, error }: { user: User; requests: RequestRecord[]; error: string }) {
  const quotes = requests.filter((request) => request.quoteTotal)
  const orders = requests.filter((request) => ["Preparing Production", "In Production"].includes(request.status))
  return <main className="mx-auto flex max-w-6xl flex-col gap-7 px-4 py-8 sm:px-6"><Heading eyebrow="Customer workspace" title={user.isAnonymous ? "Your customer workspace" : `Hello, ${user.displayName?.split(" ")[0] || "there"}`} detail="Track your manufacturing requests and active orders." action={<Button render={<Link href="/portal/quotes/new" />}><PlusIcon /> Upload 3D model</Button>} />
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="grid gap-3 sm:grid-cols-3"><Metric label="Open requests" value={String(requests.filter((r) => r.status !== "Closed").length)} /><Metric label="Quotations" value={String(quotes.length)} /><Metric label="Active orders" value={String(orders.length)} /></div>
    <Card><CardHeader><CardTitle>Recent requests</CardTitle><CardDescription>Live updates from your RFQ inbox</CardDescription></CardHeader><CardContent className="grid gap-3">{requests.length ? requests.slice(0, 3).map((rfq) => <RequestRow key={rfq.id} request={rfq} />) : <Empty title="No requests yet" detail="Upload a 3D model to start a manufacturing request." action="Upload model" href="/portal/quotes/new" />}</CardContent></Card>
    <Card><CardHeader><CardTitle>Recent quotations</CardTitle></CardHeader><CardContent className="grid gap-3">{quotes.length ? quotes.slice(0, 3).map((request) => <RequestRow key={request.id} request={request} />) : <p className="text-sm text-muted-foreground">Automatic quotations appear after supported models finish slicing. Other requests need Manufacturer review.</p>}</CardContent></Card>
    <Card><CardHeader><CardTitle>Active orders</CardTitle></CardHeader><CardContent className="grid gap-3">{orders.length ? orders.slice(0, 3).map((request) => <Link key={request.id} href={`/portal/orders/detail?id=${encodeURIComponent(request.id)}`} className="rounded-lg border p-3 text-sm">{request.product} · {request.status} · Paid</Link>) : <p className="text-sm text-muted-foreground">Orders appear after the Manufacturer confirms payment.</p>}<Button render={<Link href="/portal/orders" />} variant="outline">View orders</Button></CardContent></Card>
  </main>
}

function Metric({ label, value }: { label: string; value: string }) { return <Card size="sm"><CardHeader className="pb-1"><CardDescription>{label}</CardDescription><CardTitle className="text-2xl">{value}</CardTitle></CardHeader></Card> }
function Empty({ title, detail, action, href }: { title: string; detail: string; action?: string; href?: string }) { return <div className="grid justify-items-center gap-2 rounded-xl border border-dashed p-8 text-center"><div className="grid size-10 place-items-center rounded-full bg-muted"><FileUpIcon className="size-4 text-muted-foreground" /></div><p className="text-sm font-medium">{title}</p><p className="max-w-sm text-sm text-muted-foreground">{detail}</p>{action && href ? <Button render={<Link href={href} />} size="sm" className="mt-2">{action}</Button> : null}</div> }
function RequestRow({ request }: { request: RequestRecord }) { return <Link href={`/portal/quotes/detail?id=${encodeURIComponent(request.id)}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 hover:bg-muted/40"><div className="min-w-0"><p className="truncate text-sm font-medium">{request.product}</p><p className="mt-1 text-xs text-muted-foreground">{request.id} · {request.requirements.quantity} units · {request.quoteTotal ? formatIDR(request.quoteTotal) : request.estimate?.total ? `Est. ${formatIDR(request.estimate.total)}` : "Calculating estimate"}</p></div><Badge variant="outline">{request.status}</Badge></Link> }
function QuotesPage({ requests, error }: { requests: RequestRecord[]; error: string }) {
  const [filter, setFilter] = useState("all")
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState("newest")
  const records = useMemo(() => requests.map((r) => ({ id: r.id, title: r.product, status: r.status, detail: `${r.requirements.quantity} units · RFQ${r.quoteTotal ? ` · ${formatIDR(r.quoteTotal)}` : r.estimate?.status === "ready" ? ` · est. ${formatIDR(r.estimate.total ?? 0)}` : ""}`, date: r.quotedAt ?? r.createdAt })).filter((item) => (filter === "all" || item.status.toLowerCase().includes(filter)) && `${item.id} ${item.title}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => sort === "name" ? a.title.localeCompare(b.title) : b.date - a.date), [requests, filter, search, sort])
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6"><Heading eyebrow="Workspace" title="Quotations" detail="Review your RFQs and customer quotation summaries." action={<Button render={<Link href="/portal/quotes/new" />}><PlusIcon /> New request</Button>} />{error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">Could not load customer requests: {error}</p> : null}<div className="flex flex-wrap gap-3"><Input className="max-w-sm" placeholder="Search requests…" aria-label="Search quotations" value={search} onChange={(e) => setSearch(e.target.value)} /><Select value={filter} onValueChange={(value) => setFilter(String(value ?? "all"))}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All statuses</SelectItem><SelectItem value="submitted">Submitted</SelectItem><SelectItem value="quoted">Quoted</SelectItem><SelectItem value="production">In Production</SelectItem></SelectContent></Select><Select value={sort} onValueChange={(value) => setSort(String(value ?? "newest"))}><SelectTrigger aria-label="Sort quotations" className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="newest">Recently updated</SelectItem><SelectItem value="name">Name A–Z</SelectItem></SelectContent></Select></div>{records.length ? <div className="grid gap-3 md:grid-cols-2">{records.map((item) => <Link key={item.id} href={`/portal/quotes/detail?id=${encodeURIComponent(item.id)}`} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:bg-muted/30"><div><p className="text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.id} · {item.detail}</p></div><Badge variant="outline">{item.status}</Badge></Link>)}</div> : <Empty title="No matching quotations" detail="Try a different search or create a new manufacturing request." action="Upload 3D model" href="/portal/quotes/new" />}</main>
}

function OrdersPage({ requests }: { requests: RequestRecord[] }) {
  const orders = requests.filter((request) => ["Preparing Production", "In Production", "Completed"].includes(request.status))
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6"><Heading eyebrow="Workspace" title="Orders" detail="Paid requests move here while production is being prepared and completed." />{orders.length ? <div className="grid gap-3">{orders.map((request) => <Link key={request.id} href={`/portal/orders/detail?id=${encodeURIComponent(request.id)}`} className="rounded-xl border bg-card p-4 hover:bg-muted/30"><p className="text-sm font-semibold">{request.product}</p><p className="mt-1 text-xs text-muted-foreground">{request.id} · {request.requirements.quantity} units · {formatIDR(request.quoteTotal ?? 0)}</p><Badge className="mt-2" variant="outline">{request.status} · Paid</Badge></Link>)}</div> : <Empty title="No active orders" detail="Your request will appear here after payment is confirmed." />}</main>
}

function QuoteDetail({ requests, error, uid }: { requests: RequestRecord[]; error: string; uid: string }) {
  const [id, setId] = useState("")
  const [fileError, setFileError] = useState("")
  const [downloading, setDownloading] = useState(false)
  const [paymentBusy, setPaymentBusy] = useState(false)
  const [paymentError, setPaymentError] = useState("")
  const [returnedFromPayment, setReturnedFromPayment] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setId(params.get("rfqId") || params.get("id") || "")
    setReturnedFromPayment(params.get("payment") === "return")
  }, [])
  const rfq = requests.find((request) => request.id === id)
  async function payWithKasera() {
    if (!rfq) return
    setPaymentBusy(true)
    setPaymentError("")
    try {
      const returnUrl = new URL(window.location.href)
      returnUrl.searchParams.delete("payment")
      returnUrl.searchParams.set("rfqId", rfq.id)
      returnUrl.searchParams.delete("id")
      const createCheckout = httpsCallable<{ rfqId: string; returnUrl: string }, { checkoutUrl: string }>(functions, "createKaseraCheckout")
      const result = await createCheckout({ rfqId: rfq.id, returnUrl: returnUrl.toString() })
      window.location.assign(result.data.checkoutUrl)
    } catch (cause) {
      setPaymentError(cause instanceof Error ? cause.message : "Kasera checkout could not be opened.")
      setPaymentBusy(false)
    }
  }
  const shippingCost = rfq?.shipping?.selection?.cost
  const totalDue = rfq?.quoteTotal !== undefined
    ? shippingCost !== undefined ? rfq.quoteTotal + shippingCost : rfq.paymentStatus === "Paid" ? rfq.quoteTotal : null
    : null
  const canPay = Boolean(rfq?.status === "Quoted" && rfq.quoteTotal !== undefined && rfq.quoteTotal > 0 && rfq.paymentStatus === "Unpaid" && rfq.shipping?.address && rfq.shipping.selection && !rfq.paymentReviewRequired && !rfq.activeKaseraPaymentAttemptId)
  return <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6">
    <Link href="/portal/quotes" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeftIcon className="size-4" /> Quotations</Link>
    {error && !rfq ? <p role="alert" className="text-sm text-destructive">Could not load your requests: {error}</p> : null}
    {rfq ? <>
      <Heading eyebrow={rfq.id} title={rfq.product} detail={`Submitted ${new Date(rfq.submittedAt ?? rfq.createdAt).toLocaleDateString("en-GB")}`} />
      <Card><CardHeader><CardTitle>Request details</CardTitle><CardDescription>Manufacturing requirements and uploaded file</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Detail label="Status" value={rfq.status} /><Detail label="Quantity" value={`${rfq.requirements.quantity} units`} /><Detail label="Material" value={`${rfq.requirements.material}${rfq.requirements.color ? ` · ${rfq.requirements.color}` : ""}${rfq.requirements.infillPercent !== undefined ? ` · ${rfq.requirements.infillPercent}% infill` : ""}`} /><Detail label="Process" value={rfq.requirements.process} /><Detail label="File" value={`${rfq.model.name} · ${formatSize(rfq.model.size)}`} /><Detail label="Bounding box" value={`${rfq.model.boundingBoxMm.map((x) => x.toFixed(1)).join(" × ")} mm`} />
        {rfq.quoteTotal !== undefined ? <>
          <Detail label="Manufacturing quotation" value={formatIDR(rfq.quoteTotal)} />
          <Detail label="Total due" value={totalDue === null ? `${formatIDR(rfq.quoteTotal)} + shipping` : formatIDR(totalDue)} />
          <Detail label="Payment" value={rfq.paymentStatus ?? "Unpaid"} />
          {rfq.paymentStatus !== "Paid" ? <div className="sm:col-span-2 grid gap-3 rounded-lg bg-muted/50 p-3">
            <p className="text-sm text-muted-foreground">The total includes manufacturing and the courier you choose below. Pay securely with Kasera; this page updates after Kasera confirms the payment.</p>
            {returnedFromPayment ? <p role="status" className="text-sm">Waiting for Kasera payment confirmation. This page will update automatically.</p> : null}
            {canPay ? <Button type="button" disabled={paymentBusy} onClick={() => void payWithKasera()}>{paymentBusy ? "Opening Kasera…" : `Pay ${formatIDR(totalDue!)} with Kasera`}</Button> : !rfq.paymentReviewRequired && !rfq.activeKaseraPaymentAttemptId ? <p className="text-sm font-medium">Add your delivery address and choose a courier below to see the final total and continue to payment.</p> : null}
            {rfq.activeKaseraPaymentAttemptId ? <p role="status" className="text-sm">Kasera checkout is already in progress. Finish or return from that payment page to continue.</p> : null}
            {paymentError ? <p role="alert" className="text-sm text-destructive">{paymentError}</p> : null}
          </div> : null}
        </> : <>
          <Detail label="Quotation" value="Menunggu quotation" />
          <Detail label="Payment" value="Belum ada pembayaran" />
          <p className="sm:col-span-2 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">{rfq.estimate?.status === "failed" || rfq.estimate?.status === "unsupported" ? "Automatic pricing is unavailable for this model. The Manufacturer will review it and send a quotation." : rfq.estimate?.status === "ready" ? "Your automatic price is ready. The payable quotation is being finalized and will appear here shortly." : "Your automatic quotation is being calculated. Pay with Kasera will appear as soon as the price is ready."}</p>
        </>}
        {rfq.paymentReviewRequired ? <p role="alert" className="sm:col-span-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{rfq.paymentReviewReason || "Your payment needs Manufacturer review. Please contact the Manufacturer."}</p> : null}
        {rfq.paymentStatus === "Paid" ? <p className="sm:col-span-2 rounded-lg bg-muted/50 p-3 text-sm">Payment confirmed · production is being prepared.</p> : null}
        {rfq.requirements.notes ? <Detail label="Notes" value={rfq.requirements.notes} /> : null}
        <div className="sm:col-span-2"><Button type="button" variant="outline" disabled={downloading} onClick={async () => { setDownloading(true); setFileError(""); try { await downloadModel(rfq.model.storagePath, rfq.model.name) } catch { setFileError("Could not access the uploaded model.") } finally { setDownloading(false) } }}>{downloading ? "Preparing file…" : "Download your STL"}</Button>{fileError ? <p role="alert" className="mt-2 text-xs text-destructive">{fileError}</p> : null}</div>
      </CardContent></Card>
      <QuoteShippingPanel rfq={rfq} uid={uid} />
      <EstimatePanel request={rfq} />
    </> : <Empty title="Request not found" detail="This request may not belong to your account or is no longer available." />}
  </main>
}
function Detail({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium">{value}</p></div> }
function OrderDetail({ requests }: { requests: RequestRecord[] }) {
  const [id, setId] = useState("")
  useEffect(() => setId(new URLSearchParams(window.location.search).get("id") || ""), [])
  const request = requests.find((item) => item.id === id && ["Preparing Production", "In Production", "Completed"].includes(item.status))
  return <main className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6"><Link href="/portal/orders" className="text-sm text-muted-foreground">← Orders</Link>{request ? <><Heading eyebrow={request.id} title={request.product} detail={`${request.requirements.quantity} units · ${formatIDR(request.quoteTotal ?? 0)}`} /><Card><CardHeader><CardTitle>Production status</CardTitle><CardDescription>Payment is confirmed. Your order is being handled by the Manufacturer.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Detail label="Status" value={request.status} /><Detail label="Payment" value="Paid" /><Detail label="STL model" value={request.model.name} /><Detail label="Material" value={request.requirements.material} /><Detail label="Process" value={request.requirements.process} /></CardContent></Card></> : <Empty title="Order not found" detail="Orders appear after the Manufacturer confirms payment." />}</main>
}

function QuoteWizard({ user }: { user: User }) {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState<File | null>(null)
  const [geometry, setGeometry] = useState<import("three").BufferGeometry | null>(null)
  const [model, setModel] = useState<UploadedModelMetadata | null>(null)
  const [unit, setUnit] = useState<"mm" | "inch">("mm")
  const [product, setProduct] = useState("")
  const [contactName, setContactName] = useState("")
  const [contactEmail, setContactEmail] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [material, setMaterial] = useState("PLA")
  const [process, setProcess] = useState("FDM")
  const [notes, setNotes] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const [pendingId, setPendingId] = useState("")
  const [draftReady, setDraftReady] = useState(false)
  const [rawDimensions, setRawDimensions] = useState<[number, number, number] | null>(null)
  const [rawVolume, setRawVolume] = useState<number | undefined>()

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`oi-rfq-draft-${user.uid}`) || "null")
      const profile = readCustomerProfile(user.uid)
      setProduct(saved?.product ?? "")
      setContactName(saved?.contactName || profile?.name || "")
      setContactEmail(saved?.contactEmail || profile?.email || "")
      setQuantity(saved?.quantity ?? "1")
      setMaterial(saved?.material ?? "PLA")
      setProcess(saved?.process ?? "FDM")
      setUnit(saved?.unit ?? "mm")
      setNotes(saved?.notes ?? "")
      setPendingId(saved?.pendingId ?? "")
    } catch { /* Ignore an invalid local draft. */ }
    setDraftReady(true)
  }, [user.uid])
  useEffect(() => { if (draftReady) localStorage.setItem(`oi-rfq-draft-${user.uid}`, JSON.stringify({ product, contactName, contactEmail, quantity, material, process, unit, notes, pendingId })) }, [draftReady, user.uid, product, contactName, contactEmail, quantity, material, process, unit, notes, pendingId])
  useEffect(() => {
    if (!rawDimensions || !model) return
    const scale = unit === "mm" ? 1 : 25.4
    setModel((current) => current ? { ...current, boundingBoxMm: rawDimensions.map((value) => value * scale) as [number, number, number], ...(rawVolume === undefined ? {} : { volumeCm3: rawVolume * scale ** 3 }) } : null)
  }, [unit, rawDimensions, rawVolume])

  async function chooseFile(chosen: File | undefined) {
    setMessage(""); setGeometry(null); setModel(null); setFile(null)
    if (!chosen) return
    if (!chosen.name.toLowerCase().endsWith(".stl")) { setMessage("Choose an STL file."); return }
    if (chosen.size > MAX_FILE_SIZE) { setMessage("STL files must be 50 MB or smaller."); return }
    try {
      const [{ STLLoader }, THREE] = await Promise.all([import("three/examples/jsm/loaders/STLLoader.js"), import("three")])
      const parsed = new STLLoader().parse(await chosen.arrayBuffer())
      if (parsed.getAttribute("position").count < 9 || !parsed.getAttribute("position").count || parsed.getAttribute("position").count % 3 !== 0) throw new Error("The STL mesh has no valid triangles.")
      parsed.computeBoundingBox()
      if (!parsed.boundingBox) throw new Error("Could not read the model dimensions.")
      const dims = [parsed.boundingBox.max.x - parsed.boundingBox.min.x, parsed.boundingBox.max.y - parsed.boundingBox.min.y, parsed.boundingBox.max.z - parsed.boundingBox.min.z] as [number, number, number]
      if (!dims.every(Number.isFinite) || dims.some((value) => value <= 0)) throw new Error("The STL model has invalid dimensions.")
      const positions = parsed.getAttribute("position")
      // shortcut: skip topology checking above 200k triangles, switch to a worker for larger meshes.
      const checkClosed = positions.count <= 600_000
      const edges = new Map<string, number>()
      let signedVolume = 0
      const point = (index: number) => [positions.getX(index), positions.getY(index), positions.getZ(index)] as const
      const key = (p: readonly number[]) => p.map((v) => v.toFixed(5)).join(",")
      const edge = (a: readonly number[], b: readonly number[]) => { const k1 = key(a); const k2 = key(b); const id = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`; edges.set(id, (edges.get(id) ?? 0) + 1) }
      for (let i = 0; i < positions.count; i += 3) {
        const a = point(i); const b = point(i + 1); const c = point(i + 2)
        signedVolume += (a[0] * (b[1] * c[2] - b[2] * c[1]) + a[1] * (b[2] * c[0] - b[0] * c[2]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
        if (checkClosed) { edge(a, b); edge(b, c); edge(c, a) }
      }
      const volumeCm3 = checkClosed && [...edges.values()].every((count) => count === 2) && Math.abs(signedVolume) > 1e-8 ? Math.abs(signedVolume) / 1000 : undefined
      const unitScale = unit === "mm" ? 1 : 25.4
      setGeometry(parsed); setFile(chosen); setRawDimensions(dims); setRawVolume(volumeCm3); setModel({ name: chosen.name, size: chosen.size, contentType: "model/stl", storagePath: "", boundingBoxMm: dims.map((value) => value * unitScale) as [number, number, number], ...(volumeCm3 === undefined ? {} : { volumeCm3: volumeCm3 * unitScale ** 3 }) })
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Could not parse this STL file.") }
  }

  async function submit() {
    if (!file || !model || !product.trim() || !contactName.trim() || !/^\S+@\S+\.\S+$/.test(contactEmail.trim()) || !Number.isInteger(Number(quantity)) || Number(quantity) < 1) { setMessage("Add a valid model, product, contact name, email, and quantity before submitting."); return }
    setBusy(true); setMessage("")
    const id = pendingId || `RFQ-${crypto.randomUUID()}`; setPendingId(id)
    const storagePath = `rfqs/${user.uid}/${id}/${file.name}`
    const draft: CustomerRFQ = { organizationId: DEMO_ORGANIZATION_ID, ownerUid: user.uid, customer: { name: contactName.trim(), email: contactEmail.trim() }, product: product.trim(), requirements: { quantity: Number(quantity), material, process, unit, notes: notes.trim() } satisfies ManufacturingRequirements, model: { ...model, storagePath }, status: "Draft", paymentStatus: "Unpaid", createdAt: Date.now() }
    saveCustomerProfile(user.uid, { name: contactName.trim(), email: contactEmail.trim() })
    try { await submitCustomerRequest(id, file, draft); localStorage.removeItem(`oi-rfq-draft-${user.uid}`); window.location.assign(`/portal/quotes/detail?id=${encodeURIComponent(id)}`) }
    catch (cause) { setMessage(`${cause instanceof Error ? cause.message : "Submission failed."} Your form details are saved in this browser; select retry to submit again.`) }
    finally { setBusy(false) }
  }

  const requirementsValid = product.trim().length > 0 && contactName.trim().length > 0 && /^\S+@\S+\.\S+$/.test(contactEmail.trim()) && Number.isInteger(Number(quantity)) && Number(quantity) > 0
  return <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6"><Heading eyebrow="New request" title="Upload a 3D model" detail="Share a model and manufacturing requirements for review." />
    <div className="grid grid-cols-4 gap-2">{["Model", "Requirements", "Review", "Submit"].map((label, index) => <div key={label} className={`border-t-2 pt-2 text-xs ${index <= step ? "border-primary text-foreground" : "border-muted text-muted-foreground"}`}>{index + 1}. {label}</div>)}</div>
    {step === 0 ? <Card><CardHeader><CardTitle>Model file</CardTitle><CardDescription>STL only · maximum size 50 MB. STL files do not store units.</CardDescription></CardHeader><CardContent className="grid gap-4 md:grid-cols-[1fr_1.2fr]"><div className="grid content-start gap-4"><Label htmlFor="stl-file">Choose STL file</Label><Input id="stl-file" type="file" accept=".stl,model/stl" onChange={(event) => void chooseFile(event.target.files?.[0])} /><div className="grid gap-1"><Label htmlFor="model-unit">Model units</Label><Select value={unit} onValueChange={(value) => setUnit(value as "mm" | "inch")}><SelectTrigger id="model-unit"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="mm">Millimeters</SelectItem><SelectItem value="inch">Inches</SelectItem></SelectContent></Select></div>{file && model ? <div className="rounded-lg bg-muted/60 p-3 text-sm"><p className="font-medium">{file.name} <span className="text-muted-foreground">· {formatSize(file.size)}</span></p><p className="mt-1 text-xs text-muted-foreground">Bounding box: {model.boundingBoxMm.map((v) => v.toFixed(1)).join(" × ")} mm</p><p className="mt-1 text-xs text-muted-foreground">{model.volumeCm3 ? `Closed-mesh geometric volume: ${model.volumeCm3.toFixed(2)} cm³` : "Volume hidden: mesh is open, non-manifold, or large."} · geometry only, not material estimate</p></div> : null}</div><div>{geometry ? <ModelPreview geometry={geometry} /> : <div className="grid h-72 place-items-center rounded-xl border border-dashed text-sm text-muted-foreground">Your STL preview will appear here.</div>}</div></CardContent></Card> : null}
    {step === 1 ? <Card><CardHeader><CardTitle>Contact and manufacturing requirements</CardTitle><CardDescription>No account needed. Add contact details so the team can send your quotation.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 text-sm"><span>Contact name</span><Input autoComplete="name" value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Your name" /></label><label className="grid gap-1.5 text-sm"><span>Email for quotation</span><Input type="email" autoComplete="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="you@example.com" /></label><label className="grid gap-1.5 text-sm"><span>Part / product name</span><Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="e.g. Sensor bracket" /></label><label className="grid gap-1.5 text-sm"><span>Quantity</span><Input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></label><label className="grid gap-1.5 text-sm"><span>Preferred process</span><Select value={process} onValueChange={(v) => setProcess(String(v ?? "FDM"))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FDM">FDM 3D printing</SelectItem><SelectItem value="SLA">SLA resin printing</SelectItem><SelectItem value="SLS">SLS</SelectItem><SelectItem value="Not sure">Not sure</SelectItem></SelectContent></Select></label><label className="grid gap-1.5 text-sm"><span>Preferred material</span><Select value={material} onValueChange={(v) => setMaterial(String(v ?? "PLA"))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["PLA", "PETG", "ABS", "ASA", "TPU", "Tough Resin", "Not sure"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-1.5 text-sm sm:col-span-2"><span>Requirements or notes (optional)</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" placeholder="Application, tolerances, finish, environment…" /></label></CardContent></Card> : null}
    {step === 2 ? <Card><CardHeader><CardTitle>Review request</CardTitle><CardDescription>Confirm the details before submitting. The Manufacturer will prepare the quotation after reviewing the model.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2"><Detail label="Contact" value={`${contactName} · ${contactEmail}`} /><Detail label="Product" value={product || "Not provided"} /><Detail label="Quantity" value={`${quantity} units`} /><Detail label="Model file" value={file ? `${file.name} · ${formatSize(file.size)}` : "No STL selected"} /><Detail label="Units / dimensions" value={`${unit} · ${model?.boundingBoxMm.map((v) => v.toFixed(1)).join(" × ") ?? "—"} mm`} /><Detail label="Process and material" value={`${process} · ${material}`} /><Detail label="Notes" value={notes || "No additional notes"} /></CardContent></Card> : null}
    {step === 3 ? <Card><CardHeader><CardTitle>Submit request</CardTitle><CardDescription>The request is saved first, then your STL uploads directly to secure file storage.</CardDescription></CardHeader><CardContent><p className="text-sm">{product} · {quantity} units · {file?.name || "No file"}</p><p className="mt-2 text-xs text-muted-foreground">Keep this page open until the upload and request finalization complete.</p></CardContent></Card> : null}
    {message ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{message}</p> : null}
    <div className="flex flex-wrap justify-between gap-3"><Button type="button" variant="outline" disabled={step === 0 || busy} onClick={() => setStep((current) => current - 1)}><ArrowLeftIcon /> Back</Button>{step < 3 ? <Button type="button" disabled={(step === 0 && (!model || !file)) || (step === 1 && !requirementsValid)} onClick={() => setStep((current) => current + 1)}>Continue <ArrowRightIcon /></Button> : <Button type="button" disabled={busy || !file || !model} onClick={() => void submit()}><UploadCloudIcon />{busy ? "Uploading…" : pendingId ? "Retry submission" : "Submit request"}</Button>}</div>
  </main>
}
