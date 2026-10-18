import type { Firestore } from "firebase-admin/firestore"
import type { UserRequest } from "../../shared/types.ts"
import type { ShippingDestination } from "./provider.ts"
import { AppError } from "../../shared/errors.ts"
import {
  calculateShippingRates,
  searchShippingDestinations,
} from "./provider.ts"

function requireUser(uid: string) {
  if (!uid)
    throw new AppError(
      "unauthenticated",
      "Sign in before requesting shipping rates."
    )
}

async function searchShippingLocations({
  uid,
  apiKey,
  scope,
  search,
}: {
  uid: string
  apiKey?: string
  scope: string
  search: string
}) {
  requireUser(uid)
  return {
    destinations: await searchShippingDestinations({ apiKey, scope, search }),
  }
}

async function getCustomerShippingRatePreview({
  db,
  uid,
  organizationId,
  destination,
  weightGrams,
  dimensionsMm,
  apiKey,
  fetcher,
}: {
  db: Firestore
  uid: string
  organizationId: string
  destination: ShippingDestination & { scope: "domestic" | "international" }
  weightGrams: number
  dimensionsMm: number[]
  apiKey?: string
  fetcher?: typeof fetch
}) {
  requireUser(uid)
  if (
    organizationId !== "demo" ||
    !destination ||
    !["domestic", "international"].includes(destination.scope) ||
    !Number.isSafeInteger(destination.id) ||
    destination.id < 1
  ) {
    throw new AppError(
      "invalid-argument",
      "Choose a valid delivery destination."
    )
  }
  if (
    !Number.isSafeInteger(weightGrams) ||
    weightGrams < 1 ||
    weightGrams > 100_000_000 ||
    !Array.isArray(dimensionsMm) ||
    dimensionsMm.length !== 3 ||
    dimensionsMm.some(
      (value) => !Number.isFinite(value) || value <= 0 || value > 10_000
    )
  ) {
    throw new AppError(
      "invalid-argument",
      "A valid estimated package weight and size are required."
    )
  }
  const organization = await db.doc(`organizations/${organizationId}`).get()
  const origin = organization.data()?.shippingOrigin
  if (
    !organization.exists ||
    organization.data()!.active !== true ||
    !origin ||
    !Number.isSafeInteger(origin.destinationId)
  ) {
    throw new AppError(
      "failed-precondition",
      "The Manufacturer has not configured a shipping origin yet."
    )
  }
  const rates = await calculateShippingRates({
    apiKey,
    scope: destination.scope,
    originId: origin.destinationId,
    destinationId: destination.id,
    weightGrams,
    dimensionsMm,
    fetcher,
  })
  if (!rates.length)
    throw new AppError(
      "unavailable",
      "RajaOngkir returned no services for this route."
    )
  return { rates, weightGrams, dimensionsMm }
}

