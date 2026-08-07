# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth.spec.ts >> Fase 1 — Auth y Login >> 1.12 Login con Google: abre popup
- Location: e2e\auth.spec.ts:120:3

# Error details

```
Error: expect(received).toContain(expected) // indexOf

Expected substring: "accounts.google.com"
Received string:    "https://ediagil-new-2026.firebaseapp.com/__/auth/handler?apiKey=AIzaSyDummyKeyForCompilation-ReplaceMe&appName=%5BDEFAULT%5D&authType=signInViaPopup&redirectUrl=http%3A%2F%2Flocalhost%3A3000%2Flogin&v=12.13.0&eventId=6579817909&providerId=google.com&scopes=profile"
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - button "Volver a la página principal" [ref=e4]
      - generic [ref=e7]:
        - img "EdiAgil Logo" [ref=e9]
        - heading "EdiAgil" [level=1] [ref=e10]
        - paragraph [ref=e11]: Gestiona tus clases, asistencias y calificaciones en la nube.
        - generic [ref=e12]:
          - textbox "Email" [ref=e13]
          - textbox "Contraseña (mín. 6 caracteres)" [ref=e14]
          - paragraph [ref=e15]: Error al iniciar sesión con Google. Asegúrate de haber habilitado el proveedor en Firebase Console > Authentication > Sign-in method.
          - button "Iniciar sesión" [ref=e16]
          - generic [ref=e17]: o
          - button "Continuar con Google" [ref=e21]
          - button "¿Olvidaste tu contraseña?" [ref=e27]
        - button "¿No tienes cuenta? Regístrate" [ref=e28]
        - generic [ref=e29]:
          - link "Términos" [ref=e30] [cursor=pointer]:
            - /url: /terminos.html
          - generic [ref=e31]: ·
          - link "Privacidad" [ref=e32] [cursor=pointer]:
            - /url: /privacidad.html
    - generic: Iniciar sesión con Google
  - iframe [ref=e33]:
    
```

# Test source

