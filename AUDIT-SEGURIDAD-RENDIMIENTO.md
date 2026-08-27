# Auditoría de Seguridad y Análisis de Rendimiento — EdiAgil (Plan Institucional)

> **Fecha:** 2026 · **Alcance:** `functions/index.js` (callables/endpoints del plan institucional), `firestore.rules`, `storage.rules`, módulos puros (`lib/`), e integración de reportes en el front.
> **Método:** revisión manual de código y reglas + ejecución de las suites de tests existentes (`scripts/test-alerts.mjs`, `scripts/test-school-config.mjs`) y validadores (`node --check`, `tsc --noEmit`, `vite build`).

## Resumen ejecutivo

| Área | Estado |
|------|--------|
| Seguridad crítico | 0 hallazgos críticos abiertos |
| Seguridad medio | 1 corregido (modelo de IA arbitrario en `geminiproxy`) |
| Rendimiento alto | 2 corregidos (serialización de `adminListTeachers`, lecturas completas en boletín) |
| Rendimiento medio | 1 corregido (payload de contenidos en métricas) + 3 recomendaciones |

Ningún hallazgo bloquea la operación; los corregidos reducen de forma notable el costo (lecturas Firestore, payloads, latencia ×N docentes).

---

## 1. Seguridad

### 1.1 Hallazgos corregidos

**SEC-01 — Modelo de IA arbitrario en `geminiproxy` (MEDIO-ALTO)**
- Estado anterior: el cliente enviaba `{ model }` y el proxy lo concatenaba a la URL de la API de Gemini sin validar (`functions/index.js`). Un usuario autenticado podía apuntar a modelos caros (quema de costo y de cuota de la cuenta) o a paths inexistentes.
- Corrección aplicada: allowlist `ALLOWED_GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash']` (los únicos usados por la app: default del front y `documentParser.ts`); cualquier otro modelo recibe `400 Modelo de IA no permitido.` antes de reservar cuota.

### 1.2 Controles verificados como correctos

| # | Control | Evidencia |
|---|---------|-----------|
| V-1 | Deny-by-default en Firestore y Storage (`allow read, write: if false`) | `firestore.rules:5-7`; `storage.rules` sin wildcard de escritura |
| V-2 | Soberanía del docente: el admin nunca escribe datos pedagógicos | Reglas de `subjects/students/grades/attendance/...` exigen `userId == request.auth.uid`; el admin no puede escribir colecciones ajenas |
| V-3 | `role`/`institutionId`/`plan`/trial son backend-only | `firestore.rules` `users` create/update con `hasAll/!in/diff()`; cliente no puede auto-concederse rol, institución, plan ni prueba |
| V-4 | `licenseKeys` selladas (lectura prohibida al cliente) | `firestore.rules:370-373` |
| V-5 | Membresías: solo el admin crea `role: 'teacher'` (nunca admin) dentro de SU institución; id del doc = userId (invariante) | `firestore.rules:396-401` |
| V-6 | Aislamiento entre instituciones en **todos** los callables admin: `institutionId` se lee SIEMPRE del doc `users/{adminUid}` (nunca del payload del cliente) y los docentes ajenos se rechazan | `assertAdmin` + patrón `adminSnap.data().institutionId` en los 11 callables; `adminGetTeacherData`/`Summary` verifican `teacherData.institutionId === adminInstitutionId` |
| V-7 | `assertAdmin` real sobre `users.role == 'admin'` (no custom claims volátiles) | `functions/index.js:637-643` |
| V-8 | Webhook Lemon Squeezy: firma HMAC-SHA256 sobre `rawBody` con comparación en tiempo constante; idempotencia por `eventId`; guard de suscripción activa (eventos viejos no degradan suscripciones nuevas) | `functions/index.js:138-143, 2080-2109` |
| V-9 | Cuota de IA atómica (reserva previa en transacción, reversión con `Math.max(0,…)`; límites por plan con degradación por trial expirado) | `reserveAiQuota`/`releaseAiCall` |
| V-10 | Canje de licencia idempotente con marcado atómico `used` en transacción | `redeemLicenseKey` |
| V-11 | Logo institucional: Storage `institutions/{id}/logo` escribe solo el admin de la institución (`firestore.get()` de la membresía), imágenes <10 MB, deletes restringidos | `storage.rules` |
| V-12 | Límite del plan school: 30 docentes por institución, validado en servidor | `adminInviteTeacher` |
| V-13 | CORS con allowlist (fallback al origen canónico, sin reflejar origines no listados) | `setCors` |

### 1.3 Recomendaciones (no bloqueantes, requieren decisión de producto)

