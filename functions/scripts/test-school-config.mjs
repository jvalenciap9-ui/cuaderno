/**
 * test-school-config.mjs — Fase 5: validación de la configuración post-login
 * institucional. Verifica que la sanitización del onboarding:
 *   a) Recorta y limpia correctamente cada campo (máximos, trim, tipos raros).
 *   b) Rechaza URLs de logo inválidas (solo http/https).
 *   c) Serializa schoolConfig para el cliente siempre con strings seguros y
 *      respeta el flag onboardingDone.
 *
 * Uso: node scripts/test-school-config.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sanitizeSchoolConfigInput, schoolConfigOut } = require('../functions/lib/school-config.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function checkThrows(name, fn, expectedMessage) {
  try {
    fn();
    fail++; failures.push(name); console.log(`  ❌ ${name} (no lanzó excepción)`);
  } catch (err) {
    if (err && err.message === expectedMessage) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; failures.push(name); console.log(`  ❌ ${name} (error distinto: ${err && err.message})`); }
  }
}

console.log('── sanitizeSchoolConfigInput ──');

const full = sanitizeSchoolConfigInput({
  name: '  Colegio Aurora  ',
  slogan: '  Menos Burocracia, Más Impacto ',
  directorName: '  Lic. Elena Vargas ',
  address: 'Av. Principal #12',
  phone: '  0412-1234567 ',
  email: 'CONTACTO@AURORA.EDU.VE ',
  logoUrl: 'https://firebasestorage.googleapis.com/logo.png',
  primaryColor: '  #2E7D32 ',
});
check('name se recorta y limpia', full.name === 'Colegio Aurora', `got "${full.name}"`);
check('slogan se recorta y limpia', full.schoolConfig.slogan === 'Menos Burocracia, Más Impacto');
check('directorName se recorta y limpia', full.schoolConfig.directorName === 'Lic. Elena Vargas');
check('phone se recorta y limpia', full.schoolConfig.phone === '0412-1234567');
check('logoUrl válido se conserva', full.schoolConfig.logoUrl === 'https://firebasestorage.googleapis.com/logo.png');
check('primaryColor hex válido se conserva', full.schoolConfig.primaryColor === '#2E7D32', `got "${full.schoolConfig.primaryColor}"`);

const maxed = sanitizeSchoolConfigInput({
  name: 'x'.repeat(500),
  slogan: 'y'.repeat(500),
  directorName: 'z'.repeat(300),
  address: 'a'.repeat(500),
  phone: '1'.repeat(200),
  email: 'e'.repeat(500),
  logoUrl: '',
});
check('name se trunca a 200', maxed.name.length === 200);
check('slogan se trunca a 200', maxed.schoolConfig.slogan.length === 200);
check('directorName se trunca a 120', maxed.schoolConfig.directorName.length === 120);
check('address se trunca a 200', maxed.schoolConfig.address.length === 200);
check('phone se trunca a 40', maxed.schoolConfig.phone.length === 40);
check('email se trunca a 120', maxed.schoolConfig.email.length === 120);

const empty = sanitizeSchoolConfigInput(undefined);
check('entrada vacía produce strings vacíos',
  empty.name === '' && empty.schoolConfig.logoUrl === '' && empty.schoolConfig.slogan === '');

checkThrows('logo URL no-http lanza LOGO_URL_INVALID',
  () => sanitizeSchoolConfigInput({ logoUrl: 'ftp://logo.png' }), 'LOGO_URL_INVALID');
checkThrows('logo URL de texto plano lanza LOGO_URL_INVALID',
  () => sanitizeSchoolConfigInput({ logoUrl: 'mi-logo.png' }), 'LOGO_URL_INVALID');
check('logo URL sin http se acepta vacía',
  sanitizeSchoolConfigInput({ logoUrl: '   ' }).schoolConfig.logoUrl === '');

console.log('── Módulo 5: color primario ──');

checkThrows('hex sin # lanza PRIMARY_COLOR_INVALID',
  () => sanitizeSchoolConfigInput({ primaryColor: '2E7D32' }), 'PRIMARY_COLOR_INVALID');
checkThrows('hex de 3 dígitos lanza PRIMARY_COLOR_INVALID',
  () => sanitizeSchoolConfigInput({ primaryColor: '#2E7' }), 'PRIMARY_COLOR_INVALID');
checkThrows('texto libre lanza PRIMARY_COLOR_INVALID',
  () => sanitizeSchoolConfigInput({ primaryColor: 'verde' }), 'PRIMARY_COLOR_INVALID');
check('hex con canal alpha se trunca a 7 (convención truncar-validar)',
  sanitizeSchoolConfigInput({ primaryColor: '#2E7D32FF' }).schoolConfig.primaryColor === '#2E7D32');
check('hex en mayúsculas se conserva',
  sanitizeSchoolConfigInput({ primaryColor: '#FFC107' }).schoolConfig.primaryColor === '#FFC107');
check('color vacío o ausente se acepta (default en cliente)',
  sanitizeSchoolConfigInput({ primaryColor: '   ' }).schoolConfig.primaryColor === ''
  && sanitizeSchoolConfigInput({}).schoolConfig.primaryColor === '');

console.log('── schoolConfigOut ──');

check('doc inexistente serializa seguro',
  (() => { const o = schoolConfigOut(undefined); return o.logoUrl === '' && o.slogan === '' && o.primaryColor === '' && o.onboardingDone === false; })());
check('serializa todo en strings (sin undefined/null)',
  (() => { const o = schoolConfigOut({ schoolConfig: { logoUrl: undefined, slogan: null, primaryColor: undefined } }); return o.logoUrl === '' && o.slogan === '' && o.primaryColor === ''; })());
check('serializa primaryColor conservado',
  schoolConfigOut({ schoolConfig: { primaryColor: '#2E7D32' } }).primaryColor === '#2E7D32');
check('respeta onboardingDone true',
  schoolConfigOut({ schoolConfig: { onboardingDone: true } }).onboardingDone === true);
check('onboardingDone false por defecto',
  schoolConfigOut({ schoolConfig: {} }).onboardingDone === false);
check('conserva campos no vacíos',
  (() => { const o = schoolConfigOut({ schoolConfig: { logoUrl: 'https://x.png', directorName: 'Dir' } }); return o.logoUrl === 'https://x.png' && o.directorName === 'Dir'; })());

console.log('\n──────────────────────────────');
console.log(`Resultado: ${pass} ✅ / ${fail} ❌`);
if (fail > 0) {
  console.log('Fallos:', failures.join(', '));
  process.exit(1);
}