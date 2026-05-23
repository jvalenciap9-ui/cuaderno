# 🧑‍🏫 EdiAgil – Cuaderno de calificaciones y asistencia con IA

**EdiAgil** es una aplicación para docentes que facilita la gestión de cursos, estudiantes, calificaciones, asistencia e informes automáticos usando inteligencia artificial (Gemini). Funciona offline gracias a IndexedDB y es multiplataforma (web, escritorio, móvil).

## ✨ Características principales

- 📚 **Gestión de cursos** (CRUD)
- 👩‍🎓 **Registro de estudiantes** por curso
- 📊 **Calificaciones con pesos** y cálculo automático de promedios
- ✅ **Toma de asistencia diaria** (presente/ausente/tarde/justificado)
- 🤖 **Informes automáticos con IA** (sugerencias de mejora, análisis de rendimiento)
- 📅 **Calendario interactivo** con eventos del día
- 📎 **Importación de planificaciones** desde Excel, PDF o Word
- 🧠 **Planificación AI** – genera horarios y pruebas automáticamente
- 💾 **100% offline** – los datos se guardan localmente en IndexedDB
- 🔒 **Privacidad total** – sin dependencia de la nube

## 🛠️ Tecnologías

- React 19 + TypeScript
- Vite
- Dexie (IndexedDB)
- Tailwind CSS 4
- Google Gemini AI
- Lucide React + Motion (animaciones)
- Recharts (gráficos)

## 🚀 Ejecutar localmente

### Requisitos
- Node.js 20+ (recomendado)

### Pasos

```bash
# 1. Clonar el repositorio
git clone https://github.com/TU_USUARIO/cuaderno.git
cd cuaderno

# 2. Instalar dependencias
npm install

# 3. Crear archivo .env.local con tu clave de Gemini
echo "VITE_GEMINI_API_KEY=tu_clave_aqui" > .env.local

# 4. Ejecutar en modo desarrollo
npm run dev
