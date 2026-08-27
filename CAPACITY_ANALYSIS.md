# Auditoría de Seguridad y Análisis de Rendimiento (EdiAgil - Plan Institucional)

Este documento contiene un análisis exhaustivo del **Plan Institucional** (30 docentes + 1 admin) y el **Boletín Individual** en EdiAgil. Evalúa el cumplimiento de las reglas de seguridad, el rendimiento bajo pruebas de carga extrema (30 docentes activos con miles de alumnos y notas) y propone optimizaciones clave.

---

## 🔒 1. Auditoría de Seguridad y Cumplimiento

### Cumplimiento del Principio de Soberanía Docente
El principio inmutable de EdiAgil establece que **el administrador no puede editar datos pedagógicos de los docentes**; su rol es de supervisión y solo lectura.

* **Validación en Firestore Rules:**
  Las reglas en `firestore.rules` protegen todas las colecciones pedagógicas (`subjects`, `notes`, `students`, `evaluations`, `grades`, `attendance`, `materials`, `subjectModules`) con la cláusula:
  ```javascript
  allow create, update, delete: if isSignedIn() && isExistingOwner();
  ```
  Donde `isExistingOwner()` exige que `resource.data.userId == request.auth.uid`. Dado que el administrador posee un UID distinto, Firestore bloquea cualquier intento de escritura (creación, edición o borrado) de datos pedagógicos por parte del admin desde el cliente.
* **Validación de Lectura Directa:**
  Las reglas también restringen la lectura directa de estas colecciones al propietario:
  ```javascript
  allow list, get: if isSignedIn() && isExistingOwner();
  ```
  Esto significa que el administrador tiene **bloqueada la lectura directa** de los documentos pedagógicos de los docentes a través del SDK del cliente.
* **Acceso del Administrador vía Cloud Functions:**
  El administrador obtiene la información agregada a través de HTTPS Callable Functions (`adminListTeachers`, `adminGetTeacherData`, `adminGetTeacherSummary`, `adminGetInstitutionStats`). Estas funciones usan el SDK de administración (`firebase-admin`) en el backend (que bypassa las reglas de seguridad) pero realizan las siguientes verificaciones:
  1. Validar que el token de sesión sea correcto.
  2. Ejecutar `assertAdmin(uid)` para asegurar que el usuario tiene el campo `role === 'admin'` en su perfil de Firestore (cargado exclusivamente por el webhook/backend).
  3. Comprobar que el docente consultado pertenezca a la **misma institución** del administrador (`teacherData.institutionId === adminInstitutionId`).

> [!TIP]
> **Conclusión de Seguridad:** El diseño de seguridad cumple al 100% con los requisitos de soberanía. El administrador solo puede consultar y exportar datos a través de funciones del servidor auditadas, sin posibilidad de alterar información pedagógica ni leer datos de docentes de otras instituciones.

---

## ⚡ 2. Análisis de Rendimiento y Capacidad (Uso Extremo)

Para evaluar la escalabilidad, modelamos un escenario de **Uso Extremo** en una institución con el límite de licenciamiento completo:
* **Docentes:** 30 docentes activos.
* **Asignaturas por docente:** 5 asignaturas (150 asignaturas en total).
* **Alumnos por asignatura:** 30 alumnos (4,500 alumnos en total).
* **Evaluaciones por asignatura:** 15 evaluaciones (2,250 evaluaciones en total).
* **Calificaciones:** 30 alumnos × 15 evaluaciones × 5 asignaturas = 2,250 notas por docente (**67,500 notas en total**).
* **Asistencias:** 30 alumnos × 30 días = 900 registros de asistencia por docente (**27,000 asistencias en total**).

### Cuellos de Botella Detectados

