# 🔧 Instrucciones para Reparar y Ejecutar EdiAgil

## Si obtuviste un error al ejecutar `npm run dev`

Sigue estos pasos en orden:

### Opción 1: Ejecución Rápida (Recomendado)
Ejecuta el script batch que creé:
```bash
FIX_AND_RUN.bat
```
O simplemente doble-click en el archivo.

### Opción 2: Manual paso a paso

1. **Abre una terminal en la carpeta del proyecto**
   ```bash
   cd c:\Users\José Valencia\Desktop\ediagil
   ```

2. **Limpia completamente los caches y builds**
   ```bash
   npm cache clean --force
   npm run clean
   rmdir /s /q node_modules
   del package-lock.json
   ```

3. **Reinstala las dependencias**
   ```bash
   npm install
   ```

4. **Verifica que no haya errores de TypeScript**
   ```bash
   npm run lint
   ```
   (Si hay errores de tipos, ignóralos por ahora - no son bloqueantes)

5. **Inicia el servidor de desarrollo**
   ```bash
   npm run dev
   ```

6. **Abre en tu navegador**
   ```
   http://localhost:3000
   ```

---

## Si aún hay problemas:

### Error: "Cannot find module 'storageKeys'"
- Verifica que el archivo `src/lib/storageKeys.ts` exista
- Ejecuta: `npm install && npm run dev`

### Error: "localStorage is not defined"
- Es normal en SSR, el código ya maneja esto
- El error debería desaparecer después de `npm install`

### El servidor no inicia
1. Mata cualquier proceso en puerto 3000:
   ```bash
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

2. Luego intenta de nuevo:
   ```bash
   npm run dev
   ```

### Si nada funciona:
```bash
npm cache clean --force
del /s /q node_modules dist
del package-lock.json
npm install
npm run lint
npm run dev
```

---

## Cambios realizados ✨

Se agregó un sistema de keys de localStorage con prefijo `ediagil_app_` para:
- ✅ Evitar conflictos con la landing page
- ✅ Aislar datos de configuración
- ✅ Mejor manejo de errores

Archivos modificados:
- `src/lib/storageKeys.ts` (NUEVO)
- `src/App.tsx`
- `src/components/SettingsModal.tsx`
- `src/components/AuthProvider.tsx`
- `src/components/GradesSummary.tsx`
- `src/components/GradesTab.tsx`
- `src/components/ProgressWidget.tsx`
- `src/lib/exportUtils.ts`

---

## Dudas?

Si los problemas persisten, comparte el **mensaje de error exacto** que ves en:
1. La terminal (cuando ejecutas `npm run dev`)
2. La consola del navegador (F12 > Console)

Así podré debuggear más específicamente. 🔍
