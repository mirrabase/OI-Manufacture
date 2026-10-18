# OI Manufacture

## Run the local simulation

Requires Node.js 22.18+ and Java for Firebase Emulator Suite. Install PrusaSlicer on Debian/Ubuntu with `sudo apt-get install prusa-slicer`, then run:

```sh
pnpm install
pnpm dev
```

`pnpm dev` starts Auth, Firestore, Storage, a local slicing worker, and Next.js. The frontend always uses `demo-oi-manufacture` and loopback emulators in development. The worker rejects other project IDs and remote emulator hosts. It does not deploy or use Firebase cloud. If an emulator stops, requests fail instead of falling back to cloud.

PrusaSlicer can also be selected with `PRUSA_SLICER_BIN=/absolute/path/to/prusa-slicer pnpm dev`. This workspace already has a rootless Debian 2.9.2 installation in `.local/prusa/`, which the worker detects automatically. No slicer binaries are committed.

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
RUN_SLICER_INTEGRATION=1 pnpm test:slicing
pnpm verify:local
```

`verify:local` requires the emulators and checks customer ownership, waitlist access, tenant rules, immutable submitted STL, protected previews and production data, pricing validation, quotation/payment transitions, low-stock submissions, purchase receiving, reservations, equipment capacity, production completion, and realtime customer/Manufacturer request listeners. It creates and removes its own fixtures, and restores pricing.

## Kasera Pay sandbox

`pnpm dev` starts the Functions emulator alongside Auth, Firestore, and Storage. Before restarting it, create `functions/.secret.local` (ignored by Git) with a Kasera **Test mode** API key and webhook signing secret:

```ini
KASERA_API_KEY=kp_test_...
KASERA_WEBHOOK_SECRET=...
RAJAONGKIR_API_KEY=...
GOOGLE_GENAI_API_KEY=...
```

Create the RajaOngkir Shipping Cost API key in the RajaOngkir dashboard. The key stays in the Functions emulator; rate calculations call RajaOngkir's live Shipping Cost API even while Firebase data remains local.

The manufacturer dashboard also includes a free-form AI chat and **AI Highlights** on Overview. The Gemini key stays in the Functions emulator. Workspace answers cite the records used; general manufacturing guidance is separated from company facts. The assistant is read-only and chat messages are kept only in the open browser session.

In Cloudflare, add a **Published application** route to the existing tunnel for `kasera-webhook.mirrabase.com`, targeting `http://127.0.0.1:15001` and matching only `/demo-oi-manufacture/us-central1/kaseraWebhook`. Keep `pnpm dev` and the `cloudflared` tunnel running while testing; confirm `curl -i https://kasera-webhook.mirrabase.com/demo-oi-manufacture/us-central1/kaseraWebhook` returns `200` before adding it in Kasera. In the Kasera dashboard, edit the existing **Test mode → Developer** webhook URL to `https://kasera-webhook.mirrabase.com/demo-oi-manufacture/us-central1/kaseraWebhook` and keep its `payment.paid`, `payment.expired`, and `payment.failed` events enabled. If you create a new endpoint instead, copy its test signing secret to `KASERA_WEBHOOK_SECRET` in `functions/.secret.local`, then restart `pnpm dev`. Enable QRIS and/or Virtual Account under **Settings → Payment methods**. Checkout links use Kasera hosted checkout; the portal never stores payment credentials.

Local Firebase data stays in the emulator. Kasera test mode uses Kasera's API and the stable Cloudflare hostname above for webhook delivery; a `trycloudflare.com` quick-tunnel URL is temporary and must not be saved as the webhook address. Live payments require a deployed HTTPS Functions endpoint, live keys, and Firebase billing; this project is not configured for live payments.

With emulators running and the worker stopped, `pnpm verify:worker` checks interrupted job recovery, unsupported process, oversized model, invalid STL, preserved pricing, and clean shutdown. It also removes its own fixtures.

Build static files with `pnpm --filter web build`; Firebase Hosting serves `apps/web/out`. Configure the intended production Firebase project separately before deploying. Local simulation setup does not deploy any services.
