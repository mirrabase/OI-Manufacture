import { doc, onSnapshot, setDoc } from "firebase/firestore"
import { manufacturerDb } from "./client"
import { validatePricing, type Pricing } from "@/lib/pricing"

export function listenToPricing(organizationId: string, onValue: (pricing: Pricing | null) => void, onError: (error: Error) => void) {
  return onSnapshot(doc(manufacturerDb, "pricing", organizationId), (snapshot) => onValue(snapshot.exists() ? snapshot.data() as Pricing : null), onError)
}

export async function savePricing(organizationId: string, pricing: Pricing) {
  validatePricing(pricing)
  await setDoc(doc(manufacturerDb, "pricing", organizationId), pricing)
}