```ts
  25  |     await page.locator('#login-button').click();
  26  |     await waitForApp(page);
  27  |   }
  28  | }
  29  | 
  30  | test.describe('Fase 1 — Auth y Login', () => {
  31  |   test('1.1 Landing Page visible', async ({ page }) => {
  32  |     await gotoLanding(page);
  33  |     await expect(page.getByText('Empieza Gratis', { exact: true }).first()).toBeVisible();
  34  |     await expect(
  35  |       page.getByRole('button', { name: 'Iniciar Sesión' }).first(),
  36  |     ).toBeVisible();
  37  |   });
  38  | 
  39  |   test('1.2 Navegación a Login', async ({ page }) => {
  40  |     await gotoLanding(page);
  41  |     await page.getByRole('button', { name: 'Iniciar Sesión' }).first().click();
  42  |     await expect(page.locator('input[placeholder="Email"]')).toBeVisible();
  43  |     await expect(page.locator('#google-login-button')).toBeVisible();
  44  |     await expect(page.locator('#login-toggle')).toBeVisible();
  45  |   });
  46  | 
  47  |   test('1.3 Registro de Docente 1 (ya existe -> login ok)', async ({ page }) => {
  48  |     await page.goto(`${BASE_URL}/login?mode=signup`);
  49  |     await page.locator('input[placeholder="Email"]').fill(TEACHER_1.email);
  50  |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(TEACHER_1.password);
  51  |     await page.locator('#login-button').click();
  52  |     await expect(page.getByText('Este email ya está registrado. Inicia sesión.')).toBeVisible();
  53  |     // el login de la cuenta existente debe funcionar
  54  |     await page.locator('#login-toggle').click();
  55  |     await page.locator('input[placeholder="Email"]').fill(TEACHER_1.email);
  56  |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(TEACHER_1.password);
  57  |     await page.locator('#login-button').click();
  58  |     await waitForApp(page);
  59  |   });
  60  | 
  61  |   test('1.4 Registro de Docente 2 (idempotente)', async ({ page }) => {
  62  |     await signupOrLogin(page, TEACHER_2.email, TEACHER_2.password);
  63  |   });
  64  | 
  65  |   test('1.5 Registro de Docente 3 (idempotente)', async ({ page }) => {
  66  |     await signupOrLogin(page, TEACHER_3.email, TEACHER_3.password);
  67  |   });
  68  | 
  69  |   test('1.7 Login inválido: mensaje exacto', async ({ page }) => {
  70  |     await page.goto(`${BASE_URL}/login`);
  71  |     await page.locator('input[placeholder="Email"]').fill(TEACHER_1.email);
  72  |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill('contraseña-incorrecta');
  73  |     await page.locator('#login-button').click();
  74  |     await expect(page.getByText('Email o contraseña incorrectos.')).toBeVisible();
  75  |   });
  76  | 
  77  |   test('1.8 Login con email no registrado', async ({ page }) => {
  78  |     await page.goto(`${BASE_URL}/login`);
  79  |     await page.locator('input[placeholder="Email"]').fill('no.existe@ediagil.com');
  80  |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill('password123');
  81  |     await page.locator('#login-button').click();
  82  |     await expect(page.getByText('Email o contraseña incorrectos.')).toBeVisible();
  83  |   });
  84  | 
  85  |   test('1.9 Contraseña débil en registro', async ({ page }) => {
  86  |     await page.goto(`${BASE_URL}/login?mode=signup`);
  87  |     await page.locator('input[placeholder="Email"]').fill('weak.pass.test@ediagil.com');
  88  |     // quitar minLength para forzar la validación server-side de Firebase
  89  |     await page
  90  |       .locator('input[placeholder="Contraseña (mín. 6 caracteres)"]')
  91  |       .evaluate((el) => {
  92  |         el.removeAttribute('minlength');
  93  |       });
  94  |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill('123');
  95  |     await page.locator('#login-button').click();
  96  |     await waitForApp(page)
  97  |       .then(() => {
  98  |         // si por algún motivo entró (cuenta única), el test igualmente valida que
  99  |         // la app no dobló el flujo; en condiciones normales se muestra el error:
  100 |       })
  101 |       .catch(() => expect(page.getByText('La contraseña debe tener al menos 6 caracteres.')).toBeVisible());
  102 |   });
  103 | 
  104 |   test('1.10 Email duplicado en registro', async ({ page }) => {
  105 |     await page.goto(`${BASE_URL}/login?mode=signup`);
  106 |     await page.locator('input[placeholder="Email"]').fill(TEACHER_1.email);
  107 |     await page.locator('input[placeholder="Contraseña (mín. 6 caracteres)"]').fill(TEACHER_1.password);
  108 |     await page.locator('#login-button').click();
  109 |     await expect(page.getByText('Este email ya está registrado. Inicia sesión.')).toBeVisible();
  110 |   });
  111 | 
  112 |   test('1.11 Recuperar contraseña', async ({ page }) => {
  113 |     await page.goto(`${BASE_URL}/login`);
  114 |     await page.getByText('¿Olvidaste tu contraseña?').click();
  115 |     await page.locator('input[placeholder="Email"]').fill(TEACHER_1.email);
  116 |     await page.getByRole('button', { name: 'Enviar enlace de recuperación' }).click();
  117 |     await expect(page.getByText('Te enviamos un email para restablecer tu contraseña.')).toBeVisible();
  118 |   });
  119 | 
  120 |   test('1.12 Login con Google: abre popup', async ({ page }) => {
  121 |     await page.goto(`${BASE_URL}/login`);
  122 |     const popupPromise = page.waitForEvent('popup', { timeout: 30_000 });
  123 |     await page.locator('#google-login-button').click();
  124 |     const popup = await popupPromise;
> 125 |     expect(popup.url()).toContain('accounts.google.com');
      |                         ^ Error: expect(received).toContain(expected) // indexOf
  126 |     await popup.close();
  127 |   });
  128 | 
  129 |   test('1.13 Toggle Login/Registro', async ({ page }) => {
  130 |     await page.goto(`${BASE_URL}/login`);
  131 |     await expect(page.locator('#login-button')).toHaveText('Iniciar sesión');
  132 |     await page.locator('#login-toggle').click();
  133 |     await expect(page.locator('#login-button')).toHaveText('Crear cuenta');
  134 |     await page.locator('#login-toggle').click();
  135 |     await expect(page.locator('#login-button')).toHaveText('Iniciar sesión');
  136 |   });
  137 | 
  138 |   test('1.14 Logout', async ({ page }) => {
  139 |     await doLogin(page, TEACHER_1.email, TEACHER_1.password);
  140 |     await doLogout(page);
  141 |     await expect(page.locator('#login-button')).toBeVisible();
  142 |     const leftover = await page.evaluate(() =>
  143 |       Object.keys(localStorage).filter((k) => k.startsWith('ediagil_app')),
  144 |     );
  145 |     expect(leftover.length).toBe(0);
  146 |   });
  147 | 
  148 |   test('1.15 Sesión persistente al recargar', async ({ page }) => {
  149 |     await doLogin(page, TEACHER_1.email, TEACHER_1.password);
  150 |     await page.reload();
  151 |     await waitForApp(page);
  152 |     await expect(page.locator('#login-button')).toBeHidden();
  153 |   });
  154 | });
```