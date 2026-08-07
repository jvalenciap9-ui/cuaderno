# 🚀 Flujo de Registro y Suscripción Inteligente — EdiAgil

Este documento detalla el funcionamiento técnico del embudo de conversión e integración de pasarelas de pago de **EdiAgil** (desde la landing page, pasando por el registro, hasta la activación de suscripciones en LemonSqueezy) para que puedas reproducirlo fácilmente si decides cambiar de landing page o usar un servicio de marketing externo (como Webflow, WordPress, etc.).

---

## 📐 Estructura del Enrutamiento y Parámetros

Cuando un usuario selecciona un plan en cualquier landing page, el enlace debe enviarlo a la aplicación con los siguientes parámetros de consulta (query parameters):

| Plan Seleccionado | URL de Destino Recomendada |
|-------------------|-----------------------------|
| **Gratis** | `/login?mode=signup&plan=free` |
| **Premium Pro** | `/login?mode=signup&plan=pro` |
| **Institucional** | `/login?mode=signup&plan=school` |

*Si se desea pasar el nombre de la institución de antemano, se puede añadir la variable `&institutionName=Nombre+Colegio` a la URL.*

---

## ⚙️ Funcionamiento Técnico del Flujo (Código Implementado)

El flujo está automatizado en la aplicación de la siguiente manera:

1. **Captura en Entrada (`src/App.tsx`):**
   Al cargar las rutas `/` o `/login`, la aplicación lee las variables `plan` e `institutionName` de la barra de direcciones y las guarda temporalmente en el `localStorage` del dispositivo (`ediagil_pending_checkout_plan` y `ediagil_pending_checkout_institution`).

2. **Registro/Inicio de Sesión:**
   El usuario completa el registro estándar con correo o Google. Dado que la seguridad de Firestore protege la creación directa de planes de pago en el cliente, la cuenta inicialmente se crea siempre en nivel **Free** (`'free'`).

3. **Auto-Redirección al Checkout (`src/App.tsx`):**
   Una vez el usuario ingresa a la aplicación principal (`/app`):
   - El sistema valida si existe la bandera de plan pendiente en `localStorage`.
   - Si detecta `pro` o `school`, y confirma que la cuenta en la base de datos es `free`, **intercepta el flujo**, muestra un toast informativo, llama asíncronamente a la API de Firebase Functions (`/api/create-checkout`) con el token de sesión del usuario, e inicia automáticamente la redirección al portal seguro de LemonSqueezy.

4. **Retorno de Pago Exitoso (`/app?checkout=success`):**
   Tras realizar el pago, LemonSqueezy redirecciona al usuario de vuelta a la aplicación con el parámetro `?checkout=success`. La app captura este parámetro, muestra un mensaje de bienvenida Premium y abre los ajustes de facturación para su confirmación.

---

## 📝 Plantilla de Código para Nuevas Landing Pages

Si construyes otra landing page externa (en Webflow, Carrd, Astro, etc.), asegúrate de que los botones de llamada a la acción (CTA) de los planes apunten a los siguientes enlaces (reemplazando `tudominio.com` por tu URL de producción):

### Botón Plan Gratis:
```html
<a href="https://tudominio.com/login?mode=signup&plan=free">Comenzar Gratis</a>
```

### Botón Plan Premium Pro:
```html
<a href="https://tudominio.com/login?mode=signup&plan=pro">Obtener Premium Pro</a>
```

### Botón Plan Institucional:
```html
<!-- Si quieres capturar el nombre de la institución dinámicamente en tu landing -->
<a href="https://tudominio.com/login?mode=signup&plan=school">Comprar Institucional</a>
```
