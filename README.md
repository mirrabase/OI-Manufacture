# OI Manufacture

## Run the local simulation

Requires Node.js 22.18+, pnpm 11.25.0, and Java 21+ for Firebase Emulator Suite. Copy `apps/web/.env.local.example` to `apps/web/.env.local` and `apps/server/.env.example` to `apps/server/.env.local` before the first run. Install PrusaSlicer on Debian/Ubuntu with `sudo apt-get install prusa-slicer`, then run:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Firebase Auth and Firestore emulators, a Wrangler R2 simulator, the Hono API, a local slicing worker, and Next.js. R2 files persist locally under `apps/server/.wrangler/state/`; no Firebase Storage emulator is used. The Firebase emulator client rejects other project IDs and remote emulator hosts. Local simulation does not deploy or use Firebase cloud.

PrusaSlicer can also be selected with `PRUSA_SLICER_BIN=/absolute/path/to/prusa-slicer pnpm dev`. The worker also detects a rootless installation in `.local/prusa/` when present. No slicer binaries are committed.

Emulator data imports from and exports to `.local/firebase-data/` on a clean shutdown. Stop `pnpm dev` with Ctrl-C and let the export finish. Before restarting an older dev command that lacked automatic export, preserve the running suite with:

```sh
pnpm exec firebase emulators:export .local/firebase-data --project demo-oi-manufacture --force
```

## Customer and Manufacturer flow

Use the Next.js URL printed in the terminal (currently `http://localhost:3001`).

1. **Customer:** open `/`, upload an STL, choose mm or inches, then enter contact and delivery details, product, quantity, process, material, and optional notes. Submit and keep the page open until upload finishes. A guest session owns the request; keep using the same browser profile.
2. **Automatic quotation:** FDM + PLA requests are sliced locally. When slicing succeeds, the calculated price becomes the unpaid quotation automatically, so the customer can pay before production without waiting for a Manufacturer approval click. The request detail shows the price, filament weight, print time, and a layer preview. The included `/assets/3DBenchy.stl` is a test model. Other materials/processes and failed/oversized models stay in manual review.
3. **Manufacturer:** open `/login` and click **Sign in as local Manufacturer**. The seed creates `manufacturer@oi.local` / `local-manufacturer-123` and an active allowlist document. This is a local simulation account; its login control is absent in production. Manufacturer authentication uses a separate Firebase app, preserving the customer's guest session in another tab.
   The local seed creates only **Demo Organization**. Google accounts without an active `manufacturers/{uid}` membership are saved to `organizationWaitlist/{uid}` and sent to `/waiting-list`; organization and membership provisioning stays Admin SDK only.
4. Open **Requests** at `/-/requests`. Supported requests with successful slices already appear in **Awaiting payment**. Select **Review** to inspect requirements and sliced layers, download the STL, and adjust the automatic quotation if needed. Failed or unsupported models need a manual quotation; set the total and choose **Publish final quotation**.
5. After the quotation is ready, the customer chooses a RajaOngkir courier service. The Kasera checkout amount is the Manufacturer quotation plus estimated shipping. The signed Kasera webhook confirms payment and moves the request to production preparation. The customer returns to `/` and sees the live paid and production status instead of the upload form. For an external transfer, Manufacturer can still confirm received funds from the request detail. Assign filament and a compatible machine, correct any stock or capacity blockers in **Materials**, **Purchasing**, or **Equipment**, then schedule the job to reserve stock. Customer requests are never blocked by inventory. Start production when the machine is ready and record actual filament use when completing the job.

The Manufacturer **Requests** page is one live Firestore list with **All requests**, **Needs review**, **Awaiting payment**, **Preparing production**, **In production**, and **Completed** tabs. Overview and customer Orders update from Firestore. Materials, equipment, purchase orders, reservations, and usage are also stored in the local Firestore emulator. The customer directory, Analytics, and unrelated legacy dashboard modules remain demo data.

## Pricing and slicing settings

