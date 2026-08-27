# Plan: Mejoras Funcionales y Visuales de LandingPage

## Contexto

El usuario actualizó `pricing.ts` con un nuevo schema limpio:
- `PlanId = 'free' | 'pro' | 'school'` (sin `founders`)
- Campo `ctaHref` en cada plan (fuente de verdad para rutas)
- Campo `foundersPromo` estructurado en plan `school` (no en `urgency` genérico)
- Accent `amber` eliminado (solo `indigo`, `emerald`, `blue`)

Ahora `LandingPage.tsx` debe sincronizarse completamente con estos datos y mejorar su calidad visual y conversión.

---

## Cambios Propuestos

### Sección 1 — Cuadrícula de precios principal (`#precios`)

#### Problemas actuales
- El precio de **plan gratis** muestra `$ 0` con un espacio raro antes del `$` (línea 548).
- El tagline del plan Pro es demasiado largo (`US$11.99/año · Equivale a menos de US$1/mes facturado anualmente`) — se corta visualmente.
- El bloque `foundersPromo` de la tarjeta Institucional se ve bien pero el diseño puede ser más llamativo.
- El CTA del plan Gratis usa `<a href=...>` pero debería usar `plan.ctaHref` ya disponible en el objeto (actualmente ya lo hace en línea 569 ✅).
- La fila de features usa `<ul>` con `mb-10 flex-1` pero queda mal alineada verticalmente cuando los planes tienen diferente número de features.

#### Cambios funcionales y visuales
1. **Corregir el formato de precio del plan Gratis**: mostrar `Gratis` en lugar de `$0 /mes`.
2. **Truncar el tagline largo** del plan Pro: acortarlo en el componente visual a `≈ US$1/mes · facturado anualmente` (el tagline largo queda en `pricing.ts` como fuente de verdad pero en la tarjeta se muestra reducido con `line-clamp-2`).
3. **Mejorar visual del banner `foundersPromo`**: agregar icono de rayo `⚡`, fondo `amber-50` con borde `amber-300` y texto destacado del precio primer año más grande.
4. **Estandarizar altura de tarjetas**: usar `flex flex-col h-full` en la tarjeta y `mt-auto` en el CTA para que todas las tarjetas alineen el botón al fondo independientemente del número de features.
5. **Badge "Más popular"**: asegurar que use `plan.highlight` y que el badge tenga animación `animate-pulse` para mayor atención.

---

### Sección 2 — Sub-landing `/planes/premium-pro`

#### Problemas actuales
- El CTA dice "Comenzar Prueba de 14 días gratis" pero `pricing.ts` no define una prueba gratuita en los datos — no debe afirmar algo que no se controla desde la fuente de verdad.
- Las 4 tarjetas de características están escritas de forma estática (hardcoded), no leen de `plan.features`.
- No incluye tabla comparativa con el plan Gratis para hacer más claro el upgrade.

#### Cambios
1. **Actualizar CTA**: cambiar a `"Activar Premium Pro · US$11.99/año"` (el texto que muestra `plan.ctaLabel`).
2. **Agregar tabla comparativa** Gratis vs. Pro: 2 columnas, iterando sobre `plan.features` del plan Pro comparado con `free.features`.
3. **Agregar sección de garantía**: "30 días de garantía — si no mejoras tu productividad, te devolvemos el dinero" (texto estático de marketing verificable).
4. **Preservar** las 4 tarjetas de características detalladas existentes (valor real, bien redactadas).

---

### Sección 3 — Sub-landing `/planes/institucional`

#### Problemas actuales
- El CTA usa `<a href=...>` hardcoded en lugar de `navigate()` — inconsistente con el resto de la app SPA (línea 247-252).
- El banner de `foundersPromo` tiene fondo `amber-50` pero podría tener más impacto visual.
- No hay CTA secundario de "Agendar demo / Contactar ventas" — esencial para ventas B2B.

#### Cambios
1. **Corregir CTA**: cambiar `<a href=...>` a `<button onClick={() => navigate(schoolPlan.ctaHref)}>`.
2. **Agregar CTA secundario** "Agendar Demo" que envíe a `mailto:hola@ediagil.com?subject=Demo%20Plan%20Institucional` o a una URL de Calendly configurable.
3. **Mejorar diseño del banner Fundadores**: agregar countdown visual simple (texto estático "Oferta por tiempo limitado") y destacar el ahorro en bold (`Ahorra US$100 el primer año`).
4. **Ampliar la lista de features** de la sub-landing con los ítems de `schoolPlan.features` en lugar de 4 tarjetas hardcoded, para mantener coherencia con `pricing.ts` como fuente de verdad.

---

### Sección 4 — Imports y limpieza

#### Cambios
- Eliminar `Crown`, `Clock`, `AlertTriangle`, `TrendingUp` de los imports de lucide-react si no se usan en ningún lugar del componente (actualmente importados pero posiblemente sin uso tras los cambios).
- Agregar `Building2` para el CTA institucional si se usa.

---

## Archivos a Modificar

### [MODIFY] [LandingPage.tsx](file:///c:/Users/Jos%C3%A9%20Valencia/Desktop/ediagil/src/components/LandingPage.tsx)

**Cambios:**
- Línea ~548: corregir formato de precio del plan Gratis
- Líneas ~540-574: mejorar estructura de tarjetas (height, badge, foundersPromo)
- Líneas ~156-166: actualizar CTA sub-landing Premium Pro
- Líneas ~246-255: corregir `<a>` → `<button>` + CTA secundario en sub-landing Institucional
- Líneas ~3-24: limpiar imports no usados

> [!NOTE]
> `pricing.ts` ya está en su estado final — no se modifica.

---

## Verificación

### Manual
1. Abrir `http://localhost:3000` → sección Precios → confirmar 3 tarjetas correctas
2. Clic en tarjeta "Premium Pro" → redirige a `/planes/premium-pro`
3. Clic en CTA de sub-landing → redirige a `/login?mode=signup&plan=pro`
4. Clic en tarjeta "Institucional" → redirige a `/planes/institucional`
5. Clic en CTA principal institucional → redirige a `/login?mode=signup&plan=school`
6. Verificar que el banner Fundadores muestre `$99.99 primer año` y `$199.99 renovación`

### Build
> [!WARNING]
> El entorno tiene restricciones de PowerShell (`PSSecurityException`). La verificación de compilación se hará revisando que no haya errores TypeScript evidentes en el código editado.
