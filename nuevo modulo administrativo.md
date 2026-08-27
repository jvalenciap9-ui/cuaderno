# Contexto del Proyecto: EdiAgil

Eres un desarrollador experto en React, TypeScript, Firebase y Cloud Functions. Tu misión es implementar un **módulo administrativo** para el plan institucional de EdiAgil, que permita a un usuario con rol de **Administrador** tener una visión consolidada de toda la institución en modo **solo lectura** y exportar informes detallados en Excel por cada docente.

## Tecnologías actuales
- Frontend: React 19 + TypeScript + Vite + Tailwind CSS 4
- Base de datos local: Dexie (IndexedDB) – offline-first
- Base de datos en nube: Firebase Firestore
- Autenticación: Firebase Auth (Email/Password + Google)
- Backend: Firebase Cloud Functions (v2) con Node.js 22
- Pasarela de pagos: Lemon Squeezy (ya integrada)

## Estructura de datos actual en Firestore
- `subjects` → { userId, name, color, teacher, schedule, plan, createdAt }
- `students` → { userId, subjectId, cedula, firstName, lastName, gender }
- `evaluations` → { userId, subjectId, moduleId, title, maxScore, date, type }
- `grades` → { userId, subjectId, evaluationId, studentId, score }
- `attendance` → { userId, subjectId, moduleId, studentId, date, status }
- `users` → { uid, email, displayName, plan, aiCallsThisMonth, expiresAt, ... }

## Requisitos del nuevo módulo administrativo

### 1. Nuevas colecciones en Firestore
- **`institutions`** → { id, name, adminId (UID del administrador), createdAt, subscription: { plan: 'institutional', docentes: 30, expiresAt } }
- **`institutionUsers`** → { id, userId (UID del docente), role: 'admin' | 'teacher', institutionId, joinedAt }

### 2. Dashboard Administrativo (solo lectura)
El administrador debe ver:
- Total de docentes (usuarios con rol 'teacher' en su institución)
- Total de asignaturas (todas las asignaturas de los docentes de su institución)
- Total de alumnos (todos los estudiantes de las asignaturas de su institución)
- Asistencia global (promedio de asistencia de toda la institución)
- Lista de docentes con: nombre, email, número de asignaturas, total de alumnos, asistencia promedio
- Lista de asignaturas con: nombre, docente asignado, número de alumnos, asistencia promedio
- Gráficos simples (pueden ser con Recharts, que ya está en el proyecto) mostrando asistencia y calificaciones promedio por docente.

### 3. Vistas detalladas por docente
Al hacer clic en un docente, el administrador debe poder ver:
- Todas las asignaturas que imparte
- Lista de alumnos de cada asignatura (con cédula, nombres)
- Calificaciones de cada alumno en todas las evaluaciones (solo lectura, sin campos de edición)
- Asistencia de cada alumno (con porcentaje y estado por fecha)
- Un resumen estadístico (promedio de calificaciones, % de asistencia global)

### 4. Exportación a Excel por docente
El administrador debe poder exportar un **informe completo en Excel (.xlsx)** para cada docente, que incluya:
- **Hoja 1: Resumen del docente** → nombre, email, total de asignaturas, total de alumnos, período
- **Hoja 2: Asignaturas y alumnos** → lista de asignaturas con sus alumnos (nombres, cédula)
- **Hoja 3: Calificaciones** → tabla con: asignatura, evaluación, alumno, nota, promedio
- **Hoja 4: Asistencia** → tabla con: asignatura, alumno, fecha, estado (presente/ausente/tarde/justificado), % de asistencia
- Todas las hojas deben tener **formato profesional** (encabezados en negrita, bordes, colores suaves) y ser fácilmente editables por el administrador después de la descarga (archivo .xlsx estándar).

### 5. Permisos de seguridad
- **Los administradores solo pueden leer datos**, nunca escribir ni modificar.
- Los administradores solo ven datos de su propia institución.
- Los docentes no ven el módulo administrativo.
- Las reglas de Firestore deben reflejar esto.

