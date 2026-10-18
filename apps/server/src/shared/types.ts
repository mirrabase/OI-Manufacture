import type { Auth } from "firebase-admin/auth"
import type { Firestore } from "firebase-admin/firestore"
import type { createR2Store } from "../infrastructure/storage.ts"

export type R2Store = ReturnType<typeof createR2Store>
export type ServerEnv = { Variables: { uid: string } }
export type AppDependencies = {
  db: Firestore
  auth: Pick<Auth, "verifyIdToken">
  storage: R2Store
  env?: NodeJS.ProcessEnv
}
export type UserRequest = { db: Firestore; uid: string; rfqId: string }
