import { mkdir, open, readFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db, bucket, seedLocalData } from './local-firebase.mjs'
import { calculateEstimate, validatePricing } from '../apps/web/lib/pricing.ts'
import { sliceModel } from './slicing.mjs'

await mkdir('.local', { recursive: true })
const lock = '.local/slicing-worker.lock'
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
    if (request.estimate && request.estimate.status !== 'processing' && request.estimate.requestedAt === requestedAt) return false
    transaction.update(ref, { estimate: { status: 'processing', requestedAt } })
    return true
  })
  if (!claimed) return
  let directory
  let estimate
  try {
    if (request.requirements.process !== 'FDM' || request.requirements.material !== 'PLA') {
      estimate = { status: 'unsupported', requestedAt, error: 'Automatic slicing currently supports FDM + PLA. The Manufacturer can quote this request manually.' }
    } else {
      const pricing = (await db.doc('pricing/default').get()).data()
      validatePricing(pricing)
      const dimensions = request.model.boundingBoxMm
      if (!Array.isArray(dimensions) || dimensions.length !== 3 || !dimensions.every((v, i) => Number.isFinite(v) && v > 0 && v <= [250, 210, 210][i])) throw new Error('Model exceeds the 250 × 210 × 210 mm simulation build volume, or has invalid dimensions.')
      if (!['mm', 'inch'].includes(request.requirements.unit)) throw new Error('Invalid model units.')
      const prefix = `rfqs/${request.ownerUid}/${ref.id}/`
      if (!request.model.storagePath.startsWith(prefix)) throw new Error('Invalid STL storage location.')
      const source = bucket.file(request.model.storagePath)
      const [metadata] = await source.getMetadata()
      if (Number(metadata.size) < 1 || Number(metadata.size) > 50 * 1024 * 1024) throw new Error('STL must be between 1 byte and 50 MB.')
      directory = await mkdtemp(join(tmpdir(), 'oi-slice-'))
      const input = join(directory, 'model.stl')
      const output = join(directory, 'preview.gcode')
      await source.download({ destination: input })
      const measurements = await sliceModel(input, output, request.requirements.unit, pricing, { signal: controller.signal })
      const costs = calculateEstimate(measurements.gramsPerUnit, measurements.secondsPerUnit, request.requirements.quantity, pricing)
      const calculatedAt = Date.now()
      const gcodePath = `${prefix}preview-${calculatedAt}.gcode`
      await bucket.upload(output, { destination: gcodePath, metadata: { contentType: 'text/plain' }, resumable: false })
      estimate = { status: 'ready', requestedAt, ...measurements, ...costs, pricing, calculatedAt,
        profile: 'Simulation · Prusa MK3S+ · PLA · nozzle 0.4 mm · no supports', gcodePath }
    }
  } catch (error) {
    estimate = { status: 'failed', requestedAt, error: error.message || 'Slicing failed; Manufacturer review is required.' }
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true })
  }
  // A quote or payment may have been saved while slicing; never overwrite those fields.
  await db.runTransaction(async (transaction) => {
    const current = (await transaction.get(ref)).data()
    if (current && (current.estimateRequestedAt || 0) === requestedAt) transaction.update(ref, { estimate })
  })
  console.log(`[slicer] ${ref.id}: ${estimate.status}${estimate.total ? ` · Rp ${estimate.total}` : ''}`)
}

try {
  await seedLocalData()
  const pending = new Set()
  unsubscribe = db.collection('rfqs').where('status', 'in', ['Submitted', 'Quoted']).onSnapshot((snapshot) => {
    for (const change of snapshot.docChanges()) {
      if (change.type === 'removed' || pending.has(change.doc.id)) continue
      const data = change.doc.data()
      if (data.estimate && data.estimate.status !== 'processing' && data.estimate.requestedAt === (data.estimateRequestedAt || 0)) continue
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
