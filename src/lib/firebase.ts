import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore, initializeFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseAppletConfig from '../../firebase-applet-config.json';

const PRODUCTION_PROJECT_ID = 'gen-lang-client-0961551337';
const PRODUCTION_DATABASE_ID = 'aeo-database19';

const viteEnv: Record<string, string | undefined> =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? ((import.meta as any).env as Record<string, string | undefined>)
    : {};

const isStagingRuntime = (viteEnv.VITE_APP_ENV || '').trim().toLowerCase() === 'staging';

const firebaseConfig = {
  apiKey: viteEnv.VITE_FIREBASE_API_KEY || firebaseAppletConfig.apiKey || '',
  authDomain: viteEnv.VITE_FIREBASE_AUTH_DOMAIN || firebaseAppletConfig.authDomain || '',
  projectId: viteEnv.VITE_FIREBASE_PROJECT_ID || firebaseAppletConfig.projectId || '',
  storageBucket: viteEnv.VITE_FIREBASE_STORAGE_BUCKET || firebaseAppletConfig.storageBucket || '',
  messagingSenderId: viteEnv.VITE_FIREBASE_MESSAGING_SENDER_ID || firebaseAppletConfig.messagingSenderId || '',
  appId: viteEnv.VITE_FIREBASE_APP_ID || firebaseAppletConfig.appId || ''
};

const databaseId = viteEnv.VITE_FIREBASE_DATABASE_ID || firebaseAppletConfig.firestoreDatabaseId || '(default)';

if (
  isStagingRuntime &&
  (firebaseConfig.projectId === PRODUCTION_PROJECT_ID || databaseId === PRODUCTION_DATABASE_ID)
) {
  throw new Error(
    `STAGING ISOLATION VIOLATION: VITE_APP_ENV=staging cannot connect to Production Firebase project (${PRODUCTION_PROJECT_ID}) or database (${PRODUCTION_DATABASE_ID}). Configure dedicated VITE_FIREBASE_* staging credentials before running.`
  );
}

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true
  }, databaseId);
} catch (e) {
  console.warn("Failed to initialize with custom database ID, using fallback:", e);
  firestoreDb = getFirestore(app, databaseId);
}

export const db = firestoreDb;
export const googleProvider = new GoogleAuthProvider();

// Validate Connection to Firestore on startup
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration.");
    }
  }
}
testConnection();

