import { useState } from 'react';
import { motion } from 'motion/react';
import {
  GraduationCap,
  Sparkles,
  LayoutDashboard,
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileDown,
  ArrowRight,
  Menu,
  X,
  Star,
  ShieldCheck,
  Zap,
  Quote,
  CheckCircle2,
  Users,
  Infinity as InfinityIcon,
  Shield,
  Mail,
} from 'lucide-react';
import { navigate } from '../lib/router';
import {
  getPublicPlans,
  getPlanAccentStyles,
  getPlan,
  type PricingPlan,
} from '../lib/pricing';

const NAV_LINKS = [
  { href: '#caracteristicas', label: 'Características' },
  { href: '#precios', label: 'Precios' },
  { href: '#testimonios', label: 'Testimonios' },
];

const FEATURES = [
  {
    icon: LayoutDashboard,
    title: 'Gestión de clases y asignaturas',
    desc: 'Organiza cursos, módulos y materiales en un único cuaderno digital siempre sincronizado con la nube.',
  },
  {
    icon: BarChart3,
    title: 'Calificaciones con ponderaciones',
    desc: 'Configura pesos por tipo de evaluación y obtén promedios finales calculados al instante y sin errores.',
  },
  {
    icon: ClipboardList,
    title: 'Asistencia inteligente',
    desc: 'Registra la asistencia con un toque y recibe alertas automáticas cuando un estudiante acumula ausencias.',
  },
  {
    icon: CalendarDays,
    title: 'Calendario por asignatura',
    desc: 'Planifica evaluaciones, eventos y fechas clave para no perder de vista nada durante el período.',
  },
  {
    icon: Sparkles,
    title: 'Apuntes con IA',
    desc: 'Genera syllabi, resúmenes y apuntes estructurados con inteligencia artificial en cuestión de segundos.',
  },
  {
    icon: FileDown,
    title: 'Exportación y respaldo',
    desc: 'Exporta reportes a PDF/Excel y haz respaldos completos de tus datos para llevarlos a donde quieras.',
  },
];

const TESTIMONIALS = [
  {
    name: 'María Fernanda López',
    role: 'Docente de Matemáticas · Caracas, VE',
    quote: 'Dejé los cuadernos físicos por completo. Las ponderaciones automáticas me ahorran horas cada semana y mis estudiantes siempre saben su promedio.',
  },
  {
    name: 'Carlos Andrés Méndez',
    role: 'Profesor de Física · Medellín, CO',
    quote: 'La IA me genera los syllabi y los apuntes estructurados en segundos. Mi planificación pasó de tomar días a tomar minutos.',
  },
  {
    name: 'Laura Beatriz Rojas',
    role: 'Coordinadora Académica · Santiago, CL',
    quote: 'El plan institucional nos permitió unificar la gestión de 30 docentes con reportes centralizados. La experiencia fue impecable.',
  },
];

function CheckIcon({ included }: { included: boolean }) {
  if (included) return <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />;
  return <X className="w-4 h-4 text-neutral-300 shrink-0" />;
}

