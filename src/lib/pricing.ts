export type PlanId = 'free' | 'pro' | 'school';

export interface PlanFeature {
  text: string;
  included: boolean;
}

export interface PricingPlan {
  id: PlanId;
  name: string;
  price: number;
  period: string;
  tagline: string;
  highlight: boolean;
  ctaLabel: string;
  ctaAction: string;
  ctaHref: string;
  accent: 'indigo' | 'emerald' | 'blue';
  features: PlanFeature[];
  foundersPromo?: {
    firstYearPrice: number;
    renewalPrice: number;
    label: string;
  };
}

export const PRICING_PLANS: Record<PlanId, PricingPlan> = {
  free: {
    id: 'free',
    name: 'Gratis',
    price: 0,
    period: '/mes',
    tagline: 'Para siempre, sin tarjeta',
    highlight: false,
    ctaLabel: 'Comenzar gratis',
    ctaAction: 'Crear cuenta gratis',
    ctaHref: '/login?mode=signup&plan=free',
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
  pro: {
    id: 'pro',
    name: 'Premium Pro',
    price: 11.99,
    period: '/año',
    tagline: 'US$11.99/año · Equivale a menos de US$1/mes facturado anualmente',
    highlight: true,
    ctaLabel: 'Activar Premium Pro',
    ctaAction: 'Conocer Premium Pro',
    ctaHref: '/planes/premium-pro',
    accent: 'emerald',
    features: [
      { text: 'Hasta 999 estudiantes y cursos', included: true },
      { text: 'Calificaciones avanzadas con pesos', included: true },
      { text: 'Asistencia con alertas inteligentes', included: true },
      { text: '2.000 consultas IA/mes', included: true },
      { text: 'Exportar PDF/Excel', included: true },
      { text: 'Syllabus IA ilimitado', included: true },
    ],
  },
  school: {
    id: 'school',
    name: 'Institucional',
    price: 199.99,
    period: '/año',
    tagline: 'US$199.99/año · 30 docentes + 1 administrador',
    highlight: false,
    ctaLabel: 'Conocer Plan Institucional',
    ctaAction: 'Conocer Plan Institucional',
    ctaHref: '/planes/institucional',
    accent: 'blue',
    features: [
      { text: '30 licencias de docente incluidas', included: true },
      { text: '1 licencia de administrador incluida', included: true },
      { text: 'Asignaturas y cursos ilimitados', included: true },
      { text: '9.999 consultas IA/mes por docente', included: true },
      { text: 'Panel administrativo de gestión', included: true },
      { text: 'SSO Google Workspace & Office 365', included: true },
      { text: 'Boletines masivos en PDF', included: true },
      { text: 'Cumplimiento Ley 1581 (Habeas Data)', included: true },
      { text: 'Onboarding y soporte prioritario 24/7', included: true },
    ],
    foundersPromo: {
      firstYearPrice: 99.99,
      renewalPrice: 199.99,
      label: 'Promoción Fundadores activa',
    },
  },
};

export const PLAN_ORDER: PlanId[] = ['free', 'pro', 'school'];

export function getPlan(planId: PlanId): PricingPlan {
  return PRICING_PLANS[planId];
}

export function getAllPlans(): PricingPlan[] {
  return PLAN_ORDER.map((id) => PRICING_PLANS[id]);
}

export function getPublicPlans(): PricingPlan[] {
  return PLAN_ORDER.map((id) => PRICING_PLANS[id]);
}

export function getPlanAccentStyles(accent: PricingPlan['accent']) {
  switch (accent) {
    case 'emerald':
      return {
        badge: 'bg-amber-400 text-white',
        border: 'border-emerald-600 shadow-emerald-500/10',
        btn: 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/30',
        tag: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      };
    case 'blue':
      return {
        badge: 'bg-blue-600 text-white',
        border: 'border-blue-600 shadow-blue-500/10',
        btn: 'bg-blue-600 hover:bg-blue-500 shadow-blue-500/30',
        tag: 'bg-blue-50 text-blue-700 border-blue-200',
      };
    default:
      return {
        badge: 'bg-neutral-500 text-white',
        border: 'border-neutral-200 shadow-sm',
        btn: 'bg-neutral-900 hover:bg-neutral-800 shadow-neutral-900/20',
        tag: 'bg-neutral-50 text-neutral-700 border-neutral-200',
      };
  }
}