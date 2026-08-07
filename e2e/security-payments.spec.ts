/**
 * FASE 6 — Seguridad, Uso y Pagos (31 tests) — e2e/security-payments.spec.ts
 *
 * Dos niveles:
 *  - Reglas de Firestore: se ejercen con la API REST real del proyecto usando
 *    los ID tokens de las cuentas de prueba (escrituras que DEBEN ser
 *    denegadas). Nunca se crean datos con éxito aquí.
 *  - Límites/trial/pagos/settings: UI + lectura de docs.
 *
 * Precondiciones:
 *  - Fases 2-4 completadas (teacher1 con datos).
 *  - Planes school activos para las docentes.
 *  - Para 6.25/6.26: E2E_LICENSE_KEY_VALID/INVALID en e2e/.env (opcional).
 */

import fs from 'node:fs';
import path from 'node:path';
import { test, expect, Page } from '@playwright/test';
import {
  TEACHER_1,
  TEACHER_2,
  FREE,
  BASE_URL,
  LS_CHECKOUT_MARKER,
  LS_PORTAL_MARKER,
  PAYMENT,
} from './data';
import {
  doLogin,
  createSubject,
  selectSubject,
  openTab,
  expectToast,
  waitForApp,
  gotoLanding,
} from './helpers';
import {
  signInAs,
  restGetDoc,
  restListOwnedDocs,
  restPatchDoc,
  restDeleteDoc,
  restCommit,
  restCreateDoc,
  restMe,
  fromDoc,
  AuthSession,
} from './firestoreRest';

const YEAR = String(new Date().getFullYear());

async function loginFree(page: Page) {
  await page.goto(`${BASE_URL}/login?mode=signup`);
  await page.locator('input[placeholder="Email"]').fill(FREE.email);
  await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(FREE.password);
  await page.locator('#login-button').click();
  const ok = await waitForApp(page)
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    // cuenta ya creada en una corrida previa
    await page.locator('input[placeholder="Email"]').fill(FREE.email);
    await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(FREE.password);
    await page.locator('#login-button').click();
    await waitForApp(page);
  }
}

async function openSettingsTab(page: Page, tabId: 'general' | 'advanced' | 'billing') {
  await page.locator('#weightings-btn').click();
  await expect(page.getByText('Ajustes', { exact: true }).first()).toBeVisible();
  const tabLabel = tabId === 'general' ? 'General' : tabId === 'advanced' ? 'Avanzado' : 'Suscripción';
  await page.getByRole('button', { name: tabLabel, exact: true }).click();
}

function denegado(r: { ok: boolean; status: number }): boolean {
  return !r.ok && (r.status === 403 || r.status === 400 || r.status === 404);
}

