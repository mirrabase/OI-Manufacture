"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { onAuthStateChanged, signOut, type User } from "firebase/auth"
import { Building2Icon, LogOutIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { manufacturerAuth } from "@/lib/firebase/client"
import { DEMO_ORGANIZATION_NAME } from "@/lib/organization"
import { resolveManufacturerOrganization } from "@/lib/firebase/organization-access"

export function OrganizationWaitlist() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [checking, setChecking] = useState(true)

  useEffect(() => onAuthStateChanged(manufacturerAuth, (nextUser) => {
    if (!nextUser) {
      router.replace("/login")
      return
    }
    setUser(nextUser)
    void resolveManufacturerOrganization(nextUser).then((organization) => {
      if (organization) router.replace("/-/overview")
      else setChecking(false)
    }).catch(() => setChecking(false))
  }), [router])

  if (checking || !user) return <main className="grid min-h-svh place-items-center p-6 text-sm text-muted-foreground">Checking your access…</main>
  return <main className="grid min-h-svh place-items-center p-6">
    <section className="grid w-full max-w-lg gap-5 rounded-xl border bg-card p-6 shadow-sm">
      <div className="grid size-11 place-items-center rounded-lg bg-muted"><Building2Icon className="size-5" /></div>
      <div className="grid gap-2">
        <p className="text-sm font-medium text-muted-foreground">{DEMO_ORGANIZATION_NAME}</p>
        <h1 className="text-2xl font-semibold">You’re on the waiting list</h1>
        <p className="text-sm text-muted-foreground">Your Google account is signed in, but access to the hackathon demo workspace is limited. We’ll enable your account when a spot is available.</p>
        <p className="text-sm">{user.email}</p>
      </div>
      <Button variant="outline" className="w-fit" onClick={async () => { await signOut(manufacturerAuth); router.replace("/login") }}><LogOutIcon /> Sign out</Button>
    </section>
  </main>
}
