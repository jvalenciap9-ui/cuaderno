/**
 * FASE 2 — Gestión de Asignaturas (19 tests) — e2e/subjects.spec.ts
 *
 * Precondición: las 3 docentes con sesión activa y plan school.
 * Antes de la fase se limpian los datos de las 3 cuentas (REST, idempotente)
 * para partir de un estado conocido.
 */

import path from 'node:path';
import fs from 'node:fs';
import { test, expect, Page } from '@playwright/test';
import {
  TEACHER_1,
  TEACHER_2,
  TEACHER_3,
  SUBJECTS_T1,
  SUBJECTS_T2,
  SUBJECTS_T3,
  TEMP_SUBJECT,
} from './data';
import { doLogin, createSubject, selectSubject, openTab } from './helpers';
import { signInAs, resetTeacherData, restGetDoc, restListOwnedDocs } from './firestoreRest';

const RANGE = { start: '2026-01-01', end: '2030-12-31' };
const DL_DIR = () => path.join(process.cwd(), 'test-results', 'downloads');

async function login(page: Page, email: string, password: string) {
  await doLogin(page, email, password);
}

async function counterSubjectCount(token: string, uid: string): Promise<number> {
  const r = await restGetDoc(token, `userCounters/${uid}`);
  if (!r.json?.fields) return 0;
  const f = r.json.fields;
  const n = f.subjectCount?.doubleValue ?? f.subjectCount?.integerValue;
  return Number(n ?? 0);
}

