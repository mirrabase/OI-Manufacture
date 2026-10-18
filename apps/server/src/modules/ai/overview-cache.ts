import { randomUUID } from "node:crypto"
import { setTimeout } from "node:timers/promises"
import type { DocumentReference } from "firebase-admin/firestore"
import { freshOverviewCache } from "./data.ts"

export async function cachedOverview<T extends { generatedAt: number }>(
  ref: DocumentReference,
  fingerprint: string,
  generate: () => Promise<T>,
  validate: (value: unknown) => T | null
) {
  const owner = randomUUID()
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const state = await ref.firestore.runTransaction(async (tx) => {
      const doc = await tx.get(ref)
      const data = doc.data()
      const cached = validate(freshOverviewCache(data, fingerprint))
      if (cached) return { cached, acquired: false }
      if (data?.leaseUntil > Date.now())
        return { cached: null, acquired: false }
      tx.set(
        ref,
        { leaseOwner: owner, leaseUntil: Date.now() + 60_000 },
        { merge: true }
      )
      return { cached: null, acquired: true }
    })
    if (state.cached) return state.cached
    if (!state.acquired) {
      await setTimeout(250)
      continue
    }
    try {
      const response = await generate()
      await ref.firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref)
        if (doc.data()?.leaseOwner !== owner)
          throw new Error("Overview lease expired")
        tx.set(ref, {
          fingerprint,
          generatedAt: response.generatedAt,
          response,
          leaseOwner: null,
          leaseUntil: 0,
        })
      })
      return response
    } finally {
      await ref.firestore.runTransaction(async (tx) => {
        const doc = await tx.get(ref)
        if (doc.data()?.leaseOwner === owner)
          tx.set(ref, { leaseOwner: null, leaseUntil: 0 }, { merge: true })
      })
    }
  }
  throw new Error("AI Highlights refresh is already running; retry shortly")
}
