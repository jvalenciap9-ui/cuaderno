import React, { useEffect, useRef, useState } from 'react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';
import {
  adminSaveSchoolConfig,
  adminSaveGradingWeight,
  adminSavePeriodos,
  adminSavePlanRules,
  type AdminSchoolConfigResponse,
  type SchoolConfig,
  type GradingWeight,
  type InstitutionPeriodos,
  type PeriodoKey,
  type PlanRules,
  type ReglaPlan,
  PERIODO_LABEL,
  REGLA_PLAN_OPTIONS,
  DEFAULT_GRADING_WEIGHT,
  DEFAULT_PERIODOS,
  DEFAULT_PLAN_RULES,
} from '../lib/adminApi';
import { IS_DEMO_MODE, resetDemoConfig } from '../lib/demoAdminData';
import { showToast } from '../hooks/useToast';
import { GradingWeightEditor } from './GradingWeightEditor';
import {
  X,
  Loader2,
  Building2,
  Mail,
  Image,
  Check,
  ChevronLeft,
  ChevronRight,
  Users,
  GraduationCap,
  FileText,
  CheckCircle2,
  SlidersHorizontal,
  Clock,
  CalendarRange,
  Sun,
  Sunset,
  Moon,
} from 'lucide-react';

const BRAND_BG = '#F0F7F4';
const BRAND_TEXT = '#1A3C40';

// Paleta sugerida para el color primario institucional (Módulo 5): base
// EdiAgil + colores institucionales habituales. El admin también puede
// escribir un hex libre (#RRGGBB).
const PRIMARY_PRESETS = ['#FFC107', '#1A3C40', '#2E7D32', '#D32F2F', '#2563EB', '#7C3AED', '#0891B2', '#EA580C'];

interface AdminOnboardingProps {
  open: boolean;
  initialName: string;
  initialConfig: SchoolConfig;
  initialGradingWeight: GradingWeight;
  initialPeriodos: InstitutionPeriodos;
  initialPlanRules: PlanRules;
  institutionId: string;
  onClose: () => void;
  onNavigate?: (section: 'teachers' | 'students') => void;
  onSaved: (res: AdminSchoolConfigResponse) => void;
}

// Índices de pasos que validan al guardar (para redirigir al paso con error).
const PONDERACION_STEP = 3;
const PERIODOS_STEP = 4;

const STEPS = [
  { title: 'Institución', icon: Building2 },
  { title: 'Contacto', icon: Mail },
  { title: 'Logo', icon: Image },
  { title: 'Ponderación', icon: SlidersHorizontal },
  { title: 'Periodos', icon: Clock },
  { title: 'Reglas del Plan', icon: CalendarRange },
  { title: 'Reportes', icon: FileText },
];

// Icono de cada periodo para su tarjeta.
const PERIODO_ICON: Record<PeriodoKey, typeof Sun> = {
  matutino: Sun,
  vespertino: Sunset,
  nocturno: Moon,
};

const WEIGHT_KEYS = ['teoria', 'practica', 'apreciativa'] as const;

