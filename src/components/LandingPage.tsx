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
  Check,
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
} from 'lucide-react';
import { navigate } from '../lib/router';

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

const PLANS = [
  {
    id: 'free',
    name: 'Gratis',
    price: '$0',
    period: '/mes',
    tagline: 'Para siempre, sin tarjeta',
    highlight: false,
    ctaLabel: 'Comenzar Gratis',
    accent: 'indigo',
    features: [
      { text: 'Estudiantes ilimitados por curso', included: true },
      { text: 'Hasta 2 asignaturas por año', included: true },
      { text: 'Calificaciones básicas', included: true },
      { text: 'Registro de asistencia', included: true },
      { text: 'Informes con IA (15/mes)', included: true },
      { text: 'Exportar PDF/Excel', included: false },
      { text: 'Syllabus IA', included: false },
    ],
  },
  {
    id: 'pro',
    name: 'Premium Pro',
    price: '$4.99',
    period: '/año',
    tagline: '🔥 14 días gratis · Solo $0.42/mes · Anual',
    highlight: true,
    ctaLabel: 'Obtener Premium Pro',
    accent: 'emerald',
    features: [
      { text: 'Hasta 999 estudiantes y cursos', included: true },
      { text: 'Calificaciones avanzadas con pesos', included: true },
      { text: 'Asistencia con alertas inteligentes', included: true },
      { text: '2.000 consultas IA/mes', included: true },
      { text: 'Exportar PDF/Excel', included: true },
      { text: 'Syllabus IA', included: true },
    ],
  },
  {
    id: 'school',
    name: 'Institucional',
    price: '$99.99',
    period: '/año',
    tagline: '💰 Ahorra +70% en planes grupales',
    highlight: false,
    ctaLabel: 'Comprar Institucional',
    accent: 'blue',
    features: [
      { text: 'Hasta 999 estudiantes y cursos', included: true },
      { text: '9.999 consultas IA/mes', included: true },
      { text: 'Panel administrativo', included: true },
      { text: 'Sincronización en la nube', included: true },
      { text: 'Reportes institucionales', included: true },
      { text: 'Onboarding personalizado', included: true },
      { text: 'Facturación centralizada', included: true },
    ],
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

export function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);

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
      <section id="inicio" className="relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.05] pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-[45%] h-[55%] bg-indigo-600 rounded-full blur-[130px]" />
          <div className="absolute bottom-[-20%] right-[-10%] w-[45%] h-[55%] bg-purple-600 rounded-full blur-[130px]" />
        </div>

        <div className="relative max-w-7xl mx-auto px-6 lg:px-8 pt-20 pb-24 grid lg:grid-cols-2 gap-16 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
          >
            <div className="inline-flex items-center gap-2 bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded-2xl text-[10px] font-black uppercase tracking-widest mb-8">
              <Sparkles className="w-4 h-4" />
              Hecho para docentes, con IA
            </div>
            <h1 className="text-5xl lg:text-6xl font-black text-neutral-900 tracking-tight leading-[1.05] mb-8">
              Tu cuaderno digital
              <br />
              docente <span className="text-indigo-600">con IA</span>
            </h1>
            <p className="text-xl text-neutral-500 font-medium leading-relaxed mb-12 max-w-lg">
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
                className="w-full sm:w-auto inline-flex items-center justify-center gap-3 bg-white border border-neutral-200 hover:border-indigo-200 hover:bg-neutral-50 text-neutral-700 px-10 py-5 rounded-[2rem] text-sm font-black uppercase tracking-widest shadow-sm transition-all active:scale-95"
              >
                Ver Características
              </a>
            </div>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <div className="flex items-center gap-3">
                <Users className="w-5 h-5 text-indigo-600" />
                <span className="text-sm font-bold text-neutral-500">+2.000 docentes activos</span>
              </div>
              <div className="flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span className="text-sm font-bold text-neutral-500">Datos cifrados en la nube</span>
              </div>
              <div className="flex items-center gap-3">
                <Zap className="w-5 h-5 text-amber-500" />
                <span className="text-sm font-bold text-neutral-500">Funciona sin internet</span>
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
            {PLANS.map((plan) => {
              const accent =
                plan.accent === 'emerald'
                  ? { badge: 'bg-amber-400', border: 'border-emerald-600', btn: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/30' }
                  : plan.accent === 'blue'
                    ? { badge: 'bg-blue-600', border: 'border-blue-600', btn: 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/30' }
                    : { badge: '', border: 'border-neutral-200', btn: 'bg-neutral-900 hover:bg-neutral-800 shadow-neutral-900/20' };

              return (
                <div
                  key={plan.id}
                  className={`relative flex flex-col justify-between bg-white rounded-[2.5rem] p-8 border-2 transition-all hover:-translate-y-1 hover:shadow-2xl ${
                    plan.highlight ? `${accent.border} shadow-2xl shadow-emerald-500/10` : `border-neutral-100 shadow-sm ${accent.border.replace('border-emerald-600', 'hover:border-emerald-200').replace('border-blue-600', 'hover:border-blue-200').replace('border-neutral-200', 'hover:border-indigo-200')}`
                  }`}
                >
                  {plan.highlight && (
                    <div className="absolute top-5 right-5 bg-amber-400 text-white px-3 py-1 rounded-full text-[8px] font-black uppercase tracking-widest shadow-lg">
                      Más popular
                    </div>
                  )}
                  <div>
                    <h3 className="text-xl font-black text-neutral-900 mb-1">{plan.name}</h3>
                    <p className="text-4xl font-black text-neutral-900 mb-1">
                      {plan.price}
                      <span className="text-sm text-neutral-400">{plan.period}</span>
                    </p>
                    <p className="text-[11px] font-bold text-neutral-400 mb-8">{plan.tagline}</p>
                    <ul className="space-y-3 mb-10">
                      {plan.features.map((feature) => (
                        <li key={feature.text} className="flex items-center gap-3 text-sm font-bold text-neutral-600">
                          <CheckIcon included={feature.included} />
                          <span className={feature.included ? '' : 'text-neutral-400 line-through decoration-neutral-300'}>{feature.text}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <button
                    onClick={() => navigate('/login')}
                    title={`Elegir plan ${plan.name}`}
                    className={`w-full inline-flex items-center justify-center gap-2 py-4 rounded-2xl text-xs font-black uppercase tracking-widest text-white shadow-lg transition-all active:scale-95 ${accent.btn}`}
                  >
                    {plan.ctaLabel}
                    <ArrowRight className="w-4 h-4" />
                  </button>
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
      <section id="testimonios" className="bg-neutral-50 py-24 scroll-mt-24">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <span className="inline-block text-[10px] font-black uppercase tracking-[0.25em] text-indigo-600 bg-indigo-50 border border-indigo-100 px-4 py-2 rounded-2xl mb-6">
              Testimonios
            </span>
            <h2 className="text-4xl lg:text-5xl font-black text-neutral-900 tracking-tight mb-6">
              Docentes que ya lo aman
            </h2>
            <p className="text-lg text-neutral-500 font-medium leading-relaxed">
              Miles de educadores recuperaron horas de su semana con EdiAgil.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {TESTIMONIALS.map((testimonial) => (
              <div
                key={testimonial.name}
                className="bg-white border border-neutral-100 rounded-[2rem] p-8 flex flex-col hover:border-indigo-200 hover:shadow-2xl hover:shadow-indigo-500/10 transition-all"
              >
                <div className="flex items-center gap-1 mb-6">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="w-4 h-4 fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <Quote className="w-8 h-8 text-indigo-200 mb-4" />
                <p className="flex-1 text-sm text-neutral-600 font-medium leading-relaxed mb-8">
                  &ldquo;{testimonial.quote}&rdquo;
                </p>
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 bg-indigo-600 text-white rounded-2xl flex items-center justify-center font-black uppercase">
                    {testimonial.name.split(' ').slice(0, 2).map((part) => part[0]).join('')}
                  </div>
                  <div>
                    <p className="text-sm font-black text-neutral-900">{testimonial.name}</p>
                    <p className="text-[11px] font-bold text-neutral-400">{testimonial.role}</p>
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
          <div className="relative overflow-hidden bg-neutral-900 rounded-[3rem] px-8 py-20 text-center">
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
    </div>
  );
}
