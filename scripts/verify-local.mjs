import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { db, auth as adminAuth, bucket, seedLocalData, projectId } from './local-firebase.mjs'
import { defaultPricing } from '../apps/web/lib/pricing.ts'
import { getProductionReadiness } from '../apps/web/lib/manufacturing-operations.ts'

const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase/app')
const { getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword } = require('firebase/auth')
const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, onSnapshot, query, collection, where, orderBy, runTransaction, deleteField, terminate, setLogLevel } = require('firebase/firestore')
const { FieldValue } = require('firebase-admin/firestore')
const { getStorage, connectStorageEmulator, ref, getBytes, uploadBytes } = require('firebase/storage')
setLogLevel('silent')
const clients = []
const rfqIds = []
const files = []
const internalPaths = []
let inactiveUid
let previousPricing

function client(name) {
  const app = initializeApp({ projectId, apiKey: 'demo-api-key', storageBucket: `${projectId}.appspot.com` }, `verify-${name}-${randomUUID()}`)
  const auth = getAuth(app)
  connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
  const firestore = getFirestore(app)
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':')
  connectFirestoreEmulator(firestore, host, Number(port))
  const storage = getStorage(app)
  const [storageHost, storagePort] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')
  connectStorageEmulator(storage, storageHost, Number(storagePort))
  const value = { app, auth, firestore, storage }
  clients.push(value)
  return value
}

async function denied(operation) {
  await assert.rejects(operation, (error) => /permission-denied|storage\/unauthorized/.test(error.code))
}

function waitFor(target, check) {
  return new Promise((resolve, reject) => {
    let unsubscribe = () => {}
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Firestore listener timed out')) }, 15_000)
    unsubscribe = onSnapshot(target, (snapshot) => {
      if (check(snapshot)) { clearTimeout(timer); unsubscribe(); resolve() }
    }, (error) => { clearTimeout(timer); unsubscribe(); reject(error) })
  })
}

function requestDraft(uid, id, overrides = {}) {
  return {
    ownerUid: uid,
    customer: { name: 'Local verification', email: 'test@example.invalid' },
    product: 'Rules verification',
    requirements: { quantity: 1, material: 'PLA', process: 'FDM', unit: 'mm', notes: '' },
    model: { name: 'model.stl', size: 100, contentType: 'model/stl', storagePath: `rfqs/${uid}/${id}/model.stl`, boundingBoxMm: [1, 1, 1] },
    status: 'Draft',
    paymentStatus: 'Unpaid',
    createdAt: Date.now(),
    ...overrides,
  }
}

