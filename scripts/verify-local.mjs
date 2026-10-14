import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { db, auth as adminAuth, bucket, seedLocalData, projectId } from './local-firebase.mjs'
import { defaultPricing } from '../apps/web/lib/pricing.ts'

const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { initializeApp, deleteApp } = require('firebase/app')
const { getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword } = require('firebase/auth')
const { getFirestore, connectFirestoreEmulator, doc, setDoc, updateDoc, getDoc, onSnapshot, query, collection, where, orderBy, terminate, setLogLevel } = require('firebase/firestore')
const { getStorage, connectStorageEmulator, ref, getBytes, uploadBytes } = require('firebase/storage')
setLogLevel('silent')
const clients = []
const ids = []
const files = []
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
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('Firestore listener timed out')) }, 15_000)
    const unsubscribe = onSnapshot(target, (snapshot) => {
      if (check(snapshot)) { clearTimeout(timer); unsubscribe(); resolve() }
    }, (error) => { clearTimeout(timer); unsubscribe(); reject(error) })
  })
}

try {
  await seedLocalData()
  previousPricing = (await db.doc('pricing/default').get()).data()
  const owner = client('owner'), other = client('other'), manufacturer = client('manufacturer'), inactive = client('inactive')
  await Promise.all([signInAnonymously(owner.auth), signInAnonymously(other.auth), signInAnonymously(inactive.auth),
    signInWithEmailAndPassword(manufacturer.auth, 'manufacturer@oi.local', 'local-manufacturer-123')])
  inactiveUid = inactive.auth.currentUser.uid
  await db.doc(`manufacturers/${inactiveUid}`).set({ active: false })
  const id = `verify-${randomUUID()}`
  ids.push(id)
  const uid = owner.auth.currentUser.uid
  const path = `rfqs/${uid}/${id}/model.stl`
  files.push(path)
  const draft = { ownerUid: uid, customer: { name: 'Local verification', email: 'test@example.invalid' }, product: 'Rules verification',
    requirements: { quantity: 1, material: 'PLA', process: 'FDM', unit: 'mm', notes: '' },
    model: { name: 'model.stl', size: 100, contentType: 'model/stl', storagePath: path, boundingBoxMm: [1, 1, 1] },
    status: 'Draft', paymentStatus: 'Unpaid', createdAt: Date.now() }
  const ownDoc = doc(owner.firestore, 'rfqs', id)
  assert.equal((await getDoc(ownDoc)).exists(), false)
  await denied(() => setDoc(ownDoc, { ...draft, estimate: { status: 'ready', total: 1 } }))
  await setDoc(ownDoc, draft)
  await uploadBytes(ref(owner.storage, path), new TextEncoder().encode('verification STL'), { contentType: 'model/stl' })
  await db.doc(`rfqs/${id}`).update({ estimate: { status: 'unsupported', requestedAt: 0, error: 'Verification fixture' } })
  await updateDoc(ownDoc, { status: 'Submitted', submittedAt: Date.now() })
  await denied(() => uploadBytes(ref(owner.storage, path), new TextEncoder().encode('changed'), { contentType: 'model/stl' }))
  await denied(() => getDoc(doc(other.firestore, 'rfqs', id)))
  await denied(() => getDoc(doc(inactive.firestore, 'rfqs', id)))
  await denied(() => updateDoc(ownDoc, { estimate: { status: 'ready', total: 1 } }))
  const paid = { status: 'In Production', paymentStatus: 'Paid', paidAt: Date.now() }
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), paid))
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
  await denied(() => updateDoc(ownDoc, paid))
  await denied(() => updateDoc(doc(inactive.firestore, 'rfqs', id), paid))
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), { ...paid, product: 'tampered' }))
  const preview = `rfqs/${uid}/${id}/preview.gcode`
  files.push(preview)
  await bucket.file(preview).save('G1 X1 Y1 E1\n', { contentType: 'text/plain' })
  assert.ok((await getBytes(ref(owner.storage, preview))).byteLength > 0)
  assert.ok((await getBytes(ref(manufacturer.storage, preview))).byteLength > 0)
  await denied(() => getBytes(ref(other.storage, preview)))
  await denied(() => getBytes(ref(inactive.storage, preview)))
  await denied(() => uploadBytes(ref(owner.storage, preview), new TextEncoder().encode('tampered'), { contentType: 'text/plain' }))
  const ownerPaid = waitFor(ownDoc, (snapshot) => snapshot.data()?.status === 'In Production' && snapshot.data()?.paymentStatus === 'Paid')
  const manufacturerOrders = waitFor(query(collection(manufacturer.firestore, 'rfqs'), where('status', '==', 'In Production'), orderBy('paidAt', 'desc')), (snapshot) => snapshot.docs.some((item) => item.id === id))
  const customerOrders = waitFor(query(collection(owner.firestore, 'rfqs'), where('ownerUid', '==', uid), orderBy('createdAt', 'desc')), (snapshot) => snapshot.docs.some((item) => item.id === id && item.data().status === 'In Production'))
  await updateDoc(doc(manufacturer.firestore, 'rfqs', id), paid)
  await Promise.all([ownerPaid, manufacturerOrders, customerOrders])
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), { estimateRequestedAt: Date.now() }))
  await denied(() => updateDoc(doc(manufacturer.firestore, 'rfqs', id), { quoteTotal: 1, quotedAt: Date.now() }))
  console.log('PASS: ownership, immutable submitted STL, pricing validation, active Manufacturer permissions, final quotation, Paid transition, protected preview, and customer/Manufacturer Orders listeners.')
} finally {
  if (previousPricing) await db.doc('pricing/default').set(previousPricing)
  for (const id of ids) await db.doc(`rfqs/${id}`).delete()
  for (const path of files) await bucket.file(path).delete({ ignoreNotFound: true })
  if (inactiveUid) await db.doc(`manufacturers/${inactiveUid}`).delete()
  for (const value of clients) {
    if (value.auth.currentUser && value.auth.currentUser.uid !== 'local-manufacturer') await adminAuth.deleteUser(value.auth.currentUser.uid)
    await terminate(value.firestore)
    await deleteApp(value.app)
  }
  await db.terminate()
}
