/**
 * FASE 3 — Estudiantes y Asistencia (11 tests) — e2e/students-attendance.spec.ts
 *
 * Precondición: Fase 2 completada (asignaturas creadas).
 */

import { test, expect, Page } from '@playwright/test';
import { TEACHER_1, TEACHER_2 } from './data';
import {
  doLogin,
  selectSubject,
  openTab,
  addStudent,
  setAttendance,
  lastMonday,
  addDaysStr,
} from './helpers';
import { signInAs, restListOwnedDocs, restGetDoc } from './firestoreRest';

const MATE = [
  { cedula: '8-111-1111', firstName: 'Juan Carlos', lastName: 'Pérez Gómez', gender: 'Masculino' },
  { cedula: '8-222-2222', firstName: 'María Fernanda', lastName: 'Torres Rivera', gender: 'Femenino' },
  { cedula: '8-333-3333', firstName: 'Luis Enrique', lastName: 'Morales Díaz', gender: 'Masculino' },
  { cedula: '8-444-4444', firstName: 'Ana Lucía', lastName: 'Ramírez Ortiz', gender: 'Femenino' },
  { cedula: '8-555-5555', firstName: 'Carlos Alberto', lastName: 'Vega Ríos', gender: 'Masculino' },
];
const HIST = [
  { cedula: '4-111-1111', firstName: 'Sofía Isabel', lastName: 'Castro Mendoza', gender: 'Femenino' },
  { cedula: '4-222-2222', firstName: 'Diego Alejandro', lastName: 'Rojas Salazar', gender: 'Masculino' },
  { cedula: '4-333-3333', firstName: 'Valentina Paola', lastName: 'Núñez León', gender: 'Femenino' },
  { cedula: '4-444-4444', firstName: 'Mateo Sebastián', lastName: 'Herrera Gil', gender: 'Masculino' },
  { cedula: '4-555-5555', firstName: 'Camila Andrea', lastName: 'Paredes Soto', gender: 'Femenino' },
];

async function login(page: Page, email: string, password: string) {
  await doLogin(page, email, password);
}

/** Devuelve los registros de asistencia del usuario en la asignatura. */
async function attendanceFor(token: string, subjectName: string) {
  const docs = await restListOwnedDocs(token, 'attendance');
  const subjects = await restListOwnedDocs(token, 'subjects');
  const subj = subjects.find((s: any) => String(s.name) === subjectName);
  const subjId = subj?.id;
  if (!subjId) return [];
  return docs.filter((a: any) => a.subjectId === subjId);
}

