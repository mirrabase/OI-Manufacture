"use client"

import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { listenToPricing, savePricing } from "@/lib/firebase/pricing"
import type { Pricing } from "@/lib/pricing"
import { useManufacturerOrganization } from "./organization-provider"

const fields: { key: keyof Pricing; label: string; min: number; max: number; step: number }[] = [
  { key: "materialPerKg", label: "PLA material (IDR / kg)", min: 0, max: 10_000_000, step: 1000 },
  { key: "machinePerHour", label: "Machine (IDR / hour)", min: 0, max: 10_000_000, step: 1000 },
  { key: "setup", label: "Setup (IDR / request)", min: 0, max: 10_000_000, step: 1000 },
  { key: "markupPercent", label: "Markup on cost (%)", min: 0, max: 500, step: 1 },
  { key: "minimumTotal", label: "Minimum total (IDR)", min: 0, max: 10_000_000, step: 1000 },
  { key: "layerHeight", label: "Layer height (mm)", min: 0.08, max: 0.32, step: 0.01 },
  { key: "infillPercent", label: "Infill (%)", min: 0, max: 100, step: 1 },
]

export function PricingSettings() {
  const organization = useManufacturerOrganization()
  const [draft, setDraft] = useState<Pricing | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)
  useEffect(() => listenToPricing(organization.id, (value) => { setDraft(value); setLoading(false); setError("") }, (cause) => { setError(cause.message); setLoading(false) }), [organization.id])
  return <section className="space-y-5">
    <header className="border-b pb-4">
      <h2 className="text-xl font-semibold">Pricing and slicing · FDM / PLA</h2>
      <p className="mt-1 text-sm text-muted-foreground">Example simulation rates stored in Firestore. Prusa MK3S+ · nozzle 0.4 mm · no supports</p>
    </header>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {loading ? <p className="text-sm text-muted-foreground">Loading pricing…</p> : !draft ? <p className="text-sm">No pricing configuration. Start the local worker or run pnpm seed:local.</p> : <form className="grid gap-4" onSubmit={async (event) => {
      event.preventDefault(); setSaving(true); setError(""); setSaved(false)
      try { await savePricing(organization.id, draft); setSaved(true) } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save pricing.") } finally { setSaving(false) }
    }}><div className="divide-y border-y">{fields.map((field) => <label key={field.key} className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center"><span className="font-medium">{field.label}</span><Input required type="number" min={field.min} max={field.max} step={field.step} value={Number.isNaN(draft[field.key]) ? "" : draft[field.key]} onChange={(event) => { setSaved(false); setDraft({ ...draft, [field.key]: event.target.value === "" ? NaN : Number(event.target.value) }) }} /></label>)}</div>
      <p className="text-xs text-muted-foreground">Total = max(minimum, (material + machine + setup) × (1 + markup)). Rounded up to Rp1.000. Changes apply to new estimates; use Recalculate estimate on an existing RFQ. Final quotations stay unchanged.</p>
      <div className="flex items-center gap-3 border-t pt-4"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save pricing"}</Button>{saved ? <p role="status" className="text-sm text-muted-foreground">Saved to Firestore.</p> : null}</div>
    </form>}
  </section>
}