export function LandingPage({ pathname = '/' }: { pathname?: string }) {
  const [mobileOpen, setMobileOpen] = useState(false);

  // --- Renderizado de Landing Page detallada de Premium Pro ---
  if (pathname === '/planes/premium-pro') {
    const proPlan = getPlan('pro');
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col justify-between py-12 px-6">
        <div className="max-w-4xl mx-auto w-full bg-white rounded-[3rem] border border-neutral-100 p-8 md:p-16 shadow-2xl shadow-neutral-100/50 space-y-12">
          {/* Cabecera */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-neutral-100">
            <div>
              <button 
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-500 mb-4 transition-all"
              >
                ← Volver a Inicio
              </button>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight text-neutral-900">
                Premium Pro
              </h1>
              <p className="text-neutral-500 font-medium mt-2">
                Maximiza tu rendimiento docente con el cuaderno digital más potente.
              </p>
            </div>
            <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 px-6 py-4 rounded-[2rem] text-center shrink-0 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-emerald-600 mb-1">Facturación Anual</p>
              <p className="text-3xl font-black">${proPlan.price.toFixed(2)}<span className="text-xs text-neutral-400">{proPlan.period}</span></p>
              <p className="text-[9px] font-bold text-neutral-400 mt-1">Equivale a menos de US$1/mes · facturado anualmente</p>
            </div>
          </div>

          {/* Características en profundidad */}
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">📊 Calificaciones Avanzadas</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Configura ponderaciones personalizadas por categorías, exámenes o proyectos. Deja que EdiAgil calcule automáticamente la nota final de tus alumnos basándose en tu propio criterio pedagógico.
              </p>
            </div>
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">⚡ Syllabus AI Ilimitado</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Genera en segundos planes de estudio y estructuras de módulos adaptadas a la asignatura utilizando el motor inteligente de Gemini. Diseña y distribuye los contenidos de manera ágil.
              </p>
            </div>
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">🤖 2.000 Consultas IA/mes</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Asistente personal con inteligencia artificial para la redacción de apuntes, resúmenes, retroalimentación a estudiantes y optimización de materiales directamente desde tu cuaderno.
              </p>
            </div>
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">📥 Exportación y Respaldo</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Descarga de informes de calificaciones e inasistencias listos en formatos Excel y PDF para facilitar tus reportes y entregas administrativas institucionales.
              </p>
            </div>
          </div>

          {/* Tabla comparativa Gratis vs Pro */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-neutral-100">
                  <th className="text-left py-3 pr-6 font-black text-neutral-900">Característica</th>
                  <th className="text-center py-3 px-4 font-black text-neutral-400 whitespace-nowrap">Plan Gratis</th>
                  <th className="text-center py-3 px-4 font-black text-emerald-700 whitespace-nowrap">✦ Premium Pro</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const freePlan = getPlan('free');
                  const proPlanData = getPlan('pro');
                  const allFeatures = Array.from(
                    new Set([...freePlan.features.map(f => f.text), ...proPlanData.features.map(f => f.text)])
                  );
                  return allFeatures.map(featureText => {
                    const inFree = freePlan.features.find(f => f.text === featureText)?.included ?? false;
                    const inPro = proPlanData.features.find(f => f.text === featureText)?.included ?? false;
                    return (
                      <tr key={featureText} className="border-b border-neutral-50 hover:bg-neutral-50 transition-colors">
                        <td className="py-3 pr-6 font-semibold text-neutral-700">{featureText}</td>
                        <td className="text-center py-3 px-4">
                          {inFree ? <span className="text-indigo-500 font-black">✓</span> : <span className="text-neutral-300 font-black">✗</span>}
                        </td>
                        <td className="text-center py-3 px-4">
                          {inPro ? <span className="text-emerald-600 font-black">✓</span> : <span className="text-neutral-300 font-black">✗</span>}
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>

          {/* Garantía */}
          <div className="p-6 bg-emerald-50 border border-emerald-100 rounded-3xl flex items-start gap-4">
            <ShieldCheck className="w-8 h-8 text-emerald-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-black text-emerald-900 text-sm uppercase tracking-wide">Garantía 30 días</h4>
              <p className="text-xs text-emerald-800 font-medium leading-relaxed">
                Si en los primeros 30 días no mejoras tu productividad docente, te devolvemos el dinero — sin preguntas.
              </p>
            </div>
          </div>

          {/* Llamado a la Acción (CTA) */}
          <div className="pt-8 border-t border-neutral-100 flex flex-col items-center gap-4 text-center">
            <button
              onClick={() => navigate('/login?mode=signup&plan=pro')}
              className="px-10 py-5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl shadow-emerald-500/20 active:scale-95 transition-all w-full md:w-auto"
            >
              {proPlan.ctaLabel} · US${proPlan.price.toFixed(2)}{proPlan.period}
            </button>
            <p className="text-xs text-neutral-400 font-semibold">
              Sin permanencia · Cancela cuando quieras
            </p>
          </div>
        </div>
      </div>
    );
  }

// --- Renderizado de Landing Page detallada de plan Institucional ---
  if (pathname === '/planes/institucional') {
    const schoolPlan = getPlan('school');
    return (
      <div className="min-h-screen bg-neutral-50 text-neutral-900 flex flex-col justify-between py-12 px-6">
        <div className="max-w-4xl mx-auto w-full bg-white rounded-[3rem] border border-neutral-100 p-8 md:p-16 shadow-2xl shadow-neutral-100/50 space-y-12">
          {/* Cabecera */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-8 border-b border-neutral-100">
            <div>
              <button 
                onClick={() => navigate('/')}
                className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-500 mb-4 transition-all"
              >
                ← Volver a Inicio
              </button>
              <h1 className="text-4xl md:text-5xl font-black tracking-tight text-neutral-900">
                Plan Institucional
              </h1>
              <p className="text-neutral-500 font-medium mt-2">
                Unifica, centraliza y personaliza la experiencia académica de todo tu colegio o departamento.
              </p>
            </div>
            <div className="bg-blue-50 text-blue-800 border border-blue-100 px-6 py-4 rounded-[2rem] text-center shrink-0 shadow-sm">
              <p className="text-[10px] font-black uppercase tracking-widest text-blue-600 mb-1">Facturación Anual</p>
              <p className="text-3xl font-black">${schoolPlan.price.toFixed(2)}<span className="text-xs text-neutral-400">{schoolPlan.period}</span></p>
              {schoolPlan.foundersPromo && (
                <p className="text-[9px] font-bold text-amber-600 mt-1">Promoción Fundadores: ${schoolPlan.foundersPromo.firstYearPrice.toFixed(2)} primer año</p>
              )}
            </div>
          </div>

          {/* Banner de Promoción Fundadores */}
          {schoolPlan.foundersPromo && (
            <div className="p-6 bg-amber-50 border-2 border-amber-300 rounded-3xl flex items-start gap-4 shadow-lg shadow-amber-100/50">
              <div className="text-3xl mt-0.5 animate-bounce">⚡</div>
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="font-black text-amber-900 text-sm uppercase tracking-wide">Oferta por tiempo limitado · Promoción Fundadores</h4>
                  <span className="inline-block bg-amber-200 text-amber-900 text-[8px] font-black uppercase tracking-widest px-2 py-1 rounded-full">Cupos limitados</span>
                </div>
                <p className="text-2xl font-black text-amber-900">
                  US${schoolPlan.foundersPromo.firstYearPrice.toFixed(2)}
                  <span className="text-sm font-bold text-amber-700"> primer año</span>
                </p>
                <p className="text-xs text-amber-800 font-bold">
                  <strong>Ahorra US${(schoolPlan.foundersPromo.renewalPrice - schoolPlan.foundersPromo.firstYearPrice).toFixed(2)} el primer año</strong> — renovación posterior: US${schoolPlan.foundersPromo.renewalPrice.toFixed(2)}/año.
                </p>
                <p className="text-xs text-amber-700 font-medium">Ideal para centros escolares de hasta 30 docentes + 1 administrador.</p>
              </div>
            </div>
          )}

          {/* Características en profundidad */}
          <div className="grid md:grid-cols-2 gap-8">
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">🎨 Personalización Temática</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Establece la identidad visual de tu colegio. Configura el logotipo y el color primario de la institución, los cuales se propagarán automáticamente a las interfaces de todos los docentes miembros.
              </p>
            </div>
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">🏢 Panel Administrativo & KPIs</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Acceso a un centro de control global. Visualiza estadísticas de asistencia por grados, promedios generales y tendencias de permanencia sin interferir con el trabajo diario del docente.
              </p>
            </div>
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">🕒 Gestión de Horarios y Turnos</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Define los periodos lectivos y horarios operativos activos (Matutino, Vespertino, Nocturno). Evita que los docentes asignen cursos fuera de las jornadas oficiales definidas.
              </p>
            </div>
            <div className="p-6 bg-neutral-50 rounded-3xl space-y-3">
              <h3 className="font-black text-lg text-neutral-900">⚠️ Control de Riesgo y Discrepancias</h3>
              <p className="text-sm text-neutral-500 font-medium leading-relaxed">
                Módulo inteligente que reporta estudiantes en riesgo (baja asistencia o promedio) y detecta discrepancias de matrícula (alumnos inscritos en múltiples turnos o cursos duplicados).
              </p>
            </div>
          </div>

          {/* Llamado a la Acción (CTA) */}
          <div className="pt-8 border-t border-neutral-100 flex flex-col items-center gap-6 text-center">
            <button
              onClick={() => navigate('/login?mode=signup&plan=school')}
              className="px-10 py-5 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl text-sm font-black uppercase tracking-widest shadow-xl shadow-blue-500/20 active:scale-95 transition-all w-full md:w-auto"
            >
              {schoolPlan.foundersPromo
                ? `⚡ Obtener Precio Fundadores · US$${schoolPlan.foundersPromo.firstYearPrice.toFixed(2)} primer año`
                : schoolPlan.ctaLabel}
            </button>
            <a
              href="mailto:hola@ediagil.com?subject=Demo%20Plan%20Institucional"
              className="inline-flex items-center gap-2 px-8 py-4 border-2 border-blue-200 text-blue-700 hover:bg-blue-50 rounded-2xl text-sm font-black uppercase tracking-widest transition-all w-full md:w-auto justify-center"
            >
              <Mail className="w-4 h-4" />
              Agendar Demo · hola@ediagil.com
            </a>
            <p className="text-xs text-neutral-400 font-semibold">
              Soporte prioritario y migración de datos de alumnos gratuita incluida
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-neutral-900 scroll-smooth">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-white/85 backdrop-blur-xl border-b border-neutral-100">
        <nav className="max-w-7xl mx-auto px-6 lg:px-8 h-20 flex items-center justify-between">
          <a href="#inicio" className="flex items-center gap-3">
            <div className="w-11 h-11 bg-indigo-600 rounded-2xl flex items-center justify-center overflow-hidden p-1 shadow-lg shadow-indigo-500/20">
              <img src="/logo.webp" alt="EdiAgil" className="app-logo w-full h-full object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-black text-xl tracking-tight text-neutral-900">EdiAgil</span>
              <span className="text-[9px] font-black uppercase tracking-[0.25em] text-indigo-600">Cuaderno Docente</span>
            </div>
          </a>

          <div className="hidden md:flex items-center gap-8">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm font-bold text-neutral-500 hover:text-neutral-900 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>

          <div className="hidden md:block">
            <button
              onClick={() => navigate('/login')}
              title="Iniciar sesión en tu cuenta"
              className="px-6 py-3 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg transition-all active:scale-95"
            >
              Iniciar Sesión
            </button>
          </div>

          <button
            aria-label="Abrir menú"
            title="Abrir menú de navegación"
            onClick={() => setMobileOpen((v) => !v)}
            className="md:hidden text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            {mobileOpen ? <X className="w-7 h-7" /> : <Menu className="w-7 h-7" />}
          </button>
        </nav>

        {mobileOpen && (
          <div className="md:hidden border-t border-neutral-100 bg-white px-6 py-6 space-y-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setMobileOpen(false)}
                className="block text-sm font-bold text-neutral-600 hover:text-neutral-900 transition-colors"
              >
                {link.label}
              </a>
            ))}
            <button
              onClick={() => navigate('/login')}
              title="Iniciar sesión en tu cuenta"
              className="w-full px-6 py-3.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-2xl text-xs font-black uppercase tracking-widest shadow-lg transition-all active:scale-95"
            >
              Iniciar Sesión
            </button>
          </div>
        )}
      </header>

      {/* Hero */}
      <section id="inicio" className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 opacity-20 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[45%] h-[55%] bg-indigo-500 rounded-full blur-[130px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[45%] h-[55%] bg-emerald-500 rounded-full blur-[130px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-24 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="inline-flex items-center gap-2 bg-indigo-900/30 border border-indigo-500/30 text-indigo-300 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest mb-8">
              <Sparkles className="w-4 h-4" />
              Hecho para docentes, con IA
            </div>
            <h1 className="text-5xl lg:text-6xl font-black text-white tracking-tight leading-[1.05] mb-8">
              Tu cuaderno digital
              <br />
              docente <span className="text-indigo-400">con IA</span>
            </h1>
            <p className="text-xl text-slate-400 font-medium leading-relaxed mb-12 max-w-lg">
              Gestiona tus clases, asistencias, calificaciones con ponderaciones y apuntes generados por
              inteligencia artificial. Todo en la nube, seguro y disponible sin conexión.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 mb-14">
              <button
                onClick={() => navigate('/login?mode=signup')}
                title="Crear cuenta gratis"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-10 py-5 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-indigo-500/40 hover:shadow-indigo-500/60 transition-all active:scale-95"
              >
                Empieza Gratis
                <ArrowRight className="w-5 h-5" />
              </button>
              <a
                href="#caracteristicas"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-slate-900 border border-slate-700 hover:border-indigo-500 hover:bg-slate-800 text-slate-200 px-10 py-5 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-sm transition-all active:scale-95"
              >
                Ver Características
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <div className="flex items-center gap-3">
                <Shield className="w-5 h-5 text-indigo-400" />
                <span className="text-sm font-bold text-slate-400">Datos cifrados en la nube</span>
              </div>
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-400" />
                <span className="text-sm font-bold text-slate-400">Funciona sin internet</span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <span className="text-sm font-bold text-slate-400">Privacidad garantizada</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 32 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.15, ease: 'easeOut' }}
            className="relative"
          >
            <div className="absolute -inset-10 bg-gradient-to-tr from-indigo-500/15 via-purple-500/10 to-emerald-500/15 rounded-[3.5rem] blur-3xl pointer-events-none" />

            <div className="relative bg-white rounded-[2.5rem] border border-neutral-200 shadow-2xl shadow-neutral-900/10 overflow-hidden rotate-1 hover:rotate-0 transition-transform duration-700">
              <div className="flex items-center gap-2 px-6 py-4 border-b border-neutral-100">
                <span className="w-3 h-3 rounded-full bg-red-400" />
                <span className="w-3 h-3 rounded-full bg-amber-400" />
                <span className="w-3 h-3 rounded-full bg-emerald-400" />
                <div className="ml-4 flex items-center gap-2">
                  <img src="/logo.webp" alt="EdiAgil" className="app-logo w-4 h-4 object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
                  <span className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Mi Cuaderno</span>
                </div>
              </div>

              <div className="grid grid-cols-5">
                <div className="col-span-1 p-4 space-y-3 border-r border-neutral-100 bg-neutral-50/60">
                  <div className="flex items-center gap-2 px-2 py-2 rounded-xl bg-indigo-600 text-white">
                    <LayoutDashboard className="w-3.5 h-3.5" />
                    <span className="text-[8px] font-black uppercase tracking-widest">Dashboard</span>
                  </div>
                  {[
                    { color: '#4f46e5', name: 'Matemáticas' },
                    { color: '#059669', name: 'Física' },
                    { color: '#d97706', name: 'Química' },
                  ].map((subject) => (
                    <div key={subject.name} className="flex items-center gap-2 px-2 py-2 rounded-xl text-neutral-400">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: subject.color }} />
                      <span className="text-[8px] font-black uppercase tracking-widest truncate">{subject.name}</span>
                    </div>
                  ))}
                </div>

                <div className="col-span-4 p-5 space-y-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 mb-1">Matemáticas</p>
                    <p className="text-sm font-black text-neutral-900">Calificaciones</p>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      { label: 'Examen Diagnóstico', value: '85', color: 'bg-emerald-500', width: 'w-[85%]' },
                      { label: 'Trabajo Práctico', value: '92', color: 'bg-indigo-500', width: 'w-[92%]' },
                      { label: 'Evaluación Apreciativa', value: '78', color: 'bg-amber-500', width: 'w-[78%]' },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center gap-3">
                        <span className="w-32 text-[9px] font-bold text-neutral-500 truncate">{row.label}</span>
                        <div className="flex-1 h-2.5 bg-neutral-100 rounded-full overflow-hidden">
                          <div className={`h-full ${row.color} ${row.width} rounded-full`} />
                        </div>
                        <span className="text-[10px] font-black text-neutral-700 w-8 text-right">{row.value}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-between p-3.5 rounded-2xl bg-neutral-50 border border-neutral-100">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-xl flex items-center justify-center">
                        <BarChart3 className="w-4 h-4" />
                      </div>
                      <div>
                        <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Promedio Final</p>
                        <p className="text-sm font-black text-neutral-900">85.0 / 100</p>
                      </div>
                    </div>
                    <span className="px-3 py-1.5 bg-emerald-50 text-emerald-600 text-[9px] font-black uppercase tracking-widest rounded-xl border border-emerald-100">
                      Aprobado
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute -bottom-6 -left-6 bg-white border border-neutral-200 rounded-2xl shadow-xl px-5 py-4 flex items-center gap-3 animate-bounce">
              <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <p className="text-[9px] font-black uppercase tracking-widest text-neutral-400">Syllabus IA</p>
                <p className="text-xs font-black text-neutral-900">Listo en 20 segundos</p>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* Características */}
      <section id="caracteristicas" className="bg-neutral-50 py-24 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-indigo-600 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-2xl mb-6">
              Características
            </span>
            <h2 className="text-4xl lg:text-5xl font-black text-neutral-900 tracking-tight mb-6">
              Todo lo que necesitas para dar clases
            </h2>
            <p className="text-lg text-neutral-500 font-medium leading-relaxed">
              Una sola herramienta para planificar, enseñar, evaluar y analizar el rendimiento de tus estudiantes.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="group bg-white border border-neutral-100 rounded-[2rem] p-8 hover:border-indigo-200 hover:shadow-2xl hover:shadow-indigo-500/10 transition-all hover:-translate-y-1"
              >
                <div className="w-14 h-14 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 transition-transform group-hover:bg-indigo-600 group-hover:text-white">
                  <feature.icon className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-black text-neutral-900 mb-3 tracking-tight">{feature.title}</h3>
                <p className="text-sm text-neutral-500 font-medium leading-relaxed">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Precios */}
      <section id="precios" className="py-24 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-indigo-600 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-2xl mb-6">
              Precios
            </span>
            <h2 className="text-4xl lg:text-5xl font-black text-neutral-900 tracking-tight mb-6">
              Planes simples para cada docente
            </h2>
            <p className="text-lg text-neutral-500 font-medium leading-relaxed">
              Empieza gratis y mejora cuando lo necesites. Sin permanencia, cancelas cuando quieras.
            </p>
          </div>

          <div className="grid lg:grid-cols-3 gap-8 items-stretch">
            {getPublicPlans().map((plan: PricingPlan) => {
              const accent = getPlanAccentStyles(plan.accent);
              const planUrl = plan.ctaHref;
              const baseCardClass = 'relative flex flex-col h-full bg-white rounded-[2.5rem] p-8 border-2 transition-all hover:-translate-y-1 hover:shadow-2xl ';
              const highlightClass = accent.border + ' shadow-2xl shadow-emerald-500/10 ring-2 ring-emerald-500/20';
              const normalClass = 'border-neutral-100 shadow-sm hover:border-indigo-200 ' + accent.border.replace('border-emerald-600', 'hover:border-emerald-200').replace('border-blue-600', 'hover:border-blue-200').replace('border-neutral-200', 'hover:border-indigo-200');
              const cardClass = baseCardClass + (plan.highlight ? highlightClass : normalClass);
              const btnClass = 'w-full inline-flex items-center justify-center gap-2 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-white shadow-lg transition-all active:scale-95 mt-auto ' + accent.btn;

              return (
                <div
                  key={plan.id}
                  className={cardClass}
                >
                  {plan.highlight && (
                    <div className="absolute top-5 right-5 bg-amber-400 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg animate-pulse">
                      Más popular
                    </div>
                  )}
                  <div className="space-y-3">
                    <h3 className="text-xl font-black text-neutral-900 mb-1">{plan.name}</h3>
                    {plan.price === 0 ? (
                      <p className="text-4xl font-black text-neutral-900 mb-1">Gratis</p>
                    ) : (
                      <p className="text-4xl font-black text-neutral-900 mb-1">
                        US${plan.price.toFixed(2)}
                        <span className="text-sm text-neutral-400">{plan.period}</span>
                      </p>
                    )}
                    <p className="text-[11px] font-bold text-neutral-400 mb-2 line-clamp-2">{plan.tagline}</p>
                    {plan.foundersPromo && (
                      <div className="p-3 bg-amber-50 border border-amber-300 rounded-xl space-y-2">
                        <p className="text-[9px] font-black uppercase tracking-widest text-amber-800">⚡ Promoción Fundadores</p>
                        <p className="text-xl font-black text-amber-900">US${plan.foundersPromo.firstYearPrice.toFixed(2)} <span className="text-sm font-bold text-amber-700">primer año</span></p>
                        <p className="text-[10px] font-bold text-neutral-600">Renovación: US${plan.foundersPromo.renewalPrice.toFixed(2)}/año</p>
                      </div>
                    )}
                  </div>
                  <ul className="space-y-3 my-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature.text} className="flex items-center gap-3 text-sm font-bold text-neutral-600">
                        <CheckIcon included={feature.included} />
                        <span className={feature.included ? '' : 'text-neutral-400 line-through decoration-neutral-300'}>{feature.text}</span>
                      </li>
                    ))}
                  </ul>
                  <a
                    href={planUrl}
                    className={btnClass}
                  >
                    {plan.ctaLabel}
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>
              );
            })}
          </div>

          <p className="text-center text-sm text-neutral-400 font-medium mt-10">
            ¿Tienes un código de licencia premium? Cánjéalo desde Configuración dentro de la aplicación.
          </p>
        </div>
      </section>

      {/* Testimonios */}
      <section id="testimonios" className="bg-slate-900 py-24 scroll-mt-24 text-white">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-indigo-300 bg-indigo-900/40 border border-indigo-500/30 px-4 py-2 rounded-2xl mb-6">
              Testimonios
            </span>
            <h2 className="text-4xl lg:text-5xl font-black text-white tracking-tight mb-6">
              Docentes que ya lo aman
            </h2>
            <p className="text-lg text-slate-400 font-medium leading-relaxed">
              Miles de educadores recuperaron horas de su semana con EdiAgil.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((testimonial) => (
              <div
                key={testimonial.name}
                className="bg-slate-800 border border-slate-700 rounded-[2rem] p-8 flex flex-col hover:border-indigo-500 hover:shadow-2xl hover:shadow-indigo-500/20 transition-all"
              >
                <div className="flex items-center gap-1 mb-6">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <Quote className="w-8 h-8 text-indigo-200 mb-4" />
                <p className="flex-1 text-sm text-slate-300 font-medium leading-relaxed mb-8">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black uppercase">
                    {testimonial.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-black text-white">{testimonial.name}</p>
                    <p className="text-[11px] font-bold text-slate-400">{testimonial.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA final */}
      <section className="py-24">
        <div className="max-w-5xl mx-auto px-6 lg:px-8">
          <div className="relative overflow-hidden bg-slate-950 rounded-[3rem] px-8 py-20 text-center border border-slate-800/50 shadow-2xl shadow-slate-900/50">
            <div className="absolute inset-0 opacity-20 pointer-events-none">
              <div className="absolute top-[-30%] left-[-10%] w-[50%] h-[70%] bg-indigo-600 rounded-full blur-[120px]" />
              <div className="absolute bottom-[-30%] right-[-10%] w-[50%] h-[70%] bg-purple-600 rounded-full blur-[120px]" />
            </div>
            <div className="relative">
              <div className="w-20 h-20 bg-white/10 backdrop-blur rounded-[1.75rem] flex items-center justify-center mx-auto mb-8">
                <GraduationCap className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-4xl lg:text-5xl font-black text-white tracking-tight mb-6">
                Empieza gratis hoy
              </h2>
              <p className="text-lg text-neutral-300 font-medium leading-relaxed max-w-xl mx-auto mb-12">
                Crea tu cuenta en menos de un minuto. Sin tarjeta de crédito, sin permanencia, con todos los beneficios del plan gratis para siempre.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                <button
                  onClick={() => navigate('/login?mode=signup')}
                  title="Crear cuenta gratis"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-12 py-5 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-indigo-500/40 transition-all active:scale-95"
                >
                  Empieza Gratis
                  <ArrowRight className="w-5 h-5" />
                </button>
                <a
                  href="#precios"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-white/10 backdrop-blur border border-white/20 hover:bg-white/20 text-white px-12 py-5 rounded-[2rem] text-sm font-black uppercase tracking-widest transition-all active:scale-95"
                >
                  Ver Planes
                </a>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4 mt-14">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-neutral-300">Sin tarjeta de crédito</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-neutral-300">Cancelas cuando quieras</span>
                </div>
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  <span className="text-sm font-bold text-neutral-300">Datos cifrados en la nube</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-neutral-950 text-neutral-400 py-16">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-10 mb-12">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 bg-indigo-600 rounded-2xl flex items-center justify-center overflow-hidden p-1 shadow-lg shadow-indigo-500/20">
                <img src="/logo.webp" alt="EdiAgil" className="app-logo w-full h-full object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-xl tracking-tight text-white">EdiAgil</span>
                <span className="text-[9px] font-black uppercase tracking-[0.25em] text-indigo-400">Cuaderno Docente</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <a
                href="/terminos.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-neutral-400 hover:text-white transition-colors"
              >
                Términos de Servicio
              </a>
              <span className="text-neutral-700 text-sm">·</span>
              <a
                href="/privacidad.html"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-bold text-neutral-400 hover:text-white transition-colors"
              >
                Política de Privacidad
              </a>
            </div>
            <button
              onClick={() => navigate('/login')}
              title="Iniciar sesión en tu cuenta"
              className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-2xl text-xs font-black uppercase tracking-widest border border-white/10 transition-all active:scale-95"
            >
              Iniciar Sesión
            </button>
          </div>
          <div className="flex items-center justify-center gap-2 pt-8 border-t border-white/10 text-sm font-medium">
            <InfinityIcon className="w-4 h-4 text-indigo-500" />
            © {new Date().getFullYear()} EdiAgil. Todos los derechos reservados.
          </div>
        </div>
      </footer>

      {/* Mobile Floating CTA */}
      <button
        onClick={() => navigate('/login?mode=signup')}
        title="Crear cuenta gratis"
        className="md:hidden fixed bottom-6 right-6 z-50 inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-4 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-2xl shadow-indigo-500/40 transition-all active:scale-95 animate-bounce-subtle"
        aria-label="Crear cuenta gratis"
      >
        Empieza Gratis
        <ArrowRight className="w-5 h-5" />
      </button>
    </div>
  );
}