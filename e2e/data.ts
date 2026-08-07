/**
 * e2e/data.ts — Datos de prueba del Plan Institucional EdiAgil.
 *
 * Carga credenciales desde `e2e/.env` (copiar `e2e/env.example`).
 * Las 3 cuentas de docente + la cuenta admin YA deben existir en Firebase
 * Auth (se acceden por email/password; se usan tanto por UI como por la API
 * REST de Firebase para las pruebas de seguridad).
 */

import dotenv from 'dotenv';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.join(here, '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

function required(key: string): string {
  const v = process.env[key];
  if (!v || !v.trim()) {
    throw new Error(
      `❌ Falta "${key}" en e2e/.env — copia e2e/env.example y complétala con las credenciales reales.`,
    );
  }
  return v.trim();
}

export interface Account {
  name: string;
  email: string;
  password: string;
}

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';

export const TEACHER_1: Account = {
  name: 'Docente 1 — María López',
  email: required('E2E_TEACHER1_EMAIL'),
  password: required('E2E_TEACHER1_PASS'),
};
export const TEACHER_2: Account = {
  name: 'Docente 2 — Ana García',
  email: required('E2E_TEACHER2_EMAIL'),
  password: required('E2E_TEACHER2_PASS'),
};
export const TEACHER_3: Account = {
  name: 'Docente 3 — Carmen Rodríguez',
  email: required('E2E_TEACHER3_EMAIL'),
  password: required('E2E_TEACHER3_PASS'),
};
export const ADMIN: Account = {
  name: 'Administrador',
  email: required('E2E_ADMIN_EMAIL'),
  password: required('E2E_ADMIN_PASS'),
};
export const FREE: Account = {
  name: 'Free Tester (límites/trial)',
  // cuenta desechable: si no se define vía e2e/.env, se genera una nueva por
  // ejecución para poder probar el registro y los límites del plan free.
  email: process.env.E2E_FREE_EMAIL || `free.e2e.${Date.now()}@ediagil.com`,
  password: process.env.E2E_FREE_PASS || 'free-tester-1234',
};

/** Asignaturas por docente (9 en total). */
export const SUBJECTS_T1 = ['Matemáticas', 'Física', 'Química'];
export const SUBJECTS_T2 = ['Historia', 'Geografía', 'Ciencias Sociales'];
export const SUBJECTS_T3 = ['Lenguaje', 'Inglés', 'Educación Artística'];

/** Asignatura sacrificable para el test de borrado (2.17). */
export const TEMP_SUBJECT = 'Asignatura E2E Temporal';

export const INSTANCE_NAME = process.env.E2E_INSTITUTION_NAME || 'Colegio de Prueba EdiAgil';

/** Nombre de la institución mostrada en el dashboard admin (coincide con institutionName de la cuenta admin). */
export const ADMIN_INSTITUTION_NAME = process.env.E2E_ADMIN_INSTITUTION_NAME || 'Colegio de Prueba EdiAgil';

export const LS_CHECKOUT_MARKER = 'checkout.liquonsqueezy.com';
export const LS_PORTAL_MARKER = 'app.lemonsqueezy.com';

export function firebaseConfig() {
  const p = path.join(here, '..', 'firebase-applet-config.json');
  if (!existsSync(p)) throw new Error('❌ Falta firebase-applet-config.json en la raíz del repo.');
  return JSON.parse(readFileSync(p, 'utf8'));
}

export const FIREBASE = firebaseConfig();
export const API_KEY: string = FIREBASE.apiKey;
export const PROJECT_ID: string = FIREBASE.projectId || 'ediagil-new-2026';

/** Credenciales opcionales de pago (solo se usan si la rama del test las necesita). */
export const PAYMENT = {
  /** Email de la cuenta usada para el flujo de pago (por defecto Docente 1). */
  email: process.env.E2E_PAYMENT_EMAIL || TEACHER_1.email,
  password: process.env.E2E_PAYMENT_PASS || TEACHER_1.password,
  /** Código de licencia válido (school_teacher) para 6.25. */
  validLicenseKey: process.env.E2E_LICENSE_KEY_VALID || '',
  /** Código de licencia inválido para 6.26. */
  invalidLicenseKey: process.env.E2E_LICENSE_KEY_INVALID || '',
  licenseTesterEmail: (process.env.E2E_LICENSE_EMAIL || 'license.tester@ediagil.com'),
  licenseTesterPass: (process.env.E2E_LICENSE_PASS || 'test-license-1234'),
};