"use client"

import { useEffect, useMemo, useState } from "react"
import { Loader2Icon, PlusIcon, SearchIcon } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import { formatIDR } from "@/lib/customer-portal"
import type { EquipmentRecord, MaterialRecord, PurchaseOrder } from "@/lib/manufacturing-operations"
import {
  adjustMaterialStock,
  cancelPurchaseOrder,
  createPurchaseOrder,
  listenToEquipment,
  listenToMaterials,
  listenToPurchaseOrders,
  receivePurchaseOrder,
  saveEquipment,
  saveMaterial,
} from "@/lib/firebase/operations"
import { useManufacturerOrganization } from "./organization-provider"

type Page = "materials" | "equipment"
type MaterialDraft = Omit<MaterialRecord, "id" | "organizationId" | "stock" | "reserved">
type EquipmentDraft = Omit<EquipmentRecord, "id" | "organizationId" | "scheduledHours" | "activeProductionOrderId">

const blankMaterial: MaterialDraft = { name: "", category: "", manufacturer: "", unitCost: 0, reorderAt: 0, properties: "" }
const blankEquipment: EquipmentDraft = { name: "", manufacturer: "", model: "", technology: "FDM", buildVolumeMm: [250, 210, 210], compatibleMaterialIds: [], hourlyCost: 0, workingHours: 8, status: "Available" }
const kg = (value: number) => `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")} kg`
const materialDraft = (value?: MaterialRecord): MaterialDraft => value ? ({ name: value.name, category: value.category, manufacturer: value.manufacturer, unitCost: value.unitCost, reorderAt: value.reorderAt, properties: value.properties }) : blankMaterial
const equipmentDraft = (value?: EquipmentRecord): EquipmentDraft => value ? ({ name: value.name, manufacturer: value.manufacturer, model: value.model, technology: value.technology, buildVolumeMm: value.buildVolumeMm, compatibleMaterialIds: value.compatibleMaterialIds, hourlyCost: value.hourlyCost, workingHours: value.workingHours, status: value.status }) : blankEquipment

