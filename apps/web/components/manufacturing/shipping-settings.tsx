"use client"

import { useEffect, useState } from "react"
import { httpsCallable } from "firebase/functions"
import { doc, onSnapshot, updateDoc } from "firebase/firestore"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { manufacturerDb, manufacturerFunctions } from "@/lib/firebase/client"
import { useManufacturerOrganization } from "./organization-provider"

type ShippingOrigin = {
  name: string
  phone: string
  addressLine: string
  postalCode: string
  destinationId: number
  destinationLabel: string
}

type Destination = { id: number; label: string }

const emptyOrigin: ShippingOrigin = {
  name: "",
  phone: "",
  addressLine: "",
  postalCode: "",
  destinationId: 0,
  destinationLabel: "",
}

export function ShippingSettings() {
  const organization = useManufacturerOrganization()
  const [origin, setOrigin] = useState<ShippingOrigin>(emptyOrigin)
  const [search, setSearch] = useState("")
  const [destinations, setDestinations] = useState<Destination[]>([])
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [saved, setSaved] = useState(false)

  useEffect(() => onSnapshot(doc(manufacturerDb, "organizations", organization.id), (snapshot) => {
    const value = snapshot.data()?.shippingOrigin as ShippingOrigin | undefined
    setOrigin(value ?? emptyOrigin)
    setSearch(value?.destinationLabel ?? "")
    setLoading(false)
  }, (cause) => { setError(cause.message); setLoading(false) }), [organization.id])

  useEffect(() => {
    if (search.trim().length < 2 || search === origin.destinationLabel) {
      setDestinations([])
      return
    }
    const timer = window.setTimeout(async () => {
      setSearching(true)
      try {
        const searchLocations = httpsCallable<{ scope: "domestic"; search: string }, { destinations: Destination[] }>(manufacturerFunctions, "searchShippingLocations")
        const result = await searchLocations({ scope: "domestic", search: search.trim() })
        setDestinations(result.data.destinations)
        setError("")
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not search shipping locations.")
      } finally {
        setSearching(false)
      }
    }, 350)
    return () => window.clearTimeout(timer)
  }, [search, origin.destinationLabel])

  function update<K extends keyof ShippingOrigin>(key: K, value: ShippingOrigin[K]) {
    setSaved(false)
    setOrigin((current) => ({ ...current, [key]: value }))
  }

  return <section className="space-y-5">
    <header className="border-b pb-4">
      <h2 className="text-xl font-semibold">Shipping origin</h2>
      <p className="mt-1 text-sm text-muted-foreground">Customers choose a destination and courier at checkout. Set the sender address used to calculate their rates.</p>
    </header>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {loading ? <p className="text-sm text-muted-foreground">Loading organization address…</p> : <form className="grid gap-4" onSubmit={async (event) => {
        event.preventDefault()
        if (!origin.destinationId) { setError("Choose a RajaOngkir origin location from the search results."); return }
        setSaving(true); setError(""); setSaved(false)
        try {
          await updateDoc(doc(manufacturerDb, "organizations", organization.id), { shippingOrigin: origin })
          setSaved(true)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "Could not save the shipping origin.")
        } finally { setSaving(false) }
      }}>
        <div className="divide-y border-y">
          <label className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_24rem] sm:items-center"><span className="font-medium">Sender / organization name</span><Input required value={origin.name} onChange={(event) => update("name", event.target.value)} /></label>
          <label className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_24rem] sm:items-center"><span className="font-medium">Sender phone</span><Input required type="tel" value={origin.phone} onChange={(event) => update("phone", event.target.value)} /></label>
          <label className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_24rem] sm:items-center"><span className="font-medium">Street address</span><Input required value={origin.addressLine} onChange={(event) => update("addressLine", event.target.value)} /></label>
          <label className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_24rem] sm:items-center"><span className="font-medium">Postal code</span><Input required value={origin.postalCode} onChange={(event) => update("postalCode", event.target.value)} /></label>
          <label className="grid gap-2 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_24rem] sm:items-center"><span className="font-medium">RajaOngkir origin area</span><Input required value={search} placeholder="Search city or district" onChange={(event) => { setSearch(event.target.value); update("destinationId", 0); update("destinationLabel", "") }} /></label>
        </div>
        {searching ? <p role="status" className="text-xs text-muted-foreground">Searching locations…</p> : destinations.length ? <div className="grid max-h-40 gap-1 overflow-y-auto rounded-md border p-1">{destinations.map((destination) => <button key={destination.id} type="button" className="rounded px-2 py-1.5 text-left text-sm hover:bg-muted" onClick={() => { update("destinationId", destination.id); update("destinationLabel", destination.label); setSearch(destination.label); setDestinations([]) }}>{destination.label}</button>)}</div> : null}
        <div className="flex items-center gap-3 border-t pt-4"><Button type="submit" disabled={saving || !origin.name.trim() || !origin.phone.trim() || !origin.addressLine.trim() || !origin.postalCode.trim() || !origin.destinationId}>{saving ? "Saving…" : "Save shipping origin"}</Button>{saved ? <p role="status" className="text-sm text-muted-foreground">Saved to this Organization.</p> : null}</div>
      </form>}
  </section>
}
