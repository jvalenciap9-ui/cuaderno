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
```

## 💎 Suscripción Premium y Monetización

EdiAgil ofrece un modelo **Freemium** diseñado para adaptarse a las necesidades de profesores individuales e instituciones:

### 🌟 Planes Disponibles

1. **Plan Gratis ($0/mes)**
   - Hasta 3 asignaturas simultáneas.
   - Apuntes y registro de notas/asistencia guardados localmente.
   - Hasta 50 consultas de IA mensuales.
   - Soporte a través de la comunidad.

2. **Plan Premium Pro ($4.99/mes)**
   - Asignaturas y apuntes **ilimitados**.
   - Sincronización en tiempo real multidispositivo mediante **Cloud Firestore**.
   - Hasta 500 consultas mensuales de IA Avanzada (Gemini 2.5 Pro).
   - Generación ilimitada de planificaciones, horarios y exámenes.
   - Soporte prioritario por correo electrónico.

3. **Plan Institucional ($99.99/año)**
   - Incluye **30 licencias anuales** Pro para docentes del centro educativo.
   - **Panel Administrativo** centralizado para coordinadores y directores escolares.
   - Sincronización en la nube institucional.
   - Soporte 24/7 y asistencia en onboarding para profesores.

### 💖 Cómo apoyar el proyecto (Monetización)

El proyecto soporta múltiples canales de pago seguros integrados con el backend de Firebase:
- **Pasarela Global (Lemon Squeezy):** Haz clic en "Gestionar Plan" en la pestaña de Ajustes para pagar con tarjeta internacional.
- **GitHub Sponsors:** Puedes patrocinar este proyecto en GitHub. El sistema detectará automáticamente tu patrocinio y activará tu cuenta Pro sin comisiones intermedias.
- **Canje de Códigos de Licencia:** Si pagas por transferencia local (Yape/Mercado Pago) o compras en lote para tu institución, el administrador te entregará un código de activación único que puedes canjear desde la pestaña de Suscripción para desbloquear tu cuenta Pro por un año.
