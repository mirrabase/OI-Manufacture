import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defaultPricing } from '../apps/web/lib/pricing.ts'

export const projectId = 'demo-oi-manufacture'
process.env.METADATA_SERVER_DETECTION = 'none'
for (const key of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
  if (process.env[key] && process.env[key] !== projectId) throw new Error(`${key} must be ${projectId}; cloud access is disabled.`)
  process.env[key] = projectId
}
for (const [key, fallback] of Object.entries({
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:19199',
})) {
  const value = process.env[key] || fallback
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(value)) throw new Error(`${key} must point to a loopback emulator.`)
  process.env[key] = value
}
process.env.STORAGE_EMULATOR_HOST = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}`
const app = initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
export const db = getFirestore(app)
export const auth = getAuth(app)
export const bucket = getStorage(app).bucket()

export async function seedLocalData() {
  const uid = 'local-manufacturer'
  try {
    await auth.getUser(uid)
  } catch (error) {
    if (error.code !== 'auth/user-not-found') throw error
    await auth.createUser({ uid, email: 'manufacturer@oi.local', password: 'local-manufacturer-123', displayName: 'Local Manufacturer' })
  }
  const allowlist = db.doc(`manufacturers/${uid}`)
  if (!(await allowlist.get()).exists) await allowlist.create({ active: true })
  const pricing = db.doc('pricing/default')
  if (!(await pricing.get()).exists) await pricing.create(defaultPricing)
  console.log('[local] Manufacturer and example PLA pricing ready. Firebase: localhost only.')
}

if (process.argv[1]?.endsWith('/local-firebase.mjs')) await seedLocalData()