async function getCustomerShippingRates({
  db,
  uid,
  rfqId,
  apiKey,
  fetcher,
}: UserRequest & { apiKey?: string; fetcher?: typeof fetch }) {
  requireUser(uid)
  if (typeof rfqId !== "string" || !rfqId.trim())
    throw new AppError("invalid-argument", "Request ID is required.")
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const snapshot = await rfqRef.get()
  if (!snapshot.exists) throw new AppError("not-found", "Request not found.")
  const rfq = snapshot.data()!
  if (rfq.ownerUid !== uid)
    throw new AppError(
      "permission-denied",
      "You cannot request rates for another customer's request."
    )
  if (
    !["Submitted", "Quoted"].includes(rfq.status) ||
    rfq.paymentStatus !== "Unpaid" ||
    (rfq.status === "Quoted" && !Number.isSafeInteger(rfq.quoteTotal))
  ) {
    throw new AppError(
      "failed-precondition",
      "Shipping rates are available after the request is submitted and its STL estimate is ready."
    )
  }
  const destination = rfq.shipping?.address?.destination
  if (
    !destination ||
    !["domestic", "international"].includes(destination.scope) ||
    !Number.isSafeInteger(destination.id)
  ) {
    throw new AppError(
      "failed-precondition",
      "Complete the delivery destination before requesting shipping rates."
    )
  }
  const organization = await db.doc(`organizations/${rfq.organizationId}`).get()
  const origin = organization.data()?.shippingOrigin
  if (
    !organization.exists ||
    organization.data()!.active !== true ||
    !origin ||
    !Number.isSafeInteger(origin.destinationId)
  ) {
    throw new AppError(
      "failed-precondition",
      "The Manufacturer has not configured a shipping origin yet."
    )
  }
  const gramsPerUnit = Number(rfq.estimate?.gramsPerUnit)
  const quantity = Number(rfq.requirements?.quantity)
  const weightGrams = Math.ceil(gramsPerUnit * quantity)
  if (
    rfq.estimate?.status !== "ready" ||
    !Number.isSafeInteger(weightGrams) ||
    weightGrams < 1
  ) {
    throw new AppError(
      "failed-precondition",
      "A successful print estimate is required to calculate shipping."
    )
  }
  const rates = await calculateShippingRates({
    apiKey,
    scope: destination.scope,
    originId: origin.destinationId,
    destinationId: destination.id,
    weightGrams,
    dimensionsMm: rfq.model?.boundingBoxMm,
    fetcher,
  })
  if (!rates.length)
    throw new AppError(
      "unavailable",
      "RajaOngkir returned no services for this route."
    )
  const now = Date.now()
  const expiresAt = now + 15 * 60 * 1000
  await db.doc(`shippingRateQuotes/${rfqId}`).set({
    rfqId,
    ownerUid: uid,
    organizationId: rfq.organizationId,
    destinationId: destination.id,
    scope: destination.scope,
    quoteTotal: Number.isSafeInteger(rfq.quoteTotal) ? rfq.quoteTotal : null,
    weightGrams,
    dimensionsMm: rfq.model?.boundingBoxMm ?? [],
    rates,
    createdAt: now,
    expiresAt,
  })
  return {
    rates,
    weightGrams,
    dimensionsMm: rfq.model?.boundingBoxMm ?? [],
    expiresAt,
  }
}

function normalizeShippingAddress(value: unknown) {
  if (!value || typeof value !== "object") {
    throw new AppError(
      "invalid-argument",
      "Enter a delivery address before choosing a courier."
    )
  }
  const address = value as Record<string, unknown>
  const destination = address.destination as
    (ShippingDestination & { scope: "domestic" | "international" }) | undefined
  const fields = [
    "recipientName",
    "phone",
    "addressLine",
    "postalCode",
  ] as const
  if (
    fields.some(
      (field) => typeof address[field] !== "string" || !address[field].trim()
    )
  ) {
    throw new AppError(
      "invalid-argument",
      "Complete the recipient, phone, street address, and postal code."
    )
  }
  if (
    !destination ||
    !["domestic", "international"].includes(destination.scope) ||
    !Number.isSafeInteger(destination.id) ||
    destination.id < 1 ||
    typeof destination.label !== "string" ||
    !destination.label.trim()
  ) {
    throw new AppError(
      "invalid-argument",
      "Choose a delivery destination from the location results."
    )
  }
  return {
    recipientName: (address.recipientName as string).trim().slice(0, 120),
    phone: (address.phone as string).trim().slice(0, 40),
    addressLine: (address.addressLine as string).trim().slice(0, 300),
    postalCode: (address.postalCode as string).trim().slice(0, 32),
    destination: {
      scope: destination.scope,
      id: destination.id,
      label: destination.label.trim().slice(0, 200),
    },
  }
}