Open `/-/settings` as Manufacturer. Local seed data starts the Organization shipping origin at Karet Semanggi, Jakarta Selatan (demo address and phone); edit it here to use the real workshop address. The customer chooses their destination and courier before checkout. Shipping rates use estimated slicer weight and STL dimensions, so the carrier may adjust the final parcel charge after packing. Initial example pricing is PLA Rp150.000/kg, machine Rp15.000/hour, setup Rp10.000/request, 30% markup on cost, and a Rp25.000 minimum total. The simulation profile is PrusaSlicer, 0.4 mm nozzle, 0.2 mm layers, 15% infill, no supports, and a 250 × 210 × 210 mm build volume. Rates, setup, markup, minimum, layer height, and infill are editable in Firestore through the dashboard.

Total is `max(minimum, ((grams / 1000 × material rate + seconds / 3600 × machine rate) × quantity + setup) × (1 + markup / 100))`, rounded up to Rp1.000. Quantity assumes repeated single-unit prints, without plate packing. Benchy with the initial profile produces about 12.76 g, 1h 21m 25s, and Rp42.000 per request for one unit.

Each estimate saves its rates and profile. Settings changes apply to future calculations; **Recalculate estimate with current settings** explicitly recalculates an existing unpaid RFQ. An automatic quotation is created once for a successful slice; later recalculations do not overwrite it. Manufacturer can update the quotation before checkout begins. Failed, unsupported, and oversized models remain saved for manual review. Interrupted jobs resume on worker restart; each slicing attempt has a five-minute limit and uses two threads.

Seed is idempotent and preserves edited rates and existing requests. To seed an already running suite or attach a worker to it:

```sh
pnpm seed:local
pnpm slicing
```

Run only one slicing worker per workspace. The seed and worker are local tools; production slicing infrastructure is not included. The example profile must be calibrated before using its estimates for a real printer. Preview G-code is a simulation artifact, not an instruction to operate a printer.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test:slicing
pnpm test:server
pnpm test:bench
node --test apps/web/lib/overview-refresh.test.mjs apps/web/lib/manufacturing-source.test.mjs
RUN_SLICER_INTEGRATION=1 pnpm test:slicing
pnpm verify:local
pnpm verify:api
```

`verify:local` requires Auth and Firestore emulators. It checks customer ownership, waitlist access, tenant rules, server-only RFQ state transitions, pricing validation, purchase receiving, reservations, equipment capacity, production permissions, and realtime customer/Manufacturer listeners. The server tests exercise payment, shipping, email, notification, AI data, and API authorization workflows. Run `FIRESTORE_EMULATOR_HOST=127.0.0.1:18080 pnpm test:server` to include the AI emulator integration tests; those tests skip when the variable is absent.

`verify:api` requires running Auth and Firestore emulators. It reuses a healthy local Wrangler R2 worker or starts one, then starts an isolated Hono API on port `18081` (override with `OI_VERIFY_API_PORT`). The API port must be free; the check leaves the development API on port `8787` running. It checks a full authenticated RFQ lifecycle over HTTP, including file upload/download, quotation, shipping selection, manual payment, and production completion. It uses synthetic data and disables external AI, payment, shipping, and email credentials for the test API.

## Backend benchmark

Run `pnpm bench:backend` on Linux with Docker and Java available. It builds the production backend image and compares 1 vCPU/512 MiB with 2 vCPU/1 GiB at concurrency 1, 5, and 10. Business requests use an 80/20 lead-time/quotation mix, with two repeats of 5 seconds warmup and 30 seconds measurement. The separate HTTP health baseline uses 5 seconds per stage. Measurement takes about 8–10 minutes after setup.

The runner uses project `demo-oi-benchmark`, a Docker internal network, and separate emulator ports; `pnpm dev` can stay running. Reports and logs are written to `.local/benchmarks/backend/<run-id>/` and stay outside Git. See [the benchmark guide](scripts/bench-backend.md) for prerequisites, isolation, validation, and interpretation limits. These are local emulator measurements, not production capacity or a count of real users.

## Server credentials and provider sandboxes

The Hono server uses strict TypeScript, with HTTP routes, feature modules, and storage infrastructure documented in [apps/server/README.md](apps/server/README.md).

`pnpm dev` runs Hono locally on port `8787`; the ignored `apps/server/.env.local` holds server settings and secrets. Add test credentials as needed:

```ini
KASERA_API_KEY=kp_test_...
KASERA_WEBHOOK_SECRET=...
RAJAONGKIR_API_KEY=...
GOOGLE_GENAI_API_KEY=...
RESEND_API_KEY=...
R2_LOCAL_WORKER_URL=http://127.0.0.1:8788
R2_LOCAL_TOKEN=oi-local-r2-only-token
API_CORS_ORIGINS=http://localhost:3000,http://localhost:3001
```

Create the RajaOngkir Shipping Cost API key in the RajaOngkir dashboard. It stays in Hono; rate calculations call RajaOngkir's live Shipping Cost API even while Firebase data remains local.

The manufacturer dashboard also includes a free-form AI chat and **AI Highlights** on Overview. The Gemini key stays in Hono. Workspace answers cite the records used; general manufacturing guidance is separated from company facts. The assistant is read-only and chat messages are kept only in the open browser session. Overview highlights are cached for 30 minutes and refresh when due while the tab is visible; failed refreshes retry after one minute. Citation links open the related workspace.

The Kasera webhook route is `POST /api/webhooks/kasera` on local Hono port `8787`. Configure the existing Cloudflare tunnel to send `kasera-webhook.mirrabase.com` to `http://127.0.0.1:8787/api/webhooks/kasera`, then set that public URL in the Kasera **Test mode → Developer** settings and enable its `payment.paid`, `payment.expired`, and `payment.failed` events. Keep `pnpm dev` and the tunnel running while testing. Enable QRIS and/or Virtual Account under **Settings → Payment methods**. Checkout links use Kasera hosted checkout; the portal never stores payment credentials.