export function InventoryWorkspace({ page }: { page: Page }) {
  const organization = useManufacturerOrganization()
  const [materials, setMaterials] = useState<MaterialRecord[]>([])
  const [equipment, setEquipment] = useState<EquipmentRecord[]>([])
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [action, setAction] = useState("")
  const [query, setQuery] = useState("")
  const [status, setStatus] = useState("all")
  const [editor, setEditor] = useState<{ kind: "material" | "equipment"; id?: string } | null>(null)
  const [adjustmentId, setAdjustmentId] = useState("")
  const [purchaseOpen, setPurchaseOpen] = useState(false)

  useEffect(() => {
    let ready = 0
    const receive = (cause: Error) => { setError(cause.message); setLoading(false) }
    const loaded = () => { ready++; if (ready >= (page === "materials" ? 3 : 2)) setLoading(false) }
    const stops = [
      listenToMaterials(organization.id, (rows) => { setMaterials(rows.sort((a, b) => a.name.localeCompare(b.name))); loaded(); setError("") }, receive),
      listenToEquipment(organization.id, (rows) => { setEquipment(rows.sort((a, b) => a.name.localeCompare(b.name))); loaded(); setError("") }, receive),
    ]
    if (page === "materials") stops.push(listenToPurchaseOrders(organization.id, (rows) => { setOrders(rows.sort((a, b) => b.createdAt - a.createdAt)); loaded(); setError("") }, receive))
    return () => stops.forEach((stop) => stop())
  }, [organization.id, page])

  const selectedMaterial = materials.find((item) => item.id === editor?.id)
  const selectedEquipment = equipment.find((item) => item.id === editor?.id)
  const visibleMaterials = useMemo(() => materials.filter((item) => {
    const low = item.stock - item.reserved <= item.reorderAt
    return (status === "all" || (status === "low" ? low : !low))
      && `${item.name} ${item.category} ${item.manufacturer}`.toLowerCase().includes(query.toLowerCase())
  }), [materials, query, status])
  const visibleEquipment = useMemo(() => equipment.filter((item) => (status === "all" || item.status === status)
    && `${item.id} ${item.name} ${item.manufacturer} ${item.model} ${item.technology}`.toLowerCase().includes(query.toLowerCase())), [equipment, query, status])

  const metrics = page === "materials" ? [
    ["Materials", String(materials.length)],
    ["Low stock", String(materials.filter((item) => item.stock - item.reserved <= item.reorderAt).length)],
    ["Inventory value", formatIDR(materials.reduce((sum, item) => sum + item.stock * item.unitCost, 0))],
    ["Open purchase orders", String(orders.filter((item) => item.status === "Ordered").length)],
  ] : [
    ["Equipment", String(equipment.length)],
    ["Available", String(equipment.filter((item) => item.status === "Available").length)],
    ["Scheduled", String(equipment.filter((item) => item.status === "Scheduled").length)],
    ["Maintenance / offline", String(equipment.filter((item) => ["Maintenance", "Offline"].includes(item.status)).length)],
  ]

  async function run(name: string, operation: () => Promise<void>) {
    setAction(name)
    setError("")
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this change.") } finally { setAction("") }
  }

  return <section className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 pb-6 md:px-6">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-xl font-semibold">{page === "materials" ? "Materials" : "Equipment"}</h1><p className="mt-1 text-sm text-muted-foreground">Live local inventory and production resources.</p></div>
      {page === "materials" ? <Button onClick={() => setEditor({ kind: "material" })}><PlusIcon /> Add material</Button> : <Button onClick={() => setEditor({ kind: "equipment" })}><PlusIcon /> Add equipment</Button>}
    </div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([label, value]) => <Card key={label} size="sm" className="min-w-0"><CardHeader><CardDescription className="text-xs font-normal">{label}</CardDescription><CardTitle className="truncate text-xl font-semibold tabular-nums">{value}</CardTitle></CardHeader></Card>)}</div>
    {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
    {loading ? <p role="status" className="text-sm text-muted-foreground">Loading inventory…</p> : page === "materials" ? <Tabs defaultValue="catalog" className="gap-3">
      <TabsList variant="line" className="h-auto min-h-10 w-full flex-wrap justify-start gap-x-1 overflow-visible rounded-none border-b p-0"><TabsTrigger value="catalog" className="gap-1.5 px-3">Materials<span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{materials.length}</span></TabsTrigger><TabsTrigger value="purchasing" className="gap-1.5 px-3">Purchasing<span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground">{orders.filter((item) => item.status === "Ordered").length}</span></TabsTrigger></TabsList>
      <TabsContent value="catalog" className="flex flex-col gap-4"><div className="flex w-full min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1"><SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search materials" placeholder="Search materials…" className="h-8 pl-8" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={status} onValueChange={(value) => setStatus(String(value ?? "all"))}><SelectTrigger className="h-8 w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All stock</SelectItem><SelectItem value="low">Low stock</SelectItem><SelectItem value="good">In stock</SelectItem></SelectContent></Select></div>
        <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow>{["Material", "Category", "Supplier", "Unit cost", "On hand", "Reserved", "Available", "Reorder at", "Status", "Actions"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{visibleMaterials.map((item) => {
          const available = item.stock - item.reserved
          const low = available <= item.reorderAt
          const compatible = equipment.filter((machine) => machine.compatibleMaterialIds.includes(item.id)).map((machine) => machine.name).join(", ") || "Not assigned"
          return <TableRow key={item.id}><TableCell className="font-medium" title={compatible}>{item.name}</TableCell><TableCell>{item.category}</TableCell><TableCell>{item.manufacturer}</TableCell><TableCell>{formatIDR(item.unitCost)} / kg</TableCell><TableCell>{kg(item.stock)}</TableCell><TableCell>{kg(item.reserved)}</TableCell><TableCell>{kg(available)}</TableCell><TableCell>{kg(item.reorderAt)}</TableCell><TableCell><Badge variant={low ? "destructive" : "secondary"}>{low ? "Low stock" : "In stock"}</Badge></TableCell><TableCell><div className="flex gap-1"><Button size="sm" variant="outline" onClick={() => setAdjustmentId(item.id)}>Adjust stock</Button><Button size="sm" variant="outline" onClick={() => setEditor({ kind: "material", id: item.id })}>Edit</Button></div></TableCell></TableRow>
        })}{visibleMaterials.length === 0 ? <TableRow><TableCell colSpan={10} className="py-8 text-center text-muted-foreground">No materials match this view.</TableCell></TableRow> : null}</TableBody></Table></div>
      </TabsContent>
      <TabsContent value="purchasing" className="flex flex-col gap-4"><div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Place local purchase orders and receive stock into inventory.</p><Button onClick={() => setPurchaseOpen(true)} disabled={Boolean(action)}><PlusIcon /> Create purchase order</Button></div><div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow>{["Supplier", "Material", "Quantity", "Unit cost", "ETA", "Status", "Actions"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{orders.map((order) => <TableRow key={order.id}><TableCell>{order.supplier}</TableCell><TableCell>{materials.find((item) => item.id === order.materialId)?.name ?? "Missing material"}</TableCell><TableCell>{kg(order.quantity)}</TableCell><TableCell>{order.unitCost === undefined ? "—" : `${formatIDR(order.unitCost)} / kg`}</TableCell><TableCell>{order.eta}</TableCell><TableCell><Badge variant={order.status === "Received" ? "default" : order.status === "Ordered" ? "secondary" : "outline"}>{order.status}</Badge></TableCell><TableCell><div className="flex gap-1">{order.status === "Ordered" ? <><Button size="sm" disabled={Boolean(action)} onClick={() => void run(`receive:${order.id}`, () => receivePurchaseOrder(order.id))}>{action === `receive:${order.id}` ? <><Loader2Icon className="animate-spin motion-reduce:animate-none" /> Receiving…</> : "Receive"}</Button><Button size="sm" variant="outline" disabled={Boolean(action)} onClick={() => { if (window.confirm("Cancel this purchase order?")) void run(`cancel:${order.id}`, () => cancelPurchaseOrder(order.id)) }}>{action === `cancel:${order.id}` ? <><Loader2Icon className="animate-spin motion-reduce:animate-none" /> Cancelling…</> : "Cancel"}</Button></> : "—"}</div></TableCell></TableRow>)}{orders.length === 0 ? <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">No purchase orders yet.</TableCell></TableRow> : null}</TableBody></Table></div></TabsContent>
    </Tabs> : <>
      <div className="flex w-full min-w-0 items-center gap-2"><div className="relative min-w-0 flex-1"><SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search equipment" placeholder="Search equipment…" className="h-8 pl-8" value={query} onChange={(event) => setQuery(event.target.value)} /></div><Select value={status} onValueChange={(value) => setStatus(String(value ?? "all"))}><SelectTrigger className="h-8 w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All equipment</SelectItem>{["Available", "Scheduled", "Maintenance", "Offline"].map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select></div>
      <div className="overflow-x-auto rounded-xl border bg-card"><Table><TableHeader><TableRow>{["Equipment", "Manufacturer / model", "Process", "Build volume", "Compatible materials", "Hourly cost", "Working hours", "Status", "Actions"].map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{visibleEquipment.map((machine) => <TableRow key={machine.id}><TableCell className="font-medium">{machine.name}</TableCell><TableCell>{machine.manufacturer} {machine.model}</TableCell><TableCell>{machine.technology}</TableCell><TableCell>{machine.buildVolumeMm.join(" × ")} mm</TableCell><TableCell>{machine.compatibleMaterialIds.map((id) => materials.find((item) => item.id === id)?.name ?? id).join(", ") || "None"}</TableCell><TableCell>{formatIDR(machine.hourlyCost)} / h</TableCell><TableCell>{machine.workingHours} h/day</TableCell><TableCell><Badge variant={machine.status === "Available" ? "default" : machine.status === "Maintenance" || machine.status === "Offline" ? "destructive" : "secondary"}>{machine.status}</Badge></TableCell><TableCell><Button size="sm" variant="outline" disabled={Boolean(machine.activeProductionOrderId) || machine.scheduledHours > 0} onClick={() => setEditor({ kind: "equipment", id: machine.id })}>Edit</Button></TableCell></TableRow>)}{visibleEquipment.length === 0 ? <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No equipment matches this view.</TableCell></TableRow> : null}</TableBody></Table></div>
    </>}
    <MaterialEditor key={editor?.kind === "material" ? editor.id ?? "new" : "closed-material"} open={editor?.kind === "material"} busy={action === "material"} value={selectedMaterial} onClose={() => setEditor(null)} onSave={(value) => run("material", async () => { await saveMaterial(value, selectedMaterial?.id); setEditor(null) })} />
    <EquipmentEditor key={editor?.kind === "equipment" ? editor.id ?? "new" : "closed-equipment"} open={editor?.kind === "equipment"} busy={action === "equipment"} value={selectedEquipment} materials={materials} onClose={() => setEditor(null)} onSave={(value) => run("equipment", async () => { await saveEquipment(value, selectedEquipment?.id); setEditor(null) })} />
    <StockAdjustment open={Boolean(adjustmentId)} busy={action === "adjustment"} material={materials.find((item) => item.id === adjustmentId)} onClose={() => setAdjustmentId("")} onSave={(delta, reason) => run("adjustment", async () => { await adjustMaterialStock(adjustmentId, delta, reason); setAdjustmentId("") })} />
    <PurchaseOrderEditor open={purchaseOpen} busy={action === "purchase-order"} materials={materials} onClose={() => setPurchaseOpen(false)} onSave={(value) => run("purchase-order", async () => { await createPurchaseOrder(value); setPurchaseOpen(false) })} />
  </section>
}

function MaterialEditor({ open, busy, value, onClose, onSave }: { open?: boolean; busy: boolean; value?: MaterialRecord; onClose: () => void; onSave: (draft: MaterialDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<MaterialDraft>(materialDraft(value))
  useEffect(() => setDraft(materialDraft(value)), [value])
  return <Sheet open={Boolean(open)} onOpenChange={(shown) => !shown && onClose()}><SheetContent className="overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{value ? "Edit material" : "Add material"}</SheetTitle><SheetDescription>Manage machine compatibility from Equipment. Stock is updated through adjustments and received purchases.</SheetDescription></SheetHeader><form className="grid gap-3 px-4 pb-6" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>
    <TextField label="Material name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required />
    <TextField label="Category" value={draft.category} onChange={(category) => setDraft({ ...draft, category })} required />
    <TextField label="Manufacturer / supplier" value={draft.manufacturer} onChange={(manufacturer) => setDraft({ ...draft, manufacturer })} required />
    <NumberField label="Unit cost (IDR / kg)" value={draft.unitCost} min={0} step={1000} onChange={(unitCost) => setDraft({ ...draft, unitCost })} />
    <NumberField label="Reorder threshold (kg)" value={draft.reorderAt} min={0} step={0.1} onChange={(reorderAt) => setDraft({ ...draft, reorderAt })} />
    <label className="grid gap-1.5 text-sm"><span>Properties</span><textarea className="min-h-20 rounded-md border border-input bg-background px-3 py-2" value={draft.properties} onChange={(event) => setDraft({ ...draft, properties: event.target.value })} required /></label>
    <Button type="submit" disabled={busy}>{busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : null}{busy ? "Saving…" : "Save material"}</Button>
  </form></SheetContent></Sheet>
}

function EquipmentEditor({ open, busy, value, materials, onClose, onSave }: { open?: boolean; busy: boolean; value?: EquipmentRecord; materials: MaterialRecord[]; onClose: () => void; onSave: (draft: EquipmentDraft) => Promise<void> }) {
  const [draft, setDraft] = useState<EquipmentDraft>(equipmentDraft(value))
  useEffect(() => setDraft(equipmentDraft(value)), [value])
  const dimension = (index: number, next: number) => setDraft({ ...draft, buildVolumeMm: draft.buildVolumeMm.map((current, position) => position === index ? next : current) as [number, number, number] })
  const toggleMaterial = (id: string) => setDraft({ ...draft, compatibleMaterialIds: draft.compatibleMaterialIds.includes(id) ? draft.compatibleMaterialIds.filter((item) => item !== id) : [...draft.compatibleMaterialIds, id] })
  return <Sheet open={Boolean(open)} onOpenChange={(shown) => !shown && onClose()}><SheetContent className="overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{value ? "Edit equipment" : "Add equipment"}</SheetTitle><SheetDescription>Equipment marked Available can be assigned to a compatible production order.</SheetDescription></SheetHeader><form className="grid gap-3 px-4 pb-6" onSubmit={(event) => { event.preventDefault(); void onSave(draft) }}>
    <TextField label="Equipment name" value={draft.name} onChange={(name) => setDraft({ ...draft, name })} required />
    <TextField label="Manufacturer" value={draft.manufacturer} onChange={(manufacturer) => setDraft({ ...draft, manufacturer })} required />
    <TextField label="Model" value={draft.model} onChange={(model) => setDraft({ ...draft, model })} required />
    <TextField label="Process / technology" value={draft.technology} onChange={(technology) => setDraft({ ...draft, technology })} required />
    <div className="grid grid-cols-3 gap-2">{draft.buildVolumeMm.map((value, index) => <NumberField key={index} label={["Build X (mm)", "Build Y (mm)", "Build Z (mm)"][index]!} value={value} min={1} step={1} onChange={(next) => dimension(index, next)} />)}</div>
    <div className="grid grid-cols-3 gap-2"><NumberField label="Hourly cost (IDR)" value={draft.hourlyCost} min={0} step={1000} onChange={(hourlyCost) => setDraft({ ...draft, hourlyCost })} /><NumberField label="Working hours / day" value={draft.workingHours} min={0.1} max={24} step={0.5} onChange={(workingHours) => setDraft({ ...draft, workingHours })} /><label className="grid gap-1.5 text-sm"><span>Status</span><Select value={draft.status} onValueChange={(value) => setDraft({ ...draft, status: String(value ?? "Available") as EquipmentDraft["status"] })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Available", "Scheduled", "Maintenance", "Offline"].map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></label></div>
    <fieldset className="grid gap-2"><legend className="text-sm font-medium">Compatible materials</legend>{materials.length ? materials.map((material) => <label key={material.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.compatibleMaterialIds.includes(material.id)} onChange={() => toggleMaterial(material.id)} />{material.name}</label>) : <p className="text-xs text-muted-foreground">Add materials before configuring compatibility.</p>}</fieldset>
    <Button type="submit" disabled={busy}>{busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : null}{busy ? "Saving…" : "Save equipment"}</Button>
  </form></SheetContent></Sheet>
}

function StockAdjustment({ open, busy, material, onClose, onSave }: { open: boolean; busy: boolean; material?: MaterialRecord; onClose: () => void; onSave: (deltaKg: number, reason: string) => Promise<void> }) {
  const [delta, setDelta] = useState("")
  const [reason, setReason] = useState("")
  useEffect(() => { setDelta(""); setReason("") }, [material])
  return <Sheet open={open} onOpenChange={(shown) => !shown && onClose()}><SheetContent className="sm:max-w-md"><SheetHeader><SheetTitle>Adjust stock</SheetTitle><SheetDescription>{material ? `${material.name} · ${kg(material.stock)} on hand · ${kg(material.reserved)} reserved` : "Update inventory count"}</SheetDescription></SheetHeader><form className="grid gap-3 px-4 pb-6" onSubmit={(event) => { event.preventDefault(); void onSave(Number(delta), reason) }}><NumberField label="Change in kilograms (use minus to remove)" value={delta === "" ? 0 : Number(delta)} min={-100000} step={0.001} onChange={(value) => setDelta(String(value))} /><label className="grid gap-1.5 text-sm"><span>Reason</span><Input value={reason} onChange={(event) => setReason(event.target.value)} required /></label><Button type="submit" disabled={busy || !delta || Number(delta) === 0}>{busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : null}{busy ? "Saving…" : "Save adjustment"}</Button></form></SheetContent></Sheet>
}

function PurchaseOrderEditor({ open, busy, materials, onClose, onSave }: { open: boolean; busy: boolean; materials: MaterialRecord[]; onClose: () => void; onSave: (value: { supplier: string; materialId: string; quantity: number; unitCost?: number; eta: string }) => Promise<void> }) {
  const [supplier, setSupplier] = useState("")
  const [materialId, setMaterialId] = useState("")
  const [quantity, setQuantity] = useState("1")
  const [unitCost, setUnitCost] = useState("")
  const [eta, setEta] = useState("")
  useEffect(() => { if (!materialId && materials[0]) setMaterialId(materials[0].id) }, [materials, materialId])
  return <Sheet open={open} onOpenChange={(shown) => !shown && onClose()}><SheetContent className="sm:max-w-md"><SheetHeader><SheetTitle>Create purchase order</SheetTitle><SheetDescription>Receive the order later to add the quantity to on-hand stock.</SheetDescription></SheetHeader><form className="grid gap-3 px-4 pb-6" onSubmit={(event) => { event.preventDefault(); void onSave({ supplier, materialId, quantity: Number(quantity), ...(unitCost === "" ? {} : { unitCost: Number(unitCost) }), eta }) }}>
    <TextField label="Supplier" value={supplier} onChange={setSupplier} required />
    <label className="grid gap-1.5 text-sm"><span>Material</span><Select value={materialId} onValueChange={(value) => setMaterialId(String(value ?? ""))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{materials.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label>
    <NumberField label="Quantity (kg)" value={Number(quantity)} min={0.001} step={0.001} onChange={(value) => setQuantity(String(value))} />
    <NumberField label="Optional unit cost (IDR / kg)" value={unitCost === "" ? 0 : Number(unitCost)} min={0} step={1000} onChange={(value) => setUnitCost(String(value))} />
    <label className="grid gap-1.5 text-sm"><span>Expected delivery</span><Input type="date" value={eta} onChange={(event) => setEta(event.target.value)} required /></label>
    <Button type="submit" disabled={!materials.length || busy}>{busy ? <Loader2Icon className="animate-spin motion-reduce:animate-none" /> : null}{busy ? "Placing order…" : "Place purchase order"}</Button>
  </form></SheetContent></Sheet>
}

function TextField({ label, value, onChange, required }: { label: string; value: string; onChange: (value: string) => void; required?: boolean }) {
  return <label className="grid gap-1.5 text-sm"><span>{label}</span><Input value={value} onChange={(event) => onChange(event.target.value)} required={required} /></label>
}

function NumberField({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max?: number; step: number; onChange: (value: number) => void }) {
  return <label className="grid gap-1.5 text-sm"><span>{label}</span><Input type="number" value={Number.isNaN(value) ? "" : value} min={min} max={max} step={step} onChange={(event) => onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))} required /></label>
}
