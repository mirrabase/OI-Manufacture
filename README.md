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

1. **Customer:** open `/portal/quotes/new`, upload an STL, choose mm or inches, then enter contact name, email, product, quantity, process, material, and optional notes. Submit and keep the page open until upload finishes. A guest session owns the request; keep using the same browser profile.
2. **Automatic estimate:** FDM + PLA requests are sliced locally. The request detail shows estimated filament weight, print time, price, and a layer preview. The included `/assets/3DBenchy.stl` is a test model. Other materials/processes remain available for manual quotation and clearly show that automatic estimation is unsupported.
3. **Manufacturer:** open `/login` and click **Sign in as local Manufacturer**. The seed creates `manufacturer@oi.local` / `local-manufacturer-123` and an active allowlist document. This is a local simulation account; its login control is absent in production. Manufacturer authentication uses a separate Firebase app, preserving the customer's guest session in another tab.
4. Open **Requests** at `/-/requests`. The **Needs review** tab contains requests with a completed automatic estimate. Select **Review**, inspect requirements and sliced layers, download the STL, adjust the total if needed, then **Publish final quotation**. The request moves to **Awaiting payment** with status `Quoted / Unpaid`. The estimate and Manufacturer's final quotation are stored separately.
5. Coordinate payment outside the portal. After funds are received, Manufacturer clicks **Confirm payment received · start production**. The request moves to **In production** with status `In Production / Paid`. The same request appears under the customer's `/portal/orders`.

The Manufacturer **Requests** page is one live Firestore list with **All requests**, **Needs review**, **Awaiting payment**, and **In production** tabs. Requests without a completed automatic estimate stay out of that work queue. Overview also reads live customer request data. Materials, equipment, customers, and analytics remain demo modules.

## Pricing and slicing settings

Open `/-/settings` as Manufacturer. Initial example settings are PLA Rp150.000/kg, machine Rp15.000/hour, setup Rp10.000/request, 30% markup on cost, and a Rp25.000 minimum total. The simulation profile is Prusa MK3S+, 0.4 mm nozzle, 0.2 mm layers, 15% infill, no supports, and a 250 × 210 × 210 mm build volume. Rates, setup, markup, minimum, layer height, and infill are editable in Firestore through the dashboard.

Total is `max(minimum, ((grams / 1000 × material rate + seconds / 3600 × machine rate) × quantity + setup) × (1 + markup / 100))`, rounded up to Rp1.000. Quantity assumes repeated single-unit prints, without plate packing. Benchy with the initial profile produces about 12.76 g, 1h 21m 25s, and Rp42.000 per request for one unit.

Each estimate saves its rates and profile. Settings changes apply to future calculations; **Recalculate estimate with current settings** explicitly recalculates an existing unpaid RFQ. Published quotation totals are never overwritten by the worker. Failed, unsupported, and oversized models remain saved for manual review. Interrupted jobs resume on worker restart; each slicing attempt has a five-minute limit and uses two threads.

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

`verify:local` requires the emulators and checks customer ownership, immutable submitted STL, protected previews, pricing validation, Manufacturer permissions, quotation/payment transitions, and realtime customer request listeners. It creates and removes its own fixtures, and restores pricing.

With emulators running and the worker stopped, `pnpm verify:worker` checks interrupted job recovery, unsupported process, oversized model, invalid STL, preserved pricing, and clean shutdown. It also removes its own fixtures.

Build static files with `pnpm --filter web build`; Firebase Hosting serves `apps/web/out`. Configure the intended production Firebase project separately before deploying. Local simulation setup does not deploy any services.
