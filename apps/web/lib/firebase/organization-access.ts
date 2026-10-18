import { doc, getDoc, setDoc } from "firebase/firestore"
import type { User } from "firebase/auth"
import { manufacturerAuth, manufacturerDb } from "./client"
import { DEMO_ORGANIZATION_ID } from "@/lib/organization"

export async function resolveManufacturerOrganization(user: User) {
  const membership = await getDoc(doc(manufacturerDb, "manufacturers", user.uid))
  const organizationId = membership.data()?.organizationId
  if (membership.data()?.active === true && typeof organizationId === "string") {
    const organization = await getDoc(doc(manufacturerDb, "organizations", organizationId))
    if (organization.exists() && organization.data().active === true) {
      return { id: organization.id, name: organization.data().name as string }
    }
  }

  const waitlist = doc(manufacturerDb, "organizationWaitlist", user.uid)
  if (!(await getDoc(waitlist)).exists()) {
    await setDoc(waitlist, {
      email: user.email ?? "",
      displayName: user.displayName ?? "",
      requestedOrganizationId: DEMO_ORGANIZATION_ID,
      createdAt: Date.now(),
    })
  }
  return null
}

export async function getCurrentOrganizationId() {
  const user = manufacturerAuth.currentUser
  if (!user) throw new Error("Sign in to access this organization.")
  const membership = await getDoc(doc(manufacturerDb, "manufacturers", user.uid))
  if (membership.data()?.active !== true || typeof membership.data()?.organizationId !== "string") {
    throw new Error("This account is not an active organization member.")
  }
  return membership.data()!.organizationId as string
}
