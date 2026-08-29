/**
 * seed-admin-demo.mjs — Siembra un admin institucional + docentes con datos
 * de materias/estudiantes/notas/asistencia en los emuladores para probar
 * la vista admin local (https://localhost:3000 o emulator hosting).
 *
 * Usuario admin: admin@demo.local / test123456
 * Requiere: emuladores corriendo (npm run emulators)
 * Uso:      node scripts/seed-admin-demo.mjs
 */
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import * as fs from 'node:fs';
import { doc, setDoc } from 'firebase/firestore';
import { signUp } from './helpers.mjs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-ediagil';
const RULES = fs.readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

const ymd = (offsetDays) => {
  const d = new Date(NOW + offsetDays * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const adminUser = await signUp('admin@demo.local');
const teachers = {
  ana: await signUp('ana@demo.local'),
  luis: await signUp('luis@demo.local'),
  carla: await signUp('carla@demo.local'),
};

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: { host: 'localhost', port: 8081, rules: RULES },
});

await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();

  await db.collection('users').doc(adminUser.uid).set({
    plan: 'school', email: adminUser.email, displayName: 'Directora Admin',
    role: 'admin', institutionId: 'esc-demo', institutionName: 'Escuela Demo',
    aiCallsThisMonth: 3, lastLoginAt: NOW, createdAt: NOW - 200 * DAY, updatedAt: NOW,
  });

  const teachersMeta = [
    { uid: teachers.ana.uid, email: teachers.ana.email, name: 'Ana Martínez', plan: 'school', ai: 12, lastLogin: -1, created: -180, subjects: ['Matemáticas', 'Física'], colors: ['blue', 'red'] },
    { uid: teachers.luis.uid, email: teachers.luis.email, name: 'Luis Gómez', plan: 'pro', ai: 7, lastLogin: -6, created: -120, subjects: ['Historia'], colors: ['amber'] },
    { uid: teachers.carla.uid, email: teachers.carla.email, name: 'Carla Ruiz', plan: 'free', ai: 0, lastLogin: -45, created: -300, subjects: ['Biología', 'Química'], colors: ['emerald', 'purple'] },
  ];

  const subjectCount = { Math: 0, Hist: 0, Bio: 0, Qui: 0 };
  for (const t of teachersMeta) {
    await db.collection('users').doc(t.uid).set({
      plan: t.plan, email: t.email, displayName: t.name,
      role: 'teacher', institutionId: 'esc-demo', institutionName: 'Escuela Demo',
      aiCallsThisMonth: t.ai, lastLoginAt: NOW + t.lastLogin * DAY, createdAt: NOW + t.created * DAY, updatedAt: NOW,
    });

    const subjIds = [];
    for (let i = 0; i < t.subjects.length; i++) {
      const sid = `${t.uid}-subj-${i}`;
      subjIds.push(sid);
      subjectCount[t.subjects[i][0] + t.subjects[i][1]] = (subjectCount[t.subjects[i][0] + t.subjects[i][1]] || 0) + 1;
      await db.doc(`subjects/${sid}`).set({
        userId: t.uid, name: t.subjects[i], color: t.colors[i], teacher: t.name,
        schedule: i === 0 ? 'Lunes y Miércoles' : 'Martes y Jueves',
        periodo: ['matutino', 'vespertino', 'nocturno'][i % 3], createdAt: NOW + t.created * DAY,
      });
      // estudiantes
      const names = [
        ['Sofía', 'Hernández'], ['Mateo', 'Torres'], ['Valentina', 'Castro'],
        ['Julián', 'Reyes'], ['Camila', 'Vargas'], ['Diego', 'Mendoza'],
      ];
      for (let s = 0; s < 6; s++) {
        await db.doc(`students/${t.uid}-st-${i}-${s}`).set({
          userId: t.uid, subjectId: sid, cedula: `V-${1000 + s}`, firstName: names[s][0], lastName: names[s][1],
        });
      }
      // evaluaciones + notas
      for (let e = 0; e < 3; e++) {
        const eid = `${t.uid}-ev-${i}-${e}`;
        await db.doc(`evaluations/${eid}`).set({
          userId: t.uid, subjectId: sid, title: ['Parcial 1', 'Examen parcial', 'Practica final'][e],
          maxScore: e === 1 ? 10 : 20, date: ymd(-7 - e * 12), type: e === 2 ? 'practica' : 'teorica',
        });
        for (let s = 0; s < 6; s++) {
          await db.doc(`grades/${t.uid}-g-${i}-${e}-${s}`).set({
            userId: t.uid, subjectId: sid, evaluationId: eid, studentId: `${t.uid}-st-${i}-${s}`,
            score: e === 0 ? 18 - (s % 4) : e === 1 ? 8 + (s % 3) : 15 + (s % 5),
          });
        }
      }
      // asistencia: 5 sesiones (2 hace 4 semanas, 3 recientes) × 6 estudiantes
      const sessionDates = [ymd(-28), ymd(-24), ymd(-10), ymd(-6), ymd(-2)];
      const statuses = ['present', 'present', 'present', 'late', 'absent'];
      let at = 0;
      for (const date of sessionDates) {
        for (let s = 0; s < 6; s++) {
          const st = statuses[(at + s * 2) % statuses.length];
          await db.doc(`attendance/${t.uid}-at-${i}-${sessionDates.indexOf(date)}-${s}`).set({
            userId: t.uid, subjectId: sid, studentId: `${t.uid}-st-${i}-${s}`, date, status: st,
          });
        }
        at++;
      }
      // apuntes, materiales y eventos
      await db.doc(`notes/${t.uid}-n-${i}`).set({ userId: t.uid, subjectId: sid, title: 'Apunte clase', content: '...', date: ymd(-9), createdAt: NOW, updatedAt: NOW });
      await db.doc(`materials/${t.uid}-m-${i}`).set({ userId: t.uid, subjectId: sid, title: 'Guía', type: 'document', date: ymd(-13) });
      await db.doc(`calendarEvents/${t.uid}-c-${i}`).set({ userId: t.uid, subjectId: sid, title: 'Examen $', date: ymd(-4), type: 'exam' });
    }
  }
  console.log('✅ Demo sembrada: admin@demo.local + 3 docentes con 6 materias, 36 estudiantes, 9 evaluaciones, notas y asistencia.');
});

await testEnv.cleanup();
