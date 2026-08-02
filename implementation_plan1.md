# 🚀 EdiAgil — Auditoría Completa & Plan de Lanzamiento en 7 Días

## Resumen Ejecutivo

Se realizó una auditoría multi-agente completa de la app **EdiAgil** (cuaderno de calificaciones para docentes). Se evaluaron: funcionalidad en vivo, seguridad Firebase, reglas de pago, exportación JSON, e integración con LemonSqueezy.

> [!CAUTION]
> **Se encontraron 4 vulnerabilidades CRÍTICAS que bloquean el lanzamiento comercial.** Los usuarios pueden obtener el plan "Pro" sin pagar, la exportación JSON puede perder datos, y no existe ningún procesador de pagos integrado.

---

## 📊 Hallazgos por Severidad

| Severidad | Cantidad | Área |
|-----------|----------|------|
| 🔴 CRÍTICO | 4 | Pagos bypass, datos truncados, import destructivo, sin gateway |
| 🟠 ALTO | 5 | Cuota IA explotable, validación cruzada, landing page, social login, race condition |
| 🟡 MEDIO | 4 | Rate limiting, localStorage settings, tipo incompleto, calendario por asignatura |
| 🟢 BAJO | 2 | Email enumeration, key naming |

---

## 🔴 HALLAZGOS CRÍTICOS (Bloqueadores de Lanzamiento)

