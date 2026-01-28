import { initializeApp, type FirebaseApp } from 'firebase/app'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth'
import { getFunctions, type Functions } from 'firebase/functions'

const firebaseConfig = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID
}

// Check if Firebase is configured
const isFirebaseConfigured = !!firebaseConfig.apiKey

let app: FirebaseApp | null = null
let db: Firestore | null = null
let auth: Auth | null = null
let functions: Functions | null = null

if (isFirebaseConfigured) {
    app = initializeApp(firebaseConfig)
    db = getFirestore(app)
    auth = getAuth(app)
    functions = getFunctions(app, 'asia-northeast1')
} else {
    console.warn('Firebase is not configured. Please set environment variables in .env.local')
}

export const googleProvider = new GoogleAuthProvider()
export { app, db, auth, functions, isFirebaseConfigured }
