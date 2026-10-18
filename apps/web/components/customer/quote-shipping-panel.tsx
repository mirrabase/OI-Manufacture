"use client"

import { useEffect, useMemo, useState } from "react"
import { httpsCallable } from "firebase/functions"
import { CheckCircle2Icon, Loader2Icon, MapPinIcon, TruckIcon } from "lucide-react"

import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import { functions } from "@/lib/firebase/client"
import { formatIDR, type CustomerRFQ, type ShippingAddress, type ShippingDestination, type ShippingDestinationOption, type ShippingRate } from "@/lib/customer-portal"
import { readCustomerProfile, saveCustomerProfile } from "@/lib/customer-profile"

type RequestRecord = CustomerRFQ & { id: string }
type DeliveryForm = Pick<ShippingAddress, "phone" | "addressLine" | "postalCode">
type ShippingPreference = Pick<ShippingRate, "courierCode" | "service">

const emptyDelivery: DeliveryForm = { phone: "", addressLine: "", postalCode: "" }

function shippingErrorMessage(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : ""
  if (/successful print estimate/i.test(message)) {
    return "Courier prices need a completed STL weight estimate. The Manufacturer must finish estimating this model before rates can be shown."
  }
  if (/shipping origin/i.test(message)) {
    return "Courier prices are not configured for the Manufacturer yet. Please contact them to finish setting up shipping."
  }
  return message || fallback
}

