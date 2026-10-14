import { collection, doc, getDoc, onSnapshot, orderBy, query, setDoc, updateDoc, where } from "firebase/firestore"
import { getBytes, ref, uploadBytes } from "firebase/storage"
import type { CustomerRFQ } from "@/lib/customer-portal"
import { auth, db, storage, manufacturerDb, manufacturerStorage } from "@/lib/firebase/client"

export function listenToCustomerRequests(ownerUid: string, onRows: (rows: (CustomerRFQ & { id: string })[]) => void, onError: (error: Error) => void) {
  const requests = query(collection(db, "rfqs"), where("ownerUid", "==", ownerUid), orderBy("createdAt", "desc"))
  return onSnapshot(requests, (snapshot) => onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CustomerRFQ & { id: string })), onError)
}

export function listenToManufacturerRequests(onRows: (rows: (CustomerRFQ & { id: string })[]) => void, onError: (error: Error) => void) {
  const requests = query(collection(manufacturerDb, "rfqs"), where("status", "in", ["Submitted", "Quoted", "In Production"]), orderBy("submittedAt", "desc"))
  return onSnapshot(requests, (snapshot) => onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as CustomerRFQ & { id: string })), onError)
}

export async function setCustomerRequestQuote(id: string, quoteTotal: number) {
  if (!Number.isSafeInteger(quoteTotal) || quoteTotal < 1) throw new Error("Enter a positive whole IDR amount.")
  await updateDoc(doc(manufacturerDb, "rfqs", id), { status: "Quoted", quoteTotal, paymentStatus: "Unpaid", quotedAt: Date.now() })
}

export async function setCustomerRequestPaid(id: string) {
  await updateDoc(doc(manufacturerDb, "rfqs", id), { status: "In Production", paymentStatus: "Paid", paidAt: Date.now() })
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
  await uploadBytes(ref(storage, draft.model.storagePath), file, { contentType: "model/stl" })
  await updateDoc(target, { status: "Submitted", submittedAt: Date.now() })
}

export async function downloadModel(path: string, name: string, asManufacturer = false) {
  const bytes = await getBytes(ref(asManufacturer ? manufacturerStorage : storage, path), 50 * 1024 * 1024)
  const url = URL.createObjectURL(new Blob([bytes], { type: "model/stl" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
