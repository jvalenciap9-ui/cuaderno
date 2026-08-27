/**
 * seed-school-config.mjs — Guarda la configuración de personalización de la
 * institución demo en los emuladores usando la Cloud Function REAL
 * `adminSaveSchoolConfig` (valida assertAdmin + sanitización + reglas).
 *
 * Requiere: emuladores corriendo (node scripts/run-emulators.mjs)
 *           y datos sembrados (node scripts/seed-admin-demo.mjs)
 * Usuario:  admin@demo.local / test123456
 * Uso:      node scripts/seed-school-config.mjs
 */
import { signUp } from './helpers.mjs';

const AUTH_EMULATOR = 'http://127.0.0.1:9099';
const FUNCTIONS_EMULATOR = 'http://127.0.0.1:5001/ediagil-new-2026/us-central1';

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@demo.local';
const ADMIN_PASS = process.env.SEED_ADMIN_PASS || 'test123456';

// Login real contra el Auth emulator y obtener idToken.
const res = await fetch(
  `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASS, returnSecureToken: true }),
  },
);
const data = await res.json();
if (!res.ok) {
  throw new Error(`Login ${ADMIN_EMAIL} falló: ${JSON.stringify(data)}`);
}
const idToken = data.idToken;

// Payload de la configuración de prueba.
const payload = {
  name: 'Escuela Demo',
  slogan: 'Menos Burocracia, Más Impacto',
  directorName: 'Directora Admin',
  address: 'Av. Demo 123, Ciudad de Prueba',
  phone: '0412-0000000',
  email: 'escuela@demo.local',
  logoUrl: '',
};

const call = await fetch(`${FUNCTIONS_EMULATOR}/adminSaveSchoolConfig`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
  },
  body: JSON.stringify({ data: payload }),
});
const body = await call.json().catch(() => null);

if (!call.ok) {
  console.error('❌ adminSaveSchoolConfig falló:', JSON.stringify(body, null, 2));
  process.exit(1);
}

const result = body?.result ?? body?.data ?? body;
console.log('✅ Configuración guardada vía adminSaveSchoolConfig:');
console.log(JSON.stringify(result, null, 2));