export function QuoteShippingPanel({ rfq, uid, preferredRate, showAddress = true }: { rfq: RequestRecord; uid: string; preferredRate?: ShippingPreference; showAddress?: boolean }) {
  const [form, setForm] = useState<DeliveryForm>(emptyDelivery)
  const [destination, setDestination] = useState<ShippingDestination | null>(null)
  const [destinationSearch, setDestinationSearch] = useState("")
  const [destinations, setDestinations] = useState<ShippingDestinationOption[]>([])
  const [searchingDestination, setSearchingDestination] = useState(false)
  const [rates, setRates] = useState<ShippingRate[]>([])
  const [chosenRateId, setChosenRateId] = useState("")
  const [editingAddress, setEditingAddress] = useState(!rfq.shipping?.address)
  const [savingAddress, setSavingAddress] = useState(false)
  const [savingRate, setSavingRate] = useState(false)
  const [loadingRates, setLoadingRates] = useState(false)
  const [error, setError] = useState("")
  const [addressRevision, setAddressRevision] = useState(0)

  const savedAddress = rfq.shipping?.address
  const selection = rfq.shipping?.selection
  const canEdit = ["Submitted", "Quoted"].includes(rfq.status) && rfq.paymentStatus === "Unpaid" && !rfq.activeKaseraPaymentAttemptId
  const estimateReady = rfq.estimate?.status === "ready"
  const sortedRates = useMemo(() => [...rates].sort((a, b) => a.cost - b.cost), [rates])
  const chosenRate = sortedRates.find((rate) => rate.id === chosenRateId)

  useEffect(() => {
    const profile = readCustomerProfile(uid)
    const initial = savedAddress ?? profile?.shipping
    setForm({
      phone: initial?.phone ?? "",
      addressLine: initial?.addressLine ?? "",
      postalCode: initial?.postalCode ?? "",
    })
    setDestination(initial?.destination ?? null)
    setDestinationSearch(initial?.destination.label ?? "")
    setEditingAddress(!savedAddress)
  }, [uid, rfq.id])

  useEffect(() => {
    if (!canEdit || !savedAddress || selection || !estimateReady) {
      setRates([])
      setLoadingRates(false)
      return
    }
    let active = true
    setRates([])
    setChosenRateId("")
    setLoadingRates(true)
    setError("")
    const getRates = httpsCallable<{ rfqId: string }, { rates: ShippingRate[] }>(functions, "getCustomerShippingRates")
    void getRates({ rfqId: rfq.id })
      .then((result) => {
        if (!active) return
        setRates(result.data.rates)
        const preferred = result.data.rates.find((rate) => rate.courierCode === preferredRate?.courierCode && rate.service === preferredRate.service)
        setChosenRateId(preferred?.id ?? "")
      })
      .catch((cause: unknown) => { if (active) setError(shippingErrorMessage(cause, "Shipping rates could not be calculated.")) })
      .finally(() => { if (active) setLoadingRates(false) })
    return () => { active = false }
  }, [canEdit, estimateReady, preferredRate?.courierCode, preferredRate?.service, rfq.id, rfq.quoteTotal, rfq.estimate?.calculatedAt, savedAddress?.recipientName, savedAddress?.phone, savedAddress?.addressLine, savedAddress?.postalCode, savedAddress?.destination.scope, savedAddress?.destination.id, selection, addressRevision])

  useEffect(() => {
    if (destination?.label === destinationSearch || destinationSearch.trim().length < 2) {
      setDestinations([])
      setSearchingDestination(false)
      return
    }
    let active = true
    const timer = window.setTimeout(async () => {
      setSearchingDestination(true)
      try {
        const searchLocations = httpsCallable<
          { scope: "auto"; search: string },
          { destinations: ShippingDestinationOption[] }
        >(functions, "searchShippingLocations")
        const result = await searchLocations({ scope: "auto", search: destinationSearch.trim() })
        if (active) setDestinations(result.data.destinations)
      } catch (cause) {
        if (active) setError(shippingErrorMessage(cause, "Location could not be searched."))
      } finally {
        if (active) setSearchingDestination(false)
      }
    }, 300)
    return () => { active = false; window.clearTimeout(timer) }
  }, [destinationSearch, destination])

  function update<K extends keyof DeliveryForm>(key: K, value: DeliveryForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setError("")
  }

  async function saveAddress(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!destination) {
      setError("Choose a city or country from the search results.")
      return
    }
    const address: ShippingAddress = { ...form, recipientName: rfq.customer.name, destination }
    setSavingAddress(true)
    setError("")
    try {
      const save = httpsCallable<
        { rfqId: string; address: ShippingAddress },
        { ok: boolean; address: ShippingAddress }
      >(functions, "saveCustomerShippingAddress")
      await save({ rfqId: rfq.id, address })
      saveCustomerProfile(uid, { name: rfq.customer.name, email: rfq.customer.email, shipping: address })
      setAddressRevision((revision) => revision + 1)
      setEditingAddress(false)
    } catch (cause) {
      setError(shippingErrorMessage(cause, "Delivery address could not be saved."))
    } finally {
      setSavingAddress(false)
    }
  }

  async function saveRate() {
    if (!chosenRateId) return
    setSavingRate(true)
    setError("")
    try {
      const selectRate = httpsCallable<{ rfqId: string; rateId: string }, { ok: boolean }>(functions, "selectCustomerShippingRate")
      await selectRate({ rfqId: rfq.id, rateId: chosenRateId })
      setRates([])
    } catch (cause) {
      setError(shippingErrorMessage(cause, "Shipping service could not be saved."))
    } finally {
      setSavingRate(false)
    }
  }

  if (!["Submitted", "Quoted"].includes(rfq.status) || rfq.paymentStatus === "Paid") {
    if (!savedAddress) return null
    return <Card><CardHeader><CardTitle className="flex items-center gap-2"><TruckIcon className="size-4" /> Delivery</CardTitle></CardHeader><CardContent className="grid gap-2 text-sm"><p>{savedAddress.recipientName} · {savedAddress.phone}</p><p className="text-muted-foreground">{savedAddress.addressLine}, {savedAddress.destination.label} {savedAddress.postalCode}</p>{selection ? <p className="font-medium">{selection.courierName} · {selection.service} · {formatIDR(selection.cost)}</p> : null}</CardContent></Card>
  }

  const shippingContent = <>
      {showAddress && savedAddress && !editingAddress ? <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm">
        <div className="flex gap-2"><MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><div><p className="font-medium">{savedAddress.recipientName} · {savedAddress.phone}</p><p className="mt-1 text-muted-foreground">{savedAddress.addressLine}, {savedAddress.destination.label} {savedAddress.postalCode}</p></div></div>
        {canEdit ? <Button variant="outline" size="sm" type="button" onClick={() => setEditingAddress(true)}>Change address</Button> : null}
      </div> : null}

      {showAddress && editingAddress && canEdit ? <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => void saveAddress(event)}>
        <label className="grid gap-1.5 text-sm sm:col-span-2">City or country<Input required autoComplete="off" placeholder="Search a city, district, or country" value={destinationSearch} onChange={(event) => { setDestination(null); setDestinationSearch(event.target.value); setError("") }} /></label>
        {searchingDestination ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground sm:col-span-2"><Loader2Icon className="size-3 animate-spin" />Searching locations…</p> : null}
        {destinations.length ? <div className="grid max-h-48 gap-1 overflow-y-auto rounded-md border p-1 sm:col-span-2">{destinations.map((item) => <button key={`${item.scope}-${item.id}`} type="button" className="flex items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm hover:bg-muted" onClick={() => { const { postalCode, ...selectedDestination } = item; setDestination(selectedDestination); update("postalCode", postalCode ?? ""); setDestinationSearch(item.label); setDestinations([]); setError("") }}><span>{item.label}</span><span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{item.scope === "domestic" ? "Indonesia" : "International"}</span></button>)}</div> : null}
        {!searchingDestination && destinationSearch.trim().length >= 2 && !destination && !destinations.length && !error ? <p className="text-xs text-muted-foreground sm:col-span-2">No location found. Try another city or country name.</p> : null}
        {destination ? <p className="text-xs text-muted-foreground sm:col-span-2">Route detected: {destination.scope === "domestic" ? "Indonesia" : "International"} · {destination.label}</p> : null}
        <label className="grid gap-1.5 text-sm">Phone number<Input required type="tel" autoComplete="shipping tel" value={form.phone} onChange={(event) => update("phone", event.target.value)} /></label>
        <label className="grid gap-1.5 text-sm">Postal code<Input required autoComplete="shipping postal-code" value={form.postalCode} onChange={(event) => update("postalCode", event.target.value)} /><span className="text-xs font-normal text-muted-foreground">Auto-filled when the destination has one.</span></label>
        <label className="grid gap-1.5 text-sm sm:col-span-2">Street address<Input required autoComplete="shipping street-address" placeholder="Street, building, unit, district" value={form.addressLine} onChange={(event) => update("addressLine", event.target.value)} /></label>
        {error ? <p role="alert" className="text-sm text-destructive sm:col-span-2">{error}</p> : null}
        <Button type="submit" className="sm:col-span-2" disabled={savingAddress}>{savingAddress ? <><Loader2Icon className="size-4 animate-spin" /> Saving delivery details…</> : "Save address and calculate shipping"}</Button>
        <p className="text-xs text-muted-foreground sm:col-span-2">We detect Indonesia or international routes from the selected location. Your address is saved with this request.</p>
      </form> : null}

      {savedAddress && !selection && estimateReady ? <div className="grid gap-3">
        <p className="text-xs text-muted-foreground">Live rates use your STL estimate and dimensions; the carrier may adjust the final parcel price.</p>
        {loadingRates ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2Icon className="size-4 animate-spin" /> Loading courier prices…</p> : null}
        {!loadingRates && sortedRates.length ? <div className="grid gap-2">
          <div className="grid gap-1.5 text-sm"><span className="font-medium">Courier service</span><Select value={chosenRateId} onValueChange={(value) => setChosenRateId(String(value ?? ""))}><SelectTrigger className="w-full"><SelectValue placeholder="Choose an expedition" /></SelectTrigger><SelectContent>{sortedRates.map((rate) => <SelectItem key={rate.id} value={rate.id}>{rate.courierName} · {rate.service} · {formatIDR(rate.cost)}</SelectItem>)}</SelectContent></Select></div>
          {chosenRate ? <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/20 p-3 text-sm"><span><span className="block font-medium">{chosenRate.courierName} · {chosenRate.service}</span><span className="text-xs text-muted-foreground">{chosenRate.description || "Courier service"} · {chosenRate.etd || "Delivery estimate unavailable"}</span></span><span className="shrink-0 font-semibold">{formatIDR(chosenRate.cost)}</span></div> : null}
        </div> : null}
        {!loadingRates && !sortedRates.length && !error ? <p className="text-sm text-muted-foreground">No courier services were returned for this route.</p> : null}
        {error && !editingAddress ? <div className="grid justify-items-start gap-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" size="sm" onClick={() => setAddressRevision((revision) => revision + 1)}>Retry shipping rates</Button></div> : null}
        {!loadingRates && !sortedRates.length && !error ? <Button type="button" variant="outline" size="sm" onClick={() => setAddressRevision((revision) => revision + 1)}>Retry shipping rates</Button> : null}
        {sortedRates.length ? <Button type="button" disabled={!chosenRateId || savingRate} onClick={() => void saveRate()}>{savingRate ? <><Loader2Icon className="size-4 animate-spin" /> Saving selection…</> : `Use selected service${chosenRateId ? ` · ${formatIDR(sortedRates.find((rate) => rate.id === chosenRateId)?.cost ?? 0)}` : ""}`}</Button> : null}
      </div> : null}

      {savedAddress && !selection && !estimateReady ? <p role="status" className="text-sm text-muted-foreground">{rfq.estimate?.status === "failed" || rfq.estimate?.status === "unsupported" ? "The STL weight estimate is unavailable. The Manufacturer must review this file before courier prices can be calculated." : "Courier choices will appear here as soon as the STL weight estimate is ready."}</p> : null}

      {selection ? <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm"><div className="flex items-center gap-2"><CheckCircle2Icon className="size-4 text-primary" /><span><strong>{selection.courierName} · {selection.service}</strong><span className="block text-xs text-muted-foreground">Estimated delivery {selection.etd || "not provided"}</span></span></div><strong>{formatIDR(selection.cost)}</strong></div> : null}
  </>
  return showAddress ? <Card id="delivery-options">
    <CardHeader>
      <CardTitle className="flex items-center gap-2"><TruckIcon className="size-4" /> Delivery and shipping</CardTitle>
      <CardDescription>Choose where to send it. Courier rates use this organization’s saved origin (Semanggi, Jakarta in the local demo).</CardDescription>
    </CardHeader>
    <CardContent className="grid gap-4">{shippingContent}</CardContent>
  </Card> : <section id="delivery-options" className="grid gap-3 border-t pt-4">
    <div><h3 className="flex items-center gap-2 text-sm font-semibold"><TruckIcon className="size-4" /> Courier service</h3><p className="mt-1 text-xs text-muted-foreground">Live rates use the Manufacturer’s saved origin and the STL estimate.</p></div>
    {shippingContent}
  </section>
}