test.describe('Fase 3 — Estudiantes y Asistencia', () => {
  test('3.1 Agregar estudiante (Matemáticas)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'students');
    await addStudent(page, MATE[0]);
    await expect(page.getByText(MATE[0].lastName, { exact: false }).first()).toBeVisible();
  });

  test('3.2 Agregar 5 estudiantes a Matemáticas', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'students');
    for (const s of MATE.slice(1)) await addStudent(page, s);
    await expect(page.getByText('Total Estudiantes').locator('..').getByText('5').first()).toBeVisible({ timeout: 15000 });
  });

  test('3.3 Agregar 5 estudiantes a Historia (Docente 2)', async ({ page }) => {
    await login(page, TEACHER_2.email, TEACHER_2.password);
    await selectSubject(page, 'Historia');
    await openTab(page, 'students');
    for (const s of HIST) await addStudent(page, s);
    await expect(page.getByText('Total Estudiantes').locator('..').getByText('5').first()).toBeVisible({ timeout: 15000 });
  });

  test('3.4 Editar estudiante (género vía select inline)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'students');
    const row = page.locator('tbody tr').filter({ hasText: MATE[0].lastName });
    await row.locator('select').selectOption({ label: 'F' });
    await page.waitForTimeout(1200);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const students = await restListOwnedDocs(sess.idToken, 'students');
    const stu = students.find((s: any) => s.cedula === MATE[0].cedula);
    expect(stu).toBeTruthy();
    expect(stu.gender).toBe('F');
  });

  test('3.5 Eliminar estudiante', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'students');
    const row = page.locator('tbody tr').filter({ hasText: MATE[4].lastName });
    await row.hover();
    await row.getByTitle('Eliminar estudiante').click();
    await expect(page.getByRole('heading', { name: 'Eliminar estudiante' })).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(page.getByText(MATE[4].lastName, { exact: false }).first()).toHaveCount(0, { timeout: 15000 });
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const students = await restListOwnedDocs(sess.idToken, 'students');
    const mateId = await subjId(sess.idToken, 'Matemáticas');
    expect(students.filter((s: any) => s.subjectId === mateId).length).toBe(4);
  });

  test('3.6 Aislamiento: Docente 1 NO ve estudiantes de Docente 2', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'students');
    await expect(page.getByText('Castro Mendoza', { exact: false })).toHaveCount(0, { timeout: 10000 });
    await expect(page.getByText('Pérez Gómez', { exact: false }).first()).toBeVisible();
  });

  test('3.7 Registrar asistencia (3 estados) en Matemáticas', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'attendance');
    const d1 = lastMonday();
    await page.locator('#attendance-section input[type="date"]').first().fill(d1);
    await page.waitForTimeout(800);
    await setAttendance(page, '8-111-1111', d1, 'present');
    await setAttendance(page, '8-222-2222', d1, 'late');
    await setAttendance(page, '8-333-3333', d1, 'absent');
    await expect(page.getByText('Total Registros').locator('..').getByText('3').first()).toBeVisible({ timeout: 15000 });
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const rows = await attendanceFor(sess.idToken, 'Matemáticas');
    expect(rows.filter((r: any) => r.date === d1).length).toBe(3);
  });

  test('3.8 Modificar asistencia (absent → present)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'attendance');
    const d1 = lastMonday();
    await page.locator('#attendance-section input[type="date"]').first().fill(d1);
    await page.waitForTimeout(800);
    await setAttendance(page, '8-333-3333', d1, 'present');
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const rows = await attendanceFor(sess.idToken, 'Matemáticas');
    const rec = rows.find((r: any) => r.date === d1 && r.studentId && true);
    const student = (await restListOwnedDocs(sess.idToken, 'students')).find((s: any) => s.cedula === '8-333-3333');
    expect(rec).toBeTruthy();
    expect(rec.studentId).toBe(student?.id);
    expect(rec.status).toBe('present');
  });

  test('3.9 Reporte de asistencia (porcentajes)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    // Reporte en el Dashboard
    await page.getByText('Dashboard', { exact: true }).first().click();
    await expect(page.getByText('Informe de Asistencia', { exact: false }).first()).toBeVisible();
    // d1: 2 presentes (8-111-1111, 8-333-3333) + 1 tardanza de 3 registros
    const rateText = await page
      .locator('text=Asistencia Total')
      .first()
      .locator('..')
      .textContent();
    expect(rateText).toContain('67');
    // Tab de asistencia: global = (present+late)/total = 3/3 = 100%
    await page.locator('#tab-attendance').click();
    await expect(page.getByText('Asistencia Global').locator('..').getByText('100%').first()).toBeVisible({ timeout: 15000 });
  });

  test('3.10 Asistencia en 3 fechas diferentes', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'attendance');
    const d1 = lastMonday();
    const d2 = addDaysStr(d1, -7);
    const d3 = addDaysStr(d1, 7);
    for (const d of [d2, d3]) {
      await page.locator('#attendance-section input[type="date"]').first().fill(d);
      await page.waitForTimeout(800);
      await setAttendance(page, '8-111-1111', d, 'present');
    }
    await page.waitForTimeout(1200);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const rows = await attendanceFor(sess.idToken, 'Matemáticas');
    const student = (await restListOwnedDocs(sess.idToken, 'students')).find((s: any) => s.cedula === '8-111-1111');
    const dates = rows.filter((r: any) => r.studentId === student?.id).map((r: any) => r.date).sort();
    expect(dates).toContain(d1);
    expect(dates).toContain(d2);
    expect(dates).toContain(d3);
  });

  test('3.11 Asistencia en otra asignatura (Física, Docente 1)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Física');
    await openTab(page, 'students');
    await addStudent(page, { cedula: '8-666-6666', firstName: 'Pedro Antonio', lastName: 'Solís Vega', gender: 'Masculino' });
    await openTab(page, 'attendance');
    const d1 = lastMonday();
    await page.locator('#attendance-section input[type="date"]').first().fill(d1);
    await page.waitForTimeout(800);
    await setAttendance(page, '8-666-6666', d1, 'present');
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const rows = await attendanceFor(sess.idToken, 'Física');
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe('present');
    expect(rows[0].subjectId).not.toBe(await subjId(sess.idToken, 'Matemáticas'));
  });
});

async function subjId(token: string, name: string): Promise<string | undefined> {
  const subjects = await restListOwnedDocs(token, 'subjects');
  return subjects.find((s: any) => String(s.name) === name)?.id;
}