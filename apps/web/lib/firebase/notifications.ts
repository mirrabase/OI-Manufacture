import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore"
import { manufacturerDb } from "@/lib/firebase/client"

export type ManufacturerNotification = {
  id: string
  organizationId: string
  recipientUid: string
  rfqId: string
  kind: string
  title: string
  message: string
  createdAt: number
  readAt?: number
}

export function listenToManufacturerNotifications(
  organizationId: string,
  recipientUid: string,
  onRows: (rows: ManufacturerNotification[]) => void,
  onError: (error: Error) => void
) {
  const notifications = query(
    collection(manufacturerDb, "notifications"),
    where("organizationId", "==", organizationId),
    where("recipientUid", "==", recipientUid),
    orderBy("createdAt", "desc"),
    limit(10)
  )
  return onSnapshot(
    notifications,
    (snapshot) => onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as ManufacturerNotification)),
    onError
  )
}

export function markManufacturerNotificationRead(id: string) {
  return updateDoc(doc(manufacturerDb, "notifications", id), { readAt: Date.now() })
}