test.describe('Fase 2 — Gestión de Asignaturas', () => {
  test.beforeAll(async () => {
    const t1 = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const t2 = await signInAs(TEACHER_2.email, TEACHER_2.password);
    const t3 = await signInAs(TEACHER_3.email, TEACHER_3.password);
    await resetTeacherData(t1.idToken);
    await resetTeacherData(t2.idToken);
    await resetTeacherData(t3.idToken);
  });

  test('2.1 Crear asignatura (Docente 1 — Matemáticas)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await createSubject(page, SUBJECTS_T1[0], { ...RANGE, teacher: 'María López' });
  });

  test('2.2 Crear asignatura (Docente 1 — Física)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await createSubject(page, SUBJECTS_T1[1], { ...RANGE, teacher: 'María López' });
  });

  test('2.3 Crear asignatura (Docente 1 — Química, plan Institucional)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await createSubject(page, SUBJECTS_T1[2], { ...RANGE, teacher: 'María López' });
    // 3ª asignatura creada sin bloqueo (plan school permite hasta 999)
    await expect(
      page.getByTitle('Seleccionar esta asignatura').filter({ hasText: SUBJECTS_T1[2] }),
    ).toHaveCount(1);
  });

  test('2.4-2.6 Crear 3 asignaturas (Docente 2)', async ({ page }) => {
    await login(page, TEACHER_2.email, TEACHER_2.password);
    for (const s of SUBJECTS_T2) await createSubject(page, s, { ...RANGE, teacher: 'Ana García' });
    for (const s of SUBJECTS_T2) {
      await expect(page.getByTitle('Seleccionar esta asignatura').filter({ hasText: s })).toHaveCount(1);
    }
  });

  test('2.7-2.9 Crear 3 asignaturas (Docente 3)', async ({ page }) => {
    await login(page, TEACHER_3.email, TEACHER_3.password);
    for (const s of SUBJECTS_T3) await createSubject(page, s, { ...RANGE, teacher: 'Carmen Rodríguez' });
    for (const s of SUBJECTS_T3) {
      await expect(page.getByTitle('Seleccionar esta asignatura').filter({ hasText: s })).toHaveCount(1);
    }
  });

  test('2.10 Editar asignatura (horario)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await page.getByTitle('Editar asignatura').click();
    const modal = page.locator('form').filter({ has: page.getByText('Nombre de la Asignatura') });
    await modal.locator('input[placeholder="Ej. Lunes y Miércoles 10:00 AM"]').fill('Martes y Jueves 08:00 AM');
    await modal.getByTitle('Guardar la asignatura').click();
    await expect(page.getByText('Martes y Jueves 08:00 AM', { exact: false }).first()).toBeVisible();
  });

  test('2.11 Seleccionar asignatura (Física)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Física');
    await expect(page.getByText('Física', { exact: true }).first()).toBeVisible();
  });

  test('2.12 Tabs disponibles de una asignatura', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Física');
    await expect(page.locator('#tab-modules')).toContainText('Módulos');
    await expect(page.locator('#tab-grades')).toContainText('Calificaciones');
    await expect(page.locator('#tab-attendance')).toContainText('Asistencia');
    await expect(page.locator('#tab-students')).toContainText('Participantes');
  });

  test('2.13 Agregar módulo + apunte', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'modules');
    await page.locator('#add-modules-btn').click();
    await page.locator('input[placeholder="Ej. Unidad 1: Introducción"]').fill('Unidad E2E 1');
    await page.getByTitle('Guardar o actualizar la información del módulo').click();
    await expect(page.getByText('Unidad E2E 1', { exact: false }).first()).toBeVisible();
    await page.locator('#add-note-btn').click();
    await page.locator('input[placeholder="Ej. Introducción a las Derivadas"]').fill('Nota E2E Derivadas');
    await page.locator('textarea[placeholder="Escribe tus apuntes aquí..."]').fill('Contenido de la nota de prueba.');
    await page.getByTitle('Guardar el apunte').click();
    await expect(page.getByText('Nota E2E Derivadas', { exact: false }).first()).toBeVisible();
  });

  test('2.14 Editar apunte', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'modules');
    await page.getByTitle('Editar apunte').click();
    const modal = page.locator('form').filter({ has: page.getByText('Editar Apunte') });
    await modal.locator('input[placeholder="Ej. Introducción a las Derivadas"]').fill('Nota E2E Derivadas (editada)');
    await modal.locator('textarea[placeholder="Escribe tus apuntes aquí..."]').fill('Contenido actualizado de la nota.');
    await modal.getByTitle('Guardar el apunte').click();
    await expect(page.getByText('Nota E2E Derivadas (editada)', { exact: false }).first()).toBeVisible();
  });

  test('2.15 Eliminar apunte', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'modules');
    await page.getByTitle('Eliminar apunte').click();
    await expect(page.getByRole('heading', { name: 'Eliminar Apunte' })).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(page.getByText('Nota E2E Derivadas (editada)')).toHaveCount(0);
  });

  test('2.16 Crear módulo', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Física');
    await openTab(page, 'modules');
    await page.locator('#add-modules-btn').click();
    await page.locator('input[placeholder="Ej. Unidad 1: Introducción"]').fill('Unidad Física E2E');
    await page.locator('textarea[placeholder="Breve descripción de los temas a tratar..."]').fill('Descripción del módulo de Física.');
    await page.getByTitle('Guardar o actualizar la información del módulo').click();
    await expect(page.getByText('Unidad Física E2E', { exact: false }).first()).toBeVisible();
  });

  test('2.17 Eliminar asignatura (sacrificial) + contador -1', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await createSubject(page, TEMP_SUBJECT, { ...RANGE, teacher: 'María' });
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const before = await counterSubjectCount(sess.idToken, sess.uid);
    await selectSubject(page, TEMP_SUBJECT);
    await page.getByTitle('Eliminar asignatura').click();
    await expect(page.getByRole('heading', { name: 'Eliminar Asignatura' })).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(
      page.getByTitle('Seleccionar esta asignatura').filter({ hasText: TEMP_SUBJECT }),
    ).toHaveCount(0, { timeout: 15000 });
    await page.waitForTimeout(1500);
    const after = await counterSubjectCount(sess.idToken, sess.uid);
    expect(after).toBe(before - 1);
  });

  test('2.18 Exportar asignatura como JSON', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Física');
    fs.mkdirSync(DL_DIR(), { recursive: true });
    const downloadPromise = page.waitForEvent('download');
    await page.getByTitle('Exportar asignatura como JSON').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toContain('.json');
    await download.saveAs(path.join(DL_DIR(), 'export-fisica.json'));
  });

  test('2.19 Importar asignatura desde JSON (Crear nueva)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const before = await restListOwnedDocs(sess.idToken, 'subjects');
    const jsonFile = path.join(DL_DIR(), 'export-fisica.json');
    expect(fs.existsSync(jsonFile)).toBeTruthy();
    await page.locator('#import-subject-btn').click();
    await page.locator('input[type="file"]').setInputFiles(jsonFile);
    await page.getByText('Crear como nueva asignatura', { exact: true }).click();
    await page.getByRole('button', { name: 'Importar', exact: true }).click();
    await page.waitForTimeout(4000);
    const after = await restListOwnedDocs(sess.idToken, 'subjects');
    expect(after.length).toBe(before.length + 1);
    expect(after.some((s: any) => String(s.name).includes('Física'))).toBeTruthy();
  });
});