export function AdminOnboarding({
  open,
  initialName,
  initialConfig,
  initialGradingWeight,
  initialPeriodos,
  initialPlanRules,
  institutionId,
  onClose,
  onNavigate,
  onSaved,
}: AdminOnboardingProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initialName);
  const [slogan, setSlogan] = useState(initialConfig.slogan || '');
  const [directorName, setDirectorName] = useState(initialConfig.directorName || '');
  const [address, setAddress] = useState(initialConfig.address || '');
  const [phone, setPhone] = useState(initialConfig.phone || '');
  const [email, setEmail] = useState(initialConfig.email || '');
  const [logoUrl, setLogoUrl] = useState(initialConfig.logoUrl || '');
  const [primaryColor, setPrimaryColor] = useState(
    /^#[0-9a-fA-F]{6}$/.test(initialConfig.primaryColor || '') ? initialConfig.primaryColor : '',
  );
  const [gradingWeight, setGradingWeight] = useState<GradingWeight>({
    ...DEFAULT_GRADING_WEIGHT,
    ...initialGradingWeight,
    weights: { ...DEFAULT_GRADING_WEIGHT.weights, ...(initialGradingWeight.weights || {}) },
    customWeights: { ...(initialGradingWeight.customWeights || {}) },
  });
  const [periodos, setPeriodos] = useState<InstitutionPeriodos>(() => ({
    matutino: { ...DEFAULT_PERIODOS.matutino, ...(initialPeriodos.matutino || {}) },
    vespertino: { ...DEFAULT_PERIODOS.vespertino, ...(initialPeriodos.vespertino || {}) },
    nocturno: { ...DEFAULT_PERIODOS.nocturno, ...(initialPeriodos.nocturno || {}) },
  }));
  const [planRules, setPlanRules] = useState<PlanRules>({
    ...DEFAULT_PLAN_RULES,
    ...initialPlanRules,
  });
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cierre con Escape cuando ya no es el onboarding de primer ingreso
  // (durante el primer registro el wizard no se puede cerrar).
  useEffect(() => {
    if (!open || !initialConfig.onboardingDone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, initialConfig.onboardingDone, onClose]);

  if (!open) return null;

  const handleLogoChange = async (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('error', 'El logo debe ser una imagen (PNG, JPG, SVG, WEBP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('error', 'El logo no puede superar los 10 MB.');
      return;
    }
    setUploading(true);
    try {
      const fileRef = ref(storage, `institutions/${institutionId}/logo`);
      const snapshot = await uploadBytes(fileRef, file);
      const url = await getDownloadURL(snapshot.ref);
      setLogoUrl(url);
      showToast('success', 'Logo subido correctamente.');
    } catch (err: any) {
      console.error('Logo upload error:', err);
      showToast('error', err?.message || 'No se pudo subir el logo.');
    } finally {
      setUploading(false);
    }
  };

  const currentWeightsTotal = WEIGHT_KEYS.reduce(
    (acc, k) => acc + (gradingWeight.weights[k] || 0),
    0,
  );
  const currentCustomTotal = Object.values(gradingWeight.customWeights).reduce(
    (acc, v) => acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    0,
  );
  const total = gradingWeight.mode === 'personalizada' ? currentCustomTotal : currentWeightsTotal;
  const isComplete = Math.abs(total - 100) < 0.01;

  const handlePeriodoToggle = (key: PeriodoKey) => {
    setPeriodos(prev => ({ ...prev, [key]: { ...prev[key], activo: !prev[key].activo } }));
  };

  const handlePeriodoTime = (key: PeriodoKey, field: 'horarioInicio' | 'horarioFin', value: string) => {
    setPeriodos(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const handleReglaChange = (regla: ReglaPlan) => {
    setPlanRules(prev => ({ ...prev, reglaSeleccionada: regla }));
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showToast('error', 'El nombre de la institución es obligatorio.');
      setStep(0);
      return;
    }
    if (!isComplete) {
      showToast('error', `La suma de las ponderaciones debe ser 100%. Actualmente suma ${Math.round(total * 100) / 100}%.`);
      setStep(PONDERACION_STEP);
      return;
    }
    const activePeriodos = Object.values(periodos).filter(p => p.activo);
    if (activePeriodos.length === 0) {
      showToast('error', 'Activa al menos un periodo de clase.');
      setStep(PERIODOS_STEP);
      return;
    }
    if (activePeriodos.some(p => !p.horarioInicio || !p.horarioFin)) {
      showToast('error', 'Define el horario de inicio y fin de cada periodo activo.');
      setStep(PERIODOS_STEP);
      return;
    }
    setSaving(true);
    try {
      const payload: GradingWeight = { ...gradingWeight };
      if (payload.mode === 'personalizada') {
        payload.weights = { ...DEFAULT_GRADING_WEIGHT.weights };
      }
      const [res] = await Promise.all([
        adminSaveSchoolConfig({
          name: name.trim(),
          slogan: slogan.trim(),
          directorName: directorName.trim(),
          address: address.trim(),
          phone: phone.trim(),
          email: email.trim(),
          logoUrl: logoUrl.trim(),
          primaryColor: /^#[0-9a-fA-F]{6}$/.test(primaryColor.trim()) ? primaryColor.trim() : '',
        }),
        adminSaveGradingWeight(payload),
        adminSavePeriodos(periodos),
        adminSavePlanRules(planRules),
      ]);
      showToast('success', 'Configuración guardada. Tu entorno ya está personalizado.');
      onSaved(res);
    } catch (err: any) {
      console.error('adminSaveSchoolConfig error:', err);
      showToast('error', err?.message || 'No se pudo guardar la configuración.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-4 py-3 rounded-2xl border border-[#1A3C40]/15 bg-white text-[#1A3C40] text-sm font-medium placeholder:text-[#1A3C40]/35 focus:outline-none focus:ring-2 focus:ring-[#FFC107]/60 focus:border-transparent transition-shadow';
  const labelCls = 'block text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/60 mb-1.5';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8">
      <div
        className="absolute inset-0 bg-[#1A3C40]/60 backdrop-blur-sm"
        onClick={initialConfig.onboardingDone ? onClose : undefined}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={initialConfig.onboardingDone ? 'Configuración de la institución' : 'Personaliza tu entorno'}
        className="relative w-full max-w-2xl rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-4rem)]"
        style={{ background: BRAND_BG }}
      >
        {/* Encabezado */}
        <div className="px-8 pt-8 pb-6 shrink-0" style={{ background: BRAND_TEXT }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.25em] text-[#FFC107]">
                EdiAgil · Plan Institucional
              </p>
              <h2 className="text-2xl md:text-3xl font-black text-white tracking-tight mt-1">
                {initialConfig.onboardingDone ? 'Configuración de la institución' : '¡Bienvenido! Personaliza tu entorno'}
              </h2>
              <p className="text-white/70 text-sm font-medium mt-1.5 max-w-lg">
                {initialConfig.onboardingDone
                  ? 'Actualiza el nombre, contacto, logo y encabezados que aparecen en los reportes.'
                  : 'Estos datos aparecerán en el boletín de tus estudiantes y en las exportaciones. Tardas menos de un minuto.'}
              </p>
            </div>
            {initialConfig.onboardingDone && (
              <button
                onClick={onClose}
                title="Cerrar"
                className="shrink-0 w-10 h-10 rounded-2xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Indicador de pasos */}
          <div className="flex items-center gap-2 mt-7">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < step;
              const active = i === step;
              return (
                <div key={s.title} className="flex-1">
                  <div
                    className={`flex items-center gap-2 rounded-2xl px-3 py-2 transition-colors ${
                      active ? 'bg-[#FFC107] text-[#1A3C40]' : done ? 'bg-white/10 text-white/60' : 'bg-white/10 text-white/40'
                    }`}
                  >
                    {done ? <Check className="w-3.5 h-3.5 shrink-0" /> : <Icon className="w-3.5 h-3.5 shrink-0" />}
                    <span className="text-[10px] font-black uppercase tracking-widest hidden sm:block truncate">
                      {s.title}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Contenido del paso */}
        <div className="p-8 flex-1 overflow-y-auto custom-scrollbar min-h-0">
          {step === 0 && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>Nombre de la institución *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ej. Colegio Nacional Aurora"
                  className={inputCls}
                  maxLength={200}
                />
              </div>
              <div>
                <label className={labelCls}>Eslogan (opcional)</label>
                <input
                  type="text"
                  value={slogan}
                  onChange={(e) => setSlogan(e.target.value)}
                  placeholder="Ej. Menos Burocracia, Más Impacto"
                  className={inputCls}
                  maxLength={200}
                />
              </div>
              <div>
                <label className={labelCls}>Director/a (opcional)</label>
                <input
                  type="text"
                  value={directorName}
                  onChange={(e) => setDirectorName(e.target.value)}
                  placeholder="Ej. Lic. Elena Vargas"
                  className={inputCls}
                  maxLength={120}
                />
              </div>
              <div>
                <label className={labelCls}>Color primario (opcional)</label>
                <p className="text-sm text-[#1A3C40]/70 font-medium mb-3">
                  Tu accent institucional. Se aplica al instante a toda la aplicación para ti y tus docentes.
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  {PRIMARY_PRESETS.map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setPrimaryColor(color)}
                      title={color}
                      aria-label={`Usar color ${color}`}
                      aria-pressed={primaryColor.toLowerCase() === color.toLowerCase()}
                      className={`w-9 h-9 rounded-xl border-2 transition-all active:scale-90 ${
                        primaryColor.toLowerCase() === color.toLowerCase()
                          ? 'border-[#1A3C40] scale-110 shadow-md'
                          : 'border-white hover:scale-105 shadow-sm'
                      }`}
                      style={{ background: color }}
                    />
                  ))}
                  <label className="flex items-center gap-2.5 bg-white border border-[#1A3C40]/15 rounded-2xl px-3 py-2 cursor-pointer">
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#FFC107'}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      aria-label="Elegir color libre"
                      className="w-9 h-9 rounded-lg border-none bg-transparent cursor-pointer p-0"
                    />
                    <input
                      type="text"
                      value={primaryColor}
                      onChange={(e) => setPrimaryColor(e.target.value)}
                      placeholder="#FFC107"
                      maxLength={7}
                      aria-label="Color primario en hexadecimal"
                      className="w-24 bg-transparent text-sm font-black text-[#1A3C40] uppercase outline-none placeholder:text-[#1A3C40]/35"
                    />
                  </label>
                </div>
                {primaryColor && !/^#[0-9a-fA-F]{6}$/.test(primaryColor) && (
                  <p className="text-xs font-bold text-[#D32F2F] mt-2">
                    Escribe un color hexadecimal válido (ej. #2E7D32).
                  </p>
                )}
              </div>
              <div className="bg-white/70 border border-[#1A3C40]/10 rounded-2xl px-5 py-4">
                <p className="text-[11px] font-black uppercase tracking-[0.15em] text-[#1A3C40]/50 mb-1">
                  Pendiente (opcional)
                </p>
                <p className="text-sm text-[#1A3C40]/80 font-medium">
                  El censo de alumnos se llena desde el cuaderno de cada docente; tú lo supervisas en{' '}
                  <span className="font-black">Censo de alumnos</span>. Los docentes se invitan desde{' '}
                  <span className="font-black">Directorio de docentes</span>.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  <button
                    onClick={() => onNavigate?.('students')}
                    className="inline-flex items-center gap-2 bg-white border border-[#1A3C40]/15 hover:border-[#1A3C40]/40 text-[#1A3C40] px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
                  >
                    <GraduationCap className="w-3.5 h-3.5" />
                    Ir al censo
                  </button>
                  <button
                    onClick={() => onNavigate?.('teachers')}
                    className="inline-flex items-center gap-2 bg-white border border-[#1A3C40]/15 hover:border-[#1A3C40]/40 text-[#1A3C40] px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
                  >
                    <Users className="w-3.5 h-3.5" />
                    Invitar docentes
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className={labelCls}>Dirección (opcional)</label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Ej. Av. 5 de Julio, Centro"
                    className={inputCls}
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className={labelCls}>Teléfono (opcional)</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="Ej. 0412-1234567"
                    className={inputCls}
                    maxLength={40}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Correo institucional (opcional)</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Ej. contacto@colegioaurora.edu.ve"
                  className={inputCls}
                  maxLength={120}
                />
              </div>
              <div className="bg-white/70 border border-[#1A3C40]/10 rounded-2xl px-5 py-4">
                <p className="text-sm text-[#1A3C40]/80 font-medium">
                  Estos datos se imprimen en el encabezado del boletín académico y en las
                  exportaciones a Excel y PDF de tu institución.
                </p>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleLogoChange(e.target.files?.[0] ?? null)}
              />
              <div className="flex flex-col sm:flex-row items-center gap-6">
                <div className="w-36 h-36 rounded-[1.5rem] border-2 border-dashed border-[#1A3C40]/25 bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo institucional" className="w-full h-full object-contain p-3" />
                  ) : (
                    <Image className="w-10 h-10 text-[#1A3C40]/30" />
                  )}
                </div>
                <div className="flex-1 space-y-3">
                  <p className="text-sm text-[#1A3C40]/80 font-medium">
                    Sube el logo de tu institución. Aparecerá en el encabezado del boletín y en
                    tus reportes impresos.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="inline-flex items-center gap-2 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-60"
                      style={{ background: BRAND_TEXT }}
                    >
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />}
                      {logoUrl ? 'Cambiar logo' : 'Subir logo'}
                    </button>
                    {logoUrl && (
                      <button
                        onClick={() => setLogoUrl('')}
                        disabled={uploading}
                        className="inline-flex items-center gap-2 bg-white border border-[#1A3C40]/15 hover:border-red-300 text-[#1A3C40] px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-60"
                      >
                        Quitar
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-[#1A3C40]/50 font-medium">
                    PNG, JPG, SVG o WEBP · máximo 10 MB
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <p className={labelCls}>Cómo se calcula la nota final</p>
              <p className="text-sm text-[#1A3C40]/80 font-medium leading-relaxed">
                Define la ponderación global de calificaciones de tu institución. Los promedios ya
                calculados no cambian; la configuración queda lista para los futuros reportes.
              </p>

              <GradingWeightEditor value={gradingWeight} onChange={setGradingWeight} />
            </div>
          )}

          {step === PERIODOS_STEP && (
            <div className="space-y-5">
              <p className={labelCls}>Periodos de clase</p>
              <p className="text-sm text-[#1A3C40]/80 font-medium leading-relaxed">
                Define qué turnos operan en tu institución y sus horarios. Solo los periodos
                activos aparecen para los docentes al crear o editar asignaturas.
              </p>
              {(Object.keys(periodos) as PeriodoKey[]).map(key => {
                const cfg = periodos[key];
                const Icon = PERIODO_ICON[key];
                return (
                  <div
                    key={key}
                    className={`rounded-2xl border p-5 transition-colors ${
                      cfg.activo
                        ? 'bg-white border-[#1A3C40]/20 shadow-sm'
                        : 'bg-white/50 border-[#1A3C40]/10'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                            cfg.activo ? 'bg-[#1A3C40] text-[#FFC107]' : 'bg-[#1A3C40]/10 text-[#1A3C40]/40'
                          }`}
                        >
                          <Icon className="w-5 h-5" />
                        </div>
                        <div>
                          <p className="text-sm font-black text-[#1A3C40]">{PERIODO_LABEL[key]}</p>
                          <p className="text-xs text-[#1A3C40]/55 font-medium">Turno {PERIODO_LABEL[key].toLowerCase()}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={cfg.activo}
                        aria-label={`Activar periodo ${PERIODO_LABEL[key]}`}
                        onClick={() => handlePeriodoToggle(key)}
                        className={`w-12 h-7 rounded-full transition-colors shrink-0 ${
                          cfg.activo ? 'bg-[#2E7D32]' : 'bg-[#1A3C40]/20'
                        }`}
                      >
                        <span
                          className={`block w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                            cfg.activo ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                    {cfg.activo && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                        <div>
                          <label className={labelCls}>Hora de inicio</label>
                          <input
                            type="time"
                            value={cfg.horarioInicio}
                            onChange={(e) => handlePeriodoTime(key, 'horarioInicio', e.target.value)}
                            className={inputCls}
                          />
                        </div>
                        <div>
                          <label className={labelCls}>Hora de fin</label>
                          <input
                            type="time"
                            value={cfg.horarioFin}
                            onChange={(e) => handlePeriodoTime(key, 'horarioFin', e.target.value)}
                            className={inputCls}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="bg-[#FFC107]/15 border border-[#FFC107]/40 rounded-2xl px-5 py-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
                <p className="text-sm text-[#1A3C40]/85 font-medium">
                  Los periodos activos y sus horarios se guardan en tu institución y quedan
                  disponibles para el dashboard y el cuaderno de tus docentes.
                </p>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <p className={labelCls}>Regla de planificación institucional</p>
              <p className="text-sm text-[#1A3C40]/80 font-medium leading-relaxed">
                Define el ritmo de planificación de tus docentes. Si lo activas, la institución
                recomienda esta regla al crear o editar una asignatura.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {REGLA_PLAN_OPTIONS.map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleReglaChange(opt.id)}
                    aria-pressed={planRules.reglaSeleccionada === opt.id}
                    className={`text-left rounded-2xl border px-4 py-3 transition-all active:scale-95 ${
                      planRules.reglaSeleccionada === opt.id
                        ? 'border-[#1A3C40] bg-white shadow-lg shadow-[#1A3C40]/10'
                        : 'border-[#1A3C40]/15 bg-white/70 hover:border-[#1A3C40]/40'
                    }`}
                  >
                    <span className="block text-xs font-black text-[#1A3C40]">{opt.title}</span>
                    <span className="block text-[10px] text-[#1A3C40]/50 font-bold mt-0.5">{opt.desc}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={planRules.recomendarADocentes}
                aria-label="Recomendar a docentes"
                onClick={() => setPlanRules(prev => ({ ...prev, recomendarADocentes: !prev.recomendarADocentes }))}
                className="w-full flex items-center justify-between gap-4 rounded-2xl border border-[#1A3C40]/15 bg-white/70 px-5 py-4 text-left"
              >
                <div>
                  <p className="text-sm font-black text-[#1A3C40]">Recomendar a docentes</p>
                  <p className="text-xs text-[#1A3C40]/55 font-medium mt-0.5">
                    Muestra una sugerencia al crear o editar asignaturas, sin obligar.
                  </p>
                </div>
                <span
                  className={`w-12 h-7 rounded-full transition-colors shrink-0 ${
                    planRules.recomendarADocentes ? 'bg-[#2E7D32]' : 'bg-[#1A3C40]/20'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white shadow transform transition-transform ${
                      planRules.recomendarADocentes ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </span>
              </button>
              <div className="bg-[#FFC107]/15 border border-[#FFC107]/40 rounded-2xl px-5 py-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
                <p className="text-sm text-[#1A3C40]/85 font-medium">
                  La regla seleccionada se guarda en tu institución y queda disponible para el
                  dashboard y los docentes.
                </p>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-5">
              {/* Vista previa del encabezado de reportes */}
              <p className={labelCls}>Así se verá el encabezado de tus reportes</p>
              <div className="bg-white rounded-[1.5rem] border border-[#1A3C40]/10 p-6 print:border-none">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-2xl bg-[#F0F7F4] border border-[#1A3C40]/10 flex items-center justify-center overflow-hidden shrink-0">
                    {logoUrl ? (
                      <img src={logoUrl} alt="Logo" className="w-full h-full object-contain p-1.5" />
                    ) : (
                      <Building2 className="w-6 h-6 text-[#1A3C40]/40" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-black text-[#1A3C40] truncate">{name.trim() || 'Nombre de la institución'}</p>
                    {slogan && (
                      <p className="text-[11px] text-[#1A3C40]/60 font-medium italic truncate">{slogan}</p>
                    )}
                    <p className="text-[10px] text-[#1A3C40]/45 font-medium truncate">
                      Boletín académico del estudiante
                    </p>
                  </div>
                </div>
                <div
                  className="mt-3 h-1.5 rounded-full"
                  style={{ background: /^#[0-9a-fA-F]{6}$/.test(primaryColor) ? primaryColor : '#FFC107' }}
                />
                {(directorName || address || phone || email) && (
                  <div className="mt-4 pt-3 border-t border-[#1A3C40]/10 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
                    {directorName && (
                      <p className="text-[11px] text-[#1A3C40]/70 font-bold">Director/a: {directorName}</p>
                    )}
                    {address && <p className="text-[11px] text-[#1A3C40]/70 font-bold">{address}</p>}
                    {phone && <p className="text-[11px] text-[#1A3C40]/70 font-bold">Tel: {phone}</p>}
                    {email && <p className="text-[11px] text-[#1A3C40]/70 font-bold">{email}</p>}
                  </div>
                )}
              </div>
              <div className="bg-[#FFC107]/15 border border-[#FFC107]/40 rounded-2xl px-5 py-4 flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
                <p className="text-sm text-[#1A3C40]/85 font-medium">
                  El cambio se aplica de inmediato a todos los boletines y exportaciones. Puedes
                  volver a configurar esto cuando quieras desde el panel.
                </p>
              </div>
            </div>
          )}

          {/* Navegación */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-[#1A3C40]/10">
            <button
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="inline-flex items-center gap-2 bg-white border border-[#1A3C40]/15 text-[#1A3C40] px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-30"
            >
              <ChevronLeft className="w-4 h-4" />
              Volver
            </button>
            {IS_DEMO_MODE && (
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('¿Restaurar los valores de demostración? Se perderán los cambios de configuración hechos en este demo.')) return;
                  resetDemoConfig();
                  window.location.reload();
                }}
                className="text-[11px] font-bold text-[#D32F2F]/70 hover:text-[#D32F2F] transition-colors"
                title="Solo modo demostración"
              >
                Restaurar valores de demostración
              </button>
            )}
            {step < STEPS.length - 1 ? (
              <button
                onClick={() => setStep(Math.min(STEPS.length - 1, step + 1))}
                className="inline-flex items-center gap-2 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
                style={{ background: BRAND_TEXT }}
              >
                Continuar
                <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-2 text-white px-6 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-60"
                style={{ background: BRAND_TEXT }}
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {saving ? 'Guardando...' : 'Guardar configuración'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}