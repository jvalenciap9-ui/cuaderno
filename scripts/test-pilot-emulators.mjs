/**
 * Puerta Firebase del piloto. Arranca y detiene sus propios emuladores con
 * projectId demo-ediagil y sin Emulator UI, para evitar usar producción o
 * volver a chocar con el puerto 4000.
 */
import { spawn } from 'node:child_process';

const projectId = process.env.FIREBASE_PROJECT_ID || 'demo-ediagil';
if (!/^demo-[a-z0-9-]+$/.test(projectId)) {
  console.error(`BLOCKED — FIREBASE_PROJECT_ID debe ser un identificador demo seguro (recibido: ${projectId}).`);
  process.exit(1);
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor !== 22) {
  console.warn(`ADVERTENCIA — Functions usa Node 22; esta terminal ejecuta Node ${process.versions.node}.`);
}

const env = {
  ...process.env,
  FIREBASE_PROJECT_ID: projectId,
  GCLOUD_PROJECT: projectId,
  GOOGLE_CLOUD_PROJECT: projectId,
  FUNCTIONS_DISCOVERY_TIMEOUT: process.env.FUNCTIONS_DISCOVERY_TIMEOUT || '120',
  LEMON_SQUEEZY_WEBHOOK_SECRET: process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'emulator-webhook-secret',
  LEMON_SQUEEZY_API_KEY: process.env.LEMON_SQUEEZY_API_KEY || 'emulator-ls-api-key',
  LEMON_SQUEEZY_SCHOOL_VARIANT_ID: process.env.LEMON_SQUEEZY_SCHOOL_VARIANT_ID || '900001',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || 'emulator-gemini-key',
};

const isWindows = process.platform === 'win32';
const firebaseArgs = [
  'firebase',
  'emulators:exec',
  '--config',
  'firebase.pilot.json',
  '--only',
  'auth,firestore,functions,storage',
  '--project',
  projectId,
  'node scripts/test-pilot-emulator-suite.mjs',
];

// Node 24 en Windows puede devolver spawn EINVAL al abrir directamente un
// archivo .cmd. Invocar cmd.exe de forma explícita evita esa dependencia.
const child = isWindows
  ? spawn(process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe', [
      '/d',
      '/s',
      '/c',
      `npx firebase emulators:exec --config firebase.pilot.json --only auth,firestore,functions,storage --project ${projectId} "node scripts/test-pilot-emulator-suite.mjs"`,
    ], { stdio: 'inherit', env })
  : spawn('npx', firebaseArgs, { stdio: 'inherit', env });

child.on('error', (error) => {
  console.error(`BLOCKED — no se pudo iniciar Firebase CLI: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
