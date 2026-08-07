import { defineConfig } from '@playwright/test';

/**
 * Config E2E para el Plan de Pruebas Multi-Agente — EdiAgil Plan Institucional.
 *
 * Entorno: la app se sirve en http://localhost:3000 (Vite) y el proxy Express
 * en :3001 (npm run dev:full). Los datos viven en el proyecto Firebase real
 * (ediagil-new-2026), por lo que la suite se ejecuta de forma SERIAL
 * (workers: 1) para no pisarse los datos compartidos entre fases.
 */

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: {
    timeout: 20_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],

  use: {
    // La app usa Firebase real en dev. Nada de mock de red por defecto.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 20_000,
  },

  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],

  webServer: {
    command: 'npm run dev:full',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});