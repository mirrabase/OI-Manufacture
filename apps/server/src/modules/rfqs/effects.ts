import type {
  Firestore,
  DocumentData,
  DocumentSnapshot,
} from "firebase-admin/firestore"
import { sendRfqEmailForChange } from "../email/service.ts"
import { createManufacturerNotifications } from "../notifications/service.ts"

async function applyRfqEffects({
  db,
  rfqId,
  before,
  after,
  env = process.env,
}: {
  db: Firestore
  rfqId: string
  before?: DocumentData
  after: DocumentSnapshot
  env?: NodeJS.ProcessEnv
}) {
  const eventId = String(after.updateTime?.toMillis?.() || Date.now())
  const createdAt = after.updateTime?.toMillis?.() || Date.now()
  const current = after.data()!
  if (!current) return
  const effects = [
    createManufacturerNotifications(db, {
      before,
      after: current,
      rfqId,
      eventId,
      createdAt,
    }),
    sendRfqEmailForChange({
      before,
      after: current,
      rfqId,
      apiKey: env.RESEND_API_KEY || "",
      from: env.RESEND_FROM || "OI Manufacture <quotes@notify.mirrabase.com>",
      appOrigin: env.CUSTOMER_APP_ORIGIN || "http://localhost:3001",
    }),
  ]
  const results = await Promise.allSettled(effects)
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        "RFQ follow-up effect failed:",
        result.reason?.message || "unknown error"
      )
    }
  }
}

export { applyRfqEffects }