### C1. Plan "Pro" Bypass — SIN PAGO REAL
**Archivos:** [SettingsModal.tsx](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/components/SettingsModal.tsx#L23-L27), [usePlan.ts](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/hooks/usePlan.ts)

> [!CAUTION]
> Un usuario puede hacer clic en "Premium Pro" en la pestaña Suscripción → se guarda en `localStorage` → la UI desbloquea TODAS las funciones premium sin pagar.

**Estado actual:**
- `SettingsModal.tsx` línea 23-27: `handleSelectPlan('pro')` escribe directamente a `localStorage`
- Las reglas de Firestore protegen el campo `plan` en `/users/{uid}` contra modificación del cliente (`request.resource.data.plan == existing().plan`)
- PERO: las reglas de sub-colecciones (`subjects`, `notes`, etc.) **NO** verifican el plan del usuario → no limitan creación de asignaturas ilimitadas
- El único control real está en la Cloud Function `geminiProxy` para llamadas de IA

**Solución requerida:**
1. Eliminar la selección de plan por clic en el frontend
2. Los botones de plan deben redirigir a un checkout de LemonSqueezy
3. Solo el webhook del backend debe poder modificar el campo `plan` en Firestore
4. Las reglas de Firestore deben verificar el plan para limitar creación de recursos

---

### C2. Sin Procesador de Pagos Integrado
**Archivos:** Todo el proyecto — no existe código de LemonSqueezy, Stripe, ni ningún gateway

> [!CAUTION]
> No hay integración con ningún procesador de pagos. Los planes se muestran solo como UI decorativa. No se puede cobrar a los docentes.

**Lo que falta:**
- Cuenta y Store en LemonSqueezy con productos/variantes configurados
- Cloud Function para webhook (`lemonSqueezyWebhook`)
- Verificación HMAC-SHA256 de webhooks
- Flujo de checkout (overlay o redirect)
- Gestión de suscripciones (cancelación, renovación, expiración)
- Portal del cliente para auto-gestión

---

### C3. Exportación JSON — Truncamiento Silencioso a 500 Documentos
**Archivo:** [SettingsModal.tsx](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/components/SettingsModal.tsx#L106-L111)

> [!WARNING]
> `getDocsForUser()` usa `limit(500)`. Un docente con 30 estudiantes × 10 evaluaciones = 300+ calificaciones. Con varias asignaturas, fácilmente supera 500 registros en `grades` o `attendance`. **Los datos se pierden silenciosamente.**

```typescript
// PROBLEMA ACTUAL (línea 108):
const q = query(collection(db, colName), where('userId', '==', auth.currentUser.uid), limit(500));
```

**Solución:** Implementar paginación completa o eliminar el `limit(500)` para operaciones de backup.

---

### C4. Importación Destructiva sin Validación Previa
**Archivo:** [SettingsModal.tsx](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/components/SettingsModal.tsx#L206-L249)

> [!WARNING]
> `confirmImport` ejecuta `clearCollection()` en TODAS las colecciones **ANTES** de escribir los datos importados. Si la importación falla a mitad de camino (red, JSON corrupto), se pierden TODOS los datos sin posibilidad de recuperación.

**Problemas adicionales:**
- `clearCollection` también usa `limit(500)` → deja documentos huérfanos si hay >500
- Key mismatch: exporta como `"modules"` pero la colección es `"subjectModules"` → si el JSON usa otro nombre, se borran módulos sin restaurarlos

---

## 🟠 HALLAZGOS ALTOS

### H1. Race Condition en Cuota de IA
**Archivo:** [functions/src/index.ts](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/functions/src/index.ts#L52-L83)

La verificación de cuota (`aiCallsThisMonth >= 50`) y el incremento NO están en una transacción Firestore. Un usuario puede enviar 100 requests simultáneos y todos pasarían el check antes del primer incremento.

**Solución:** Usar `db.runTransaction()` para leer + verificar + incrementar atómicamente.

### H2. Validación Cruzada Incompleta en Firestore Rules
**Archivo:** [firestore.rules](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/firestore.rules#L94-L112)

Las reglas de `grades` verifican que el `evaluationId` existe y pertenece al usuario, PERO **no verifican que el `studentId` exista** en la colección de estudiantes ni que pertenezca a la misma asignatura.

### H3. Sin Landing Page de Marketing
**Archivo:** [App.tsx](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/App.tsx)

La URL raíz muestra directamente el formulario de login. No hay página pública que explique el producto, características, precios, ni propuesta de valor para atraer docentes.

### H4. Sin Login Social (Google/Microsoft)
**Archivo:** [AuthProvider.tsx](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/components/AuthProvider.tsx)

Solo soporta email+password. Los docentes usan masivamente Google Workspace y Office 365. Sin login social, la conversión de registro será muy baja.

### H5. Settings del localStorage NO se Exportan en JSON
**Archivo:** [SettingsModal.tsx](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/components/SettingsModal.tsx#L165-L186)

| Setting Excluido | Impacto |
|---|---|
| `gradingWeights` (ponderaciones) | Al restaurar backup en otro dispositivo, los promedios se calculan con defaults (30/60/10) en vez de la config personalizada del docente |
| `gradingScale` (escala) | Nota máxima y mínima de aprobación se pierden |
| `useCheckpoint` (4ta nota) | Toggle de evaluación adicional se pierde |

---

## 🟡 HALLAZGOS MEDIOS

### M1. Sin Rate Limiting en Firestore Rules
Los usuarios pueden crear miles de documentos rápidamente, generando costos altos de Firebase.

### M2. Tipos TypeScript Incompletos
**Archivo:** [firestore.ts](file:///C:/Users/Jos%C3%A9%20Valencia/.gemini/antigravity/worktrees/ediagil/audit-launch-optimization-plan/src/types/firestore.ts)
- `AttendanceDoc` le falta `moduleId?: string`
- `MaterialDoc` le falta `startTime?` y `endTime?`

### M3. Calendario Faltante en Vista de Asignatura
El calendario solo existe en el Dashboard global, no dentro de cada asignatura.

### M4. Datos Locales (Dexie) No se Exportan
Las tablas `extractedEvents` y `uploadedDocs` de IndexedDB no se incluyen en el backup JSON.

---

## 💳 Análisis de Integración LemonSqueezy

### Modelo Tarifario (para tus precios actuales)

| Plan | Precio | Comisión LemonSqueezy (LatAm) | Ingreso Neto |
|------|--------|-------------------------------|--------------|
| Pro Mensual | $4.99/mes | ~7% + $0.50 = $0.85 | **$4.14/mes** |
| Institucional | $99.99/año | ~7% + $0.50 = $7.50 | **$92.49/año** |

### ⚠️ Problema Crítico para LatAm

> [!IMPORTANT]
> **60-70% de tarjetas en Colombia, México, Perú son domésticas** y serán rechazadas por LemonSqueezy (procesador internacional). La tasa de conversión será ~30-40%.

### Estrategia Recomendada: Modelo Híbrido

| Mercado | Gateway | Razón |
|---------|---------|-------|
| Internacional (US, EU) | **LemonSqueezy** | MoR, impuestos globales, compliance automático |
| LatAm (CO, MX, PE, CL) | **Mercado Pago** o **dLocal** | Tarjetas domésticas, PSE, Nequi, OXXO, Pix |

---

## 📅 PLAN DE LANZAMIENTO — 7 DÍAS

### Día 1-2: 🔒 Seguridad y Pagos (CRÍTICO)

#### Tarea 1.1: Crear Cloud Function `lemonSqueezyWebhook`
- Verificación HMAC-SHA256 de webhooks
- Manejo de eventos: `subscription_created`, `subscription_updated`, `subscription_cancelled`, `subscription_expired`, `subscription_payment_success`
- Actualización segura del campo `plan` en `/users/{uid}`

#### Tarea 1.2: Eliminar el bypass de pagos en el frontend
- Eliminar `handleSelectPlan()` que escribe a localStorage
- Reemplazar botones de plan con links al checkout de LemonSqueezy
- El checkout debe pasar `custom.user_id = Firebase UID`

#### Tarea 1.3: Reforzar Firestore Rules
- Agregar verificación de plan en reglas de `subjects` (limitar cantidad según plan)
- Usar transacción en `geminiProxy` para el contador de IA
- Validar que `studentId` exista en reglas de `grades`

#### Tarea 1.4: Configurar LemonSqueezy
- Crear Store, Productos y Variantes en el dashboard de LemonSqueezy
- Configurar webhook URL apuntando a la Cloud Function
- Guardar secrets: `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_API_KEY`

---

### Día 3: 📦 Corregir Export/Import JSON

#### Tarea 3.1: Eliminar `limit(500)` e implementar paginación
```diff
- const q = query(collection(db, colName), where('userId', '==', uid), limit(500));
+ // Paginar con startAfter para obtener TODOS los documentos
```

#### Tarea 3.2: Validar JSON antes de borrar datos
- Verificar estructura del JSON importado ANTES de ejecutar `clearCollection`
- Crear backup automático antes de importar
- Soportar ambos keys: `"modules"` y `"subjectModules"`

#### Tarea 3.3: Incluir settings en el export
```diff
  const data = {
+   version: "2.0",
+   exportedAt: new Date().toISOString(),
+   settings: {
+     gradingWeights: getStorageItem(STORAGE_KEYS.GRADING_WEIGHTS),
+     gradingScale: getStorageItem(STORAGE_KEYS.GRADING_SCALE),
+     useCheckpoint: getStorageItem(STORAGE_KEYS.USE_CHECKPOINT),
+   },
    subjects: await getDocsForUser('subjects'),
    // ... resto de colecciones
  };
```

---

### Día 4: 🔑 Autenticación Social + Tipos

#### Tarea 4.1: Agregar Google Sign-In
- Habilitar proveedor Google en Firebase Console
- Agregar botón "Continuar con Google" en el formulario de login
- Actualizar `AuthProvider.tsx` con `signInWithPopup(auth, googleProvider)`

#### Tarea 4.2: Corregir tipos TypeScript
- Agregar `moduleId?: string` a `AttendanceDoc`
- Agregar `startTime?`, `endTime?` a `MaterialDoc`

---

### Día 5: 🎨 Landing Page de Marketing

#### Tarea 5.1: Crear landing page pública
- Hero section con propuesta de valor para docentes
- Sección de características con iconos animados
- Tabla de precios (Free vs Pro vs Institucional)
- Testimonios / social proof
- CTA: "Empieza Gratis" → registro
- Footer con enlaces legales

#### Tarea 5.2: Separar rutas
- `/` → Landing page pública
- `/app` → Aplicación (requiere login)
- `/login` → Formulario de autenticación

---

### Día 6: 🧪 Testing & QA

#### Tarea 6.1: Test end-to-end del flujo de pago
- Crear cuenta → usar plan free → intentar crear 3+ asignaturas → ver paywall
- Comprar plan Pro via LemonSqueezy test mode → verificar webhook → verificar acceso

#### Tarea 6.2: Test de export/import completo
- Crear datos masivos (>500 registros) → exportar → verificar completitud
- Importar en cuenta nueva → verificar integridad al 100%

#### Tarea 6.3: Deploy de reglas de seguridad
```bash
firebase deploy --only firestore:rules,storage:rules
firebase deploy --only functions
```

---

### Día 7: 🚀 Lanzamiento

#### Tarea 7.1: Deploy final
```bash
npm run build && firebase deploy
```

#### Tarea 7.2: Configuración post-launch
- Habilitar Firebase App Check
- Configurar Google Analytics (GA4)
- Activar email enumeration protection
- Monitorear errores en Firebase Crashlytics / Console

#### Tarea 7.3: Marketing inicial
- Publicar en redes sociales para docentes
- Crear video demo de 2 minutos
- Contactar escuelas piloto

---

## Verificación Final Pre-Lanzamiento

### Checklist de Seguridad
- [ ] El campo `plan` en Firestore solo es modificable por Cloud Functions (webhook)
- [ ] La UI de suscripción redirige a checkout real (no localStorage)
- [ ] El contador `aiCallsThisMonth` usa transacción atómica
- [ ] Las reglas de Firestore limitan creación según plan
- [ ] Los webhooks verifican firma HMAC-SHA256
- [ ] Firebase App Check habilitado

### Checklist de Funcionalidad
- [ ] Export JSON descarga 100% de datos (sin límite de 500)
- [ ] Import JSON valida antes de borrar datos existentes
- [ ] Settings (ponderaciones, escala) incluidos en export
- [ ] Login con Google funcional
- [ ] Landing page pública visible sin login
- [ ] Flujo de pago completo funcional (test mode)

### Checklist de Atracción de Docentes
- [ ] Landing page con propuesta de valor clara
- [ ] Precios visibles y competitivos
- [ ] Demo o trial sin tarjeta de crédito
- [ ] Social proof / testimonios
- [ ] Soporte por email/chat visible

---

## Open Questions

> [!IMPORTANT]
> **Decisiones que necesito de tu parte antes de implementar:**

1. **¿Ya tienes cuenta en LemonSqueezy?** ¿O prefieres usar otro gateway (Stripe, Mercado Pago)?
2. **¿Los precios ($4.99/mes Pro, $99.99/año Institucional) son definitivos?** Considerando que en LatAm la conversión con LemonSqueezy será ~30-40%, ¿quieres agregar Mercado Pago como alternativa?
3. **¿Quieres que implemente el plan Institucional ($99.99/año por 30 licencias)?** Esto requiere lógica adicional de multi-usuario por institución.
4. **¿Landing page en español solamente, o bilingüe (español/inglés)?**
5. **¿Tienes dominio propio** (ej. ediagil.com) o usamos ediagil.web.app para el lanzamiento?
6. **¿Prioridad de implementación?** ¿Empiezo por seguridad+pagos (Día 1-2) o prefieres otro orden?