try {
  await seedLocalData()
  for (const equipmentId of ['EQ-001', 'EQ-002']) {
    assert.ok((await db.doc(`equipment/${equipmentId}`).get()).data().compatibleMaterialIds.includes('MAT-005'))
  }
  previousPricing = (await db.doc('pricing/default').get()).data()
  const owner = client('owner'), other = client('other'), manufacturer = client('manufacturer'), inactive = client('inactive')
  await Promise.all([signInAnonymously(owner.auth), signInAnonymously(other.auth), signInAnonymously(inactive.auth),
    signInWithEmailAndPassword(manufacturer.auth, 'manufacturer@oi.local', 'local-manufacturer-123')])
  inactiveUid = inactive.auth.currentUser.uid
  await db.doc(`manufacturers/${inactiveUid}`).set({ active: false })

  const id = `verify-${randomUUID()}`
  const noQuoteId = `${id}-no-quote`
  rfqIds.push(id, noQuoteId)
  const uid = owner.auth.currentUser.uid
  const path = `rfqs/${uid}/${id}/model.stl`
  files.push(path)
  const ownDoc = doc(owner.firestore, 'rfqs', id)
  const noQuoteDoc = doc(owner.firestore, 'rfqs', noQuoteId)
  const draft = requestDraft(uid, id)
  assert.equal((await getDoc(ownDoc)).exists(), false)
  await denied(() => setDoc(ownDoc, { ...draft, estimate: { status: 'ready', total: 1 } }))
  await setDoc(ownDoc, draft)
  await uploadBytes(ref(owner.storage, path), new TextEncoder().encode('verification STL'), { contentType: 'model/stl' })
  await db.doc(`rfqs/${id}`).update({ estimate: { status: 'unsupported', requestedAt: 0, error: 'Verification fixture' } })
  await updateDoc(ownDoc, { status: 'Submitted', submittedAt: Date.now() })

  // Customer submission does not query materials or equipment, even when local stock is empty.
  const materialId = `${id}-material`
  const equipmentId = `${id}-equipment`
  const purchaseId = `${id}-purchase`
  const receiptMovementId = `${id}-receipt`
  const scheduleMovementId = `${id}-schedule`
  const completeMovementId = `${id}-complete`
  const planPath = `productionOrders/${id}`
  const poPath = `purchaseOrders/${purchaseId}`
  internalPaths.push(`materials/${materialId}`, `equipment/${equipmentId}`, poPath, planPath,
    `inventoryMovements/${receiptMovementId}`, `inventoryMovements/${scheduleMovementId}`, `inventoryMovements/${completeMovementId}`)
  await setDoc(doc(manufacturer.firestore, 'materials', materialId), {
    name: 'PLA', category: 'Test filament', manufacturer: 'Local verification', unitCost: 1000,
    stock: 0, reserved: 0, reorderAt: 0.5, properties: 'Test', updatedAt: Date.now(),
  })
  await setDoc(doc(manufacturer.firestore, 'equipment', equipmentId), {
    name: 'Test printer', manufacturer: 'Local verification', model: 'Test 1', technology: 'FDM',
    buildVolumeMm: [10, 10, 10], compatibleMaterialIds: [materialId], hourlyCost: 1000,
    workingHours: 8, scheduledHours: 0, status: 'Available', updatedAt: Date.now(),
  })
  const readiness = getProductionReadiness(
    { ...requestDraft(uid, id), id, status: 'Preparing Production', paymentStatus: 'Paid' },
    { id, rfqId: id, status: 'Preparing Production', materialId, equipmentId, plannedGrams: 500, plannedHours: 1, reservedKg: 0, createdAt: Date.now(), updatedAt: Date.now() },
    [{ id: materialId, name: 'PLA', stock: 0, reserved: 0, reorderAt: 0.5 }],
    [{ id: equipmentId, name: 'Test printer', technology: 'FDM', compatibleMaterialIds: [materialId], buildVolumeMm: [10, 10, 10], workingHours: 8, scheduledHours: 0, status: 'Available' }],
  )
  assert.equal(readiness.ready, false)
  assert.match(readiness.blockers.join(' '), /Short 0\.500 kg/)
  const capacity = getProductionReadiness(
    { ...requestDraft(uid, id), id, status: 'Preparing Production', paymentStatus: 'Paid' },
    { id, rfqId: id, status: 'Preparing Production', materialId, equipmentId, plannedGrams: 500, plannedHours: 1, reservedKg: 0, createdAt: Date.now(), updatedAt: Date.now() },
    [{ id: materialId, name: 'PLA', stock: 2, reserved: 0, reorderAt: 0.5 }],
    [{ id: equipmentId, name: 'Test printer', technology: 'FDM', compatibleMaterialIds: [materialId], buildVolumeMm: [10, 10, 10], workingHours: 8, scheduledHours: 7.5, status: 'Available' }],
  )
  assert.match(capacity.blockers.join(' '), /not have enough working hours/)
  const tpuRequest = { ...requestDraft(uid, id), id, status: 'Preparing Production', paymentStatus: 'Paid', requirements: { quantity: 1, material: 'TPU', process: 'FDM', unit: 'mm', notes: '' } }
  const tpuReadiness = getProductionReadiness(tpuRequest,
    { id, rfqId: id, status: 'Preparing Production', materialId, equipmentId, plannedGrams: 500, plannedHours: 1, reservedKg: 0, createdAt: Date.now(), updatedAt: Date.now() },
    [{ id: materialId, name: 'TPU 95A', stock: 2, reserved: 0, reorderAt: 0.5 }],
    [{ id: equipmentId, name: 'Test printer', technology: 'FDM', compatibleMaterialIds: [materialId], buildVolumeMm: [10, 10, 10], workingHours: 8, scheduledHours: 0, status: 'Available' }],
  )
  assert.equal(tpuReadiness.ready, true)
  await setDoc(noQuoteDoc, requestDraft(uid, noQuoteId))
  await updateDoc(noQuoteDoc, { status: 'Submitted', submittedAt: Date.now() })
  await denied(() => getDoc(doc(owner.firestore, 'materials', materialId)))
  await denied(() => getDoc(doc(owner.firestore, 'equipment', equipmentId)))
  await denied(() => getDoc(doc(owner.firestore, 'purchaseOrders', purchaseId)))
  await denied(() => getDoc(doc(owner.firestore, 'productionOrders', id)))
  await denied(() => getDoc(doc(inactive.firestore, 'materials', materialId)))
  assert.equal((await getDoc(doc(manufacturer.firestore, 'materials', materialId))).data().stock, 0)

  await denied(() => uploadBytes(ref(owner.storage, path), new TextEncoder().encode('changed'), { contentType: 'model/stl' }))
  await denied(() => getDoc(doc(other.firestore, 'rfqs', id)))
  await denied(() => getDoc(doc(inactive.firestore, 'rfqs', id)))
  await denied(() => updateDoc(ownDoc, { estimate: { status: 'ready', total: 1 } }))
  await denied(() => updateDoc(ownDoc, { estimateRequestedAt: Date.now() }))
  await denied(() => setDoc(doc(owner.firestore, 'pricing/default'), defaultPricing))
  await denied(() => setDoc(doc(inactive.firestore, 'pricing/default'), defaultPricing))
  await denied(() => setDoc(doc(manufacturer.firestore, 'pricing/default'), { ...defaultPricing, layerHeight: 0 }))
  await denied(() => setDoc(doc(manufacturer.firestore, 'pricing/default'), { ...defaultPricing, setup: -1 }))
  await setDoc(doc(manufacturer.firestore, 'pricing/default'), { ...previousPricing, setup: previousPricing.setup + 1000 })
  await setDoc(doc(manufacturer.firestore, 'pricing/default'), previousPricing)

  const quoteSeen = waitFor(ownDoc, (snapshot) => snapshot.data()?.quoteTotal === 42_000 && snapshot.data()?.status === 'Quoted')
  await updateDoc(doc(manufacturer.firestore, 'rfqs', id), { status: 'Quoted', quoteTotal: 42_000, paymentStatus: 'Unpaid', quotedAt: Date.now() })
  await quoteSeen
  await denied(() => updateDoc(ownDoc, { status: 'Preparing Production', paymentStatus: 'Paid', paidAt: Date.now() }))
  await denied(() => updateDoc(doc(inactive.firestore, 'rfqs', id), { status: 'Preparing Production', paymentStatus: 'Paid', paidAt: Date.now() }))
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), { status: 'Preparing Production', paymentStatus: 'Paid', paidAt: Date.now() }))
  await denied(() => runTransaction(manufacturer.firestore, async (transaction) => {
    const requestRef = doc(manufacturer.firestore, 'rfqs', noQuoteId)
    const planRef = doc(manufacturer.firestore, 'productionOrders', noQuoteId)
    await transaction.get(requestRef)
    transaction.update(requestRef, { status: 'Preparing Production', paymentStatus: 'Paid', paidAt: Date.now() })
    transaction.set(planRef, { rfqId: noQuoteId, status: 'Preparing Production', materialId: '', equipmentId: '', plannedGrams: 0, plannedHours: 0, reservedKg: 0, createdAt: Date.now(), updatedAt: Date.now() })
  }))
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), { status: 'Quoted', quoteTotal: 1, quotedAt: Date.now(), product: 'tampered' }))

  const attemptId = `${id}-kasera-attempt`
  internalPaths.push(`kaseraPaymentAttempts/${attemptId}`)
  await db.doc(`kaseraPaymentAttempts/${attemptId}`).set({ rfqId: id, ownerUid: uid, quoteTotal: 42_000, status: 'pending' })
  await db.doc(`rfqs/${id}`).update({ activeKaseraPaymentAttemptId: attemptId })
  await denied(() => getDoc(doc(owner.firestore, 'kaseraPaymentAttempts', attemptId)))
  await denied(() => getDoc(doc(manufacturer.firestore, 'kaseraPaymentAttempts', attemptId)))
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), { quoteTotal: 43_000, quotedAt: Date.now() }))
  await db.doc(`rfqs/${id}`).update({ activeKaseraPaymentAttemptId: FieldValue.delete() })

  const preview = `rfqs/${uid}/${id}/preview.gcode`
  files.push(preview)
  await bucket.file(preview).save('G1 X1 Y1 E1\n', { contentType: 'text/plain' })
  assert.ok((await getBytes(ref(owner.storage, preview))).byteLength > 0)
  assert.ok((await getBytes(ref(manufacturer.storage, preview))).byteLength > 0)
  await denied(() => getBytes(ref(other.storage, preview)))
  await denied(() => getBytes(ref(inactive.storage, preview)))
  await denied(() => uploadBytes(ref(owner.storage, preview), new TextEncoder().encode('tampered'), { contentType: 'text/plain' }))

  const now = Date.now()
  const requestRef = db.doc(`rfqs/${id}`)
  const planRef = db.doc(`productionOrders/${id}`)
  assert.equal((await requestRef.get()).data()?.status, 'Quoted')
  await requestRef.update({ status: 'Preparing Production', paymentStatus: 'Paid', paymentConfirmedBy: 'verification', paidAt: now })
  await planRef.set({ rfqId: id, status: 'Preparing Production', materialId, equipmentId, plannedGrams: 500, plannedHours: 1, reservedKg: 0, createdAt: now, updatedAt: now })
  assert.equal((await getDoc(doc(manufacturer.firestore, 'productionOrders', id))).data().status, 'Preparing Production')
  await denied(() => getDoc(doc(owner.firestore, 'productionOrders', id)))

  const customerPreparing = waitFor(query(collection(owner.firestore, 'rfqs'), where('ownerUid', '==', uid), orderBy('createdAt', 'desc')),
    (snapshot) => snapshot.docs.some((item) => item.id === id && item.data().status === 'Preparing Production'))
  const manufacturerOrders = waitFor(query(collection(manufacturer.firestore, 'rfqs'), where('status', 'in', ['Preparing Production', 'In Production', 'Completed']), orderBy('submittedAt', 'desc')),
    (snapshot) => snapshot.docs.some((item) => item.id === id && item.data().status === 'Preparing Production'))
  await Promise.all([customerPreparing, manufacturerOrders])

  await setDoc(doc(manufacturer.firestore, 'purchaseOrders', purchaseId), {
    supplier: 'Local verification supplier', materialId, quantity: 2, eta: '2026-10-15', status: 'Ordered', createdAt: now,
  })
  await runTransaction(manufacturer.firestore, async (transaction) => {
    const materialRef = doc(manufacturer.firestore, 'materials', materialId)
    const orderRef = doc(manufacturer.firestore, 'purchaseOrders', purchaseId)
    const [material, order] = await Promise.all([transaction.get(materialRef), transaction.get(orderRef)])
    transaction.update(materialRef, { stock: material.data().stock + order.data().quantity, updatedAt: Date.now() })
    transaction.update(orderRef, { status: 'Received', receivedAt: Date.now() })
    transaction.set(doc(manufacturer.firestore, 'inventoryMovements', receiptMovementId), { type: 'purchaseReceipt', materialId, deltaKg: 2, reservedDeltaKg: 0, referenceId: purchaseId, createdAt: Date.now() })
  })
  assert.equal((await getDoc(doc(manufacturer.firestore, 'materials', materialId))).data().stock, 2)

  await runTransaction(manufacturer.firestore, async (transaction) => {
    const materialRef = doc(manufacturer.firestore, 'materials', materialId)
    const equipmentRef = doc(manufacturer.firestore, 'equipment', equipmentId)
    const planRef = doc(manufacturer.firestore, 'productionOrders', id)
    const [material, machine, plan] = await Promise.all([transaction.get(materialRef), transaction.get(equipmentRef), transaction.get(planRef)])
    transaction.update(materialRef, { reserved: material.data().reserved + 0.5, updatedAt: Date.now() })
    transaction.update(equipmentRef, { status: 'Scheduled', scheduledHours: machine.data().scheduledHours + 1, activeProductionOrderId: id, updatedAt: Date.now() })
    transaction.update(planRef, { status: 'Scheduled', reservedKg: 0.5, updatedAt: Date.now() })
    transaction.set(doc(manufacturer.firestore, 'inventoryMovements', scheduleMovementId), { type: 'reservation', materialId, deltaKg: 0, reservedDeltaKg: 0.5, referenceId: id, createdAt: Date.now() })
  })
  await runTransaction(manufacturer.firestore, async (transaction) => {
    const requestRef = doc(manufacturer.firestore, 'rfqs', id)
    const planRef = doc(manufacturer.firestore, 'productionOrders', id)
    transaction.update(planRef, { status: 'In Production', updatedAt: Date.now() })
    transaction.update(requestRef, { status: 'In Production', productionStartedAt: Date.now() })
  })
  const customerInProduction = waitFor(doc(owner.firestore, 'rfqs', id), (snapshot) => snapshot.data()?.status === 'In Production')
  await customerInProduction
  await runTransaction(manufacturer.firestore, async (transaction) => {
    const materialRef = doc(manufacturer.firestore, 'materials', materialId)
    const equipmentRef = doc(manufacturer.firestore, 'equipment', equipmentId)
    const planRef = doc(manufacturer.firestore, 'productionOrders', id)
    const requestRef = doc(manufacturer.firestore, 'rfqs', id)
    const [material, machine] = await Promise.all([transaction.get(materialRef), transaction.get(equipmentRef)])
    transaction.update(materialRef, { stock: material.data().stock - 0.2, reserved: material.data().reserved - 0.5, updatedAt: Date.now() })
    transaction.update(equipmentRef, { status: 'Available', scheduledHours: machine.data().scheduledHours - 1, activeProductionOrderId: deleteField(), updatedAt: Date.now() })
    transaction.update(planRef, { status: 'Completed', reservedKg: 0, actualGrams: 200, updatedAt: Date.now() })
    transaction.update(requestRef, { status: 'Completed', completedAt: Date.now() })
    transaction.set(doc(manufacturer.firestore, 'inventoryMovements', completeMovementId), { type: 'consumption', materialId, deltaKg: -0.2, reservedDeltaKg: -0.5, referenceId: id, createdAt: Date.now() })
  })
  await waitFor(doc(owner.firestore, 'rfqs', id), (snapshot) => snapshot.data()?.status === 'Completed')
  assert.equal((await getDoc(doc(manufacturer.firestore, 'materials', materialId))).data().stock, 1.8)
  assert.equal((await getDoc(doc(manufacturer.firestore, 'equipment', equipmentId))).data().scheduledHours, 0)
  await denied(() => getDoc(doc(other.firestore, 'rfqs', id)))
  console.log('PASS: local-only customer submission at zero stock, RFQ privacy, active Manufacturer permissions, paid/quotation rules, production plan privacy, live customer/Manufacturer updates, purchase receiving, stock reservation, equipment capacity, and production completion.')
} finally {
  if (previousPricing) await db.doc('pricing/default').set(previousPricing)
  for (const id of rfqIds) await db.doc(`rfqs/${id}`).delete()
  for (const path of internalPaths) await db.doc(path).delete()
  for (const path of files) await bucket.file(path).delete({ ignoreNotFound: true })
  if (inactiveUid) await db.doc(`manufacturers/${inactiveUid}`).delete()
  for (const value of clients) {
    if (value.auth.currentUser && value.auth.currentUser.uid !== 'local-manufacturer') await adminAuth.deleteUser(value.auth.currentUser.uid)
    await terminate(value.firestore)
    await deleteApp(value.app)
  }
  await db.terminate()
}
