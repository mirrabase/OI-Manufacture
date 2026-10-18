"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { onAuthStateChanged } from "firebase/auth"
import { manufacturerAuth } from "@/lib/firebase/client"
import { resolveManufacturerOrganization } from "@/lib/firebase/organization-access"
import type { ManufacturerOrganization } from "@/lib/organization"

const OrganizationContext = createContext<ManufacturerOrganization | null>(null)

export function useManufacturerOrganization() {
  const organization = useContext(OrganizationContext)
  if (!organization) throw new Error("Manufacturer organization context is unavailable.")
  return organization
}

export function ManufacturerOrganizationProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const [organization, setOrganization] = useState<ManufacturerOrganization | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let generation = 0
    const unsubscribe = onAuthStateChanged(manufacturerAuth, (user) => {
      const current = ++generation
      setChecking(true)
      if (!user) {
        router.replace("/login")
        return
      }
      void resolveManufacturerOrganization(user).then((resolved) => {
        if (current !== generation) return
        if (!resolved) {
          router.replace("/waiting-list")
          return
        }
        setOrganization(resolved)
        setChecking(false)
      }).catch(() => {
        if (current === generation) {
          router.replace("/waiting-list")
        }
      })
    })
    return () => { generation++; unsubscribe() }
  }, [router])

  if (checking || !organization) return <main className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">Checking organization access…</main>
  return <OrganizationContext.Provider value={organization}>{children}</OrganizationContext.Provider>
}
