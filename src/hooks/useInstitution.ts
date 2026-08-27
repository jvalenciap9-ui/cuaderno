/**
 * useInstitution.ts — Personalización institucional visible para TODOS los
 * miembros (docentes y admin): nombre, logo y color primario.
 *
 * Módulo 5 del plan del dashboard administrativo. Los campos viven en
 * institutions/{id} (name en la raíz; logoUrl/primaryColor dentro de
 * schoolConfig) y se escriben SOLO desde la Cloud Function
 * adminSaveSchoolConfig. Las reglas de Firestore permiten LEER ese documento
 * a cualquier miembro de la institución, por lo que este hook usa onSnapshot
 * directo (sin Cloud Function admin-only) y funciona para docentes.
 *
 * El color primario se propaga como CSS var --institution-primary sobre
 * document.documentElement (default #FFC107 en index.css) con una variable
 * compañera --institution-primary-contrast (texto legible sobre el accent).
 * Se cachea en localStorage por institución para evitar parpadeo y mantener
 * la personalización en arranques offline.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../components/AuthProvider';
import { usePlan } from './usePlan';
import type { InstitutionPeriodos, PeriodoKey, PlanRules, ReglaPlan } from '../types/firestore';
import { DEFAULT_PERIODOS, DEFAULT_PLAN_RULES, DEFAULT_GRADING_WEIGHT, type GradingWeight } from '../lib/adminApi';
// Modo Demo (VITE_DEMO_MODE=true): la institución mock se lee en memoria y se
// refresca periódicamente para reflejar los cambios del onboarding.
import { IS_DEMO_MODE, getDemoInstitutionConfig } from '../lib/demoAdminData';

export const DEFAULT_INSTITUTION_PRIMARY = '#FFC107';
export const INSTITUTION_PRIMARY_VAR = '--institution-primary';
export const INSTITUTION_PRIMARY_CONTRAST_VAR = '--institution-primary-contrast';

const REGLAS_PLAN = ['semanal', 'mensual', 'trimestral', 'cuatrimestral', 'anual'];

export interface InstitutionTheme {
  name: string;
  logoUrl: string;
  primaryColor: string;
  // Módulo 1: periodos de clase y reglas del plan institucional (lectura para
  // todos los miembros; los docentes NO pueden editarlos).
  periodos: InstitutionPeriodos;
  planRules: PlanRules;
  // POLÍTICA INSTITUCIONAL: ponderación académica (fuente autoritativa
  // institutions/{id}.gradingWeight), lectura para TODOS los miembros; solo el
  // admin la edita (vía adminSaveGradingWeight). null = ausente/corrupta → los
  // consumidores aplican sus defaults.
  gradingWeight: GradingWeight | null;
}

const clonePeriodos = (p: InstitutionPeriodos): InstitutionPeriodos => ({
  matutino: { ...p.matutino },
  vespertino: { ...p.vespertino },
  nocturno: { ...p.nocturno },
});

// Lee periodos desde un documento (Firestore o cache). Si el documento no
// define periodos en absoluto, aplica los defaults (los tres turnos activos
// con sus horarios); si define solo algunos, los no definidos quedan
// inactivos. Mismo criterio que periodosOut en el backend.
const parsePeriodos = (raw: unknown): InstitutionPeriodos => {
  const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const entry = (k: PeriodoKey) => {
    const e = p[k] && typeof p[k] === 'object' ? (p[k] as Record<string, unknown>) : {};
    return {
      activo: e.activo === true,
      horarioInicio: typeof e.horarioInicio === 'string' ? e.horarioInicio : '',
      horarioFin: typeof e.horarioFin === 'string' ? e.horarioFin : '',
    };
  };
  const anyDefined = (['matutino', 'vespertino', 'nocturno'] as PeriodoKey[]).some(k => p[k] && typeof p[k] === 'object');
  if (!anyDefined) return clonePeriodos(DEFAULT_PERIODOS);
  return { matutino: entry('matutino'), vespertino: entry('vespertino'), nocturno: entry('nocturno') };
};

// Lee planRules desde un documento (Firestore o cache). Regla fuera de la
// whitelist o documento ausente → default trimestral sin recomendación.
const parsePlanRules = (raw: unknown): PlanRules => {
  const pr = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const reglaSeleccionada: ReglaPlan = REGLAS_PLAN.includes(pr.reglaSeleccionada as string)
    ? (pr.reglaSeleccionada as ReglaPlan)
    : DEFAULT_PLAN_RULES.reglaSeleccionada;
  return {
    reglaSeleccionada,
    recomendarADocentes: pr.recomendarADocentes === true,
  };
};

// Lee la ponderación institucional desde un documento (Firestore o cache).
// Ausente/corrupta → null (los consumidores aplican defaults; nunca se
// reconstruye a medias: la validación completa vive en el backend).
const parseGradingWeight = (raw: unknown): GradingWeight | null => {
  if (!raw || typeof raw !== 'object') return null;
  const gw = raw as Record<string, unknown>;
  const mode = gw.mode;
  if (mode !== 'tradicional' && mode !== 'competencias' && mode !== 'personalizada') return null;
  if (gw.applyTo !== 'global' && gw.applyTo !== 'override') return null;
  const weights = gw.weights && typeof gw.weights === 'object' ? (gw.weights as Record<string, unknown>) : {};
  const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const customWeights: Record<string, number> = {};
  if (gw.customWeights && typeof gw.customWeights === 'object') {
    for (const [k, v] of Object.entries(gw.customWeights as Record<string, unknown>)) {
      if (typeof k === 'string' && k.trim() && typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) {
        customWeights[k] = v;
      }
    }
  }
  return {
    mode,
    weights: {
      teoria: numOr(weights.teoria, DEFAULT_GRADING_WEIGHT.weights.teoria),
      practica: numOr(weights.practica, DEFAULT_GRADING_WEIGHT.weights.practica),
      apreciativa: numOr(weights.apreciativa, DEFAULT_GRADING_WEIGHT.weights.apreciativa),
    },
    customWeights,
    applyTo: gw.applyTo,
    updatedAt: typeof gw.updatedAt === 'number' ? gw.updatedAt : undefined,
    updatedBy: typeof gw.updatedBy === 'string' ? gw.updatedBy : undefined,
  };
};

export const EMPTY_INSTITUTION_THEME: InstitutionTheme = {
  name: '',
  logoUrl: '',
  primaryColor: '',
  periodos: clonePeriodos(DEFAULT_PERIODOS),
  planRules: { ...DEFAULT_PLAN_RULES },
  gradingWeight: null,
};

const cacheKey = (institutionId: string) => `ediagil_institution_theme_${institutionId}`;

const isValidHex = (v: unknown): v is string =>
  typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v);

const contrastFor = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 160 ? '#1A3C40' : '#FFFFFF';
};

export function useInstitution() {
  const { user } = useAuth();
  const { profile, loading: loadingPlan } = usePlan();
  const institutionId = profile?.institutionId || '';

  const [theme, setTheme] = useState<InstitutionTheme>(() => {
    if (!institutionId) return { ...EMPTY_INSTITUTION_THEME, name: profile?.institutionName || '' };
    try {
      const raw = localStorage.getItem(cacheKey(institutionId));
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          name: typeof parsed.name === 'string' ? parsed.name : profile?.institutionName || '',
          logoUrl: typeof parsed.logoUrl === 'string' ? parsed.logoUrl : '',
          primaryColor: isValidHex(parsed.primaryColor) ? parsed.primaryColor : '',
          periodos: parsePeriodos(parsed.periodos),
          planRules: parsePlanRules(parsed.planRules),
          gradingWeight: parseGradingWeight(parsed.gradingWeight),
        };
      }
    } catch {
      // cache corrupto: se ignora y se vuelve a cargar
    }
    return { ...EMPTY_INSTITUTION_THEME, name: profile?.institutionName || '' };
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (IS_DEMO_MODE) {
      const apply = () => {
        const demo = getDemoInstitutionConfig();
        setTheme({
          name: demo.name,
          logoUrl: demo.logoUrl,
          primaryColor: isValidHex(demo.primaryColor) ? demo.primaryColor : '',
          periodos: demo.periodos,
          planRules: demo.planRules,
          gradingWeight: parseGradingWeight(demo.gradingWeight),
        });
        setLoaded(true);
      };
      apply();
      const id = window.setInterval(apply, 2000);
      return () => window.clearInterval(id);
    }
    if (!user || !institutionId) {
      setLoaded(true);
      return;
    }
    const ref = doc(db, 'institutions', institutionId);
    const unsub = onSnapshot(
      ref,
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const schoolConfig =
          data.schoolConfig && typeof data.schoolConfig === 'object' ? data.schoolConfig : {};
        const next: InstitutionTheme = {
          name: typeof data.name === 'string' ? data.name : profile?.institutionName || '',
          logoUrl: typeof schoolConfig.logoUrl === 'string' ? schoolConfig.logoUrl : '',
          primaryColor: isValidHex(schoolConfig.primaryColor) ? schoolConfig.primaryColor : '',
          periodos: parsePeriodos(data.periodos),
          planRules: parsePlanRules(data.planRules),
          gradingWeight: parseGradingWeight(data.gradingWeight),
        };
        setTheme(next);
        setLoaded(true);
        try {
          localStorage.setItem(cacheKey(institutionId), JSON.stringify(next));
        } catch {
          // almacenamiento lleno o bloqueado: la personalización sigue en memoria
        }
      },
      (err) => {
        console.error('useInstitution error:', err.message);
        setLoaded(true);
      },
    );
    return () => unsub();
  }, [user, institutionId, profile?.institutionName]);

  // Propaga el color primario como accent global y su contraste de texto.
  useEffect(() => {
    const color = isValidHex(theme.primaryColor) ? theme.primaryColor : DEFAULT_INSTITUTION_PRIMARY;
    const root = document.documentElement;
    root.style.setProperty(INSTITUTION_PRIMARY_VAR, color);
    root.style.setProperty(INSTITUTION_PRIMARY_CONTRAST_VAR, contrastFor(color));
  }, [theme.primaryColor]);

  return {
    institution: theme,
    loading: loadingPlan || (user && institutionId ? !loaded : false),
    name: theme.name,
    logoUrl: theme.logoUrl,
    primaryColor: isValidHex(theme.primaryColor) ? theme.primaryColor : DEFAULT_INSTITUTION_PRIMARY,
    periodos: theme.periodos,
    planRules: theme.planRules,
    gradingWeight: theme.gradingWeight,
  };
}
