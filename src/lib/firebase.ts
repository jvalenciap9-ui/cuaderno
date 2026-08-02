import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
export const storage = getStorage(app);

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
