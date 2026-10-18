# Hono API

Node.js **22.18+** runs the TypeScript source directly using [native type stripping](https://nodejs.org/api/typescript.html). `tsc --noEmit` checks types separately; no transpiler or build output is required. Use erasable TypeScript syntax and explicit `.ts` imports.

```text
src/
  index.ts          Firebase initialization and Node HTTP server
  app.ts            CORS, authentication, errors, and route registration
  routes/           HTTP handlers and request schemas, grouped by API area
  modules/
    ai/             Manufacturer assistant, evidence, and insights
    email/          Quotation and payment emails
    notifications/  Manufacturer notifications
    payments/       Checkout, payment state, and Kasera signatures
    production/     Production availability estimates
    rfqs/           RFQ transitions and follow-up effects
    shipping/       Shipping workflows and RajaOngkir adapter
  infrastructure/   Local and cloud R2 storage adapter
  shared/           Errors, dependency types, and JSON validation
tests/             Existing node:test regression and integration tests
```

Routes validate external input and pass explicit fields to services. Services own authorization, business rules, and Firestore transactions. Firestore's SDK remains the data access layer; transaction boundaries stay inside their workflows. R2 uses the existing storage adapter. Keep API paths and response contracts compatible with `apps/web`.

From the repository root:

```sh
pnpm --filter @oi-manufacture/server dev
pnpm --filter @oi-manufacture/server start
pnpm --filter @oi-manufacture/server typecheck
pnpm --filter @oi-manufacture/server lint
pnpm test:server
pnpm verify:api
pnpm verify:worker
```

Both `dev` and `start` load `apps/server/.env.local` when present. Deployment environment variables take priority. Local Hono defaults to port `8787`. Keep provider credentials on the server.

Start the local stack with `pnpm dev` before integration checks. Server integration tests require the Firebase Auth/Firestore emulators. Set `FIRESTORE_EMULATOR_HOST=127.0.0.1:18080` when running `pnpm test:server` to include the AI integration tests; API and worker verification also use local R2. `verify:worker` additionally requires the slicer configured by the root README.

The Dockerfile runs only production dependencies and the TypeScript source:

```sh
docker build -f apps/server/Dockerfile -t oi-manufacture-server .
```

For the isolated CPU/memory capacity sweep, run `pnpm bench:backend`. See [the benchmark guide](../../scripts/bench-backend.md) for the separate emulator ports, workload, generated reports, and limits of local measurements.