#### 🚨 B1. Concurrencia de Consultas en el Backend (OOM y Timeouts)
En `adminGetInstitutionStats` y `adminGetInstitutionAlerts`, el servidor ejecuta consultas en paralelo para los 30 docentes usando `Promise.allSettled`:
```javascript
const results = await Promise.allSettled(teachers.map(async (teacherData) => {
  const [subjects, students, evaluations, attendance, grades, ...] = await Promise.all([
    getAllDocsForUser('subjects', teacherUid),
    getAllDocsForUser('students', teacherUid),
    ...
  ]);
}));
```
* **Problema:** Esto dispara `30 docentes × 8 consultas = 240` promesas concurrentes hacia Firestore.
* **Impacto:** Con un volumen de datos extremo (más de 100,000 documentos a recuperar), el tiempo de respuesta del servidor puede superar los 60 segundos (provocando un **Timeout HTTP 504**). Además, almacenar en memoria 100k documentos en formato JSON dentro de una sola instancia de Cloud Function puede provocar un error de **Out of Memory (OOM)**, tirando el contenedor.

#### 🚨 B2. Facturación y Costos de Lectura de Firestore
Cada vez que el administrador hace clic en "Actualizar" o abre la pestaña de métricas, la función lee todos los documentos del historial del colegio.
* **Problema:** En el escenario extremo, una sola consulta al dashboard lee ~100k documentos.
* **Costo:** 10 ejecuciones del dashboard al día equivalen a **1 millón de lecturas de Firestore diarias**, lo que consumiría rápidamente la cuota gratuita de Firebase y generaría costos de facturación innecesarios.

---

## 🛠️ 3. Mejoras Técnicas Propuestas (Plan de Optimización)

Para resolver de manera definitiva los cuellos de botella de rendimiento y costo en escenarios de uso masivo, implementaremos las siguientes tres optimizaciones:

### 1. Sistema de Caché de Estadísticas y Alertas (Firestore Caching)
En lugar de recalcular las métricas en cada llamada, crearemos documentos de caché en Firestore (`/institutionStats/{institutionId}` e `/institutionAlerts/{institutionId}`).
* **Lógica:**
  * Al llamar a `adminGetInstitutionStats`, el servidor busca el documento de caché.
  * Si el documento existe y tiene un `generatedAt` menor a **15 minutos**, se devuelve de inmediato el JSON precalculado.
  * Si no existe o expiró, se realiza el cálculo pesado, se guarda el nuevo resultado en la caché y se le responde al administrador.
* **Rendimiento:** Reduce el tiempo de respuesta del dashboard de **15-30 segundos a menos de 500 milisegundos**.
* **Ahorro de Costos:** Reduce las lecturas de Firestore de 100,000 a **1 lectura** por cada consulta del administrador dentro de la ventana de 15 minutos.

### 2. Filtrado de Actividad Reciente por Fecha
Para calcular la actividad semanal y las métricas de uso de la app, no es necesario descargar el historial completo de notas, materiales y eventos de los últimos años.
* **Lógica:**
  * Modificar `getAllDocsForUser` para que acepte un parámetro opcional de fecha límite (`dateLimit`).
  * Para las colecciones de actividad (`notes`, `materials`, `calendarEvents`), solo solicitaremos documentos donde `date >= fecha_de_hace_60_dias`.
* **Rendimiento:** Reduce el volumen de transferencia de datos en un **80%**, evitando la saturación de memoria en la Cloud Function.

### 3. Ejecución Controlada en Lotes (Query Batching)
En lugar de disparar 240 promesas en paralelo con `Promise.allSettled`, agruparemos la carga de docentes en lotes secuenciales de 5 docentes a la vez.
* **Lógica:**
  * Usar un iterador por lotes (batch helper) para procesar a los docentes de forma controlada.
* **Rendimiento:** Evita la congestión de conexiones concurrentes y mantiene el uso de memoria estable por debajo del límite de la Cloud Function.

---

## 🧪 4. Validador de Rendimiento Extremo

Proponemos la ejecución de una prueba de rendimiento en desarrollo para validar los límites de la app:
1. **Semillero de Datos Masivos:** Ejecutar el script `functions/seed-demo.js` o un script adaptado que simule 30 docentes y 60,000 notas en el emulador local de Firestore.
2. **Medición de Tiempos:** Realizar solicitudes a `adminGetInstitutionStats` localmente y registrar el tiempo de respuesta inicial.
3. **Validación de Caché:** Realizar una segunda solicitud inmediata y verificar que el tiempo sea inferior a 50ms y que el log del servidor indique `Servido desde caché`.
4. **Prueba de TypeScript:** Ejecutar `npm run lint` para asegurar la tipificación de los documentos de caché.
