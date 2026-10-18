import { initializeApp, getApps } from "firebase-admin/app"
import { getAuth } from "firebase-admin/auth"
import { getFirestore } from "firebase-admin/firestore"
import { serve } from "@hono/node-server"
import { createApp } from "./app.ts"
import { createR2Store } from "./infrastructure/storage.ts"

if (!getApps().length)
  initializeApp({
    projectId:
      process.env.FIREBASE_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT,
  })
const db = getFirestore()
const auth = getAuth()
const storage = createR2Store()
const app = createApp({ db, auth, storage })
const port = Number(process.env.PORT || 8787)

serve(
  { fetch: app.fetch, port, hostname: process.env.HOST || "0.0.0.0" },
  (info) => {
    console.log(
      `OI Manufacture Hono API listening on ${info.address}:${info.port}`
    )
  }
)
