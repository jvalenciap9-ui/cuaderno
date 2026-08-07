/**
 * e2e/helpers.ts — Helpers de UI para los specs Playwright.
 * Selectors y strings extraídos del código fuente (src/App.tsx, componentes).
 */

import { expect, Page, Download } from '@playwright/test';
import { BASE_URL } from './data';

/* ── Navegación y sesión ───────────────────────────────────────────────────── */

export async function gotoLanding(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForLoadState('domcontentloaded');
}

export async function waitForApp(page: Page): Promise<void> {
  // Sidebar cargado = sesión activa y datos listos.
  await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Asignaturas', { exact: true }).first()).toBeVisible();
}

export async function doLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[placeholder="Email"]').fill(email);
  await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
  await page.locator('#login-button').click();
  await waitForApp(page);
}

/** Registro; si el email ya existe, cae a login (idempotente). */
export async function doSignupOrLogin(page: Page, email: string, password: string): Promise<void> {
  await page.goto(`${BASE_URL}/login?mode=signup`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[placeholder="Email"]').fill(email);
  await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
  await page.locator('#login-button').click();
  const already = page.getByText('Este email ya está registrado. Inicia sesión.');
  await Promise.race([
    already.waitFor({ timeout: 8000 }).then(() => null),
    waitForApp(page).then(() => 'logged'),
  ]).catch(() => null);
  await page.waitForTimeout(300);
  if (await page.locator('#login-button').isVisible().catch(() => false)) {
    // si seguimos en el form (ya registrado), intentar login directo
    await page.locator('input[placeholder="Email"]').fill(email);
    await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
    await page.locator('#login-button').click();
    await waitForApp(page);
  }
}

export async function doLogout(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Cerrar Sesión' }).click();
  await expect(page.locator('#login-button')).toBeVisible({ timeout: 15000 });
}

export function toastText(page: Page, text: string) {
  return page.getByText(text, { exact: false }).first();
}

export async function expectToast(page: Page, text: string, timeout = 15000): Promise<void> {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout });
}

/* ── Asignaturas ───────────────────────────────────────────────────────────── */

export async function createSubject(
  page: Page,
  name: string,
  opts: { teacher?: string; schedule?: string; start?: string; end?: string } = {},
): Promise<void> {
  await page.locator('#new-subject-btn').click();
  await page.locator('input[placeholder="Ej. Matemáticas Avanzadas"]').fill(name);
  await page.locator('input[placeholder="Ej. Dra. García"]').fill(opts.teacher ?? 'Docente de Prueba');
  await page.locator('input[placeholder="Ej. Lunes y Miércoles 10:00 AM"]').fill(
    opts.schedule ?? 'Lunes y Miércoles 10:00 AM',
  );
  if (opts.start) {
    await page.locator('label:has-text("Fecha Inicio") ~ input[type="date"]').first().fill(opts.start);
  }
  if (opts.end) {
    await page.locator('label:has-text("Fecha Final") ~ input[type="date"]').first().fill(opts.end);
  }
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(
    page.getByTitle('Seleccionar esta asignatura').filter({ hasText: name }).first(),
  ).toBeVisible({ timeout: 20000 });
}

export async function selectSubject(page: Page, name: string): Promise<void> {
  await page.getByTitle('Seleccionar esta asignatura').filter({ hasText: name }).first().click();
  // esperar a que se cargue la vista de la asignatura (breadcrumb/header)
  await expect(page.getByTitle('Editar asignatura')).toBeVisible({ timeout: 15000 });
}

export async function openTab(page: Page, tabId: string): Promise<void> {
  await page.locator(`#tab-${tabId}`).click();
}

/* ── Participantes ──────────────────────────────────────────────────────────── */

