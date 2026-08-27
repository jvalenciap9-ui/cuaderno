# Informe Ejecutivo: Sistema de Pagos y Suscripciones (EdiAgil)

## 1. Opciones de Pago y Suscripción Implementadas

El sistema de EdiAgil cuenta con una arquitectura de monetización robusta, apoyada en **Lemon Squeezy** como pasarela de pagos principal y **Firebase Cloud Functions / Firestore** para el control de acceso y límites lógicos. 

Las opciones actuales son:

### A. Plan Gratis (Free)
- **Funciones:** Hasta 2 asignaturas por año natural, calificaciones básicas, registro de asistencia, 15 consultas IA/mes y apuntes locales.
- **Cumplimiento:** **Completado.** Las reglas de Firestore restringen de manera estricta que no se superen las 2 asignaturas (a través del `userCounters`) y el proxy de Gemini restringe de forma atómica a 15 llamadas de IA, receteándose cada mes de forma segura.

### B. Plan Premium Pro ($4.99/año)
- **Funciones:** Hasta 999 estudiantes/cursos, calificaciones avanzadas, 2.000 consultas IA/mes, exportación PDF/Excel, Syllabus IA y sincronización en la nube.
- **Cumplimiento:** **Completado.** Se integra vía Lemon Squeezy (Variante `1158973`). Los webhooks asignan el plan `pro`, actualizan la fecha de expiración y habilitan las cuotas de IA altas y la evasión de límites de materias en Firestore. 

### C. Plan Institucional / School ($99.99/año)
- **Funciones:** Panel administrativo, 9.999 consultas IA/mes, onboarding personalizado, reportes y métricas de institución.
- **Cumplimiento:** **Completado.** Los pagos se manejan mediante una variante configurada en los *secrets* de Firebase (`LEMON_SQUEEZY_SCHOOL_VARIANT_ID`). Asigna automáticamente el rol `admin` y la `institutionId`. 

### D. Prueba Gratuita (14 Días)
- **Funciones:** Permite probar el Plan Pro por 14 días sin tarjeta de crédito.
- **Cumplimiento:** **Completado.** Es gestionado por Cloud Functions (`activateTrial`). Se maneja de forma idempotente, el cliente no puede alterar sus fechas, y expira degradando la cuenta a `free` (protegido contra concurrencias).

### E. Canje de Códigos de Licencia (License Keys)
- **Funciones:** Permite a administradores o ventas entregar códigos para planes Pro o Institucionales (roles admin o teacher).
- **Cumplimiento:** **Completado.** A través de la función `redeemLicenseKey` ejecutada en un `batch` atómico de Firestore, marcando la clave como usada y asignando instantáneamente los privilegios, roles e institución correspondiente.

---

## 2. Estado de Seguridad y Webhooks

- **Firma de Webhooks:** El webhook de Lemon Squeezy verifica la firma criptográfica (HMAC-SHA256) antes de procesar órdenes, evitando falsificaciones.
- **Idempotencia:** Se previene el reprocesamiento de eventos de pago (evita que un evento viejo atrase o dañe la suscripción de un usuario).
- **Protección de Datos:** Los usuarios **no pueden** alterar sus campos `plan`, `expiresAt`, `isTrial`, `aiCallsThisMonth` directamente en la base de datos (firestore.rules).
- **Manejo del Ciclo de Vida:** Los estados `subscription_created`, `subscription_updated` (cancelaciones y expiraciones) y `subscription_payment_success` están integrados correctamente para dar o quitar acceso cuando corresponda.

---

## 3. Próxima Implementación: Notificación de Vencimiento

Para mejorar la retención y la experiencia de usuario, se agregará un sistema de **Notificaciones de Vencimiento de 7 Días**. 

**¿Qué hará exactamente?**
- Al ingresar a la aplicación, el sistema evaluará si el usuario tiene una suscripción paga (`expiresAt`) o una prueba gratuita (`trialEndsAt`) que venza en **7 días o menos**.
- Mostrará una alerta (tipo "Toast" / Banner no bloqueante) amigable indicando los días restantes, con un llamado a la acción para renovar o adquirir el plan premium.
- Para no ser intrusiva, esta notificación se mostrará solo una vez por sesión (o por día) guardando un flag en `sessionStorage`.

*(Ver el Plan de Implementación para el detalle técnico de esta nueva función).*
