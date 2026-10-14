import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'
import { existsSync } from 'node:fs'
import { db, bucket } from './local-firebase.mjs'

if (existsSync('.local/slicing-worker.lock')) throw new Error('Stop the slicing worker before running this recovery check. Leave the Firebase emulators running.')
const prefix = `verify-worker-${randomUUID()}`
const ids = ['recovery', 'oversized', 'invalid'].map((suffix) => `${prefix}-${suffix}`)
const sourcePath = `rfqs/verification/${ids[2]}/model.stl`
let worker
try {
  const before = (await db.doc('pricing/default').get()).data()
  for (const [index, id] of ids.entries()) {
    await db.doc(`rfqs/${id}`).set({ ownerUid: 'verification', customer: { name: 'Worker verification', email: 'test@example.invalid' },
      product: 'Worker verification', requirements: { quantity: 1, material: 'PLA', process: index === 0 ? 'SLA' : 'FDM', unit: 'mm', notes: '' },
      model: { name: 'model.stl', size: 100, contentType: 'model/stl', storagePath: sourcePath, boundingBoxMm: index === 1 ? [251, 10, 10] : [10, 10, 10] },
      status: 'Submitted', paymentStatus: 'Unpaid', createdAt: Date.now(), submittedAt: Date.now(),
      ...(index === 0 ? { estimate: { status: 'processing', requestedAt: 0 } } : {}) })
  }
  await bucket.file(sourcePath).save('invalid STL', { contentType: 'model/stl' })
  worker = spawn('node', ['scripts/slicing-worker.mjs'], { stdio: ['ignore', 'inherit', 'inherit'] })
  const exit = new Promise((resolve) => worker.once('exit', resolve))
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
  assert.deepEqual((await db.doc('pricing/default').get()).data(), before, 'seed must preserve edited pricing')
  worker.kill('SIGTERM')
  await exit
  assert.equal(existsSync('.local/slicing-worker.lock'), false)
  console.log('PASS: interrupted job recovery, unsupported process, oversized model, invalid STL, preserved RFQs and pricing, clean worker shutdown.')
} finally {
  if (worker && worker.exitCode === null) {
    const exit = new Promise((resolve) => worker.once('exit', resolve))
    worker.kill('SIGTERM')
    await exit
  }
  for (const id of ids) await db.doc(`rfqs/${id}`).delete()
  await bucket.file(sourcePath).delete({ ignoreNotFound: true })
  await db.terminate()
}
