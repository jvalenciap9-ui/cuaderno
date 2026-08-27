import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'http://localhost:3000';
const spec = await import('./firestoreRest');

const TEACHER1 = { email: 'docente1.test@ediagil.com', password: 'Test1234!' };

async function main() {
  const st = await spec.signInAs(TEACHER1.email, TEACHER1.password);
  console.log('signInAs ok, uid=%s', st.uid || '?');
  const t = Date.now();
  await spec.resetTeacherData(st.idToken);
  console.log('resetTeacherData OK in %ds', ((Date.now() - t) / 1000).toFixed(1));

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.locator('input[placeholder="Email"]').fill(TEACHER1.email);
  await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(TEACHER1.password);
  await page.locator('#login-button').click();
  await page.getByText('Dashboard', { exact: true }).first().waitFor({ timeout: 20000 });

  await page.locator('#new-subject-btn').waitFor({ timeout: 15000 });
  await page.locator('#new-subject-btn').click();
  await page.locator('input[placeholder="Ej. Matemáticas Avanzadas"]').fill('Matemáticas');
  await page.locator('input[placeholder="Ej. Dra. García"]').fill('María López');
  await page.locator('input[placeholder="Ej. Lunes y Miércoles 10:00 AM"]').fill('Lunes y Miércoles 10:00 AM');
  await page.locator('label:has-text("Fecha Inicio") ~ input[type="date"]').first().fill('2026-01-01');
  await page.locator('label:has-text("Fecha Final") ~ input[type="date"]').first().fill('2030-12-31');
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();

  let created = true;
  try {
    await page.getByTitle('Seleccionar esta asignatura').filter({ hasText: 'Matemáticas' }).first().waitFor({ timeout: 15000 });
  } catch {
    created = false;
  }
  console.log('CREATED=' + created);
  const modalOpen = await page.locator('dialog:has-text("Nueva Asignatura")').isVisible().catch(() => false);
  console.log('modalStillOpen=' + modalOpen);
  if (logs.length) console.log('CONSOLE_LOGS:\n' + logs.join('\n'));

  await browser.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });