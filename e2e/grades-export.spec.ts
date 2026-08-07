/**
 * FASE 4 — Calificaciones y Exportación Excel (13 tests) — e2e/grades-export.spec.ts
 *
 * Precondición: Fase 3 completada (Matemáticas con 4 estudiantes).
 */

import path from 'node:path';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { test, expect, Page } from '@playwright/test';
import { TEACHER_1, ADMIN } from './data';
import { doLogin, selectSubject, openTab, createEvaluation, expectToast } from './helpers';
import { signInAs, restListOwnedDocs, restGetDoc } from './firestoreRest';

async function login(page: Page, email: string, password: string) {
  await doLogin(page, email, password);
}

async function openEvalDetail(page: Page, title: string) {
  await page.locator('#grades-section select').first().selectOption({ label: title });
  await expect(page.getByRole('button', { name: /Guardar \(\d+\)/ }).first()).toBeVisible({ timeout: 15000 });
}

async function setGradeFor(page: Page, lastName: string, score: number | string) {
  const row = page.locator('#grades-section tbody tr').filter({ hasText: lastName });
  const input = row.locator('input[type="number"]').first();
  await input.fill(String(score));
}

async function saveGrades(page: Page) {
  await page.getByRole('button', { name: /Guardar \(\d+\)/ }).first().click();
  await page.waitForTimeout(1200);
}

const DL_DIR = () => path.join(process.cwd(), 'test-results', 'downloads');

