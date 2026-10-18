"use client"

import { useEffect, useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import { manufacturerAuth } from "@/lib/firebase/client"
import { useManufacturerOrganization } from "./organization-provider"
import { PricingSettings } from "./pricing-settings"
import { ShippingSettings } from "./shipping-settings"

type SettingsSection = "account" | "billing" | "pricing" | "shipping"

const groups: { label: string; sections: { id: SettingsSection; label: string }[] }[] = [
  { label: "Your account", sections: [
    { id: "account", label: "Account" },
    { id: "billing", label: "Billing" },
  ] },
  { label: "Organization", sections: [
    { id: "pricing", label: "Pricing and slicing" },
    { id: "shipping", label: "Shipping origin" },
  ] },
]

export function OrganizationSettings() {
  const [active, setActive] = useState<SettingsSection>("pricing")

  useEffect(() => {
    const syncSection = () => {
      const section = window.location.hash.slice(1)
      if (groups.some((group) => group.sections.some((item) => item.id === section))) setActive(section as SettingsSection)
    }
    syncSection()
    window.addEventListener("hashchange", syncSection)
    return () => window.removeEventListener("hashchange", syncSection)
  }, [])

  function selectSection(section: SettingsSection) {
    setActive(section)
    window.history.replaceState(null, "", `#${section}`)
  }

  return <main className="mx-auto grid min-h-[calc(100svh-5.5rem)] w-full max-w-7xl grid-cols-1 gap-6 px-4 pb-8 md:h-[calc(100svh-var(--header-height)-3rem)] md:min-h-0 md:grid-cols-[13rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:items-stretch md:gap-8 md:overflow-hidden md:px-6">
    <aside className="min-w-0 md:pr-5">
      <h1 className="mb-4 text-xl font-semibold">Settings</h1>
      <nav aria-label="Settings sections" className="flex gap-5 overflow-x-auto border-b pb-2 md:flex-col md:gap-5 md:overflow-visible md:border-0 md:pb-0">
        {groups.map((group) => <div key={group.label} className="grid shrink-0 gap-1">
          <p className="px-3 pb-1 text-xs font-semibold text-muted-foreground">{group.label}</p>
          {group.sections.map((section) => <button
            key={section.id}
            type="button"
            aria-current={active === section.id ? "page" : undefined}
            onClick={() => selectSection(section.id)}
            className={`shrink-0 rounded-r-md border-b-2 px-3 py-2 text-left text-sm transition-colors md:w-full md:border-b-0 md:border-l-2 md:py-1.5 ${active === section.id ? "border-primary bg-muted font-medium text-foreground md:bg-muted/60" : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}
          >{section.label}</button>)}
        </div>)}
      </nav>
    </aside>
    <div className="min-h-0 min-w-0 max-w-4xl md:h-full md:overflow-y-auto md:overscroll-contain md:border-l md:pl-8 md:pr-3">
      <div className={active === "account" ? "" : "hidden"}><AccountSettings /></div>
      <div className={active === "billing" ? "" : "hidden"}><BillingSettings /></div>
      <div className={active === "pricing" ? "" : "hidden"}><PricingSettings /></div>
      <div className={active === "shipping" ? "" : "hidden"}><ShippingSettings /></div>
    </div>
  </main>
}

function AccountSettings() {
  const organization = useManufacturerOrganization()
  const user = manufacturerAuth.currentUser
  const name = user?.displayName || user?.email?.split("@")[0] || "—"

  return <SettingsSection title="Account" description="Account used to sign in to this organization.">
    <dl className="divide-y border-y">
      <SettingRow label="Name" value={name} />
      <SettingRow label="Email" value={user?.email || "—"} />
      <SettingRow label="Organization" value={organization.name} />
    </dl>
  </SettingsSection>
}

function BillingSettings() {
  return <SettingsSection title="Billing" description="Plan and billing details for this organization.">
    <div className="divide-y border-y">
      <div className="flex items-center justify-between gap-4 py-4">
        <div><p className="text-sm font-medium">Current plan</p><p className="mt-1 text-sm text-muted-foreground">Plan shown in the organization header</p></div>
        <Badge variant="outline">FREE</Badge>
      </div>
      <p className="py-4 text-sm text-muted-foreground">Billing management is not connected yet.</p>
    </div>
  </SettingsSection>
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="space-y-5">
    <header className="border-b pb-4"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></header>
    {children}
  </section>
}

function SettingRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 py-3 sm:grid-cols-[minmax(0,1fr)_24rem] sm:items-center"><dt className="text-sm font-medium">{label}</dt><dd className="break-all text-sm text-muted-foreground">{value}</dd></div>
}
