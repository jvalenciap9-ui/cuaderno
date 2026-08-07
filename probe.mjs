import { initializeTestEnvironment, assertSucceeds } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { signUp } from './scripts/helpers.mjs';

const RULES = fs.readFileSync('./firestore.rules', 'utf8');
const testEnv = await initializeTestEnvironment({
  projectId: 'ediagil-new-2026',
  firestore: { host: 'localhost', port: 8081, rules: RULES },
});
await testEnv.clearFirestore();

const me = await signUp('probe3@test.local');
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), 'users', me.uid), { plan: 'free', email: 'probe3@test.local', createdAt: Date.now(), aiCallsThisMonth: 0, aiCallsResetAt: Date.now() });
});

const NOW = Date.now();
const YEAR = String(new Date().getFullYear());
const ctx = testEnv.authenticatedContext(me.uid);
const db = ctx.firestore();

const sub = (id) => ({ userId: me.uid, name: 'X', color: '#123456', teacher: 'P', schedule: 'L 8' });
const counter = (n, yc) => ({ subjectCount: n, createdThisYear: yc, yearKey: YEAR, updatedAt: NOW, writes: 1, writeWindowStart: NOW });

async function go(name, n, yc, subId) {
  const batch = writeBatch(db);
  batch.set(doc(db, 'userCounters', me.uid), counter(n, yc));
  batch.set(doc(db, 'subjects', subId), sub(subId));
  try {
    await assertSucceeds(batch.commit());
    console.log(name + ' → OK');
  } catch (e) {
    const why = e.message.split('\n').find(l => l.includes('undefined') || l.includes('Type') || l.includes('evaluation'));
    console.log(name + ' → FAIL (' + (why || 'denegado') + ')');
  }
}

await go('batch#1 counter1-sub1', 1, 1, 'probe-sub-1');
await go('batch#2 counter2-sub2', 2, 2, 'probe-sub-2');

await testEnv.cleanup();