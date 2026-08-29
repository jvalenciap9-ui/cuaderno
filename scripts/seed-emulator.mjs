/**
 * seed-emulator.mjs — Crea cuentas de prueba y datos iniciales en los emuladores.
 *
 * Requiere: emuladores corriendo (node scripts/run-emulators.mjs)
 * Uso:      node scripts/seed-emulator.mjs
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import { signUp, WEBHOOK_SECRET } from './helpers.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-ediagil';
const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const accounts = [
  ['free', 'free@test.local'],
  ['trial-nuevo', 'trial-nuevo@test.local'],
  ['trial-activo', 'trial-activo@test.local'],
  ['trial-expirado', 'trial-expirado@test.local'],
  ['trial-usado', 'trial-usado@test.local'],
  ['pro-pago', 'pro-pago@test.local'],
  ['pro-licencia', 'pro-licencia@test.local'],
  ['school-admin', 'school-admin@test.local'],
  ['school-teacher', 'school-teacher@test.local'],
  ['other-teacher', 'other-teacher@test.local'],
  ['normal-teacher', 'normal-teacher@test.local'],
  ['key-user', 'key-user@test.local'],
];

const created = {};
for (const [name, email] of accounts) {
  created[name] = await signUp(email);
  console.log(`👤 ${name} → uid ${created[name].uid} (${email})`);
}

const userDocs = {
  [created['trial-activo'].uid]: {
    plan: 'pro', email: 'trial-activo@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    isTrial: true, trialStartedAt: NOW, trialEndsAt: NOW + 14 * DAY, trialUsed: true,
    paymentProvider: 'trial', updatedAt: NOW,
  },
  [created['trial-expirado'].uid]: {
    plan: 'pro', email: 'trial-expirado@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    isTrial: true, trialStartedAt: NOW - 20 * DAY, trialEndsAt: NOW - 6 * DAY, trialUsed: true,
    paymentProvider: 'trial', updatedAt: NOW,
  },
  [created['trial-usado'].uid]: {
    plan: 'free', email: 'trial-usado@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    trialUsed: true, updatedAt: NOW,
  },
  [created['pro-pago'].uid]: {
    plan: 'pro', email: 'pro-pago@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    paymentProvider: 'lemonsqueezy', paymentOrderId: 'order_test_1',
    subscriptionId: 'sub_test_1', expiresAt: NOW + 365 * DAY,
    isTrial: false, trialUsed: true, updatedAt: NOW,
  },
  [created['school-admin'].uid]: {
    plan: 'school', email: 'school-admin@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    paymentProvider: 'lemonsqueezy', subscriptionId: 'sub_test_admin',
    expiresAt: NOW + 365 * DAY, isTrial: false, trialUsed: true,
    role: 'admin', institutionId: 'inst-1', institutionName: 'Colegio Prueba',
    lastLoginAt: NOW, updatedAt: NOW,
  },
  [created['school-teacher'].uid]: {
    plan: 'school', email: 'school-teacher@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    paymentProvider: 'licensekey', isTrial: false, trialUsed: true,
    role: 'teacher', institutionId: 'inst-1', institutionName: 'Colegio Prueba',
    lastLoginAt: NOW, updatedAt: NOW,
  },
  [created['other-teacher'].uid]: {
    plan: 'free', email: 'other-teacher@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW,
    institutionId: 'inst-2', institutionName: 'Otra Escuela',
    lastLoginAt: NOW, updatedAt: NOW,
  },
[created['normal-teacher'].uid]: {
    plan: 'free', email: 'normal-teacher@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW, updatedAt: NOW,
  },
  [created['key-user'].uid]: {
    plan: 'free', email: 'key-user@test.local', createdAt: NOW,
    aiCallsThisMonth: 0, aiCallsResetAt: NOW, updatedAt: NOW,
  },
};

// Institución real del emulador (redeemLicenseKey valida que exista)
const institutionDocs = {
  'inst-1': {
    name: 'Colegio Prueba',
    adminId: created['school-admin'].uid,
    createdAt: NOW,
    subscription: { plan: 'school', docentes: 30, expiresAt: NOW + 365 * DAY },
  },
};

const licenseKeys = {
  'PRO-TEST-0001': { plan: 'pro', used: false, createdAt: NOW },
  'SCH-TEST-0001': { plan: 'school', used: false, createdAt: NOW },
  'SCH-ADMIN-0001': { plan: 'school_admin', institutionId: 'inst-1', institutionName: 'Colegio Prueba', used: false, createdAt: NOW },
  'SCH-TEACH-0001': { plan: 'school_teacher', institutionId: 'inst-1', institutionName: 'Colegio Prueba', used: false, createdAt: NOW },
  'SCH-TEACH-0002': { plan: 'school_teacher', institutionId: 'inst-1', institutionName: 'Colegio Prueba', used: false, createdAt: NOW },
  'PRO-USED-0001': { plan: 'pro', used: true, usedBy: 'someone', usedAt: NOW, createdAt: NOW },
  // Casos de validación de institución (redeemLicenseKey):
  'SCH-ADMIN-GHOST-0001': { plan: 'school_admin', institutionId: 'inst-fantasma', used: false, createdAt: NOW },
  'SCH-ADMIN-NOINST-0001': { plan: 'school_admin', used: false, createdAt: NOW },
};

console.log(`\n🔑 Webhook secret para pruebas: ${WEBHOOK_SECRET}`);

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: 'localhost', port: 8081, rules: RULES },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [uid, doc] of Object.entries(userDocs)) {
    await db.collection('users').doc(uid).set(doc);
  }
  for (const [id, doc] of Object.entries(institutionDocs)) {
    await db.collection('institutions').doc(id).set(doc);
  }
  for (const [key, doc] of Object.entries(licenseKeys)) {
    await db.collection('licenseKeys').doc(key).set(doc);
  }
  console.log(`💾 ${Object.keys(userDocs).length} users + ${Object.keys(institutionDocs).length} instituciones + ${Object.keys(licenseKeys).length} licencias sembradas`);
});

await testEnv.cleanup();
