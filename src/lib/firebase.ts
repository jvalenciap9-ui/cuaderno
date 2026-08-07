import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
export const storage = getStorage(app);

// Emuladores locales: activar con VITE_EMULATORS=1 (solo desarrollo/auditoría).
if (import.meta.env.VITE_EMULATORS === '1') {
  connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, 'localhost', 8081);
  connectStorageEmulator(storage, 'localhost', 9199);
  connectFunctionsEmulator(getFunctions(app), 'localhost', 5001);
  console.info('🔧 Conectado a los emuladores locales de Firebase');
}

// M1: Firebase App Check con ReCAPTCHA Enterprise. Solo se inicializa si el
// config provee `appCheckSiteKey` (se configura en Firebase Console y en
// firebase-applet-config.json). Si no existe, el init se salta silenciosamente.
const siteKey = (firebaseConfig as Record<string, unknown>).appCheckSiteKey as string | undefined;
if (siteKey) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (e) {
    console.warn('App Check no inicializado:', e);
  }
}