Local Firebase data stays in the emulator and local files stay in Wrangler's R2 state. Kasera test mode uses Kasera's API and the stable Cloudflare hostname above for webhook delivery; a `trycloudflare.com` quick-tunnel URL is temporary and must not be saved as the webhook address.

With Firestore and the local R2 worker running, `pnpm verify:worker` checks interrupted job recovery, unsupported process, oversized model, invalid STL, and preserved pricing. It reuses an active slicer or starts and stops an isolated one, then removes its fixtures.

## CI and deployment

GitHub Actions runs lint, type checks, slicing tests, emulator-backed rules/API/server checks, and the production build on pushes to `development` and `main`. Production deployment waits for a successful CI run on `main` and checks out that exact commit. Configure the GitHub `production` environment with the public Firebase settings and API URL used in [the deployment workflow](.github/workflows/deploy-firebase.yml), plus `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_DEPLOY_SERVICE_ACCOUNT` for Google Cloud authentication.

Build static files with `pnpm --filter web build`; Firebase Hosting serves `apps/web/out`. GitHub Actions deploys Hosting and Firestore Rules after a merge to `main`. Set `NEXT_PUBLIC_API_URL` in the GitHub production environment to the deployed Hono URL. Existing Firebase Storage objects are left untouched and must be copied into R2 before switching production traffic if the old bucket contains RFQ files.

If a restricted local environment rejects Turbopack’s PostCSS worker with `binding to a port: Operation not permitted`, use `pnpm --filter web exec next build --webpack` to verify the static production build. CI keeps the default `pnpm build` command.

Deploy `apps/server` from AI Studio Build mode as a Node.js full-stack service, then add `FIREBASE_PROJECT_ID`, `CUSTOMER_APP_ORIGIN`, `API_CORS_ORIGINS`, `RESEND_FROM`, `GOOGLE_GENAI_API_KEY`, `KASERA_API_KEY`, `KASERA_WEBHOOK_SECRET`, `RAJAONGKIR_API_KEY`, `RESEND_API_KEY`, and the four R2 settings (`R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) to its server-side secrets/config. Give the Cloud Run service identity Firestore access (`roles/datastore.user`). Configure the R2 bucket CORS policy using `apps/server/r2-cors.json`, replacing the origin with the Firebase Hosting domain. The Dockerfile keeps the Hono package independently runnable if AI Studio cannot deploy the monorepo subdirectory directly.

## Local video assets

The Remotion production workspace in `demo-video/` is local-only and ignored by Git. Video sources, captures, renders, and deliverables are not part of the application repository or CI.
