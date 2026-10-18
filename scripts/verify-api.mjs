import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const apiPort = Number(process.env.OI_VERIFY_API_PORT || 18081)
const apiOrigin = `http://127.0.0.1:${apiPort}`
const localR2Url = process.env.R2_LOCAL_WORKER_URL || "http://127.0.0.1:8788"
const localR2Token = process.env.R2_LOCAL_TOKEN || "oi-local-r2-only-token"
const authEmulator =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:19099"

for (const [name, value] of Object.entries({
  apiOrigin,
  localR2Url,
  authEmulator: `http://${authEmulator}`,
})) {
  const url = new URL(value)
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
    throw new Error(`${name} must point to a loopback address.`)
}
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535)
  throw new Error("OI_VERIFY_API_PORT must be a valid port.")

process.env.GCLOUD_PROJECT = "demo-oi-manufacture"
process.env.GOOGLE_CLOUD_PROJECT = "demo-oi-manufacture"
process.env.FIREBASE_PROJECT_ID = "demo-oi-manufacture"
process.env.FIREBASE_AUTH_EMULATOR_HOST = authEmulator
process.env.FIRESTORE_EMULATOR_HOST ||= "127.0.0.1:18080"
process.env.R2_LOCAL_WORKER_URL = localR2Url
process.env.R2_LOCAL_TOKEN = localR2Token
for (const key of [
  "GOOGLE_GENAI_API_KEY",
  "KASERA_API_KEY",
  "KASERA_WEBHOOK_SECRET",
  "RAJAONGKIR_API_KEY",
  "RESEND_API_KEY",
]) {
  process.env[key] = ""
}

const { db, auth, seedLocalData } = await import("./local-firebase.mjs")
const { createR2Store } = await import("../apps/server/src/infrastructure/storage.ts")
const storage = createR2Store(process.env)
const r2HealthUrl = `${localR2Url.replace(/\/$/, "")}/_r2/?key=health`
const serverEnv = {
  ...process.env,
  PORT: String(apiPort),
  HOST: "127.0.0.1",
  API_PUBLIC_URL: apiOrigin,
  CUSTOMER_APP_ORIGIN: "http://localhost:3001",
  API_CORS_ORIGINS: "http://localhost:3001",
}
let r2Process
let apiProcess
let output = ""
let failure
let ownerUid
let filePath
const rfqId = `verify-api-${randomUUID()}`
const materialId = `${rfqId}-material`
const equipmentId = `${rfqId}-equipment`

function start(command, args, cwd, env = process.env) {
  const child = spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  })
  child.stdout.on("data", (chunk) => {
    output += chunk
  })
  child.stderr.on("data", (chunk) => {
    output += chunk
  })
  return child
}

async function waitFor(check, child, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child && (child.exitCode !== null || child.signalCode !== null))
      throw new Error(`${label} stopped before it became ready.`)
    if (await check()) return
    await delay(250)
  }
  throw new Error(
    `Timed out waiting for ${label}.${output ? `\n${output}` : ""}`
  )
}

async function r2Ready() {
  try {
    const response = await fetch(r2HealthUrl, {
      method: "HEAD",
      headers: { "x-local-r2-token": localR2Token },
    })
    if (response.status === 401)
      throw new Error(
        "Local R2 token does not match apps/server/wrangler.jsonc."
      )
    return response.status === 404
  } catch (error) {
    if (error.message.includes("token does not match")) throw error
    return false
  }
}

async function apiReady() {
  try {
    const response = await fetch(`${apiOrigin}/health`)
    return response.ok && (await response.json()).ok === true
  } catch {
    return false
  }
}

