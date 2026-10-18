import { auth, manufacturerAuth } from "./client"

function apiOrigin() {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "")
  if (process.env.NODE_ENV !== "production") return "http://127.0.0.1:8787"
  throw new Error("NEXT_PUBLIC_API_URL is missing from the static web build.")
}

async function requestApi(path: string, init: RequestInit = {}, asManufacturer = false) {
  const currentAuth = asManufacturer ? manufacturerAuth : auth
  const token = await currentAuth.currentUser?.getIdToken()
  if (!token) throw new Error("Sign in to continue.")
  const response = await fetch(`${apiOrigin()}/api/${path.replace(/^\//, "")}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(payload?.error?.message || `Request failed (HTTP ${response.status}).`)
  }
  return response
}

export async function callApi<T>(path: string, body: unknown = {}, asManufacturer = false, method = "POST"): Promise<T> {
  const response = await requestApi(path, { method, body: JSON.stringify(body) }, asManufacturer)
  return response.json() as Promise<T>
}

export async function uploadRfqModel(rfqId: string, file: File, storagePath: string) {
  const ticket = await callApi<{ url: string; headers: Record<string, string>; requiresAuth: boolean }>("storage/upload-url", {
    rfqId,
    size: file.size,
  })
  const headers = new Headers(ticket.headers)
  if (ticket.requiresAuth) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new Error("Sign in to continue.")
    headers.set("Authorization", `Bearer ${token}`)
  }
  const response = await fetch(ticket.url, { method: "PUT", headers, body: file })
  if (!response.ok) throw new Error("The STL upload failed. Try again.")
  await callApi(`rfqs/${encodeURIComponent(rfqId)}/submit`, { storagePath })
}

export async function fetchRfqObject(path: string, asManufacturer = false) {
  const response = await requestApi(`storage/objects?path=${encodeURIComponent(path)}`, {}, asManufacturer)
  return new Uint8Array(await response.arrayBuffer())
}
