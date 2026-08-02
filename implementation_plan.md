# Implementado: Unificación de Configuración de Calificaciones

## Resumen de Cambios

Se reemplazó el patrón frágil de `localStorage` + evento `'storage'` por un **React Context** con persistencia global a localStorage y Firestore.

### Archivos Creados

- **`src/contexts/GradeSettingsContext.tsx`** — Contexto que provee `viewMode`, `calculationMode`, `setViewMode` y `setCalculationMode` a toda la app. Persiste automáticamente a localStorage (síncrono) y Firestore (`userSettings/{userId}`, asíncrono). Se inicializa desde localStorage y hace merge con Firestore al cargar.

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/App.tsx:63` | Envuelve `<CuadernoApp>` con `<GradeSettingsProvider>` |
| `src/components/SettingsModal.tsx` | Reemplaza `useState` + `handleUpdateViewMode/CalculationMode` por `useGradeSettings()` |
| `src/components/ProgressWidget.tsx` | Elimina `refreshKey` + listener `'storage'`; usa `useGradeSettings()` |
| `src/components/GradesSummary.tsx` | Elimina estado local + listener; usa `useGradeSettings()` |
| `src/components/ModuleSummaryModal.tsx` | Elimina estado local + listener; usa `useGradeSettings()` |

### No Requirió Cambios

- **`src/lib/gradeCalculator.ts`** — Ya estaba correcto y centralizado.
- **`src/lib/exportUtils.ts`** — Lee de localStorage directamente (función utilitaria, no componente React).
- **`src/components/GradesTab.tsx`** — Ya usaba `viewMode`/`calculationMode` de forma correcta.

### Persistencia

- **localStorage**: escritura síncrona inmediata en `setViewMode`/`setCalculationMode`.
- **Firestore**: documento `userSettings/{userId}` con campos `gradingViewMode` y `gradingCalculationMode`. Se escribe asincrónicamente en cada cambio.
- **Carga**: al montar el provider, se lee localStorage primero (instántaneo) y luego Firestore para sincronizar (merge).

### Verificación

`npm run lint` (`tsc --noEmit`) pasa sin errores.
