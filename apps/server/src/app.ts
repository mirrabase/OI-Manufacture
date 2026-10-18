import { aiRoutes } from "./routes/ai.ts"
import { productionRoutes } from "./routes/production.ts"
import { shippingRoutes } from "./routes/shipping.ts"
import { paymentsRoutes } from "./routes/payments.ts"
import { rfqsRoutes } from "./routes/rfqs.ts"
import { storageRoutes } from "./routes/storage.ts"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { UserFacingError } from "genkit"
import { AppError } from "./shared/errors.ts"
import { ShippingError } from "./modules/shipping/provider.ts"
import type { AppDependencies, ServerEnv } from "./shared/types.ts"

const STATUS_CODES: Record<string, ContentfulStatusCode> = {
  unauthenticated: 401,
  UNAUTHENTICATED: 401,
  "permission-denied": 403,
  PERMISSION_DENIED: 403,
  "invalid-argument": 400,
  INVALID_ARGUMENT: 400,
  "not-found": 404,
  NOT_FOUND: 404,
  "already-exists": 409,
  ALREADY_EXISTS: 409,
  "failed-precondition": 409,
  FAILED_PRECONDITION: 409,
  unavailable: 503,
  UNAVAILABLE: 503,
  "data-loss": 500,
  internal: 500,
  INTERNAL: 500,
}

function createApp({ db, auth, storage, env = process.env }: AppDependencies) {
  const app = new Hono<ServerEnv>()
  const allowedOrigins = new Set(
    [...(env.API_CORS_ORIGINS || "").split(","), env.CUSTOMER_APP_ORIGIN]
      .map((value) => value?.trim())
      .filter(Boolean)
  )

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (allowedOrigins.has(origin) ? origin : ""),
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
      exposeHeaders: ["Content-Disposition", "Content-Length", "Content-Type"],
      maxAge: 600,
    })
  )
  app.use("/api/*", async (context, next) => {
    if (context.req.path === "/api/webhooks/kasera") return next()
    const authorization = context.req.header("authorization") || ""
    const token = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : ""
    if (!token) throw new AppError("unauthenticated", "Sign in to continue.")
    try {
      const decoded = await auth.verifyIdToken(token)
      context.set("uid", decoded.uid)
    } catch {
      throw new AppError(
        "unauthenticated",
        "Your session expired. Sign in again."
      )
    }
    await next()
  })

  app.get("/health", (context) => context.json({ ok: true }))
  app.route("/api/ai", aiRoutes())
  app.route("/api/production", productionRoutes({ db }))
  app.route("/api/shipping", shippingRoutes({ db, env }))
  app.route("/api", paymentsRoutes({ db, env }))
  app.route("/api/rfqs", rfqsRoutes({ db, storage }))
  app.route("/api/storage", storageRoutes({ db, storage, env }))

  app.notFound((context) =>
    context.json(
      { error: { code: "not-found", message: "API route not found." } },
      404
    )
  )
  app.onError((error, context) => {
    const code =
      error instanceof AppError
        ? error.code
        : error instanceof UserFacingError
          ? error.status
          : "internal"
    const status = STATUS_CODES[code] || 500
    if (status >= 500)
      console.error("API request failed:", error.message || "unknown error")
    return context.json(
      {
        error: {
          code: String(code).toLowerCase(),
          message:
            status < 500 ||
            error instanceof ShippingError ||
            error instanceof UserFacingError
              ? error.message
              : "The request could not be completed.",
        },
      },
      status
    )
  })
  return app
}

export { createApp }
