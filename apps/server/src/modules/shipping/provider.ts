export type ShippingDestination = {
  id: number
  label: string
  postalCode?: string
  scope?: "domestic" | "international"
}

import { AppError } from "../../shared/errors.ts"

const RAJA_ONGKIR_API = "https://rajaongkir.komerce.id/api/v1"
const DOMESTIC_COURIERS =
  "jne:sicepat:ide:sap:jnt:ninja:tiki:lion:anteraja:pos:ncs:rex:rpx:sentral:star:wahana:spx"
const INTERNATIONAL_COURIERS = "jne:tiki:pos"

class ShippingError extends AppError {}

async function rajaOngkirRequest(
  apiKey: string | undefined,
  path: string,
  {
    method = "GET",
    body,
    fetcher = fetch,
  }: { method?: string; body?: URLSearchParams; fetcher?: typeof fetch } = {}
) {
  if (!apiKey)
    throw new ShippingError(
      "failed-precondition",
      "Shipping is not configured. Please contact support."
    )
  let response
  try {
    response = await fetcher(`${RAJA_ONGKIR_API}/${path}`, {
      method,
      headers: {
        key: apiKey,
        ...(body
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}),
      },
      ...(body ? { body } : {}),
      signal: AbortSignal.timeout(15000),
    })
  } catch {
    throw new ShippingError(
      "unavailable",
      "RajaOngkir could not be reached. Try again shortly."
    )
  }
  const payload: {
    meta?: { status?: unknown; message?: string }
    data?: unknown
  } | null = await response.json().catch(() => null)
  if (
    response.status === 404 &&
    path.startsWith("destination/") &&
    /^(?:(?:domestic|international) )?destinations? data not found\.?$/i.test(
      payload?.meta?.message?.trim() || ""
    )
  ) {
    return { data: [] }
  }
  if (
    !response.ok ||
    !payload ||
    (payload.meta?.status !== undefined &&
      payload.meta.status !== "success" &&
      payload.meta.status !== true)
  ) {
    const message = [401, 403].includes(response.status)
      ? "Shipping provider credentials were rejected. Please contact support."
      : response.status === 429
        ? "Shipping provider request limit reached. Try again shortly."
        : "RajaOngkir is temporarily unavailable. Try again shortly."
    throw new ShippingError("unavailable", message)
  }
  return payload
}

async function searchShippingDestinations({
  apiKey,
  scope,
  search,
  fetcher,
}: {
  apiKey?: string
  scope: string
  search: string
  fetcher?: typeof fetch
}): Promise<ShippingDestination[]> {
  if (!search || search.trim().length < 2) return []
  if (!["auto", "domestic", "international"].includes(scope)) {
    throw new AppError(
      "invalid-argument",
      "Choose a domestic or international destination."
    )
  }
  async function searchScope(
    destinationScope: string
  ): Promise<ShippingDestination[]> {
    const params = new URLSearchParams({
      search: search.trim().slice(0, 80),
      limit: "10",
      offset: "0",
    })
    const path =
      destinationScope === "domestic"
        ? "destination/domestic-destination"
        : "destination/international-destination"
    const result = await rajaOngkirRequest(apiKey, `${path}?${params}`, {
      fetcher,
    })
    return (Array.isArray(result.data) ? result.data : []).flatMap(
      (value: unknown) => {
        if (!value || typeof value !== "object") return []
        const row = value as Record<string, unknown>
        const id = Number(
          row.id ?? row.destination_id ?? row.destination_code ?? row.country_id
        )
        const label =
          row.label ?? row.name ?? row.destination_name ?? row.country_name
        const postalCode = row.zip_code ?? row.postal_code ?? row.postalCode
        return Number.isSafeInteger(id) && id > 0 && typeof label === "string"
          ? [
              {
                id,
                label: label.slice(0, 200),
                ...(typeof postalCode === "string" && postalCode
                  ? { postalCode: postalCode.slice(0, 32) }
                  : {}),
              },
            ]
          : []
      }
    )
  }
  if (scope !== "auto") return searchScope(scope)

  const domestic = await searchScope("domestic")
  if (domestic.length)
    return domestic.map((destination) => ({
      ...destination,
      scope: "domestic",
    }))
  const international = await searchScope("international")
  return international.map((destination) => ({
    ...destination,
    scope: "international",
  }))
}

function normalizeRate(value: unknown) {
  if (!value || typeof value !== "object") return null
  const row = value as Record<string, unknown>
  const cost = Number(row.cost ?? row.value)
  const code = row.code ?? row.courier_code
  const name = row.name ?? row.courier_name
  const service = row.service ?? row.service_name
  if (
    !Number.isFinite(cost) ||
    cost < 0 ||
    typeof code !== "string" ||
    typeof name !== "string" ||
    typeof service !== "string"
  )
    return null
  const currency = typeof row.currency === "string" ? row.currency : "IDR"
  const exchangeRate = Number(row.currency_value)
  if (
    currency !== "IDR" &&
    (!Number.isFinite(exchangeRate) || exchangeRate <= 0)
  )
    return null
  const costIdr =
    currency === "IDR" ? Math.ceil(cost) : Math.ceil(cost * exchangeRate)
  if (!Number.isSafeInteger(costIdr) || costIdr < 0) return null
  const rateId = `${code}:${service}:${cost}:${currency}`
  return {
    id: rateId,
    courierCode: code,
    courierName: name,
    service,
    description:
      typeof row.description === "string" ? row.description.slice(0, 240) : "",
    cost: costIdr,
    etd: typeof row.etd === "string" ? row.etd.slice(0, 80) : "",
    currency: "IDR",
  }
}

async function calculateShippingRates({
  apiKey,
  scope,
  originId,
  destinationId,
  weightGrams,
  dimensionsMm = [],
  fetcher,
}: {
  apiKey?: string
  scope: string
  originId: number
  destinationId: number
  weightGrams: number
  dimensionsMm?: number[]
  fetcher?: typeof fetch
}) {
  if (
    !["domestic", "international"].includes(scope) ||
    !Number.isSafeInteger(Number(originId)) ||
    !Number.isSafeInteger(Number(destinationId)) ||
    !Number.isSafeInteger(weightGrams) ||
    weightGrams < 1
  ) {
    throw new AppError(
      "invalid-argument",
      "Shipping origin, destination, and package weight are required."
    )
  }
  const endpoint =
    scope === "domestic"
      ? "calculate/domestic-cost"
      : "calculate/international-cost"
  const params = new URLSearchParams({
    origin: String(originId),
    destination: String(destinationId),
    weight: String(weightGrams),
    courier: scope === "domestic" ? DOMESTIC_COURIERS : INTERNATIONAL_COURIERS,
    price: "lowest",
  })
  if (
    dimensionsMm.length === 3 &&
    dimensionsMm.every((value) => Number.isFinite(value) && value > 0)
  ) {
    const [length, width, height] = dimensionsMm.map((value) =>
      String(Math.max(1, Math.ceil(value / 10)))
    )
    params.set("length", length!)
    params.set("width", width!)
    params.set("height", height!)
  }
  const result = await rajaOngkirRequest(apiKey, endpoint, {
    method: "POST",
    body: params,
    fetcher,
  })
  return (Array.isArray(result.data) ? result.data : [])
    .map(normalizeRate)
    .filter(
      (
        rate: ReturnType<typeof normalizeRate>
      ): rate is NonNullable<typeof rate> => rate !== null
    )
}

export {
  ShippingError,
  calculateShippingRates,
  normalizeRate,
  rajaOngkirRequest,
  searchShippingDestinations,
}
