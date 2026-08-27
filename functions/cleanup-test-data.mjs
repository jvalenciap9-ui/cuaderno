// scripts/cleanup-test-data.mjs
//
// Uso:
//   node scripts/cleanup-test-data.mjs --dry-run
//   node scripts/cleanup-test-data.mjs --yes
//
// Descripción:
//   Borra las colecciones de Firestore utilizadas por las pruebas para
//   garantizar un estado limpio antes de ejecutar los scripts de test.
//   Es especialmente útil para el emulador o un proyecto de desarrollo.
//   Por seguridad, si no detecta el emulador, exige confirmación explícita.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// 1. Cargar credenciales de Firebase Admin.
//    Ajusta la ruta si usas un archivo de credenciales diferente.
let serviceAccount;
try {
  serviceAccount = JSON.parse(
    readFileSync(join(rootDir, 'functions', 'serviceAccountKey.json'), 'utf8')
  );
} catch {
  console.error('No se encontró serviceAccountKey.json en functions/.');
  console.error('Usa las credenciales de Firebase Admin para scripts.');
  process.exit(1);
}

const projectId = serviceAccount.project_id;
const isEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;

if (!isEmulator && projectId.includes('ediagil-new-2026')) {
  console.error('⛔ Este script NO debe ejecutarse contra producción.');
  console.error('   Usa el emulador o un proyecto de desarrollo.');
  process.exit(1);
}

const app = initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore(app);

// 2. Colecciones que las pruebas crean/modifican.
//    Ajusta esta lista según las colecciones reales de EdiAgil.
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

// 3. Modo dry-run: solo muestra cuántos documentos se borrarían.
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
  const batchSize = 500;
  const docs = snapshot.docs;
  for (let i = 0; i < docs.length; i += batchSize) {
    const batch = db.batch();
    docs.slice(i, i + batchSize).forEach((doc) => {
      batch.delete(doc.ref);
    });
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