/**
 * FASE 5 — Dashboard y Vista de Administrador (15 tests) — e2e/dashboard-admin.spec.ts
 *
 * Precondiciones:
 *  - Fases 2-4 completadas (datos de docentes e instituciones).
 *  - Cuenta ADMIN con role:'admin' e institutionId en Firestore, y las 3
 *    docentes con el MISMO institutionId (la institución se asocia al canjear
 *    licencias school_teacher / school_admin generadas por el backend).
 */

import { test, expect, Page } from '@playwright/test';
import { TEACHER_1, TEACHER_2, TEACHER_3, ADMIN, ADMIN_INSTITUTION_NAME } from './data';
import { doLogin } from './helpers';

async function login(page: Page, email: string, password: string) {
  await doLogin(page, email, password);
}

test.describe('Fase 5 — Dashboard y Admin', () => {
  test.describe('Dashboard del Docente', () => {
    test('5.1 Vista Dashboard', async ({ page }) => {
      await login(page, TEACHER_1.email, TEACHER_1.password);
      await page.getByText('Dashboard', { exact: true }).first().click();
await expect(page.getByText('Resumen de actividad', { exact: false }).first()).toBeVisible();
    });

    test('5.2 Resumen de asignaturas (4 asignaturas)', async ({ page }) => {
      await login(page, TEACHER_1.email, TEACHER_1.password);
      await page.getByText('Dashboard', { exact: true }).first().click();
      await page.waitForTimeout(1500);
      const card = page.locator('div').filter({ hasText: 'Asignaturas' }).filter({ hasText: '4' }).first();
      await expect(card).toBeVisible({ timeout: 15000 });
    });

    test('5.3 Widget de progreso', async ({ page }) => {
      await login(page, TEACHER_1.email, TEACHER_1.password);
      await page.getByText('Dashboard', { exact: true }).first().click();
      await expect(page.getByText('Progreso General', { exact: true }).first()).toBeVisible({ timeout: 15000 });
    });

    test('5.4 Calendario del docente', async ({ page }) => {
      await login(page, TEACHER_1.email, TEACHER_1.password);
      await page.getByText('Dashboard', { exact: true }).first().click();
      // SubjectCalendar está embebido en el dashboard; al haber módulos/eventos se muestran
      await expect(page.getByText('Calendario', { exact: false }).first()).toBeVisible({ timeout: 15000 });
    });
  });

  test.describe('Vista del Administrador', () => {
    test('5.5 Acceso Admin Dashboard', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      await expect(page.getByText('Panel Institucional', { exact: true }).first()).toBeVisible({ timeout: 20000 });
    });

    test('5.6 Listar docentes (2 de la institución)', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      for (const t of [TEACHER_1, TEACHER_2]) {
        await expect(page.locator('tbody tr').filter({ hasText: t.email }).first()).toBeVisible({ timeout: 30000 });
      }
    });

    test('5.7 Buscar docente', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      await expect(page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first()).toBeVisible({ timeout: 30000 });
      await page.getByPlaceholder('Buscar docente por nombre o email...').fill('Ana');
      await page.waitForTimeout(800);
      // "ana" coincide con maestra.ana@ediagil.com y Prof. Ana Martínez → 1 fila
      const rowCount = await page.locator('tbody tr').count();
      expect(rowCount).toBe(1);
      await expect(page.locator('tbody tr').first()).toContainText(TEACHER_1.email);
    });

    test('5.8 Ver detalle de docente', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      const row = page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      await row.getByRole('button', { name: 'Ver', exact: true }).click();
      await expect(page.getByText('Resumen', { exact: true }).first()).toBeVisible({ timeout: 20000 });
      // stats del resumen
      await expect(page.getByText('Asignaturas', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Evaluaciones', { exact: true }).first()).toBeVisible();
    });

    test('5.9 Resumen del docente (adminGetTeacherSummary)', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      const row = page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      await row.getByRole('button', { name: 'Ver', exact: true }).click();
      await expect(page.getByText('Asistencia de estudiantes', { exact: false }).first()).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Rendimiento de estudiantes', { exact: false }).first()).toBeVisible();
    });

    test('5.10 Exportar reporte del docente (detalle)', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      const row = page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      await row.getByRole('button', { name: 'Ver', exact: true }).click();
      const downloadPromise = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Exportar Excel' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename().toLowerCase()).toContain('.xlsx');
    });

    test('5.11 Admin NO puede modificar datos (solo lectura)', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      await expect(page.getByText('Acceso de solo lectura', { exact: false }).first()).toBeVisible({ timeout: 20000 });
      // sin botones de edición/eliminación de datos de docentes
      const hasEdit = await page
        .getByRole('button', { name: 'Editar' })
        .or(page.getByRole('button', { name: 'Eliminar' }))
        .count();
      expect(hasEdit).toBe(0);
      // el banner de solo lectura está presente
      await expect(
        page.getByText('El administrador solo puede consultar y exportar datos', { exact: false }).first(),
      ).toBeVisible();
    });

    test('5.12 Ranking de asistencia', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      const row = page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      await row.getByRole('button', { name: 'Ver', exact: true }).click();
      await expect(page.getByText('Mejor asistencia', { exact: false }).first()).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Deben mejorar asistencia', { exact: false }).first()).toBeVisible();
    });

    test('5.13 Top/Bottom calificaciones', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      const row = page.locator('tbody tr').filter({ hasText: TEACHER_2.email }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      await row.getByRole('button', { name: 'Ver', exact: true }).click();
      // a teacher de prueba sin notas puede que aparezcan vacíos; validamos los títulos
      await expect(page.getByText('Mejores promedios', { exact: false }).first()).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Deben mejorar', { exact: false }).first()).toBeVisible();
    });

    test('5.14 Calendario de actividad (admin)', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      const row = page.locator('tbody tr').filter({ hasText: TEACHER_1.email }).first();
      await row.waitFor({ state: 'visible', timeout: 30000 });
      await row.getByRole('button', { name: 'Ver', exact: true }).click();
      await expect(page.getByText('Fechas con actividad', { exact: false }).first()).toBeVisible({ timeout: 20000 });
    });

    test('5.15 Nombre de institución', async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      await expect(
        page.getByText(ADMIN_INSTITUTION_NAME, { exact: false }).first(),
      ).toBeVisible({ timeout: 20000 });
    });
  });
});