export async function addStudent(
  page: Page,
  data: { firstName: string; lastName: string; cedula: string; gender?: string },
): Promise<void> {
  await page.locator('#add-manual-btn').click();
  await page.locator('input[placeholder="Ej. 8-123-456"]').fill(data.cedula);
  await page.locator('input[placeholder="Ej. Juan Carlos"]').fill(data.firstName);
  await page.locator('input[placeholder="Ej. Pérez Gómez"]').fill(data.lastName);
  if (data.gender) {
    await page.locator('select').filter({ has: page.locator('option', { hasText: data.gender }) }).selectOption({ label: data.gender }).catch(() => {});
  }
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByText(data.lastName, { exact: false }).first()).toBeVisible({ timeout: 15000 });
}

/* ── Asistencia ────────────────────────────────────────────────────────────── */

/** Devuelve el offset de día para una fecha en una semana lunes-viernes (índice 0-4). */
export function weekdayIndexFor(dateStr: string): number {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  return Math.max(0, dow - 1); // lunes=0 … viernes=4
}

export function lastMonday(dateStr = todayStr()): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const dow = d.getDay();
  const diff = dow === 1 ? 0 : dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toISO(d);
}

export function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function todayStr(): string {
  return toISO(new Date());
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Marca el estado de asistencia del estudiante para una fecha concreta.
 * Elige la columna del día dentro de la semana actual y recorre el ciclo
 * (sin registro → presente → tardanza → ausente) hasta el estado deseado.
 */
export async function setAttendance(
  page: Page,
  cedula: string,
  dateStr: string,
  target: 'present' | 'late' | 'absent',
): Promise<void> {
  const row = page.locator('tbody tr').filter({ hasText: cedula });
  const cells = row.locator('button[title^="Asistencia"], button[title^="Sin registro"]');
  const idx = weekdayIndexFor(dateStr);
  const cell = cells.nth(idx);
  await cell.scrollIntoViewIfNeeded();

  const cycle: Record<string, string[]> = {
    present: ['Sin registro', 'Asistencia: Ausente', 'Asistencia: Tardanza'],
    late: ['Sin registro', 'Asistencia: Presente', 'Asistencia: Ausente'],
    absent: ['Sin registro', 'Asistencia: Presente', 'Asistencia: Tardanza'],
  };
  for (const from of cycle[target]) {
    await cell.waitFor({ state: 'visible', timeout: 10000 });
    const title = (await cell.getAttribute('title')) || '';
    if (title.startsWith(from)) break;
    await cell.click();
    await page.waitForTimeout(400);
  }
  const want = target === 'present' ? 'Asistencia: Presente' : target === 'late' ? 'Asistencia: Tardanza' : 'Asistencia: Ausente';
  await expect(cell).toHaveAttribute('title', new RegExp(`^${want}`));
}

/* ── Calificaciones ────────────────────────────────────────────────────────── */

export type EvalType = 'teorica' | 'practica' | 'apreciativa';

export async function createEvaluation(
  page: Page,
  title: string,
  maxScore: number,
  type?: EvalType,
  dateStr?: string,
): Promise<void> {
  await page.getByRole('button', { name: 'Nueva Eval.' }).click();
  await page.locator('input[type="text"]').filter({ has: page.locator('[placeholder="Ej. Examen Parcial"]') }).catch(() => {});
  // re-lleno por placeholder para robustez
  await page.locator('input[placeholder="Ej. Examen Parcial"]').fill(title);
  await page.locator('input[placeholder="100"]').fill(String(maxScore));
  if (type) {
    await page.locator('select').filter({ hasText: 'Teórica' }).or(page.locator('select').filter({ hasText: 'Práctica' })).first().selectOption({ label: new RegExp(`^${type === 'teorica' ? 'Teórica' : type === 'practica' ? 'Práctica' : 'Apreciativa'}`) });
  }
  if (dateStr) {
    await page.locator('input[type="date"]').last().fill(dateStr);
  }
  await page.getByRole('button', { name: 'Guardar Evaluación' }).click();
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15000 });
}

export async function setGrade(page: Page, studentLastName: string, score: number | string): Promise<void> {
  const row = page.locator('tbody tr').filter({ hasText: studentLastName });
  const input = row.locator('input[type="number"]').first();
  const max = parseInt(await input.getAttribute('max').then((v) => v || '100'), 10);
  const safe = Math.min(Number(score), max);
  await input.fill(String(safe));
}