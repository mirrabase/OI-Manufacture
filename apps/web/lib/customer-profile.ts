import type { ShippingAddress } from "./customer-portal"

export type CustomerProfile = {
  name?: string
  email?: string
  shipping?: ShippingAddress
}

function profileKey(uid: string) {
  return `oi-customer-profile:${uid}`
}

export function readCustomerProfile(uid: string): CustomerProfile | null {
  if (typeof window === "undefined") return null
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(profileKey(uid)) || "null")
    if (!value || typeof value !== "object") return null
    const profile = value as Record<string, unknown>
    const shippingValue = profile.shipping
    let shipping: ShippingAddress | undefined
    if (shippingValue && typeof shippingValue === "object") {
      const candidate = shippingValue as Partial<ShippingAddress>
      if (
        typeof candidate.recipientName === "string" &&
        typeof candidate.phone === "string" &&
        typeof candidate.addressLine === "string" &&
        typeof candidate.postalCode === "string" &&
        candidate.destination &&
        ["domestic", "international"].includes(candidate.destination.scope) &&
        Number.isSafeInteger(candidate.destination.id) &&
        typeof candidate.destination.label === "string"
      ) {
        shipping = candidate as ShippingAddress
      }
    }
    return {
      ...(typeof profile.name === "string" ? { name: profile.name } : {}),
      ...(typeof profile.email === "string" ? { email: profile.email } : {}),
      ...(shipping ? { shipping } : {}),
    }
  } catch {
    return null
  }
}

export function saveCustomerProfile(uid: string, profile: CustomerProfile) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(profileKey(uid), JSON.stringify(profile))
  } catch {
    // Keep customer checkout usable when browser storage is disabled or full.
  }
}