test.describe('Fase 4 — Calificaciones y Excel', () => {
  test('4.1 Crear evaluación genérica (Parcial 1)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await createEvaluation(page, 'Parcial 1', 100, 'teorica');
  });

  test('4.2 Crear evaluación teórica (max 100)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await createEvaluation(page, 'Examen Teórico E2E', 100, 'teorica');
  });

  test('4.3 Crear evaluación práctica (max 50)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await createEvaluation(page, 'Examen Práctico E2E', 50, 'practica');
  });

  test('4.4 Registrar calificaciones', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await openEvalDetail(page, 'Examen Teórico E2E');
    await setGradeFor(page, 'Pérez Gómez', 90);
    await setGradeFor(page, 'Torres Rivera', 88);
    await setGradeFor(page, 'Morales Díaz', 75);
    await setGradeFor(page, 'Ramírez Ortiz', 95);
    await saveGrades(page);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const grades = await restListOwnedDocs(sess.idToken, 'grades');
    const evals = await restListOwnedDocs(sess.idToken, 'evaluations');
    const evalId = evals.find((e: any) => e.title === 'Examen Teórico E2E')?.id;
    const forEval = grades.filter((g: any) => g.evaluationId === evalId);
    expect(forEval.length).toBe(4);
    expect(forEval.map((g: any) => g.score).sort()).toEqual([75, 88, 90, 95]);
  });

  test('4.5 Validación score > maxScore (clamp client + regla backend)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await openEvalDetail(page, 'Examen Teórico E2E');
    await setGradeFor(page, 'Pérez Gómez', 150); // > maxScore 100
    await saveGrades(page);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const grades = await restListOwnedDocs(sess.idToken, 'grades');
    const evals = await restListOwnedDocs(sess.idToken, 'evaluations');
    const evalId = evals.find((e: any) => e.title === 'Examen Teórico E2E')?.id;
    const my = grades.find((g: any) => g.evaluationId === evalId);
    expect(Number(my?.score)).toBeLessThanOrEqual(100);
  });

  test('4.6 Editar calificación', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await openEvalDetail(page, 'Examen Teórico E2E');
    await setGradeFor(page, 'Pérez Gómez', 92);
    await saveGrades(page);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const grades = await restListOwnedDocs(sess.idToken, 'grades');
    const evals = await restListOwnedDocs(sess.idToken, 'evaluations');
    const evalId = evals.find((e: any) => e.title === 'Examen Teórico E2E')?.id;
    const students = await restListOwnedDocs(sess.idToken, 'students');
    const perez = students.find((s: any) => s.lastName.startsWith('Pérez'));
    const my = grades.find((g: any) => g.evaluationId === evalId && g.studentId === perez?.id);
    expect(Number(my?.score)).toBe(92);
  });

  test('4.7 Eliminar evaluación (y sus calificaciones)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    // volver a la lista y borrar "Parcial 1"
    await page.locator('#grades-section select').first().selectOption({ label: 'Todas las Evaluaciones' });
    await page.waitForTimeout(500);
    await page.locator('#grades-section').getByText('Parcial 1', { exact: true }).first().click();
    await page.getByTitle('Confirmar eliminación de la evaluación').click();
    await expect(page.getByRole('heading', { name: 'Eliminar Evaluación' })).toBeVisible();
    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await page.waitForTimeout(1500);
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const evals = await restListOwnedDocs(sess.idToken, 'evaluations');
    const grades = await restListOwnedDocs(sess.idToken, 'grades');
    expect(evals.some((e: any) => e.title === 'Parcial 1')).toBeFalsy();
    const evalIds = evals.map((e: any) => e.id);
    expect(grades.every((g: any) => evalIds.includes(g.evaluationId))).toBeTruthy();
  });

  test('4.8 Promedios calculados (Dashboard: mejores y por mejorar)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await page.getByText('Dashboard', { exact: true }).first().click();
    await page.waitForTimeout(2500);
    // Ramírez 95% teórica -> mejor promedio; Morales 75% -> a mejorar
    await expect(page.getByText('Ramírez Ortiz', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Morales Díaz', { exact: false }).first()).toBeVisible();
  });

  test('4.9 Calificaciones en las 3 asignaturas de Docente 1', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    // Física: agregar estudiante + eval + nota
    await selectSubject(page, 'Física');
    await openTab(page, 'students');
    await page.locator('#add-manual-btn').click();
    await page.locator('input[placeholder="Ej. 8-123-456"]').fill('8-777-7777');
    await page.locator('input[placeholder="Ej. Juan Carlos"]').fill('Lucía Elena');
    await page.locator('input[placeholder="Ej. Pérez Gómez"]').fill('Mendoza Flores');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByText('Mendoza Flores', { exact: false }).first()).toBeVisible();
    await openTab(page, 'grades');
    await createEvaluation(page, 'Eval Física E2E', 100, 'teorica');
    await openEvalDetail(page, 'Eval Física E2E');
    await setGradeFor(page, 'Mendoza Flores', 85);
    await saveGrades(page);
    // Química: eval + nota
    await selectSubject(page, 'Química');
    await openTab(page, 'students');
    await page.locator('#add-manual-btn').click();
    await page.locator('input[placeholder="Ej. 8-123-456"]').fill('8-888-8888');
    await page.locator('input[placeholder="Ej. Juan Carlos"]').fill('Roberto Andrés');
    await page.locator('input[placeholder="Ej. Pérez Gómez"]').fill('Cárdenas Silva');
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await openTab(page, 'grades');
    await createEvaluation(page, 'Eval Química E2E', 100, 'practica');
    await openEvalDetail(page, 'Eval Química E2E');
    await setGradeFor(page, 'Cárdenas Silva', 78);
    await saveGrades(page);
    // verificación por REST: 2 subjects con evals y notas
    const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
    const subjects = await restListOwnedDocs(sess.idToken, 'subjects');
    const fis = subjects.find((s: any) => s.name === 'Física');
    const qui = subjects.find((s: any) => s.name === 'Química');
    const evals = await restListOwnedDocs(sess.idToken, 'evaluations');
    const grades = await restListOwnedDocs(sess.idToken, 'grades');
    expect(evals.filter((e: any) => e.subjectId === fis?.id).length).toBeGreaterThan(0);
    expect(evals.filter((e: any) => e.subjectId === qui?.id).length).toBeGreaterThan(0);
    expect(grades.filter((g: any) => g.subjectId === fis?.id).length).toBeGreaterThan(0);
    expect(grades.filter((g: any) => g.subjectId === qui?.id).length).toBeGreaterThan(0);
  });

  test('4.10 Exportar Excel (docente)', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    fs.mkdirSync(DL_DIR(), { recursive: true });
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#exporta-tu-informe-de-clases-en-excel-y-editalo-para-tus-entregas').click();
    const download = await downloadPromise;
    const fileName = download.suggestedFilename();
    expect(fileName.toLowerCase()).toContain('reporte');
    expect(fileName.toLowerCase()).toContain('.xlsx');
    const saved = path.join(DL_DIR(), 'informe-matematicas.xlsx');
    await download.saveAs(saved);
    test.info().annotations.push({ type: 'artifact', description: saved });
  });

  test('4.11 Contenido del Excel (hojas y datos)', async ({ page }) => {
    const saved = path.join(DL_DIR(), 'informe-matematicas.xlsx');
    expect(fs.existsSync(saved)).toBeTruthy();
    const wb = XLSX.readFile(saved);
    const names = wb.SheetNames.join(',');
    // hojas: Calificaciones y Asistencia (y Resumen si hay módulos)
    expect(names.toLowerCase()).toContain('calificaciones');
    expect(names.toLowerCase()).toContain('asistencia');
    const cal = XLSX.utils.sheet_to_json(wb.Sheets[names.split(',').find((n) => n.toLowerCase().includes('calificaciones'))!]);
    const header = Object.keys(cal[0] ?? {});
    expect(header.some((h) => h.toLowerCase().includes('estudiante'))).toBeTruthy();
    expect(header.some((h) => h.toLowerCase().includes('promedio'))).toBeTruthy();
    // asistencia con los estados P/T
    const asi = XLSX.utils.sheet_to_json(wb.Sheets[names.split(',').find((n) => n.toLowerCase().includes('asistencia'))!]);
    const ascii = JSON.stringify(asi);
    expect(ascii.includes('Pérez Gómez')).toBeTruthy();
  });

  test('4.12 Exportar Excel (admin)', async ({ page }) => {
    await doLogin(page, ADMIN.email, ADMIN.password);
    await expect(page.getByText('Panel Institucional', { exact: true }).first()).toBeVisible({ timeout: 20000 });
    const row = page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first();
    await row.waitFor({ state: 'visible', timeout: 30000 });
    fs.mkdirSync(DL_DIR(), { recursive: true });
    const downloadPromise = page.waitForEvent('download');
    await row.getByRole('button', { name: 'Exportar', exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toContain('.xlsx');
    await download.saveAs(path.join(DL_DIR(), 'admin-docente1.xlsx'));
  });

  test('4.13 Ponderaciones configuradas se reflejan en el promedio', async ({ page }) => {
    await login(page, TEACHER_1.email, TEACHER_1.password);
    // Configurar pesos 40/50/10
    await page.locator('#weightings-btn').click();
    await expect(page.getByText('Configuración de Ponderaciones')).toBeVisible();
    await setWeight(page, 'Teórica', 40);
    await setWeight(page, 'Práctica', 50);
    await setWeight(page, 'Apreciativa', 10);
    await page.getByTitle('Cerrar ventana').click();
    await page.waitForTimeout(1000);
    // crear apreciativa y nota perfecta para Pérez
    await selectSubject(page, 'Matemáticas');
    await openTab(page, 'grades');
    await createEvaluation(page, 'Apreciativa E2E', 10, 'apreciativa');
    await openEvalDetail(page, 'Apreciativa E2E');
    await setGradeFor(page, 'Pérez Gómez', 10);
    await saveGrades(page);
    // Pérez: 40%*90 + 50%*80 + 10%*100 = 36+40+10 = 86
    await page.getByText('Dashboard', { exact: true }).first().click();
    await page.waitForTimeout(2500);
    const row = page.locator('tbody tr, table tr').filter({ hasText: 'Pérez Gómez' }).first();
    await expect(row).toBeVisible({ timeout: 15000 });
    const rowText = await row.textContent();
    expect(rowText).toContain('86');
  });
});

/** Setea un peso por el nombre (p. ej. "Teórica") usando el setter nativo de React. */
async function setWeight(page: Page, name: string, value: number) {
  const res = await page.locator('#weightings-section input[type="text"]').evaluateAll(
    (els, { target, val }) => {
      const inputs = els as HTMLInputElement[];
      for (const el of inputs) {
        if (el.value.toLowerCase() === target.toLowerCase()) {
          const card = el.closest('div');
          const num = card?.querySelector('input[type="number"]') as HTMLInputElement | null;
          if (!num) continue;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          setter?.call(num, String(val));
          num.dispatchEvent(new Event('input', { bubbles: true }));
          return true;
        }
      }
      return false;
    },
    { target: name, val: value },
  );
  expect(res).toBe(true);
  await page.waitForTimeout(800);
}

void expectToast;