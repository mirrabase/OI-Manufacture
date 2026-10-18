"use client"

import dynamic from "next/dynamic"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { formatIDR, type CustomerRFQ } from "@/lib/customer-portal"

const GcodePreview = dynamic(() => import("./gcode-preview"), { ssr: false, loading: () => <p className="text-sm text-muted-foreground">Loading preview…</p> })

export function EstimatePanel({ request, asManufacturer = false }: { request: CustomerRFQ; asManufacturer?: boolean }) {
  const [preview, setPreview] = useState(false)
  const estimate = request.estimate
  const waiting = !estimate || estimate.status === "processing" || (request.estimateRequestedAt ?? 0) > estimate.requestedAt
  return <Card><CardHeader><CardTitle>Print estimate</CardTitle><CardDescription>Supported requests become payable quotations automatically after slicing. The Manufacturer can adjust the price before checkout.</CardDescription></CardHeader><CardContent className="grid gap-3">
    {waiting ? <p role="status" className="text-sm text-muted-foreground">Calculating filament, print time, and price… Keep the local slicer worker running.</p>
      : estimate.status !== "ready" ? <p role="status" className="text-sm text-muted-foreground">{estimate.error || "Automatic estimate unavailable; Manufacturer review is required."}</p>
      : <>
        <p className="text-2xl font-semibold">{formatIDR(estimate.total ?? 0)} <span className="text-sm font-normal text-muted-foreground">estimated total · {request.requirements.quantity} units</span></p>
        <div className="grid gap-2 text-sm sm:grid-cols-2"><p>Filament: <strong>{estimate.gramsPerUnit?.toFixed(2)} g / unit</strong></p><p>Print time: <strong>{Math.ceil((estimate.secondsPerUnit ?? 0) / 60)} min / unit</strong></p></div>
        {asManufacturer ? <div className="grid gap-1 rounded-lg bg-muted/50 p-3 text-sm"><p>Material: {formatIDR(estimate.materialCost ?? 0)}</p><p>Machine: {formatIDR(estimate.machineCost ?? 0)}</p><p>Setup: {formatIDR(estimate.setupCost ?? 0)}</p><p>Markup: {formatIDR(estimate.markup ?? 0)}</p><p>Minimum: {formatIDR(estimate.pricing?.minimumTotal ?? 0)} · rounded up to Rp1.000</p></div> : null}
        <p className="text-xs text-muted-foreground">{estimate.profile} · layer {estimate.pricing?.layerHeight} mm · infill {estimate.pricing?.infillPercent}%</p>
        <p className="text-xs text-muted-foreground">Quantity assumes printing one unit repeatedly. Material and time include the sliced toolpath; plate packing is not optimized. Pricing is saved with this estimate.</p>
        {estimate.gcodePath ? <><Button type="button" variant="outline" onClick={() => setPreview(!preview)}>{preview ? "Hide layer preview" : "View sliced layers"}</Button>{preview ? <GcodePreview key={estimate.gcodePath} path={estimate.gcodePath} asManufacturer={asManufacturer} /> : null}</> : null}
      </>}
  </CardContent></Card>
}
