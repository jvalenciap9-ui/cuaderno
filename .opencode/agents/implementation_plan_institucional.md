# Plan de Implementación: Actualización de Características del Plan Institucional

Este plan tiene como objetivo actualizar la lista de características y beneficios del **Plan Institucional** reflejados en la interfaz de la aplicación (`SettingsModal.tsx` y `LandingPage.tsx`) con las funciones reales que ya han sido desarrolladas y verificadas (como la personalización temática, alertas de riesgo, control de turnos y métricas de tendencias).

## Cambios Propuestos

### 1. Actualización de Características en la Landing Page

#### [MODIFY] [LandingPage.tsx](file:///c:/Users/Jos%C3%A9%20Valencia/Desktop/ediagil/src/components/LandingPage.tsx)
Se actualizará el array de `features` para el plan `school` (Institucional), agregando las características avanzadas reales implementadas:
- Personalización de Logo y Color Primario
- Alertas de Estudiantes en Riesgo (Académico/Asistencia)
- Control de Horarios y Turnos Escolares
- Detección de Discrepancias y Duplicados
- Gráficos de Tendencias y Retención

---

### 2. Actualización de Características en el Modal de Configuración (Panel de Planes)

#### [MODIFY] [SettingsModal.tsx](file:///c:/Users/Jos%C3%A9%20Valencia/Desktop/ediagil/src/components/SettingsModal.tsx)
Se actualizarán los elementos `<li>` del listado del plan `school` (Institucional):
- Reemplazar "Onboarding personalizado" por "Logo y colores personalizados" (o añadirlo como beneficio crítico).
- Añadir "Horarios y Turnos escolares".
- Añadir "Detección de Discrepancias".
- Añadir "Gráficos de Tendencias y Retención".
- Añadir "Monitoreo de Alumnos en Riesgo".

## Plan de Verificación

### Pruebas Manuales
1. Abrir la página principal (Landing Page) y revisar la lista de características del plan Institucional.
2. Ingresar a la aplicación, abrir el modal de Configuración, seleccionar la pestaña de Suscripciones (Facturación) y comprobar que la columna del Plan Institucional ahora liste detalladamente todas las funciones administrativas avanzadas reales.
