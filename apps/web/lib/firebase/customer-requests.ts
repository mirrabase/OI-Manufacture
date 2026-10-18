import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore"
import type { CustomerRFQ } from "@/lib/customer-portal"
import { auth, db, manufacturerDb } from "@/lib/firebase/client"
import { callApi, fetchRfqObject, uploadRfqModel } from "@/lib/firebase/api"

export function listenToCustomerRequests(ownerUid: string, onRows: (rows: (CustomerRFQ & { id: string })[]) => void, onError: (error: Error) => void) {
  const requests = query(collection(db, "rfqs"), where("ownerUid", "==", ownerUid), orderBy("createdAt", "desc"))
  return onSnapshot(requests, (snapshot) => onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CustomerRFQ & { id: string })), onError)
}

export function listenToCustomerRequest(id: string, onRow: (row: (CustomerRFQ & { id: string }) | null) => void, onError: (error: Error) => void) {
  const target = doc(db, "rfqs", id)
  return onSnapshot(target, (snapshot) => {
    if (!snapshot.exists()) onRow(null)
    else onRow({ id: snapshot.id, ...snapshot.data() } as CustomerRFQ & { id: string })
  }, onError)
}

export function listenToManufacturerRequests(organizationId: string, onRows: (rows: (CustomerRFQ & { id: string })[]) => void, onError: (error: Error) => void) {
  const requests = query(collection(manufacturerDb, "rfqs"), where("organizationId", "==", organizationId), where("status", "in", ["Submitted", "Under Review", "Quoted", "Preparing Production", "In Production", "Completed", "Closed"]))
  return onSnapshot(requests, (snapshot) => onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CustomerRFQ & { id: string }).sort((a, b) => (b.submittedAt ?? b.createdAt) - (a.submittedAt ?? a.createdAt))), onError)
}

export async function setCustomerRequestQuote(id: string, quoteTotal: number) {
  if (!Number.isSafeInteger(quoteTotal) || quoteTotal < 1) throw new Error("Enter a positive whole IDR amount.")
  await callApi(`rfqs/${encodeURIComponent(id)}/quote`, { quoteTotal }, true, "PUT")
}

export async function requestEstimate(id: string) {
  await updateDoc(doc(manufacturerDb, "rfqs", id), { estimateRequestedAt: Date.now() })
}

export async function submitCustomerRequest(id: string, file: File, draft: CustomerRFQ) {
  const ownerUid = auth.currentUser?.uid
  if (!ownerUid || draft.ownerUid !== ownerUid) throw new Error("Your guest session expired. Reload the page and try again.")
  const target = doc(db, "rfqs", id)
  const existing = await getDoc(target)
  if (!existing.exists()) await setDoc(target, draft)
  else if (existing.data().ownerUid !== ownerUid || existing.data().status !== "Draft") throw new Error("This request was already submitted. Refresh your request list.")
  await uploadRfqModel(id, file, draft.model.storagePath)
}

export async function downloadModel(path: string, name: string, asManufacturer = false) {
  const bytes = await fetchRfqObject(path, asManufacturer)
  const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
