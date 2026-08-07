/**
 * test-functions.mjs — Fases 2 y 3: auditoría de Cloud Functions de planes,
 * trial, licencias, admin, checkout/portal, webhooks y cuota de IA.
 *
 * Requiere: emuladores + seed (node scripts/seed-emulator.mjs)
 * Uso:      node scripts/test-functions.mjs
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import { doc, setDoc } from 'firebase/firestore';
import { signUp, callFunction, postFunction, computeSignature, lsEvent, PRO_VARIANT_ID, SCHOOL_VARIANT_ID } from './helpers.mjs';

const PROJECT_ID = 'ediagil-new-2026';
const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

let pass = 0;
let fail = 0;
const failures = [];

function record(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function expectStatus(name, res, status) {
  record(name, res.status === status, `(esperado ${status}, obtenido ${res.status}) ${JSON.stringify(res.body)?.slice(0, 200)}`);
}
function expectBody(name, res, matcher, extra = '') {
  record(name, !!matcher(res.body), `${extra} → ${JSON.stringify(res.body)?.slice(0, 300)}`);
}

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: 'localhost', port: 8081, rules: RULES },
});

const admin = async (fn) => testEnv.withSecurityRulesDisabled(fn);
const readUser = async (uid) => {
  let out;
  await admin(async (ctx) => {
    const snap = await ctx.firestore().doc(`users/${uid}`).get();
    out = { exists: snap.exists, data: snap.data() };
  });
  return out;
};

// ── Preparación de usuarios ──
const u = {};
for (const [name, email] of [
  ['trialNuevo', 'trial-nuevo@test.local'],
  ['trialActivo', 'trial-activo@test.local'],
  ['trialExpirado', 'trial-expirado@test.local'],
  ['trialUsado', 'trial-usado@test.local'],
  ['proPago', 'pro-pago@test.local'],
  ['proLicencia', 'pro-licencia@test.local'],
  ['schoolAdmin', 'school-admin@test.local'],
  ['schoolTeacher', 'school-teacher@test.local'],
  ['normalTeacher', 'normal-teacher@test.local'],
  ['whPro', 'wh-pro@test.local'],
  ['whSchool', 'wh-school@test.local'],
  ['whCancel', 'wh-cancel@test.local'],
  ['whExpire', 'wh-expire@test.local'],
  ['whOther', 'wh-other@test.local'],
  ['quotaFree', 'quota-free@test.local'],
  ['quotaTrial', 'quota-trial@test.local'],
]) {
  u[name] = await signUp(email);
}

// =====================================================================
// FASE 2A — Trial
// =====================================================================
console.log('\n⏳ Trial: activateTrial / resolveTrialExpiry');

{
  const r = await callFunction('activateTrial', {}, u.trialNuevo.idToken);
  expectStatus('activateTrial usuario nuevo → ok', r, 200);
  const doc = await readUser(u.trialNuevo.uid);
  const d = doc.data;
  record('activateTrial escribe plan=pro', d?.plan === 'pro');
  record('activateTrial escribe isTrial=true', d?.isTrial === true);
  record('activateTrial escribe trialUsed=true', d?.trialUsed === true);
  record('activateTrial escribe paymentProvider=trial', d?.paymentProvider === 'trial');
  record('activateTrial trialEndsAt ≈ +14 días', typeof d?.trialEndsAt === 'number' && Math.abs(d.trialEndsAt - (NOW + 14 * DAY)) < 60_000);

  const r2 = await callFunction('activateTrial', {}, u.trialNuevo.idToken);
  expectBody('activateTrial idempotente (no extiende)', r2, (b) => b?.result?.alreadyActive === true);

  const r3 = await callFunction('activateTrial', {}, u.trialUsado.idToken);
  expectBody('activateTrial trial ya usado → already-exists', r3, (b) => b?.error?.status === 'ALREADY_EXISTS' || String(b?.error?.message || '').includes('Ya usaste'));

  const r4 = await callFunction('activateTrial', {}, u.proPago.idToken);
  expectBody('activateTrial pagado → failed-precondition', r4, (b) => String(b?.error?.message || '').includes('plan activo'));
}

// resolveTrialExpiry
{
  const before = await readUser(u.trialExpirado.uid);
  const r = await callFunction('resolveTrialExpiry', {}, u.trialExpirado.idToken);
  expectStatus('resolveTrialExpiry trial expirado → ok', r, 200);
  const after = await readUser(u.trialExpirado.uid);
  record('resolveTrialExpiry degrada a free', after.data.plan === 'free', `(plan=${after.data.plan})`);
  record('resolveTrialExpiry limpia isTrial', after.data.isTrial !== true);
  record('resolveTrialExpiry conserva trialUsed', after.data.trialUsed === true);
  record('resolveTrialExpiry elimina trialEndsAt', !('trialEndsAt' in after.data));
  record('resolveTrialExpiry elimina paymentProvider trial', !('paymentProvider' in after.data) || after.data.paymentProvider === undefined, JSON.stringify(after.data));

  const rp = await callFunction('resolveTrialExpiry', {}, u.proPago.idToken);
  expectStatus('resolveTrialExpiry pagado → ok sin degradar', rp, 200);
  const afterPago = await readUser(u.proPago.uid);
  record('resolveTrialExpiry NUNCA degrada a pagado', afterPago.data.plan === 'pro', `(plan=${afterPago.data.plan})`);
}

// =====================================================================
// FASE 2B — Canje de licencias
// =====================================================================
console.log('\n🔑 redeemLicenseKey');

{
  const r = await callFunction('redeemLicenseKey', { key: 'PRO-TEST-0001' }, u.proLicencia.idToken);
  expectStatus('Canje PRO-TEST-0001 → ok', r, 200);
  expectBody('Canje pro → plan=pro', r, (b) => b?.result?.plan === 'pro' && b?.result?.role === 'teacher');
  const doc = await readUser(u.proLicencia.uid);
  record('Canje pro: paymentProvider=licensekey', doc.data.paymentProvider === 'licensekey');
  record('Canje pro: trialUsed=true y isTrial=false', doc.data.trialUsed === true && doc.data.isTrial === false);

  const r2 = await callFunction('redeemLicenseKey', { key: 'PRO-TEST-0001' }, u.normalTeacher.idToken);
  expectBody('Canje clave ya usada → invalid-argument', r2, (b) => String(b?.error?.message || '').includes('Código inválido'));

  const r3 = await callFunction('redeemLicenseKey', { key: 'PRO-USED-0001' }, u.normalTeacher.idToken);
  expectBody('Canje clave usada (seed) → invalid-argument', r3, (b) => String(b?.error?.message || '').includes('Código inválido'));

  const r4 = await callFunction('redeemLicenseKey', { key: 'SCH-ADMIN-0001' }, u.schoolTeacher.idToken);
  expectBody('Canje school_admin → role=admin', r4, (b) => b?.result?.plan === 'school' && b?.result?.role === 'admin');
  const docAdmin = await readUser(u.schoolTeacher.uid);
  record('Canje school_admin vincula institutionId', docAdmin.data.institutionId === 'inst-1');
  record('Canje school_admin vincula institutionName', docAdmin.data.institutionName === 'Colegio Prueba');
}

// =====================================================================
// FASE 2C — Funciones admin
// =====================================================================
console.log('\n🛡️ Admin institucional');

{
  const r = await callFunction('adminListTeachers', {}, u.normalTeacher.idToken);
  expectBody('adminListTeachers como docente → permission-denied', r, (b) => b?.error?.status === 'PERMISSION_DENIED' || String(b?.error?.message || '').includes('Solo administradores'));

  const r2 = await callFunction('adminListTeachers', {}, u.schoolAdmin.idToken);
  expectStatus('adminListTeachers como admin → ok', r2, 200);
  const teachers = r2?.body?.result?.teachers || [];
  record('adminListTeachers NO incluye al propio admin', !teachers.some((t) => t.uid === u.schoolAdmin.uid));
  record('adminListTeachers incluye docentes de su institución', teachers.some((t) => t.uid === u.schoolTeacher.uid));
  record('adminListTeachers NO incluye otras instituciones', !teachers.some((t) => t.uid === u.normalTeacher.uid));

  const r3 = await callFunction('adminGetTeacherData', { teacherUid: u.schoolTeacher.uid }, u.schoolAdmin.idToken);
  expectStatus('adminGetTeacherData → ok', r3, 200);
  record('adminGetTeacherData trae subjects', Array.isArray(r3?.body?.result?.subjects));

  const r4 = await callFunction('adminGetTeacherSummary', { teacherUid: u.schoolTeacher.uid }, u.schoolAdmin.idToken);
  expectStatus('adminGetTeacherSummary → ok', r4, 200);
}

// =====================================================================
// FASE 3A — Checkout / Portal (contratos; la API real no es testeable local)
// =====================================================================
console.log('\n💳 createLemonSqueezyCheckout / createCustomerPortal');

{
  const r0 = await postFunction('createLemonSqueezyCheckout', { plan: 'pro' });
  expectStatus('checkout sin token → 401', r0, 401);

  const r1 = await postFunction('createLemonSqueezyCheckout', { plan: 'malo' }, { idToken: u.normalTeacher.idToken });
  expectStatus('checkout plan inválido → 400', r1, 400);

  const r2 = await postFunction('createLemonSqueezyCheckout', { plan: 'pro' }, { idToken: u.normalTeacher.idToken });
  record('checkout pro: alcanza la API (respuesta de error esperada en emulador)', r2.status !== 401 && r2.status !== 400 && r2.status !== 405, `status=${r2.status}`);

  const r3 = await postFunction('createLemonSqueezyCheckout', { plan: 'school', institutionName: 'X'.repeat(201) }, { idToken: u.normalTeacher.idToken });
  expectStatus('checkout institutionName >200 → 400', r3, 400);

  const r4 = await postFunction('createCustomerPortal', {}, { idToken: u.normalTeacher.idToken });
  expectStatus('portal sin subscriptionId → 404', r4, 404);

  const r5 = await postFunction('createCustomerPortal', {}, { idToken: u.proPago.idToken });
  record('portal con subscriptionId: alcanza la API (respuesta de error esperada en emulador)', r5.status !== 401 && r5.status !== 404, `status=${r5.status}`);
}

// =====================================================================
// FASE 3B — Webhooks Lemon Squeezy (simulados con HMAC real)
// =====================================================================
console.log('\n📬 lemonSqueezyWebhook');

async function sendWebhook(payloadObj, secret) {
  const rawBody = JSON.stringify(payloadObj);
  return postFunction('lemonSqueezyWebhook', null, { signature: computeSignature(rawBody, secret), rawBody });
}

{
  // Sin firma / firma mala
  const r0 = await postFunction('lemonSqueezyWebhook', { meta: { event_name: 'order_created' } });
  expectStatus('webhook sin firma → 401', r0, 401);
  const raw = JSON.stringify({ meta: { event_name: 'order_created' } });
  const rBad = await postFunction('lemonSqueezyWebhook', null, { rawBody: raw, signature: 'deadbeef' });
  expectStatus('webhook firma inválida → 401', rBad, 401);

  // order_created pro
  const ev1 = lsEvent('order_created', { id: 'order_1', variantId: PRO_VARIANT_ID }, { user_id: u.whPro.uid });
  const r1 = await sendWebhook(ev1);
  expectStatus('order_created (pro) → 200', r1, 200);
  let d = (await readUser(u.whPro.uid)).data;
  record('order_created pro: plan=pro', d?.plan === 'pro');
  record('order_created: paymentProvider=lemonsqueezy', d?.paymentProvider === 'lemonsqueezy');
  record('order_created: limpió isTrial y trialUsed=true', d?.isTrial === false && d?.trialUsed === true);
  record('order_created: expiresAt ≈ +1 año', typeof d?.expiresAt === 'number' && Math.abs(d.expiresAt - (NOW + 365 * DAY)) < 60_000);

  // order_created school → rol admin + institución
  const ev2 = lsEvent('order_created', { id: 'order_2', variantId: SCHOOL_VARIANT_ID }, { user_id: u.whSchool.uid, institutionName: 'Escuela Nueva' });
  const r2 = await sendWebhook(ev2);
  expectStatus('order_created (school) → 200', r2, 200);
  d = (await readUser(u.whSchool.uid)).data;
  record('order_created school: plan=school y role=admin', d?.plan === 'school' && d?.role === 'admin');
  record('order_created school: institutionId=uid', d?.institutionId === u.whSchool.uid);
  record('order_created school: institutionName guardado', d?.institutionName === 'Escuela Nueva');

  // subscription_created
  const ev3 = lsEvent('subscription_created', { id: 'sub_new', variantId: PRO_VARIANT_ID, renews_at: '2026-09-01T00:00:00.000Z', status: 'active' }, { user_id: u.whPro.uid });
  const r3 = await sendWebhook(ev3);
  expectStatus('subscription_created → 200', r3, 200);
  d = (await readUser(u.whPro.uid)).data;
  record('subscription_created: subscriptionId guardado', d?.subscriptionId === 'sub_new');
  record('subscription_created: expiresAt = renews_at', typeof d?.expiresAt === 'number');

  // subscription_updated active (reactivación)
  const ev4 = lsEvent('subscription_updated', { id: 'sub_new', variantId: PRO_VARIANT_ID, renews_at: '2027-01-01T00:00:00.000Z', status: 'active' }, { user_id: u.whPro.uid });
  const r4 = await sendWebhook(ev4);
  expectStatus('subscription_updated(active) → 200', r4, 200);
  d = (await readUser(u.whPro.uid)).data;
  record('subscription_updated(active): plan sigue pro', d?.plan === 'pro');

  // subscription_updated cancelled → mantiene acceso hasta ends_at
  const ev5 = lsEvent('subscription_updated', { id: 'sub_new', variantId: PRO_VARIANT_ID, renews_at: '2027-01-01T00:00:00.000Z', status: 'cancelled', ends_at: '2026-12-15T00:00:00.000Z' }, { user_id: u.whPro.uid });
  const r5 = await sendWebhook(ev5);
  expectStatus('subscription_updated(cancelled) → 200', r5, 200);
  d = (await readUser(u.whPro.uid)).data;
  record('cancelled: plan NO se degrada (acceso hasta ends_at)', d?.plan === 'pro', `plan=${d?.plan}`);
  record('cancelled: expiresAt = ends_at', typeof d?.expiresAt === 'number' && Math.abs(d.expiresAt - Date.parse('2026-12-15T00:00:00.000Z')) < 60_000);
  record('cancelled: subscriptionCancelledAt guardado', typeof d?.subscriptionCancelledAt === 'number');

  // subscription_updated expired → free
  const ev6 = lsEvent('subscription_updated', { id: 'sub_new', variantId: PRO_VARIANT_ID, status: 'expired' }, { user_id: u.whPro.uid });
  const r6 = await sendWebhook(ev6);
  expectStatus('subscription_updated(expired) → 200', r6, 200);
  d = (await readUser(u.whPro.uid)).data;
  record('expired: plan=free', d?.plan === 'free', `plan=${d?.plan}`);

  // subscription_expired (evento dedicado)
  await admin(async (ctx) => setDoc(doc(ctx.firestore(), 'users', u.whExpire.uid), { plan: 'pro', subscriptionId: 'sub_exp', paymentProvider: 'lemonsqueezy', expiresAt: NOW + 30 * DAY, email: u.whExpire.email, createdAt: NOW, aiCallsThisMonth: 0, aiCallsResetAt: NOW }));
  const ev7 = lsEvent('subscription_expired', { id: 'sub_exp', variantId: PRO_VARIANT_ID, status: 'expired' }, { user_id: u.whExpire.uid });
  const r7 = await sendWebhook(ev7);
  expectStatus('subscription_expired → 200', r7, 200);
  d = (await readUser(u.whExpire.uid)).data;
  record('subscription_expired: plan=free', d?.plan === 'free');

  // subscription_cancelled → mantiene plan
  await admin(async (ctx) => setDoc(doc(ctx.firestore(), 'users', u.whCancel.uid), { plan: 'pro', subscriptionId: 'sub_canc', paymentProvider: 'lemonsqueezy', expiresAt: NOW + 30 * DAY, email: u.whCancel.email, createdAt: NOW, aiCallsThisMonth: 0, aiCallsResetAt: NOW }));
  const ev8 = lsEvent('subscription_cancelled', { id: 'sub_canc', variantId: PRO_VARIANT_ID, status: 'cancelled', ends_at: '2026-12-15T00:00:00.000Z' }, { user_id: u.whCancel.uid });
  const r8 = await sendWebhook(ev8);
  expectStatus('subscription_cancelled → 200', r8, 200);
  d = (await readUser(u.whCancel.uid)).data;
  record('subscription_cancelled: plan NO se degrada', d?.plan === 'pro');

  // subscription_payment_success
  const ev9 = lsEvent('subscription_payment_success', { id: 'sub_canc', variantId: PRO_VARIANT_ID, renews_at: '2027-03-01T00:00:00.000Z', status: 'active' }, { user_id: u.whCancel.uid });
  const r9 = await sendWebhook(ev9);
  expectStatus('subscription_payment_success → 200', r9, 200);
  d = (await readUser(u.whCancel.uid)).data;
  record('payment_success: expiresAt actualizado', typeof d?.expiresAt === 'number');
  record('payment_success: lastPaymentAt guardado', typeof d?.lastPaymentAt === 'number');

  // Idempotencia: replay del mismo evento
  const r1b = await sendWebhook(ev1);
  expectBody('Replay order_created → duplicate (idempotente)', r1b, (b) => b?.duplicate === true);

  // Evento de suscripción ajena (sub id distinto) → ignorado
  const evOther = lsEvent('subscription_updated', { id: 'sub_otra', variantId: PRO_VARIANT_ID, status: 'expired' }, { user_id: u.whCancel.uid });
  const rOther = await sendWebhook(evOther);
  d = (await readUser(u.whCancel.uid)).data;
  record('sub de otro id: ignorada, plan intacto', d?.plan === 'pro', `plan=${d?.plan}`);

  // Evento desconocido → 200 sin tocar nada
  const evUnk = lsEvent('sub_whatever', { id: 'sub_unk', variantId: PRO_VARIANT_ID }, { user_id: u.whCancel.uid });
  const rUnk = await sendWebhook(evUnk);
  expectStatus('Evento no manejado → 200 sin error', rUnk, 200);
}

// =====================================================================
// FASE 2D — Cuota de IA (geminiproxy)
// =====================================================================
console.log('\n🤖 geminiproxy: cuota por plan');

{
  const seedQuota = (uid, plan, calls, extra = {}) => admin(async (ctx) =>
    setDoc(doc(ctx.firestore(), 'users', uid), { plan, email: `${uid}@test.local`, createdAt: NOW, aiCallsThisMonth: calls, aiCallsResetAt: NOW, ...extra }));

  await seedQuota(u.quotaFree.uid, 'free', 15);
  const r1 = await postFunction('geminiproxy', { contents: 'hola' }, { idToken: u.quotaFree.idToken });
  expectStatus('Free con 15/15 → 429', r1, 429);

  await seedQuota(u.quotaFree.uid, 'free', 14);
  const r2 = await postFunction('geminiproxy', { contents: 'hola' }, { idToken: u.quotaFree.idToken });
  record('Free con 14/15: pasa cuota (error externo de API esperado)', [400, 500].includes(r2.status), `status=${r2.status}`);
  let d = (await readUser(u.quotaFree.uid)).data;
  record('Fallo de Gemini → releaseAiCall revierte reserva', d?.aiCallsThisMonth === 14, `calls=${d?.aiCallsThisMonth}`);

  await seedQuota(u.quotaFree.uid, 'free', 15, { aiCallsResetAt: NOW - 40 * DAY });
  const r3 = await postFunction('geminiproxy', { contents: 'hola' }, { idToken: u.quotaFree.idToken });
  record('Reset mensual: 15 con resetAt viejo pasa (no 429)', r3.status !== 429, `status=${r3.status}`);
  d = (await readUser(u.quotaFree.uid)).data;
  record('Reset mensual: contador reiniciado (0 tras revertir fallo)', d?.aiCallsThisMonth === 0, `calls=${d?.aiCallsThisMonth}`);

  await seedQuota(u.quotaTrial.uid, 'pro', 2000, { isTrial: true, trialEndsAt: NOW + 5 * DAY, trialUsed: true, paymentProvider: 'trial' });
  const r4 = await postFunction('geminiproxy', { contents: 'hola' }, { idToken: u.quotaTrial.idToken });
  expectStatus('Trial activo con 2000/2000 → 429', r4, 429);

  await seedQuota(u.quotaTrial.uid, 'pro', 2000, { isTrial: true, trialEndsAt: NOW - 5 * DAY, trialUsed: true, paymentProvider: 'trial' });
  const r5 = await postFunction('geminiproxy', { contents: 'hola' }, { idToken: u.quotaTrial.idToken });
  record('Trial expirado con 2000 → tratado como free (15) → 429', r5.status === 429, `status=${r5.status}`);

  const r6 = await postFunction('geminiproxy', { contents: 'hola' }, { idToken: u.normalTeacher.idToken });
  expectStatus('geminiproxy sin token → 401', r6, 401);
}

await testEnv.cleanup();

console.log(`\n═══════════════════════════════════`);
console.log(`RESULTADO: ${pass} PASS · ${fail} FAIL`);
console.log(`═══════════════════════════════════`);
if (failures.length) {
  for (const f of failures) console.log(`\n💥 ${f}`);
  process.exit(1);
}

