# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Fase 1 — Auth y Login >> 1.14 Logout
- Location: e2e\auth.spec.ts:138:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Dashboard', { exact: true }).first()
Expected: visible
Timeout: 20000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 20000ms
  - waiting for getByText('Dashboard', { exact: true }).first()

```

```yaml
- button "Volver a la página principal"
- img "EdiAgil Logo"
- heading "EdiAgil" [level=1]
- paragraph: Gestiona tus clases, asistencias y calificaciones en la nube.
- textbox "Email": docente1.test@ediagil.com
- textbox "Contraseña (mín. 6 caracteres)": Test1234!
- paragraph: "Firebase: Error (auth/api-key-not-valid.-please-pass-a-valid-api-key.)."
- button "Iniciar sesión"
- text: o
- button "Continuar con Google"
- button "¿Olvidaste tu contraseña?"
- button "¿No tienes cuenta? Regístrate"
- link "Términos":
  - /url: /terminos.html
- text: ·
- link "Privacidad":
  - /url: /privacidad.html
```

# Test source

```ts
  1   | /**
  2   |  * e2e/helpers.ts — Helpers de UI para los specs Playwright.
  3   |  * Selectors y strings extraídos del código fuente (src/App.tsx, componentes).
  4   |  */
  5   | 
  6   | import { expect, Page, Download } from '@playwright/test';
  7   | import { BASE_URL } from './data';
  8   | 
  9   | /* ── Navegación y sesión ───────────────────────────────────────────────────── */
  10  | 
  11  | export async function gotoLanding(page: Page): Promise<void> {
  12  |   await page.goto(BASE_URL, { waitUntil: 'networkidle' }).catch(() => {});
  13  |   await page.waitForLoadState('domcontentloaded');
  14  | }
  15  | 
  16  | export async function waitForApp(page: Page): Promise<void> {
  17  |   // Sidebar cargado = sesión activa y datos listos.
> 18  |   await expect(page.getByText('Dashboard', { exact: true }).first()).toBeVisible();
      |                                                                      ^ Error: expect(locator).toBeVisible() failed
  19  |   await expect(page.getByText('Asignaturas', { exact: true }).first()).toBeVisible();
  20  | }
  21  | 
  22  | export async function doLogin(page: Page, email: string, password: string): Promise<void> {
  23  |   await page.goto(`${BASE_URL}/login`, { waitUntil: 'domcontentloaded' });
  24  |   await page.locator('input[placeholder="Email"]').fill(email);
  25  |   await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
  26  |   await page.locator('#login-button').click();
  27  |   await waitForApp(page);
  28  | }
  29  | 
  30  | /** Registro; si el email ya existe, cae a login (idempotente). */
  31  | export async function doSignupOrLogin(page: Page, email: string, password: string): Promise<void> {
  32  |   await page.goto(`${BASE_URL}/login?mode=signup`, { waitUntil: 'domcontentloaded' });
  33  |   await page.locator('input[placeholder="Email"]').fill(email);
  34  |   await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
  35  |   await page.locator('#login-button').click();
  36  |   const already = page.getByText('Este email ya está registrado. Inicia sesión.');
  37  |   await Promise.race([
  38  |     already.waitFor({ timeout: 8000 }).then(() => null),
  39  |     waitForApp(page).then(() => 'logged'),
  40  |   ]).catch(() => null);
  41  |   await page.waitForTimeout(300);
  42  |   if (await page.locator('#login-button').isVisible().catch(() => false)) {
  43  |     // si seguimos en el form (ya registrado), intentar login directo
  44  |     await page.locator('input[placeholder="Email"]').fill(email);
  45  |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(password);
  46  |     await page.locator('#login-button').click();
  47  |     await waitForApp(page);
  48  |   }
  49  | }
  50  | 
  51  | export async function doLogout(page: Page): Promise<void> {
  52  |   await page.getByRole('button', { name: 'Cerrar Sesión' }).click();
  53  |   await expect(page.locator('#login-button')).toBeVisible({ timeout: 15000 });
  54  | }
  55  | 
  56  | export function toastText(page: Page, text: string) {
  57  |   return page.getByText(text, { exact: false }).first();
  58  | }
  59  | 
  60  | export async function expectToast(page: Page, text: string, timeout = 15000): Promise<void> {
  61  |   await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout });
  62  | }
  63  | 
  64  | /* ── Asignaturas ───────────────────────────────────────────────────────────── */
  65  | 
  66  | export async function createSubject(
  67  |   page: Page,
  68  |   name: string,
  69  |   opts: { teacher?: string; schedule?: string; start?: string; end?: string } = {},
  70  | ): Promise<void> {
  71  |   await page.locator('#new-subject-btn').click();
  72  |   await page.locator('input[placeholder="Ej. Matemáticas Avanzadas"]').fill(name);
  73  |   await page.locator('input[placeholder="Ej. Dra. García"]').fill(opts.teacher ?? 'Docente de Prueba');
  74  |   await page.locator('input[placeholder="Ej. Lunes y Miércoles 10:00 AM"]').fill(
  75  |     opts.schedule ?? 'Lunes y Miércoles 10:00 AM',
  76  |   );
  77  |   if (opts.start) {
  78  |     await page.locator('label:has-text("Fecha Inicio") ~ input[type="date"]').first().fill(opts.start);
  79  |   }
  80  |   if (opts.end) {
  81  |     await page.locator('label:has-text("Fecha Final") ~ input[type="date"]').first().fill(opts.end);
  82  |   }
  83  |   await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  84  |   await expect(
  85  |     page.getByTitle('Seleccionar esta asignatura').filter({ hasText: name }).first(),
  86  |   ).toBeVisible({ timeout: 20000 });
  87  | }
  88  | 
  89  | export async function selectSubject(page: Page, name: string): Promise<void> {
  90  |   await page.getByTitle('Seleccionar esta asignatura').filter({ hasText: name }).first().click();
  91  |   // esperar a que se cargue la vista de la asignatura (breadcrumb/header)
  92  |   await expect(page.getByTitle('Editar asignatura')).toBeVisible({ timeout: 15000 });
  93  | }
  94  | 
  95  | export async function openTab(page: Page, tabId: string): Promise<void> {
  96  |   await page.locator(`#tab-${tabId}`).click();
  97  | }
  98  | 
  99  | /* ── Participantes ──────────────────────────────────────────────────────────── */
  100 | 
  101 | export async function addStudent(
  102 |   page: Page,
  103 |   data: { firstName: string; lastName: string; cedula: string; gender?: string },
  104 | ): Promise<void> {
  105 |   await page.locator('#add-manual-btn').click();
  106 |   await page.locator('input[placeholder="Ej. 8-123-456"]').fill(data.cedula);
  107 |   await page.locator('input[placeholder="Ej. Juan Carlos"]').fill(data.firstName);
  108 |   await page.locator('input[placeholder="Ej. Pérez Gómez"]').fill(data.lastName);
  109 |   if (data.gender) {
  110 |     await page.locator('select').filter({ has: page.locator('option', { hasText: data.gender }) }).selectOption({ label: data.gender }).catch(() => {});
  111 |   }
  112 |   await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  113 |   await expect(page.getByText(data.lastName, { exact: false }).first()).toBeVisible({ timeout: 15000 });
  114 | }
  115 | 
  116 | /* ── Asistencia ────────────────────────────────────────────────────────────── */
  117 | 
  118 | /** Devuelve el offset de día para una fecha en una semana lunes-viernes (índice 0-4). */
```