async function authRequest(method, body) {
  const response = await fetch(
    `http://${authEmulator}/identitytoolkit.googleapis.com/v1/${method}?key=demo-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  )
  const payload = await response.json()
  if (!response.ok)
    throw new Error(
      `Firebase Auth Emulator rejected ${method}: ${payload.error?.message || response.status}`
    )
  return payload
}

async function api(path, token, { method = "POST", body } = {}) {
  const response = await fetch(`${apiOrigin}/api/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  const text = await response.text()
  if (!response.ok)
    throw new Error(
      `${method} /api/${path} returned ${response.status}: ${text}`
    )
  return text ? JSON.parse(text) : null
}

async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  try {
    if (process.platform === "win32") child.kill("SIGTERM")
    else process.kill(-child.pid, "SIGTERM")
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
  await Promise.race([
    new Promise((resolveExit) => child.once("exit", resolveExit)),
    delay(5000),
  ])
  if (child.exitCode === null && child.signalCode === null) {
    try {
      if (process.platform === "win32") child.kill("SIGKILL")
      else process.kill(-child.pid, "SIGKILL")
    } catch (error) {
      if (error.code !== "ESRCH") throw error
    }
  }
}

try {
  if (!(await r2Ready())) {
    r2Process = start(
      "pnpm",
      ["--filter", "@oi-manufacture/server", "r2:dev"],
      root,
      serverEnv
    )
    await waitFor(r2Ready, r2Process, "local Wrangler R2")
  }
  if (await apiReady())
    throw new Error(
      `Port ${apiPort} is already serving an API. Set OI_VERIFY_API_PORT to a free loopback port.`
    )
  apiProcess = start(
    process.execPath,
    ["--env-file-if-exists=.env.local", "src/index.ts"],
    resolve(root, "apps/server"),
    serverEnv
  )
  await waitFor(apiReady, apiProcess, "isolated Hono API")

  await seedLocalData()
  const preflight = await fetch(`${apiOrigin}/api/storage/upload-url`, {
    method: "OPTIONS",
    headers: {
      Origin: "http://localhost:3001",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  })
  assert.equal(preflight.status, 204)
  assert.equal(
    preflight.headers.get("access-control-allow-origin"),
    "http://localhost:3001"
  )
  const unauthorized = await fetch(`${apiOrigin}/api/production/lead-time`, {
    method: "POST",
  })
  assert.equal(unauthorized.status, 401)

  const customer = await authRequest("accounts:signUp", {
    returnSecureToken: true,
  })
  ownerUid = customer.localId
  const manufacturer = await authRequest("accounts:signInWithPassword", {
    email: "manufacturer@oi.local",
    password: "local-manufacturer-123",
    returnSecureToken: true,
  })
  filePath = `rfqs/${ownerUid}/${rfqId}/model.stl`
  const file = Buffer.from(
    "synthetic STL for local Hono, Firebase, and R2 integration verification"
  )
  const now = Date.now()

  await db.doc(`rfqs/${rfqId}`).set({
    organizationId: "demo",
    ownerUid,
    customer: { name: "API verification", email: "" },
    product: "API verification part",
    requirements: {
      quantity: 1,
      material: "Tough Resin",
      process: "SLA",
      unit: "mm",
      notes: "",
    },
    model: {
      name: "model.stl",
      size: file.length,
      contentType: "model/stl",
      storagePath: filePath,
      boundingBoxMm: [10, 10, 10],
    },
    estimate: {
      status: "unsupported",
      requestedAt: 0,
      error: "Synthetic integration fixture.",
    },
    status: "Draft",
    paymentStatus: "Unpaid",
    createdAt: now,
  })

  const ticket = await api("storage/upload-url", customer.idToken, {
    body: { rfqId, size: file.length },
  })
  assert.equal(ticket.requiresAuth, true)
  const uploaded = await fetch(ticket.url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${customer.idToken}`,
      "Content-Type": "model/stl",
      "Content-Length": String(file.length),
    },
    body: file,
  })
  assert.equal(
    uploaded.status,
    204,
    `Local R2 upload returned ${uploaded.status}.`
  )
  await api(`rfqs/${encodeURIComponent(rfqId)}/submit`, customer.idToken, {
    body: { storagePath: filePath },
  })
  assert.equal((await db.doc(`rfqs/${rfqId}`).get()).data().status, "Submitted")

  const downloaded = await fetch(
    `${apiOrigin}/api/storage/objects?path=${encodeURIComponent(filePath)}`,
    {
      headers: { Authorization: `Bearer ${customer.idToken}` },
    }
  )
  assert.equal(downloaded.status, 200)
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), file)

  await api(`rfqs/${encodeURIComponent(rfqId)}/quote`, manufacturer.idToken, {
    method: "PUT",
    body: { quoteTotal: 42000 },
  })
  await api("shipping/address", customer.idToken, {
    body: {
      rfqId,
      address: {
        recipientName: "API verification",
        phone: "081234567890",
        addressLine: "Jalan Uji 1",
        postalCode: "12930",
        destination: {
          scope: "domestic",
          id: 17578,
          label: "Karet Semanggi, Jakarta",
        },
      },
    },
  })

  const rateId = `verify:${rfqId}`
  await db.doc(`shippingRateQuotes/${rfqId}`).set({
    rfqId,
    ownerUid,
    organizationId: "demo",
    destinationId: 17578,
    scope: "domestic",
    quoteTotal: 42000,
    weightGrams: 100,
    dimensionsMm: [10, 10, 10],
    rates: [
      {
        id: rateId,
        courierCode: "test",
        courierName: "Test courier",
        service: "Test",
        description: "Local test rate",
        cost: 1000,
        etd: "1 day",
        currency: "IDR",
      },
    ],
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  })
  await api("shipping/select", customer.idToken, { body: { rfqId, rateId } })
  await api("payments/manual-confirm", manufacturer.idToken, {
    body: { rfqId },
  })
  assert.equal(
    (await db.doc(`rfqs/${rfqId}`).get()).data().status,
    "Preparing Production"
  )

  await db.doc(`materials/${materialId}`).set({
    organizationId: "demo",
    name: "Verification material",
    stock: 2,
    reserved: 0.5,
    updatedAt: Date.now(),
  })
  await db.doc(`equipment/${equipmentId}`).set({
    organizationId: "demo",
    name: "Verification printer",
    status: "Scheduled",
    scheduledHours: 1,
    compatibleMaterialIds: [materialId],
    updatedAt: Date.now(),
  })
  await db.doc(`productionOrders/${rfqId}`).update({
    status: "Scheduled",
    materialId,
    equipmentId,
    plannedGrams: 500,
    plannedHours: 1,
    reservedKg: 0.5,
    updatedAt: Date.now(),
  })
  await api(
    `rfqs/${encodeURIComponent(rfqId)}/production/start`,
    manufacturer.idToken
  )
  await api(
    `rfqs/${encodeURIComponent(rfqId)}/production/complete`,
    manufacturer.idToken,
    { body: { actualGrams: 200 } }
  )

  assert.equal((await db.doc(`rfqs/${rfqId}`).get()).data().status, "Completed")
  assert.equal(
    (await db.doc(`materials/${materialId}`).get()).data().stock,
    1.8
  )
  const notifications = await db
    .collection("notifications")
    .where("rfqId", "==", rfqId)
    .get()
  assert.ok(
    notifications.size >= 5,
    `Expected transition notifications, got ${notifications.size}.`
  )
  console.log(
    `PASS: Hono, Firebase Auth/Firestore Emulators, and local R2 completed the RFQ lifecycle (${rfqId}).`
  )
} catch (error) {
  failure = error
} finally {
  try {
    const [notifications, movements] = await Promise.all([
      db.collection("notifications").where("rfqId", "==", rfqId).get(),
      db
        .collection("inventoryMovements")
        .where("referenceId", "==", rfqId)
        .get(),
    ])
    await Promise.all([
      ...notifications.docs.map((document) => document.ref.delete()),
      ...movements.docs.map((document) => document.ref.delete()),
      db.doc(`shippingRateQuotes/${rfqId}`).delete(),
      db.doc(`productionOrders/${rfqId}`).delete(),
      db.doc(`rfqs/${rfqId}`).delete(),
      db.doc(`materials/${materialId}`).delete(),
      db.doc(`equipment/${equipmentId}`).delete(),
      ...(ownerUid ? [auth.deleteUser(ownerUid)] : []),
      ...(filePath ? [storage.delete(filePath).catch(() => {})] : []),
    ])
  } catch (error) {
    failure ||= error
    console.error(`Fixture cleanup failed: ${error.message}`)
  }
  try {
    await stop(apiProcess)
    await stop(r2Process)
    await db.terminate()
  } catch (error) {
    failure ||= error
  }
}

if (failure) {
  console.error(failure.stack || failure)
  if (output) console.error(output)
  process.exitCode = 1
}
