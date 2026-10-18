import { getApp, getApps, initializeApp } from "firebase/app"
import { getAuth } from "firebase/auth"
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore"
import { connectAuthEmulator } from "firebase/auth"
import { getStorage, connectStorageEmulator } from "firebase/storage"
import { connectFunctionsEmulator, getFunctions } from "firebase/functions"

export const useFirebaseEmulator = process.env.NODE_ENV !== "production" && (process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true" || process.env.NODE_ENV === "development")

const firebaseConfig = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-api-key",
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo-oi-manufacture.firebaseapp.com",
    projectId: useFirebaseEmulator ? "demo-oi-manufacture" : process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo-oi-manufacture",
    storageBucket: useFirebaseEmulator ? "demo-oi-manufacture.appspot.com" : process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "demo-oi-manufacture.appspot.com",
    messagingSenderId:
        process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

const app = getApps().length
    ? getApp()
    : initializeApp(firebaseConfig)

export const auth = getAuth(app)
export const db = getFirestore(app)
export const storage = getStorage(app)

// Separate app keeps Manufacturer login from replacing the customer's guest session.
const manufacturerApp = getApps().find((item) => item.name === "manufacturer") ?? initializeApp(firebaseConfig, "manufacturer")
export const manufacturerAuth = getAuth(manufacturerApp)
export const manufacturerDb = getFirestore(manufacturerApp)
export const manufacturerStorage = getStorage(manufacturerApp)
export const functions = getFunctions(app)
export const manufacturerFunctions = getFunctions(manufacturerApp)

if (typeof window !== "undefined" && useFirebaseEmulator) {
  if (!auth.emulatorConfig) {
    connectAuthEmulator(auth, "http://127.0.0.1:19099", { disableWarnings: true })
    connectFirestoreEmulator(db, "127.0.0.1", 18080)
    connectStorageEmulator(storage, "127.0.0.1", 19199)
    connectFunctionsEmulator(functions, "127.0.0.1", 15001)
  }
  if (!manufacturerAuth.emulatorConfig) {
    connectAuthEmulator(manufacturerAuth, "http://127.0.0.1:19099", { disableWarnings: true })
    connectFirestoreEmulator(manufacturerDb, "127.0.0.1", 18080)
    connectStorageEmulator(manufacturerStorage, "127.0.0.1", 19199)
    connectFunctionsEmulator(manufacturerFunctions, "127.0.0.1", 15001)
  }
}