async function saveCustomerShippingAddress({
  db,
  uid,
  rfqId,
  address,
}: UserRequest & { address: unknown }) {
  requireUser(uid)
  if (typeof rfqId !== "string" || !rfqId.trim()) {
    throw new AppError("invalid-argument", "Request ID is required.")
  }
  const normalizedAddress = normalizeShippingAddress(address)
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const ratesRef = db.doc(`shippingRateQuotes/${rfqId}`)
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rfqRef)
    if (!snapshot.exists) throw new AppError("not-found", "Request not found.")
    const rfq = snapshot.data()!
    if (rfq.ownerUid !== uid) {
      throw new AppError(
        "permission-denied",
        "You cannot change another customer's delivery address."
      )
    }
    if (
      !["Submitted", "Quoted"].includes(rfq.status) ||
      rfq.paymentStatus !== "Unpaid" ||
      rfq.activeKaseraPaymentAttemptId
    ) {
      throw new AppError(
        "failed-precondition",
        "Delivery details can only be changed before checkout starts."
      )
    }
    if (
      rfq.status === "Quoted" &&
      (!Number.isSafeInteger(rfq.quoteTotal) || rfq.quoteTotal < 1)
    ) {
      throw new AppError(
        "failed-precondition",
        "A valid quotation is required before changing delivery details."
      )
    }
    transaction.update(rfqRef, { shipping: { address: normalizedAddress } })
    transaction.delete(ratesRef)
  })
  return { ok: true, address: normalizedAddress }
}

async function selectCustomerShippingRate({
  db,
  uid,
  rfqId,
  rateId,
}: UserRequest & { rateId: string }) {
  requireUser(uid)
  if (
    typeof rfqId !== "string" ||
    !rfqId.trim() ||
    typeof rateId !== "string" ||
    !rateId.trim()
  ) {
    throw new AppError(
      "invalid-argument",
      "Request and shipping service are required."
    )
  }
  const rfqRef = db.doc(`rfqs/${rfqId}`)
  const rateRef = db.doc(`shippingRateQuotes/${rfqId}`)
  await db.runTransaction(async (transaction) => {
    const [rfqSnapshot, rateSnapshot] = await Promise.all([
      transaction.get(rfqRef),
      transaction.get(rateRef),
    ])
    if (!rfqSnapshot.exists)
      throw new AppError("not-found", "Request not found.")
    if (!rateSnapshot.exists || rateSnapshot.data()!.expiresAt <= Date.now()) {
      throw new AppError(
        "failed-precondition",
        "Shipping rates expired. Refresh the rates and choose again."
      )
    }
    const rfq = rfqSnapshot.data()!
    const rates = rateSnapshot.data()!
    if (rfq.ownerUid !== uid || rates.ownerUid !== uid)
      throw new AppError(
        "permission-denied",
        "You cannot change another customer's shipping service."
      )
    if (
      !["Submitted", "Quoted"].includes(rfq.status) ||
      rfq.paymentStatus !== "Unpaid" ||
      rfq.activeKaseraPaymentAttemptId
    ) {
      throw new AppError(
        "failed-precondition",
        "Shipping cannot be changed after checkout has started."
      )
    }
    const currentQuoteTotal = Number.isSafeInteger(rfq.quoteTotal)
      ? rfq.quoteTotal
      : null
    if (
      rates.organizationId !== rfq.organizationId ||
      (rates.quoteTotal !== null && rates.quoteTotal !== currentQuoteTotal) ||
      rates.scope !== rfq.shipping?.address?.destination?.scope ||
      rates.destinationId !== rfq.shipping?.address?.destination?.id
    ) {
      throw new AppError(
        "failed-precondition",
        "The request changed. Refresh shipping rates and choose again."
      )
    }
    const selected = rates.rates.find(
      (rate: { id: string }) => rate.id === rateId
    )
    if (!selected)
      throw new AppError(
        "invalid-argument",
        "Choose a shipping service returned for this request."
      )
    const shipping = rfq.shipping
    transaction.update(rfqRef, {
      shipping: {
        ...shipping,
        selection: {
          ...selected,
          weightGrams: rates.weightGrams,
          dimensionsMm: rates.dimensionsMm,
          estimatedAt: rates.createdAt,
        },
      },
    })
  })
  return { ok: true }
}

export {
  getCustomerShippingRatePreview,
  getCustomerShippingRates,
  normalizeShippingAddress,
  saveCustomerShippingAddress,
  searchShippingLocations,
  selectCustomerShippingRate,
}
