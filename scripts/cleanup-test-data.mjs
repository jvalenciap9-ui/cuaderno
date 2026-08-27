// scripts/cleanup-test-data.mjs
// Uso:
//   node scripts/cleanup-test-data.mjs --dry-run
//   node scripts/cleanup-test-data.mjs --yes

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Ahora el script está en functions/scripts/,
// por lo que "un nivel arriba" es functions/
const functionsDir = join(__dirname, '..');

// 1. Cargar credenciales de Firebase Admin desde functions/serviceAccountKey.json
let serviceAccount;
try {
  const serviceAccountPath = join(functionsDir, 'serviceAccountKey.json');
  serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));
} catch (err) {
  console.error('No se encontró serviceAccountKey.json en functions/.');
  console.error('Coloca el archivo en: functions/serviceAccountKey.json');
  console.error('Detalle:', err.message);
  process.exit(1);
}

const projectId = serviceAccount.project_id;
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

// Protección: no borrar producción
if (!isEmulator && projectId === 'ediagil-new-2026') {
  console.error('⛔ Este script NO debe ejecutarse contra producción.');
  console.error('   Usa el emulador o un proyecto de desarrollo.');
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(app);

// 2. Colecciones a limpiar. Ajusta según tus pruebas.
const COLLECTIONS_TO_CLEAN = [
  'users',
  'institutions',
  'institutionUsers',
  'licenseKeys',
  'webhookEvents',
  'subjects',
  'students',
  'grades',
  'attendance',
  'evaluations',
];

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const forceYes = args.includes('--yes');

if (!isDryRun && !forceYes) {
  console.error('Debes ejecutar con --dry-run o --yes.');
  process.exit(1);
}

async function deleteCollection(collectionName) {
  const snapshot = await db.collection(collectionName).get();
  if (isDryRun) {
    console.log(`📄 ${collectionName}: ${snapshot.size} documentos a borrar`);
    return;
  }
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += 500) {
    const batch = db.batch();
    docs.slice(i, i + 500).forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
  console.log(`✅ ${collectionName}: ${docs.length} documentos borrados`);
}

async function main() {
  console.log(`Proyecto: ${projectId}`);
  console.log(`Emulador: ${isEmulator ? 'SÍ' : 'NO'}`);
  console.log(`Modo: ${isDryRun ? 'DRY-RUN (no borra)' : 'BORRADO REAL'}`);
  console.log('---------------------------------------------------');

  for (const coll of COLLECTIONS_TO_CLEAN) {
    await deleteCollection(coll);
  }

  console.log('---------------------------------------------------');
  console.log('Proceso de limpieza finalizado.');
  await app.delete();
}

main().catch((err) => {
  console.error('Error durante la limpieza:', err);
  process.exit(1);
});