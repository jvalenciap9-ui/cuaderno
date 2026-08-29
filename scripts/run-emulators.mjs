/**
 * run-emulators.mjs — Arranca los emuladores de Firebase con los secrets
 * que las Cloud Functions necesitan (defineSecret se resuelve del entorno).
 *
 * Uso: node scripts/run-emulators.mjs
 */
import { spawn, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const env = { ...process.env };
const emulatorProjectId = env.FIREBASE_PROJECT_ID || 'demo-ediagil';
env.FIREBASE_PROJECT_ID = emulatorProjectId;
env.GCLOUD_PROJECT = emulatorProjectId;
env.GOOGLE_CLOUD_PROJECT = emulatorProjectId;
env.VITE_EMULATORS = '1';
env.VITE_EMULATOR_PROJECT_ID = emulatorProjectId;

// Asegurar que JAVA esté visible para el emulador de Firestore.
try {
  const winPath = execSync('powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'Path\',\'Machine\'); [Environment]::GetEnvironmentVariable(\'Path\',\'User\')"', { encoding: 'utf8' });
  const joined = winPath.split(/\r?\n/).filter(Boolean).join(';');
  if (joined) env.PATH = `${joined};${env.PATH || ''}`;
} catch { /* noop */ }

function loadEnvFile(file) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) {
        env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
    }
  } catch {
    /* archivo opcional */
  }
}

loadEnvFile(path.resolve('.env.local'));
loadEnvFile(path.resolve('.env'));

// Secrets de prueba para el emulador (nunca se usan fuera de localhost).
// FUNCTIONS_DISCOVERY_TIMEOUT: la primera carga de functions/index.js es
// lenta (cold-start ~16s en Windows) y el discovery por defecto corta a 10s.
env.FUNCTIONS_DISCOVERY_TIMEOUT ??= '120';
env.LEMON_SQUEEZY_WEBHOOK_SECRET ??= 'emulator-webhook-secret';
env.LEMON_SQUEEZY_API_KEY ??= 'emulator-ls-api-key';
env.LEMON_SQUEEZY_SCHOOL_VARIANT_ID ??= '900001';
env.GEMINI_API_KEY ??= 'emulator-gemini-key';

const child = spawn(
  'npx',
  ['firebase', 'emulators:start', '--only', 'auth,firestore,functions,storage', '--project', emulatorProjectId],
  { stdio: 'inherit', shell: process.platform === 'win32', env },
);
child.on('exit', (code) => process.exit(code ?? 0));
