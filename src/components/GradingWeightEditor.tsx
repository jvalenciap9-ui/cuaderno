/**
 * GradingWeightEditor.tsx — Editor de la ponderación académica institucional,
 * compartido por el onboarding ("Mi institución") y Configuración → General →
 * Ponderaciones académicas. POLÍTICA INSTITUCIONAL: es la única UI de edición
 * y está reservada al administrador; los docentes la consultan en solo lectura.
 *
 * El selector "Aplicación de la ponderación" (applyTo global/override) fue
 * retirado: desde la política institucional la ponderación institucional
 * aplica SIEMPRE a los miembros (gradingUtils.getEffectiveGradingWeight); el
 * campo se conserva en el esquema por compatibilidad.
 */

import { Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { type GradingWeight, type GradingMode } from '../lib/adminApi';

// Etiquetas por modo sobre los mismos 3 tipos de evaluación del sistema
// (evaluations.type): 'competencias' reinterpreta las categorías como la
// tríada clásica Saber/Hacer/Ser sin inventar tipos nuevos.
export const MODE_LABELS: Record<Exclude<GradingMode, 'personalizada'>, Record<'teoria' | 'practica' | 'apreciativa', string>> = {
  tradicional: { teoria: 'Teoría', practica: 'Práctica', apreciativa: 'Apreciativa' },
  competencias: { teoria: 'Saber', practica: 'Hacer', apreciativa: 'Ser' },
};

// Presets de cada modo para inicializar el formulario al cambiar de modo.
export const MODE_PRESETS: Record<Exclude<GradingMode, 'personalizada'>, { teoria: number; practica: number; apreciativa: number }> = {
  tradicional: { teoria: 30, practica: 60, apreciativa: 10 },
  competencias: { teoria: 30, practica: 40, apreciativa: 30 },
};

const WEIGHT_KEYS = ['teoria', 'practica', 'apreciativa'] as const;

interface GradingWeightEditorProps {
  value: GradingWeight;
  onChange: (next: GradingWeight | ((prev: GradingWeight) => GradingWeight)) => void;
}

export function GradingWeightEditor({ value, onChange }: GradingWeightEditorProps) {
  const currentWeightsTotal = WEIGHT_KEYS.reduce(
    (acc, k) => acc + (value.weights[k] || 0),
    0,
  );
  const currentCustomTotal = Object.values(value.customWeights).reduce(
    (acc, v) => acc + (typeof v === 'number' && Number.isFinite(v) ? v : 0),
    0,
  );
  const total = value.mode === 'personalizada' ? currentCustomTotal : currentWeightsTotal;
  const isComplete = Math.abs(total - 100) < 0.01;

  const handleModeChange = (mode: GradingMode) => {
    onChange(prev => {
      const next: GradingWeight = { ...prev, mode };
      if (mode === 'personalizada') {
        if (Object.keys(prev.customWeights).length === 0) {
          next.customWeights = {
            Teoría: prev.weights.teoria,
            Práctica: prev.weights.practica,
            Apreciativa: prev.weights.apreciativa,
          };
        }
      } else {
        next.weights = { ...MODE_PRESETS[mode] };
      }
      return next;
    });
  };

  const handleWeightChange = (key: 'teoria' | 'practica' | 'apreciativa', v: number) => {
    onChange(prev => ({
      ...prev,
      weights: { ...prev.weights, [key]: Math.max(0, Math.min(100, v)) },
    }));
  };

  const handleCustomWeightChange = (name: string, v: number) => {
    onChange(prev => ({
      ...prev,
      customWeights: { ...prev.customWeights, [name]: Math.max(0, Math.min(100, v)) },
    }));
  };

  const handleCustomRename = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || trimmed === oldName) return;
    onChange(prev => {
      if (!(oldName in prev.customWeights)) return prev;
      const customWeights = { ...prev.customWeights };
      const v = customWeights[oldName];
      delete customWeights[oldName];
      customWeights[trimmed] = v;
      return { ...prev, customWeights };
    });
  };

  const addCustomCategory = () => {
    onChange(prev => {
      const n = Object.keys(prev.customWeights).length;
      const customWeights = { ...prev.customWeights };
      customWeights[`Categoría ${n + 1}`] = 0;
      return { ...prev, customWeights };
    });
  };

  const removeCustomCategory = (name: string) => {
    if (Object.keys(value.customWeights).length <= 2) return;
    onChange(prev => {
      if (!(name in prev.customWeights)) return prev;
      const customWeights = { ...prev.customWeights };
      delete customWeights[name];
      return { ...prev, customWeights };
    });
  };

  return (
    <div className="space-y-5">
      {/* Selector de modo */}
      <div className="grid grid-cols-3 gap-3">
        {([
          { id: 'tradicional', title: 'Tradicional', desc: '30/60/10' },
          { id: 'competencias', title: 'Competencias', desc: 'Saber/Hacer/Ser' },
          { id: 'personalizada', title: 'Personalizada', desc: 'Sliders libres' },
        ] as { id: GradingMode; title: string; desc: string }[]).map(mode => (
          <button
            key={mode.id}
            type="button"
            onClick={() => handleModeChange(mode.id)}
            aria-pressed={value.mode === mode.id}
            className={`text-left rounded-2xl border px-4 py-3 transition-all active:scale-95 ${
              value.mode === mode.id
                ? 'border-[#1A3C40] bg-white shadow-lg shadow-[#1A3C40]/10'
                : 'border-[#1A3C40]/15 bg-white/70 hover:border-[#1A3C40]/40'
            }`}
          >
            <span className="block text-xs font-black text-[#1A3C40]">{mode.title}</span>
            <span className="block text-[10px] text-[#1A3C40]/50 font-bold mt-0.5">{mode.desc}</span>
          </button>
        ))}
      </div>

      {/* Contenido según modo */}
      {value.mode === 'personalizada' ? (
        <div className="space-y-3">
          {Object.entries(value.customWeights).map(([name, v]) => (
            <div key={name} className="bg-white/70 border border-[#1A3C40]/10 rounded-2xl px-4 py-3">
              <div className="flex items-center gap-3">
                <input
                  type="text"
                  value={name}
                  maxLength={60}
                  onChange={(e) => handleCustomRename(name, e.target.value)}
                  className="w-32 bg-transparent text-sm font-black text-[#1A3C40] outline-none border-b border-transparent focus:border-[#1A3C40]/30"
                />
                <div className="flex-1">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={v}
                    onChange={(e) => handleCustomWeightChange(name, parseInt(e.target.value, 10) || 0)}
                    aria-label={`Porcentaje de ${name}`}
                    className="w-full cursor-pointer"
                    style={{ accentColor: '#1A3C40' }}
                  />
                </div>
                <span className="w-14 text-right text-sm font-black text-[#1A3C40] tabular-nums">{v}%</span>
                <button
                  type="button"
                  onClick={() => removeCustomCategory(name)}
                  disabled={Object.keys(value.customWeights).length <= 2}
                  title="Quitar categoría"
                  aria-label={`Quitar categoría ${name}`}
                  className="p-1.5 rounded-lg text-[#1A3C40]/40 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addCustomCategory}
            disabled={Object.keys(value.customWeights).length >= 12}
            className="inline-flex items-center gap-2 bg-white border border-dashed border-[#1A3C40]/30 hover:border-[#1A3C40]/60 text-[#1A3C40] px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-colors disabled:opacity-40"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar categoría
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {WEIGHT_KEYS.map(key => (
            <div key={key} className="bg-white/70 border border-[#1A3C40]/10 rounded-2xl px-5 py-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-black text-[#1A3C40]">{MODE_LABELS[value.mode][key]}</span>
                <span className="text-sm font-black text-[#1A3C40] tabular-nums">{value.weights[key]}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={value.weights[key]}
                onChange={(e) => handleWeightChange(key, parseInt(e.target.value, 10) || 0)}
                aria-label={`Porcentaje de ${MODE_LABELS[value.mode][key]}`}
                className="w-full cursor-pointer"
                style={{ accentColor: '#1A3C40' }}
              />
            </div>
          ))}
        </div>
      )}

      {/* Estado de la suma */}
      <div
        className={`flex items-center justify-between rounded-2xl border px-5 py-3 ${
          isComplete
            ? 'bg-[#2E7D32]/10 border-[#2E7D32]/30 text-[#2E7D32]'
            : 'bg-[#D32F2F]/10 border-[#D32F2F]/30 text-[#D32F2F]'
        }`}
        role="status"
        aria-live="polite"
      >
        <span className="text-xs font-black uppercase tracking-[0.15em]">Total</span>
        <span className="text-sm font-black tabular-nums">
          {isComplete
            ? `${Math.round(total * 100) / 100}% · Listo`
            : `La suma de las ponderaciones debe ser 100%. Actualmente suma ${Math.round(total * 100) / 100}%.`}
        </span>
      </div>

      <div className="bg-[#FFC107]/15 border border-[#FFC107]/40 rounded-2xl px-5 py-4 flex items-start gap-3">
        <CheckCircle2 className="w-5 h-5 text-[#1A3C40] shrink-0 mt-0.5" />
        <p className="text-sm text-[#1A3C40]/85 font-medium">
          La ponderación se guarda en tu institución y quedará disponible para el cálculo de
          notas finales. Los docentes no pueden modificarla.
        </p>
      </div>
    </div>
  );
}
