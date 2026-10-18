import { mkdir, open, readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db, seedLocalData } from './local-firebase.mjs'
import { calculateEstimate, validatePricing } from '../apps/web/lib/pricing.ts'
import { getSlicingRequirements, sliceModel } from './slicing.mjs'

import { createR2Store } from '../apps/server/src/infrastructure/storage.ts'
import { applyRfqEffects } from '../apps/server/src/modules/rfqs/effects.ts'
const storage = createR2Store()

await mkdir('.local', { recursive: true })
const lock = process.env.OI_SLICING_LOCK_PATH || '.local/slicing-worker.lock'
try {
  const pid = Number(await readFile(lock, 'utf8'))
  try { process.kill(pid, 0); throw new Error(`Slicing worker ${pid} is already running.`) }
  catch (error) { if (error.code !== 'ESRCH') throw error }
  await rm(lock)
} catch (error) { if (error.code !== 'ENOENT') throw error }
const handle = await open(lock, 'wx')
await handle.writeFile(String(process.pid))
await handle.close()
const controller = new AbortController()
let stopping = false
let unsubscribe
let running = Promise.resolve()

// shortcut: quote publishing is local-only with this slicing worker; add a trusted worker when hosted slicing is built.
function needsAutomaticQuote(request) {
  return request.status === 'Submitted' && request.paymentStatus === 'Unpaid'
    && request.quoteTotal == null && request.estimate?.status === 'ready'
    && Number.isSafeInteger(request.estimate.total) && request.estimate.total > 0
}

function canRetryLegacyHomepageRequest(request) {
  return request.status === 'Submitted' && request.paymentStatus === 'Unpaid'
    && request.estimate?.status === 'unsupported'
    && request.estimate.requestedAt === (request.estimateRequestedAt || 0)
    && getSlicingRequirements(request.requirements).legacyHomepage
}

async function stop() {
  if (stopping) return
  stopping = true
  unsubscribe?.()
  controller.abort()
  await running
  await rm(lock, { force: true })
  await db.terminate()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void stop().then(() => process.exit(0)) })

