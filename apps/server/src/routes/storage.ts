import { Hono } from "hono"
import { z } from "genkit"
import type { AppDependencies, ServerEnv } from "../shared/types.ts"
import { AppError } from "../shared/errors.ts"
import { readJson } from "../shared/http.ts"
import { MAX_MODEL_BYTES, validObjectKey } from "../infrastructure/storage.ts"
import { activeManufacturerOrganization } from "../modules/rfqs/service.ts"

function apiBaseUrl(env: NodeJS.ProcessEnv, requestUrl: string) {
  return (env.API_PUBLIC_URL || new URL(requestUrl).origin).replace(/\/$/, "")
}

function decodeRfqObjectPath(path: unknown) {
  if (!validObjectKey(path))
    throw new AppError(
      "invalid-argument",
      "A valid request file path is required."
    )
  const parts = path.split("/")
  if (parts.length < 4 || parts[0] !== "rfqs")
    throw new AppError(
      "invalid-argument",
      "A valid request file path is required."
    )
  return { ownerUid: parts[1], rfqId: parts[2] }
}

async function checkRfqObjectAccess({
  db,
  uid,
  path,
}: {
  db: AppDependencies["db"]
  uid: string
  path: unknown
}) {
  const { ownerUid, rfqId } = decodeRfqObjectPath(path)
  const snapshot = await db.doc(`rfqs/${rfqId}`).get()
  if (!snapshot.exists || snapshot.data()!.ownerUid !== ownerUid)
    throw new AppError("not-found", "Request file not found.")
  const rfq = snapshot.data()!
  if (rfq.model?.storagePath !== path && rfq.estimate?.gcodePath !== path)
    throw new AppError("not-found", "Request file not found.")
  if (uid === ownerUid) return { rfq, rfqId }
  const organizationId = await activeManufacturerOrganization(db, uid)
  if (
    rfq.organizationId !== organizationId ||
    ![
      "Submitted",
      "Quoted",
      "Preparing Production",
      "In Production",
      "Completed",
    ].includes(rfq.status)
  ) {
    throw new AppError(
      "permission-denied",
      "You cannot access this request file."
    )
  }
  return { rfq, rfqId }
}

export function storageRoutes({
  db,
  storage,
  env = process.env,
}: Pick<AppDependencies, "db" | "storage" | "env">) {
  const app = new Hono<ServerEnv>()
  app.post("/upload-url", async (context) => {
    const body = await readJson(
      context,
      z.object({ rfqId: z.string(), size: z.number() })
    )
    if (typeof body.rfqId !== "string" || !body.rfqId)
      throw new AppError("invalid-argument", "Request ID is required.")
    if (
      !Number.isSafeInteger(body.size) ||
      body.size < 1 ||
      body.size > MAX_MODEL_BYTES
    )
      throw new AppError(
        "invalid-argument",
        "STL must be between 1 byte and 50 MB."
      )
    const uid = context.get("uid")
    const snapshot = await db.doc(`rfqs/${body.rfqId}`).get()
    if (!snapshot.exists || snapshot.data()!.ownerUid !== uid)
      throw new AppError(
        "permission-denied",
        "You cannot upload a file for this request."
      )
    const rfq = snapshot.data()!
    const key = rfq.model?.storagePath
    if (
      rfq.status !== "Draft" ||
      !key?.startsWith(`rfqs/${uid}/${body.rfqId}/`) ||
      key.split("/").includes("..") ||
      !/\.[sS][tT][lL]$/.test(key)
    ) {
      throw new AppError(
        "failed-precondition",
        "Only the request owner's draft STL can be uploaded."
      )
    }
    if (body.size !== rfq.model.size || rfq.model.contentType !== "model/stl")
      throw new AppError(
        "invalid-argument",
        "The selected STL does not match the request details."
      )
    const url = await storage.createUploadUrl({
      key,
      contentType: "model/stl",
      apiBaseUrl: apiBaseUrl(env, context.req.url),
    })
    return context.json({
      ...url,
      requiresAuth: Boolean(env.R2_LOCAL_WORKER_URL),
    })
  })

  app.put("/local-upload", async (context) => {
    if (!env.R2_LOCAL_WORKER_URL)
      throw new AppError("not-found", "Local upload route is disabled.")
    const key = context.req.query("key")
    const uid = context.get("uid")
    if (
      !validObjectKey(key) ||
      !key.startsWith(`rfqs/${uid}/`) ||
      context.req.header("content-type") !== "model/stl"
    )
      throw new AppError("invalid-argument", "Invalid local file upload.")
    const length = Number(context.req.header("content-length"))
    if (!Number.isSafeInteger(length) || length < 1 || length > MAX_MODEL_BYTES)
      throw new AppError(
        "invalid-argument",
        "STL must be between 1 byte and 50 MB."
      )
    const { rfq } = await checkRfqObjectAccess({ db, uid, path: key })
    if (
      rfq.status !== "Draft" ||
      rfq.model?.storagePath !== key ||
      rfq.model.size !== length
    )
      throw new AppError(
        "failed-precondition",
        "The upload does not match the current request draft."
      )
    const target = `${env.R2_LOCAL_WORKER_URL.replace(/\/$/, "")}/_r2/?key=${encodeURIComponent(key)}`
    const options: RequestInit & { duplex: "half" } = {
      method: "PUT",
      headers: {
        "x-local-r2-token": env.R2_LOCAL_TOKEN || "oi-local-r2-only-token",
        "content-type": "model/stl",
        "content-length": String(length),
      },
      body: context.req.raw.body,
      duplex: "half",
    }
    const response = await fetch(target, options)
    if (!response.ok)
      throw new AppError(
        response.status === 413 ? "invalid-argument" : "unavailable",
        "The local R2 upload failed."
      )
    return context.body(null, 204)
  })

  app.get("/objects", async (context) => {
    const path = context.req.query("path")
    if (!validObjectKey(path))
      throw new AppError(
        "invalid-argument",
        "A valid request file path is required."
      )
    await checkRfqObjectAccess({ db, uid: context.get("uid"), path })
    try {
      const object = await storage.get(path)
      const filename = path
        .split("/")
        .at(-1)!
        .replace(/[\r\n"\\]/g, "_")
      return new Response(object.body, {
        status: 200,
        headers: {
          "Content-Type": object.contentType,
          "Content-Length": String(object.size),
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
        },
      })
    } catch (error) {
      if (
        error instanceof Error &&
        (["NoSuchKey", "NotFound"].includes(error.name) ||
          ("code" in error && error.code === "not-found"))
      )
        throw new AppError("not-found", "Request file not found.")
      throw error
    }
  })
  return app
}

export { checkRfqObjectAccess, decodeRfqObjectPath }