### 6. Interfaz de usuario
- El módulo administrativo debe ser accesible desde un nuevo botón en el menú lateral (solo visible para administradores).
- El diseño debe seguir la identidad visual de EdiAgil (Verde Menta #F0F7F4, Azul Petróleo #1A3C40, Amarillo para destacados, Gradientes Azul Cielo para interactividad).
- Debe ser responsive (funcionar en escritorio, tablet y móvil).
- Debe integrarse con el sistema de autenticación existente (usar el mismo contexto `useAuth`).

---

## Tareas específicas para el asistente

### A. Backend (Cloud Functions)

1. **Crear la función `onUserSignUp`** para asignar rol 'teacher' por defecto a nuevos usuarios (si no están en `institutionUsers`, se crean con rol 'teacher').
2. **Crear la función `createInstitution`** (solo para administradores) que cree un documento en `institutions` y asigne el rol 'admin' al usuario creador.
3. **Crear los siguientes endpoints HTTP (onRequest):**
   - `GET /api/admin/dashboard` → retorna métricas consolidadas (totales, listas de docentes/asignaturas con stats, asistencia global)
   - `GET /api/admin/teachers` → lista todos los docentes de la institución con sus stats (asignaturas, alumnos, asistencia promedio)
   - `GET /api/admin/teacher/:teacherId` → retorna datos detallados del docente (asignaturas, alumnos, calificaciones, asistencia)
   - `GET /api/admin/export/:teacherId` → genera y retorna un buffer de Excel con el informe completo del docente
   - `GET /api/admin/subjects` → lista todas las asignaturas de la institución con stats
   - `GET /api/admin/attendance/:teacherId` → retorna asistencia por docente
   - `GET /api/admin/grades/:teacherId` → retorna calificaciones por docente

4. **Validar en cada endpoint** que el usuario esté autenticado y tenga rol 'admin' en `institutionUsers` (excepto el endpoint de creación de institución).

### B. Reglas de Firestore (`firestore.rules`)

Actualizar las reglas para:
- Permitir `read` a administradores en todas las colecciones (`subjects`, `students`, `grades`, `attendance`, `evaluations`, `users`) siempre que el documento pertenezca a un docente de su misma institución.
- **Denegar `write` a administradores** en todas las colecciones de datos docentes.
- Mantener las reglas existentes para docentes (pueden leer/escribir sus propios datos).

### C. Frontend (React)

1. **Crear los siguientes componentes:**
   - `AdminDashboard.tsx` → página principal del módulo administrativo (tarjetas de métricas, gráficos, lista de docentes)
   - `AdminTeachersList.tsx` → tabla de docentes con filtros y búsqueda
   - `AdminTeacherDetail.tsx` → vista detallada de un docente con tabs para asignaturas, alumnos, calificaciones, asistencia
   - `AdminExportButton.tsx` → botón que descarga el informe Excel para el docente actual
   - `AdminAttendanceView.tsx` → vista de asistencia por docente/asignatura
   - `AdminGradesView.tsx` → vista de calificaciones por docente/asignatura

2. **Actualizar la navegación** (`App.tsx` o `Sidebar.tsx`) para mostrar un enlace al módulo administrativo solo si el usuario tiene rol 'admin'.

3. **Conectar los componentes a los endpoints** mediante `fetch` o `axios`, pasando el token de autenticación en el header `Authorization: Bearer <idToken>`.

4. **Usar Recharts** para los gráficos (asistencia por docente, distribución de alumnos, etc.)

### D. Función de Exportación a Excel

- Usar la librería `xlsx` (ya instalada en el proyecto) para generar el archivo.
- Crear múltiples hojas como se describe arriba.
- Aplicar estilos básicos (negritas, bordes, colores) usando las capacidades de `xlsx` (o `exceljs` si es más adecuado).
- El archivo debe llamarse `Informe_Docente_Nombre_YYYY-MM-DD.xlsx`.

### E. Seguridad y Validaciones

- Todos los endpoints deben verificar que el usuario administrador pertenece a la misma institución que los datos que intenta leer.
- Limitar el número de registros devueltos (paginación) si una institución tiene muchos docentes/alumnos (por ejemplo, límite de 500 por consulta).
- Registrar en `console.log` o en una colección de logs las exportaciones realizadas por administradores (opcional).

---

## Entregables esperados

- Código completo de las Cloud Functions (nuevos endpoints).
- Nuevas reglas de Firestore.
- Código de los componentes React (páginas y subcomponentes).
- Instrucciones para ejecutar migraciones (crear colecciones y asignar roles iniciales).
- Explicación de cómo probar el módulo administrativo con usuarios de prueba.

## Notas adicionales

- La aplicación ya usa `useCustomCollectionData` para consultas a Firestore; los componentes administrativos pueden usar consultas directas con `useEffect` y `getDocs` o `useCustomCollectionData` con filtros adecuados.
- La exportación a Excel debe manejar grandes volúmenes de datos (hasta 30 docentes × 30 alumnos cada uno ≈ 900 alumnos) sin bloquear la interfaz. Se recomienda usar un spinner de carga durante la generación.
- El diseño de los componentes debe ser coherente con el resto de la aplicación (usar los mismos estilos y componentes reutilizables como `Button`, `Card`, `Modal`, etc.).
- No olvides manejar estados de carga y errores (mostrar toasts con `showToast`).

Implementa estas funcionalidades siguiendo el orden de prioridad: primero el backend y las reglas de seguridad, luego el frontend, y finalmente la exportación a Excel. Asegúrate de probar cada parte antes de continuar.

Si tienes dudas sobre algún aspecto técnico (por ejemplo, cómo obtener el `uid` del usuario autenticado en Cloud Functions o cómo estructurar una consulta compleja en Firestore), consulta la documentación de Firebase o pregunta.

¡Comienza con la implementación ahora!