test.describe('Fase 6 — Seguridad y Pagos', () => {
  test.describe('Seguridad Firestore Rules (REST)', () => {
    let t1: AuthSession;
    let t2: AuthSession;

    test.beforeAll(async () => {
      t1 = await signInAs(TEACHER_1.email, TEACHER_1.password);
      t2 = await signInAs(TEACHER_2.email, TEACHER_2.password);
    });

    test('6.1 Aislamiento: Docente 1 no lee subjects de Docente 2', async () => {
      const otherSubjects = await restListOwnedDocs(t2.idToken, 'subjects');
      expect(otherSubjects.length).toBeGreaterThan(0);
      const otherId = otherSubjects[0].id;
      const r = await restGetDoc(t1.idToken, `subjects/${encodeURIComponent(otherId)}`);
      expect(r.ok).toBe(false);
      expect([403, 404]).toContain(r.status);
    });

    test('6.2 Cliente no cambia plan', async () => {
      const own = await restGetDoc(t1.idToken, `users/${t1.uid}`);
      expect(own.ok).toBe(true);
      const data = fromDoc(own.json) as Record<string, unknown>;
      const { id: _id, ...fields } = data;
      const r = await restPatchDoc(t1.idToken, `users/${t1.uid}`, { ...fields, plan: 'pro' });
      expect(denegado(r)).toBe(true);
    });

    test('6.3 Cliente no cambia role a admin', async () => {
      const own = await restGetDoc(t1.idToken, `users/${t1.uid}`);
      const data = fromDoc(own.json) as Record<string, unknown>;
      const { id: _id, ...fields } = data;
      const r = await restPatchDoc(t1.idToken, `users/${t1.uid}`, { ...fields, role: 'admin' });
      expect(denegado(r)).toBe(true);
    });

    test('6.4 Cliente no auto-asigna trial', async () => {
      const own = await restGetDoc(t1.idToken, `users/${t1.uid}`);
      const data = fromDoc(own.json) as Record<string, unknown>;
      const { id: _id, ...fields } = data;
      const r = await restPatchDoc(t1.idToken, `users/${t1.uid}`, {
        ...fields,
        isTrial: true,
        trialEndsAt: Date.now() + 30 * 24 * 3600 * 1000,
      });
      expect(denegado(r)).toBe(true);
    });

    test('6.5 Subject sin campo obligatorio (name)', async () => {
      const counter = await restGetDoc(t1.idToken, `userCounters/${t1.uid}`);
      const c = counter.json?.fields
        ? fromDoc({ fields: counter.json.fields }) as Record<string, unknown>
        : {};
      const now = Date.now();
      const counterNext = {
        subjectCount: (Number(c.subjectCount ?? 0)) + 1,
        createdThisYear: (Number(c.createdThisYear ?? 0)) + 1,
        yearKey: YEAR,
        updatedAt: now,
        writes: 1,
        writeWindowStart: now,
      };
      const r = await restCommit(t1.idToken, [
        { path: `userCounters/${t1.uid}`, data: counterNext },
        // sin campo name → isValidSubject() debe negar
        {
          path: 'subjects/e2e_sin_name',
          data: { userId: t1.uid, color: '#ff0000', teacher: 'T', schedule: 'S' },
        },
      ]);
      expect(denegado(r)).toBe(true);
    });

    test('6.6 Subject con name > 200 chars', async () => {
      const counter = await restGetDoc(t1.idToken, `userCounters/${t1.uid}`);
      const c = counter.json?.fields
        ? fromDoc({ fields: counter.json.fields }) as Record<string, unknown>
        : {};
      const now = Date.now();
      const counterNext = {
        subjectCount: (Number(c.subjectCount ?? 0)) + 1,
        createdThisYear: (Number(c.createdThisYear ?? 0)) + 1,
        yearKey: YEAR,
        updatedAt: now,
        writes: 1,
        writeWindowStart: now,
      };
      const longName = 'x'.repeat(201);
      const r = await restCommit(t1.idToken, [
        { path: `userCounters/${t1.uid}`, data: counterNext },
        {
          path: 'subjects/e2e_nombre_largo',
          data: { userId: t1.uid, name: longName, color: '#ff0000', teacher: 'T', schedule: 'S' },
        },
      ]);
      expect(denegado(r)).toBe(true);
    });

    test('6.7 Grade con score > maxScore', async () => {
      const evals = await restListOwnedDocs(t1.idToken, 'evaluations');
      const evalDoc = evals.find((e: any) => e.title === 'Examen Teórico E2E');
      expect(evalDoc).toBeTruthy();
      const students = await restListOwnedDocs(t1.idToken, 'students');
      const student = students[0];
      const r = await restCreateDoc(t1.idToken, 'grades', {
        userId: t1.uid,
        subjectId: evalDoc.subjectId,
        evaluationId: evalDoc.id,
        studentId: student.id,
        score: 150,
      }, 'e2e_score_over');
      expect(denegado(r)).toBe(true);
    });

    test('6.8 licenseKeys ilegibles', async () => {
      const r1 = await restGetDoc(t1.idToken, 'licenseKeys/E2E-ALGUNA-CLAVE');
      expect(r1.ok).toBe(false);
      const r2 = await restGetDoc(t1.idToken, 'licenseKeys'); // list via GET = 404/403
      expect(r2.ok).toBe(false);
    });

    test('6.9 userCounters no se borra', async () => {
      const r = await restDeleteDoc(t1.idToken, `userCounters/${t1.uid}`);
      expect(denegado(r)).toBe(true);
    });

    test('6.10 Rate limit: writes=121 denegado', async () => {
      const own = await restGetDoc(t1.idToken, `userCounters/${t1.uid}`);
      expect(own.ok).toBe(true);
      const c = fromDoc(own.json) as Record<string, unknown>;
      const { id: _id, ...fields } = c;
      const r = await restPatchDoc(t1.idToken, `userCounters/${t1.uid}`, {
        ...fields,
        writes: 121,
        writeWindowStart: fields.writeWindowStart,
      });
      expect(denegado(r)).toBe(true);
    });

    test('6.11 Grade con subjectId cruzado (eval de otra asignatura)', async () => {
      const evals = await restListOwnedDocs(t1.idToken, 'evaluations');
      const evalDoc = evals.find((e: any) => e.title === 'Examen Teórico E2E');
      const subjects = await restListOwnedDocs(t1.idToken, 'subjects');
      const fisica = subjects.find((s: any) => s.name === 'Física');
      const students = await restListOwnedDocs(t1.idToken, 'students');
      const r = await restCreateDoc(t1.idToken, 'grades', {
        userId: t1.uid,
        subjectId: fisica.id, // ≠ subjectId de la evaluación
        evaluationId: evalDoc.id,
        studentId: students[0].id,
        score: 50,
      }, 'e2e_cross_subject');
      expect(denegado(r)).toBe(true);
    });

    test('6.12 ID malformado denegado', async () => {
      const badId = 'id con espacios&especiales!';
      const r = await restCreateDoc(t1.idToken, 'subjects', {
        userId: t1.uid,
        name: 'x',
        color: '#fff000',
        teacher: 'T',
        schedule: 'S',
      }, badId);
      expect(denegado(r)).toBe(true);
    });
  });

  test.describe('Límites del Plan', () => {
    test('6.13 Plan free: límite de 2 asignaturas', async ({ page }) => {
      await loginFree(page);
      await createSubject(page, 'Free Asig 1');
      await createSubject(page, 'Free Asig 2');
      // 3ª: toast de límite (validación client-side)
      await page.locator('#new-subject-btn').click();
      await expectToast(page, 'Has alcanzado el límite de 2 asignaturas por año');
      // el modal no se abrió
      await expect(page.getByText('Nombre de la Asignatura')).toHaveCount(0);
    });

    test('6.14 Plan school: sin límite práctico', async ({ page }) => {
      await doLogin(page, TEACHER_1.email, TEACHER_1.password);
      const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
      const subjects = await restListOwnedDocs(sess.idToken, 'subjects');
      expect(subjects.length).toBeGreaterThanOrEqual(3);
      await selectSubject(page, 'Química');
      await expect(page.getByTitle('Editar asignatura')).toBeVisible();
    });

    test('6.15 IA free: 15 llamadas/mes (UI + contrato)', async ({ page }) => {
      await loginFree(page);
      await openSettingsTab(page, 'billing');
      await expect(page.getByText('15 consultas IA/mes', { exact: false }).first()).toBeVisible();
      // contrato de código
      const src = fs.readFileSync(path.join(process.cwd(), 'src', 'hooks', 'usePlan.ts'), 'utf8');
      expect(src).toMatch(/free[\s\S]*?maxSubjects:\s*2/);
      expect(src).toMatch(/free[\s\S]*?aiCallsPerMonth:\s*15/);
    });

    test('6.16 IA school: 9999 llamadas/mes (UI + contrato)', async ({ page }) => {
      await doLogin(page, TEACHER_1.email, TEACHER_1.password);
      await openSettingsTab(page, 'billing');
      await expect(page.getByText('9.999 consultas IA/mes', { exact: false }).first()).toBeVisible();
      const src = fs.readFileSync(path.join(process.cwd(), 'src', 'hooks', 'usePlan.ts'), 'utf8');
      expect(src).toMatch(/school[\s\S]*?aiCallsPerMonth:\s*9999/);
    });

    test('6.17 Borrar asignatura NO libera cupo del año', async ({ page }) => {
      await loginFree(page);
      // la cuenta free tiene 2 asignaturas del 6.13; borramos una
      const sidebarItem = page.getByTitle('Seleccionar esta asignatura').filter({ hasText: 'Free Asig 2' });
      await sidebarItem.click();
      await expect(page.getByTitle('Editar asignatura')).toBeVisible();
      await page.getByTitle('Eliminar asignatura').click();
      await page.getByRole('heading', { name: 'Eliminar Asignatura' });
      await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
      await expect(sidebarItem).toHaveCount(0, { timeout: 15000 });
      // intentar crear una tercera: el contador createdThisYear sigue en 2 → servidor deniega
      await page.locator('#new-subject-btn').click();
      await page.locator('input[placeholder="Ej. Matemáticas Avanzadas"]').fill('Free Asig 3');
      await page.locator('input[placeholder="Ej. Dra. García"]').fill('Docente de Prueba');
      await page.locator('input[placeholder="Ej. Lunes y Miércoles 10:00 AM"]').fill('Lunes y Miércoles 10:00 AM');
      await page.getByRole('button', { name: 'Guardar', exact: true }).click();
      // no debe aparecer en la barra lateral
      await expect(
        page.getByTitle('Seleccionar esta asignatura').filter({ hasText: 'Free Asig 3' }),
      ).toHaveCount(0, { timeout: 15000 });
      const sess = await signInAs(FREE.email, FREE.password);
      const subjects = await restListOwnedDocs(sess.idToken, 'subjects');
      const counters = await restGetDoc(sess.idToken, `userCounters/${sess.uid}`);
      const c = fromDoc(counters.json) as Record<string, unknown>;
      expect(subjects.length).toBe(1); // no se creó la 3ª
      expect(Number(c.createdThisYear ?? 0)).toBe(2); // cupo del año intacto
    });
  });

  test.describe('Trial y Pagos', () => {
    test('6.18 Activar trial de 14 días', async ({ page }) => {
      await loginFree(page);
      await openSettingsTab(page, 'billing');
      await page.getByRole('button', { name: 'Probar Premium 14 días gratis' }).click();
      await expectToast(page, '¡Tu prueba gratuita de Premium Pro (14 días) está activa!');
      const sess = await signInAs(FREE.email, FREE.password);
      const user = await restGetDoc(sess.idToken, `users/${sess.uid}`);
      const u = fromDoc(user.json) as Record<string, unknown>;
      expect(u.isTrial).toBe(true);
      expect(u.trialUsed).toBe(true);
      const ends = Number(u.trialEndsAt ?? 0);
      expect(ends).toBeGreaterThan(Date.now() + 13 * 86400000);
      expect(ends).toBeLessThan(Date.now() + 15 * 86400000);
    });

    test('6.19 Trial idempotente (no se extiende al repetir)', async ({ page }) => {
      await loginFree(page);
      const sess = await signInAs(FREE.email, FREE.password);
      const before = fromDoc((await restGetDoc(sess.idToken, `users/${sess.uid}`)).json);
      await openSettingsTab(page, 'billing');
      // el botón de prueba ya no debe existir
      await expect(page.getByRole('button', { name: 'Probar Premium 14 días gratis' })).toHaveCount(0);
      const after = fromDoc((await restGetDoc(sess.idToken, `users/${sess.uid}`)).json);
      expect(Number(before.trialEndsAt ?? 0)).toBe(Number(after.trialEndsAt ?? 0));
      expect(after.trialUsed).toBe(true);
    });

    test('6.20 Trial expirado = free (cubierto por emulador + contrato)', async () => {
      // Escenario real de "trial expirado" requiere reescribir campos backend-only
      // (trialEndsAt en el pasado). Esa lógica se valida en el emulador con
      // `npm run test:rules` (usuarios trialExp/paidStale). Aquí validamos el
      // contrato: el plan efectivo degrada a free SOLO si no pagó.
      const src = fs.readFileSync(path.join(process.cwd(), 'src', 'hooks', 'usePlan.ts'), 'utf8');
      expect(src).toMatch(/trialExpired/);
      expect(src).toMatch(/paymentProvider/);
    });

    test('6.21 Pago NO se degrada (school se mantiene)', async () => {
      const sess = await signInAs(TEACHER_1.email, TEACHER_1.password);
      const user = fromDoc((await restGetDoc(sess.idToken, `users/${sess.uid}`)).json) as Record<string, unknown>;
      expect(user.plan).toBe('school');
      expect(user.paymentProvider).not.toBe('trial');
    });

    test('6.22 Checkout Institucional → Lemon Squeezy (sandbox)', async ({ page }) => {
      // se usa una cuenta sin plan school para que el botón "Comprar Institucional" exista
      await loginFree(page);
      await openSettingsTab(page, 'billing');
      const instName = page.getByPlaceholder('Nombre de tu institución');
      if (await instName.isVisible().catch(() => false)) {
        await instName.fill('Institución E2E');
      }
      const checkoutPage = page.waitForURL((url) => url.hostname.includes('lemonsqueezy'), { timeout: 45_000 });
      await page.getByRole('button', { name: 'Comprar Institucional' }).click();
      const reached = await checkoutPage
        .then(() => true)
        .catch(async () => {
          // fallo posible: variante institucional sin configurar (mensaje backend)
          const toast = page.getByText('El plan institucional no está disponible todavía', { exact: false });
          return (await toast.isVisible().catch(() => false)) ? false : Promise.reject();
        });
      expect(reached).toBe(true);
      expect(page.url()).toContain(LS_CHECKOUT_MARKER);
    });

    test('6.23 Webhook: firma inválida rechazada (y compra real documentada)', async ({ page }) => {
      const res = await page.request.post(`${BASE_URL}/api/lemon-webhook`, {
        data: { meta: { event_name: 'order_created' } },
        headers: { 'Content-Type': 'application/json' },
      });
      // el webhook valida la firma del header: sin firma → 4xx
      expect(res.status()).toBeGreaterThanOrEqual(400);
      expect(res.status()).toBeLessThan(500);
      test.info().annotations.push({
        type: 'manual',
        description:
          'Positivo 6.23: completar una compra sandbox real y verificar que el webhook actualiza plan a school en /users/{uid}.',
      });
    });

    test('6.24 Portal de cliente (según suscripción real)', async ({ page }) => {
      await doLogin(page, PAYMENT.email, PAYMENT.password);
      const sess = await signInAs(PAYMENT.email, PAYMENT.password);
      const user = fromDoc((await restGetDoc(sess.idToken, `users/${sess.uid}`)).json) as Record<string, unknown>;
      const hasSubscription = Boolean(user.subscriptionId || user.ls_subscriptionId || user.paymentProvider === 'lemonsqueezy');
      await openSettingsTab(page, 'billing');
      if (hasSubscription) {
        const popupPromise = page.waitForEvent('popup', { timeout: 45_000 });
        await page.getByRole('button', { name: 'Gestionar', exact: true }).click();
        const popup = await popupPromise;
        expect(popup.url()).toContain(LS_PORTAL_MARKER);
      } else {
        await page.getByRole('button', { name: 'Gestionar', exact: true }).click();
        await expectToast(page, 'No tienes una suscripción activa');
      }
    });

    test('6.25 Redimir license key válida', async ({ page }) => {
      test.skip(!PAYMENT.validLicenseKey, 'Define E2E_LICENSE_KEY_VALID en e2e/.env para este test');
      await doLogin(page, PAYMENT.licenseTesterEmail, PAYMENT.licenseTesterPass).catch(async () => {
        await loginFresh(page, PAYMENT.licenseTesterEmail, PAYMENT.licenseTesterPass);
      });
      await openSettingsTab(page, 'billing');
      await page.getByPlaceholder('EJ. PRO-XXXX-XXXX-XXXX').fill(PAYMENT.validLicenseKey);
      await page.getByRole('button', { name: 'Canjear Código' }).click();
      await expect(page.getByText('a la licencia Premium', { exact: false }).first()).toBeVisible();
      const sess = await signInAs(PAYMENT.licenseTesterEmail, PAYMENT.licenseTesterPass);
      const user = fromDoc((await restGetDoc(sess.idToken, `users/${sess.uid}`)).json) as Record<string, unknown>;
      expect(['pro', 'school']).toContain(user.plan);
    });

    test('6.26 License key inválida', async ({ page }) => {
      await doLogin(page, PAYMENT.licenseTesterEmail, PAYMENT.licenseTesterPass).catch(async () => {
        await loginFresh(page, PAYMENT.licenseTesterEmail, PAYMENT.licenseTesterPass);
      });
      await openSettingsTab(page, 'billing');
      await page.getByPlaceholder('EJ. PRO-XXXX-XXXX-XXXX').fill(PAYMENT.invalidLicenseKey || 'PRO-0000-0000-0000');
      await page.getByRole('button', { name: 'Canjear Código' }).click();
      await expect(page.getByText('inválido o ya usado').first()).toBeVisible();
    });

    test('6.27 Redirect checkout=success → toast de plan activado', async ({ page }) => {
      await loginFree(page);
      await page.goto(`${BASE_URL}/app?checkout=success`);
      await waitForApp(page);
      await expectToast(page, '¡Pago exitoso! Tu plan Premium ha sido activado.');
    });
  });

  test.describe('Configuración y Ajustes', () => {
    test('6.28 Settings — General', async ({ page }) => {
      await loginFree(page);
      await openSettingsTab(page, 'general');
      await expect(page.getByText('Configuración General', { exact: true }).first()).toBeVisible();
      await expect(page.locator('#export-btn')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Borrar Todo' })).toBeVisible();
    });

    test('6.29 Settings — Suscripción (Billing)', async ({ page }) => {
      await loginFree(page);
      await openSettingsTab(page, 'billing');
      await expect(page.getByText('Gestión de Suscripción', { exact: true }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Comenzar Gratis' }).first()).toBeVisible();
      await expect(page.getByText('Obtener Premium Pro', { exact: false }).first()).toBeVisible();
    });

    test('6.30 Settings — Avanzado', async ({ page }) => {
      await loginFree(page);
      await openSettingsTab(page, 'advanced');
      await expect(page.getByText('Funciones Avanzadas', { exact: true }).first()).toBeVisible();
      await expect(page.getByText('Configuración de Ponderaciones', { exact: false }).first()).toBeVisible();
    });

    test('6.31 Borrar todos los datos', async ({ page }) => {
      await loginFree(page);
      await openSettingsTab(page, 'general');
      await page.getByRole('button', { name: 'Borrar Todo' }).click();
      await expect(page.getByText('¿Eliminar TODOS los datos? Esta acción es irreversible.')).toBeVisible();
      await page.getByRole('button', { name: 'Sí, borrar', exact: true }).click();
      await waitForApp(page).catch(() => page.reload());
      await expect(page.getByText('No tienes asignaturas aún.')).toBeVisible({ timeout: 20000 });
      const sess = await signInAs(FREE.email, FREE.password);
      const c = fromDoc((await restGetDoc(sess.idToken, `userCounters/${sess.uid}`)).json) as Record<string, unknown>;
      expect(Number(c.subjectCount ?? -1)).toBe(0);
    });
  });
});

async function loginFresh(page: Page, email: string, password: string) {
  await page.goto(`${BASE_URL}/login?mode=signup`);
  await page.locator('input[placeholder="Email"]').fill(email);
  await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
  await page.locator('#login-button').click();
  await waitForApp(page);
}

void restMe;
void gotoLanding;
void TEACHER_2;
void openTab;
void selectSubject;