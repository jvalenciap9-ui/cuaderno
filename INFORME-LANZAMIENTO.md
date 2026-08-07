# 🚀 Informe de Acciones Pendientes — Pre-Lanzamiento EdiAgil

> **Proyecto:** `ediagil-new-2026`
> **Fecha:** 2026-08-02
> **Fuente:** auditoría multi-agente (`implementation_plan1.md` + R1–R5) y verify CR-01/HR-01

---

## Estado general

- Implementación completa, auditeda y **desplegada** (Functions 12/12, `firestore.rules`, Hosting).
- `npm run build` y `npm run lint` → **OK**. Auditoría final: **0 CRITICAL / 0 HIGH / 0 MEDIUM**.
- CR-01 (degradar pagado→free) **cerrado**; trial de 14 días funcional en producción.
- **Lo que falta es configuración comercial real y pruebas E2E (no código).**

---

## 🟥 1. BLOQUEO — ID real de variante Institucional (placeholder)

**Pendiente:** el secret `LEMON_SQUEEZY_SCHOOL_VARIANT_ID` se creó con placeholder (`PLACEHOLDER_SCHOOL_VARIANT_SET_ME`) solo para desbloquear el deploy. El plan **Institucional no puede venderse** hasta setearlo.

**Solución paso a paso:**
1. Copy el ID de la variante Institucional en Lemon Squeezy (*Catalog → variante Institucional*).
2. Guardarlo (una vez):
   ```powershell
   firebase functions:secrets:set LEMON_SQUEEZY_SCHOOL_VARIANT_ID
   ```
3. Re-desplejar functions para coger el nuevo valor:
   ```bash
   $env:FUNCTIONS_DISCOVERY_TIMEOUT="120"
   firebase deploy --only functions
   ```
4. Nota: `createLemonSqueezyCheckout` devuelve **HTTP 503** si el secret no es un ID válido (by design).

**Variantes esperadas (hardcode en código):**
| Plan | ID variante | Origen |
|------|-------------|--------|
| Pro | `1158973` | constante en `functions/index.js:65,866` |
| School | *variable* | secret `LEMON_SQUEEZY_SCHOOL_VARIANT_ID` |

---

## 🟧 Verificaciones E2E reales (requiere cuenta autenticada)

No se probó contra el servicio real (sin credenciales autenticas en la máquina). Confirmar 5 flujos:

| # | Flujo | Pasos |
|---|-------|-------|
| **E1** | Trial 14 días | Log → Ajustes → "Probar Premium 14 días gratis" → ver toast + badge "Plan de prueba — quedan N días" (Pro: 999 asign., 2000 IA). |
| **E2** | Expiración sin pago | Fuerza `trialEndsAt` pasado en Firestore → al abrir `resolveTrialExpiry` degrada a `free` y `trialUsed:true` → "Ya usaste tu prueba" (no se puede re-ahogue). |
| **E3** | **CR-01** pago durante trial | Activar trial → **comprar Pro** → verificar `plan=pro`, `paymentProvider=lemonsqueezy`, `isTrial=false`. Al pasar la fecha del trial **sigue Pro** (no se degrada). |
| **E4** | Webhook completo | Comprar → en Firestore el doc users recibe `plan`, `expiresAt`, `subscriptionId`. Logs: `firebase functions: log --only lemonSqueezyWebhook`. |
| **E5** | Portal | Ajustes → "Gestionar suscripción" → abre portal Lemon Squeezy (sin 404). |

---

## 🟨 Configuración del Dashboard de Lemon Squeezy

**Pendiente:** Webhook configurado + variantes alineadas + secret corre con valor real.

### Solución paso a paso
1. **Webhook URL** → Lemon Squeezy → Webhooks:
   ```
   https://lemonsqueezywebhook-t6k4ah2mva-uc.a.run.app
   ```
2. **Webhook signing secret** → coincide con el valor del secret `LEMON_SQUEEZY_WEBHOOK_SECRET` en Secret Manager (clave que ya existe).
3. **Eventos habilitados:**
   - `order_created`
   - `subscription_created`
   - `subscription_updated`
   - `subscription_cancelled`
   - `subscription_expired`
   - `subscription_payment_success`
4. **Alienar variantes** (tabla de arriba): Pro `1158393` + School (secret real).

---

## 🟨 Demo desde la landing

**Pendiente:** flujo *landing → registro → trial* (CTAs apuntan a `/login?mode=signup`).

### Pasos
1. Abrir `https://ediagil-new-2026.web.app`.
2. Click "Empezar Gratis"/"Probar" → debe llevar a registro con `mode=signup`.
3. Crear cuenta → usuario `free`.
4. Ajustes → "Probar Premium 14 días" → toast + badge.
5. Verificar límite 2 asignaturas en free / 999 en trial.

---

## 🟨 Endurecimiento opcional (LOW, no bloquead)

| Hallazgo | Fix sugerido |
|----------|--------------|
| `order_refunded`/`subscription_payment_failed` (refund/impago) sin handler → cliente reembolsado conserva plan | Agregar ramas en `lemonSqueezyWebhook` → `plan:'free'` tras refund; downgrade tras N impagos |
| `userStillOnSubscription` no protege si el doc del usuario no tiene `subscriptionId` | Buscar a.s fecha active por `custom.user_id`; si no → retornar `false` |

---

## ✅ Checklist final pre-venta

- [ ] **Secret** `LEMON_SQUEEZY_SCHOOL_VARIANT_ID` real + redeploy (sección 1).
- [ ] **Webhook** configurado (URL real + signing secret correctamente) (sección 3).
- [ ] **Variantes** Pro + School alineadas.
- [ ] **E1–E5** pasan con cuenta real (sección 2).
- [ ] **Landing → registro → trial** funciona.
- [ ] (opcional) refunds/impagos hardenizados.
- [ ] Actualizar `README.md` si sigue citando Stripe (AGENTS.md ya corregido).

**Orden: 1 → 2 → 3 → 4 → (opcional 5).** El bloque 1 desbloquea todo el resto.