- **SEC-R1 (BAJO):** `setupLemonSqueezyProducts` es `invoker: 'public'` y divulga `storeId` y si la variante school está configurada. No permite mutar nada; opcional restringir invocador.
- **SEC-R2 (MEDIO, decisión de negocio):** al expirar una suscripción school, `handleSubscriptionExpired` degrada `plan → free` pero conserva `role: 'admin'` e `institutionId` (la membresía sigue). Esto mantiene acceso de lectura al panel tras el impago. Si se decide revocar, el cambio debe ser backend-only (nunca por el cliente) y considerar la reactivación vía `subscription_updated(active)`.
- **SEC-R3 (BAJO):** el admin puede crear membresías de docente directo desde el cliente (regla `institutionUsers.create`), saltando `adminInviteTeacher` (sin actualizar `users.institutionId`). No es una escalada (solo `role: teacher`, dentro de su propia institución), pero puede dejar al docente sin vista institucional hasta que el backend lo vincule; valorar si conviene cerrar el create directo.

---

## 2. Rendimiento

### 2.1 Hallazgos corregidos

**PERF-01 (ALTO) — `adminListTeachers` serial ×N docentes**
- Estado anterior: bucle `for` por docente con `await` (5 lecturas cada uno) → latencia ≈ N rondas secuenciales (30 docentes = 150 lecturas en 30 rondas).
- Corrección: `Promise.allSettled` sobre todos los docentes (lecturas en paralelo, un fallo parcial no tumba la lista; el propio admin y otros admins se excluyen).

**PERF-02 (ALTO) — Boletín cargaba todo el docente por membresía**
- Estado anterior: `loadStudentBoletin` hacía `getAllDocsForUser('evaluations' | 'grades' | 'attendance', teacherUid)` — colecciones COMPLETAS del docente — por cada membresía del estudiante, filtrando luego en memoria.
- Corrección: `getAllDocsForUserBySubject(..., subId)` con las 3 colecciones de la asignatura de esa membresía (mismas proyecciones, datos a nivel de asignatura).

**PERF-03 (MEDIO) — Métricas institucionales bajaban contenidos enteros**
- Estado anterior: `adminGetInstitutionStats` leía `notes` (hasta 300 KB de contenido c/u), `materials` (adjuntos base64) y `calendarEvents` completos para solo usar `.date` en la actividad semanal.
- Corrección: nuevo helper `getAllDocsForUserLight(col, userId, ['date'])` con `.select()` (proyección de campos) → payload de metadatos en lugar de documentos enteros.

### 2.2 Patrones verificados como correctos

| # | Control | Evidencia |
|---|---------|-----------|
| V-P1 | Paginación `limit(1000)` + `startAfter(__name__)` evita el límite de 500 docs/query de Firestore | `getAllDocsForUser`, `getAllDocsForUserBySubject` |
| V-P2 | Agregados institucionales paralelos y tolerantes a fallos (`allSettled`) | `adminGetInstitutionStats`, `adminGetInstitutionAlerts`, `adminGenerateInstitutionInsights` |
| V-P3 | Búsqueda de alumnos con mínimo de 2 caracteres (evita escaneo trivial) y tope de 50 resultados | `adminSearchStudents` |
| V-P4 | Operaciones de pago/canje/trial atómicas (transacciones), sin escrituras masivas en los callables admin | `redeemLicenseKey`, `activateTrial`, webhook |
| V-P5 | Los callables pesados declaran `timeoutSeconds: 120-180` y `memory: '1GiB'` | `adminGetInstitutionStats`, `adminGetInstitutionAlerts`, `adminGenerateInstitutionInsights`, `adminGenerateStudentInsights` |

### 2.3 Recomendaciones (no aplicadas)

- **PERF-R1 (MEDIO):** `adminSearchStudents` y el boletín re-escanean la institución completa (`loadInstitutionData`) en cada llamada: el costo por búsqueda es O(docs institucionales). Aceptable a la escala actual (30 docentes), pero un cache en memoria con TTL corto (p. ej. 30-60 s) reduciría el costo de búsquedas repetidas en el dashboard.
- **PERF-R2 (BAJO):** `adminGetTeacherData` baja notas/materiales completos por asignatura (necesario para el detalle, pero pesado si hay muchas notas). Opción futura: separar contenidos y cargarlos on-demand.
- **PERF-R3 (BAJO):** el bundle principal supera 500 KB (`vite build` warning preexistente, `index-*.js` ≈ 932 KB). No bloquea, pero value la pena code-splitting (manualChunks/routes) en una pasada de front.

---

## 3. Verificación ejecutada

| Comando | Resultado |
|---------|-----------|
| `node --check functions/index.js` (+ libs, seeds) | ✅ |
| `node scripts/test-alerts.mjs` | ✅ 21/21 |
| `node scripts/test-school-config.mjs` | ✅ 20/20 |
| `npm run lint` (`tsc --noEmit`) | ✅ |
| `npm run build` (`vite build`) | ✅ |

---

## 4. Impacto y despliegue

Los cambios viven en `functions/index.js` (backend) y son retrocompatibles con el front actual:
- `geminiproxy`: los clientes que usan los modelos permitidos no ven cambios; respuesta `400` solo para modelos desconocidos.
- `adminListTeachers` / boletín / métricas: misma forma de respuesta, menor latencia y costo.

Desplegar requiere Functions: en PowerShell, `$env:FUNCTIONS_DISCOVERY_TIMEOUT="120"` antes de `firebase deploy --only functions` (o `npm run deploy` para el despliegue completo con hosting y storage).