async function processRequest(ref) {
  let request
  let requestedAt
  const claimed = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    request = snapshot.data()
    if (!request || !['Submitted', 'Quoted'].includes(request.status) || request.paymentStatus === 'Paid') return false
    requestedAt = request.estimateRequestedAt || 0
    if (request.estimate && request.estimate.status !== 'processing' && request.estimate.requestedAt === requestedAt) {
      if (needsAutomaticQuote(request)) {
        transaction.update(ref, { status: 'Quoted', quoteTotal: request.estimate.total, paymentStatus: 'Unpaid', quotedAt: request.estimate.calculatedAt || Date.now() })
        return 'quoted'
      }
      if (!canRetryLegacyHomepageRequest(request)) return false
    }
    const update = { estimate: { status: 'processing', requestedAt } }
    const slicingRequirements = getSlicingRequirements(request.requirements)
    if (slicingRequirements.legacyHomepage) {
      update.requirements = {
        ...request.requirements,
        material: slicingRequirements.material,
        color: slicingRequirements.color,
        infillPercent: slicingRequirements.infillPercent,
      }
    }
    transaction.update(ref, update)
    return true
  })
  if (claimed === 'quoted') {
    await applyRfqEffects({ db, rfqId: ref.id, before: request, after: await ref.get() })
    console.log(`[slicer] ${ref.id}: automatic quotation published · Rp ${request.estimate.total}`)
    return
  }
  if (!claimed) return
  let directory
  let estimate
  try {
    const slicingRequirements = getSlicingRequirements(request.requirements)
    if (request.requirements.process !== 'FDM' || slicingRequirements.material !== 'PLA') {
      estimate = { status: 'unsupported', requestedAt, error: 'Automatic slicing currently supports FDM + PLA. The Manufacturer can quote this request manually.' }
    } else {
      const savedPricing = (await db.doc(`pricing/${request.organizationId}`).get()).data()
      validatePricing(savedPricing)
      const pricing = slicingRequirements.infillPercent === undefined
        ? savedPricing
        : { ...savedPricing, infillPercent: slicingRequirements.infillPercent }
      validatePricing(pricing)
      const dimensions = request.model.boundingBoxMm
      if (!Array.isArray(dimensions) || dimensions.length !== 3 || !dimensions.every((v, i) => Number.isFinite(v) && v > 0 && v <= [250, 210, 210][i])) throw new Error('Model exceeds the 250 × 210 × 210 mm simulation build volume, or has invalid dimensions.')
      if (!['mm', 'inch'].includes(request.requirements.unit)) throw new Error('Invalid model units.')
      const prefix = `rfqs/${request.ownerUid}/${ref.id}/`
      if (!request.model.storagePath.startsWith(prefix)) throw new Error('Invalid STL storage location.')
      const metadata = await storage.head(request.model.storagePath)
      if (metadata.size < 1 || metadata.size > 50 * 1024 * 1024) throw new Error('STL must be between 1 byte and 50 MB.')
      directory = await mkdtemp(join(tmpdir(), 'oi-slice-'))
      const input = join(directory, 'model.stl')
      const output = join(directory, 'preview.gcode')
      await storage.downloadToFile(request.model.storagePath, input)
      const measurements = await sliceModel(input, output, request.requirements.unit, pricing, { signal: controller.signal })
      const costs = calculateEstimate(measurements.gramsPerUnit, measurements.secondsPerUnit, request.requirements.quantity, pricing)
      const calculatedAt = Date.now()
      const gcodePath = `${prefix}preview-${calculatedAt}.gcode`
      await storage.putFile(gcodePath, output, 'text/plain')
      estimate = { status: 'ready', requestedAt, ...measurements, ...costs, pricing, calculatedAt,
        profile: 'Simulation · Prusa MK3S+ · PLA · nozzle 0.4 mm · no supports', gcodePath }
    }
  } catch (error) {
    estimate = { status: 'failed', requestedAt, error: error.message || 'Slicing failed; Manufacturer review is required.' }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
  // A quote or payment may have been saved while slicing; never overwrite those fields.
  const completion = await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(ref)
    const current = currentSnapshot.data()
    if (!current || (current.estimateRequestedAt || 0) !== requestedAt) return null
    const update = { estimate }
    if (needsAutomaticQuote({ ...current, estimate })) {
      update.status = 'Quoted'
      update.quoteTotal = estimate.total
      update.quotedAt = estimate.calculatedAt
    }
    transaction.update(ref, update)
    return { before: current, quoted: update.status === 'Quoted' }
  })
  if (completion?.quoted) await applyRfqEffects({ db, rfqId: ref.id, before: completion.before, after: await ref.get() })
  console.log(`[slicer] ${ref.id}: ${estimate.status}${estimate.total ? ` · Rp ${estimate.total}` : ''}`)
}

try {
  await seedLocalData()
  const pending = new Set()
  unsubscribe = db.collection('rfqs').where('status', 'in', ['Submitted', 'Quoted']).onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed' || pending.has(change.doc.id)) continue
      const data = change.doc.data()
      if (data.estimate && data.estimate.status !== 'processing' && data.estimate.requestedAt === (data.estimateRequestedAt || 0) && !needsAutomaticQuote(data) && !canRetryLegacyHomepageRequest(data)) continue
      pending.add(change.doc.id)
      running = running.then(async () => {
        if (!stopping) await processRequest(change.doc.ref)
      }).catch((error) => console.error('[slicer]', error.message)).finally(() => { pending.delete(change.doc.id) })
    }
  }, (error) => { console.error('[slicer]', error.message); void stop().then(() => process.exit(1)) })
  console.log('[slicer] Watching local RFQs; one slicing job at a time.')
} catch (error) {
  await stop()
  throw error
}
