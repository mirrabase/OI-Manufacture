import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { db, seedLocalData } from './local-firebase.mjs'

import { createR2Store } from '../apps/server/src/infrastructure/storage.ts'
const storage = createR2Store()

const lockFile = process.env.OI_SLICING_LOCK_PATH || '.local/slicing-worker.lock'
let workerAlreadyRunning = false
if (existsSync(lockFile)) {
  const pid = Number(await readFile(lockFile, 'utf8'))
  try { process.kill(pid, 0); workerAlreadyRunning = true }
  catch (error) { if (error.code === 'ESRCH') await unlink(lockFile); else throw error }
}
const prefix = `verify-worker-${randomUUID()}`
const ids = ['recovery', 'oversized', 'invalid'].map((suffix) => `${prefix}-${suffix}`)
const sourcePath = `rfqs/verification/${ids[2]}/model.stl`
const directory = await mkdtemp(join(tmpdir(), 'oi-worker-verify-'))
const sourceFile = join(directory, 'invalid.stl')
let worker
try {
  const localR2 = process.env.R2_LOCAL_WORKER_URL || 'http://127.0.0.1:8788'
  const ready = await fetch(`${localR2.replace(/\/$/, '')}/_r2/?key=health`, {
    method: 'HEAD', headers: { 'x-local-r2-token': process.env.R2_LOCAL_TOKEN || 'oi-local-r2-only-token' },
  })
  assert.equal(ready.status, 404, 'local R2 worker must be running')
  await seedLocalData()
  const before = (await db.doc('pricing/demo').get()).data()
  for (const [index, id] of ids.entries()) {
    await db.doc(`rfqs/${id}`).set({ organizationId: 'demo', ownerUid: 'verification', customer: { name: 'Worker verification', email: 'test@example.invalid' },
      product: 'Worker verification', requirements: { quantity: 1, material: 'PLA', process: index === 0 ? 'SLA' : 'FDM', unit: 'mm', notes: '' },
      model: { name: 'model.stl', size: 100, contentType: 'model/stl', storagePath: sourcePath, boundingBoxMm: index === 1 ? [251, 10, 10] : [10, 10, 10] },
      status: 'Submitted', paymentStatus: 'Unpaid', createdAt: Date.now(), submittedAt: Date.now(),
      ...(index === 0 ? { estimate: { status: 'processing', requestedAt: 0 } } : {}) })
  }
  await writeFile(sourceFile, 'invalid STL')
  await storage.putFile(sourcePath, sourceFile, 'model/stl')
  if (!workerAlreadyRunning) worker = spawn('node', ['scripts/slicing-worker.mjs'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, OI_SLICING_LOCK_PATH: lockFile },
  })
  let results
  for (let attempt = 0; attempt < 100; attempt++) {
    results = await Promise.all(ids.map(async (id) => (await db.doc(`rfqs/${id}`).get()).data()))
    if (results.every((request) => ['failed', 'unsupported'].includes(request.estimate?.status))) break
    await setTimeout(200)
  }
  assert.equal(results[0].estimate.status, 'unsupported')
  assert.equal(results[1].estimate.status, 'failed')
  assert.match(results[1].estimate.error, /build volume/)
  assert.equal(results[2].estimate.status, 'failed')
  assert.match(results[2].estimate.error, /Could not slice/)
  assert.ok(results.every((request) => request.status === 'Submitted' && request.paymentStatus === 'Unpaid'))
  assert.deepEqual((await db.doc('pricing/demo').get()).data(), before, 'seed must preserve edited pricing')
  if (worker) {
    const exit = new Promise((resolve) => worker.once('exit', resolve))
    worker.kill('SIGTERM')
    await exit
    assert.equal(existsSync(lockFile), false)
  }
  console.log(`PASS: ${workerAlreadyRunning ? 'active' : 'restarted'} slicing worker, unsupported process, oversized model, invalid STL, preserved RFQs and pricing.`)
} finally {
  if (worker && worker.exitCode === null) {
    const exit = new Promise((resolve) => worker.once('exit', resolve))
    worker.kill('SIGTERM')
    await exit
  }
  for (const id of ids) await db.doc(`rfqs/${id}`).delete()
  await storage.delete(sourcePath).catch(() => {})
  await rm(directory, { recursive: true, force: true })
  await db.terminate()
}
