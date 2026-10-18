import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { defaultPricing } from '../apps/web/lib/pricing.ts'
import { DEMO_ORGANIZATION_ID, DEMO_ORGANIZATION_NAME } from '../apps/web/lib/organization.ts'
import { equipment, materials } from '../apps/web/lib/mock/manufacturer.ts'

export const projectId = 'demo-oi-manufacture'
const demoShippingOrigin = {
  name: 'Demo Organization',
  phone: '0000000000',
  addressLine: 'Semanggi (demo origin)',
  postalCode: '12930',
  destinationId: 17578,
  destinationLabel: 'KARET SEMANGGI, SETIA BUDI, JAKARTA SELATAN, DKI JAKARTA, 12930',
}
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
  const organization = db.doc(`organizations/${DEMO_ORGANIZATION_ID}`)
  const organizationData = {
    name: DEMO_ORGANIZATION_NAME,
    active: true,
    acceptingRequests: true,
  }
  const organizationSnapshot = await organization.get()
  if (organizationSnapshot.exists) {
    await organization.set(organizationData, { merge: true })
    if (!organizationSnapshot.data().shippingOrigin) {
      await organization.update({ shippingOrigin: demoShippingOrigin })
    }
  } else {
    await organization.create({ ...organizationData, shippingOrigin: demoShippingOrigin, createdAt: Date.now() })
  }
  const allowlist = db.doc(`manufacturers/${uid}`)
  await allowlist.set({ active: true, organizationId: DEMO_ORGANIZATION_ID, role: 'owner' }, { merge: true })
  const legacyPricing = db.doc('pricing/default')
  const pricing = db.doc(`pricing/${DEMO_ORGANIZATION_ID}`)
  if (!(await pricing.get()).exists) {
    const legacy = await legacyPricing.get()
    await pricing.create(legacy.exists ? legacy.data() : defaultPricing)
  }
  if ((await legacyPricing.get()).exists) await legacyPricing.delete()
  for (const material of materials) {
    const ref = db.doc(`materials/${material.id}`)
    const existing = await ref.get()
    if (!existing.exists) {
      const data = { ...material }
      delete data.id
      delete data.compatibleEquipment
      await ref.create({ ...data, organizationId: DEMO_ORGANIZATION_ID })
    } else if (typeof existing.data().organizationId !== 'string') {
      await ref.update({ organizationId: DEMO_ORGANIZATION_ID })
    }
  }
  for (const machine of equipment) {
    const ref = db.doc(`equipment/${machine.id}`)
    const existing = await ref.get()
    const compatibleMaterialIds = materials.filter((material) => material.compatibleEquipment.includes(machine.id)).map((material) => material.id)
    if (!existing.exists) {
      const { id, buildVolume, materials: _materials, ...data } = machine
      const dimensions = [...buildVolume.matchAll(/[\d.]+/g)].map(([value]) => Number(value)).slice(0, 3)
      if (dimensions.length !== 3 || dimensions.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error(`Invalid build volume for ${id}.`)
      await ref.create({ ...data, organizationId: DEMO_ORGANIZATION_ID, buildVolumeMm: dimensions, compatibleMaterialIds })
    } else {
      const updates = {}
      if ((!existing.data().organizationId || existing.data().organizationId === DEMO_ORGANIZATION_ID) && !existing.data().updatedAt && JSON.stringify(existing.data().compatibleMaterialIds) !== JSON.stringify(compatibleMaterialIds)) updates.compatibleMaterialIds = compatibleMaterialIds
      if (typeof existing.data().organizationId !== 'string') updates.organizationId = DEMO_ORGANIZATION_ID
      if (Object.keys(updates).length) await ref.update(updates)
    }
  }
  for (const name of ['rfqs', 'materials', 'equipment', 'purchaseOrders', 'inventoryMovements', 'productionOrders', 'kaseraPaymentAttempts']) {
    const snapshot = await db.collection(name).get()
    const missing = snapshot.docs.filter((item) => typeof item.data().organizationId !== 'string')
    for (let offset = 0; offset < missing.length; offset += 450) {
      const batch = db.batch()
      for (const item of missing.slice(offset, offset + 450)) batch.update(item.ref, { organizationId: DEMO_ORGANIZATION_ID })
      await batch.commit()
    }
  }
  console.log('[local] Manufacturer, pricing, materials, and equipment ready. Firebase: localhost only.')
}

if (process.argv[1]?.endsWith('/local-firebase.mjs')) await seedLocalData()
