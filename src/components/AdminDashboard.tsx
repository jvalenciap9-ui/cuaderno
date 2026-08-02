import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import { usePlan } from '../hooks/usePlan';
import { adminListTeachers, adminGetTeacherData, adminGetTeacherSummary, type TeacherSummary, type AdminTeacherSummaryResponse } from '../lib/adminApi';
import { exportTeacherDataToExcel } from '../lib/exportUtils';
import { showToast } from '../hooks/useToast';
import { AdminTeacherDetail } from './AdminTeacherDetail';
import {
  Users,
  BookOpen,
  GraduationCap,
  ClipboardList,
  FileSpreadsheet,
  Search,
  Loader2,
  RefreshCw,
  ShieldCheck,
  EyeOff,
  AlertTriangle,
  ChevronDown,
  ArrowLeft,
  ChevronRight,
} from 'lucide-react';

const formatActivity = (ts: number | null): string => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

const planLabel = (plan: TeacherSummary['plan']): string => {
  if (plan === 'school') return 'Institucional';
  if (plan === 'pro') return 'Premium Pro';
  return 'Gratis';
};

export function AdminDashboard() {
  const { user } = useAuth();
  const { profile, isAdmin } = usePlan();
  const [teachers, setTeachers] = useState<TeacherSummary[]>([]);
  const [institutionName, setInstitutionName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [exportingUid, setExportingUid] = useState<string | null>(null);
  const [selectedUid, setSelectedUid] = useState<string>('');
  const [summary, setSummary] = useState<AdminTeacherSummaryResponse | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errorDetail, setErrorDetail] = useState('');

  const loadTeachers = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await adminListTeachers();
      setTeachers(res.teachers);
      setInstitutionName(profile?.institutionName || res.institutionId);
      if (selectedUid && !res.teachers.some(t => t.uid === selectedUid)) {
        setSelectedUid('');
        setSummary(null);
      }
    } catch (err: any) {
      console.error('adminListTeachers error:', err);
      setError(err?.message || 'No se pudieron cargar los docentes.');
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async (uid: string) => {
    setSelectedUid(uid);
    setSummary(null);
    setErrorDetail('');
    if (!uid) return;
    setLoadingDetail(true);
    try {
      const res = await adminGetTeacherSummary(uid);
      setSummary(res);
    } catch (err: any) {
      console.error('adminGetTeacherSummary error:', err);
      setErrorDetail(err?.message || 'No se pudo cargar el detalle del docente.');
    } finally {
      setLoadingDetail(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) return;
    loadTeachers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, isAdmin]);

  const selectedTeacher = useMemo(
    () => teachers.find(t => t.uid === selectedUid) || null,
    [teachers, selectedUid],
  );

  const handleExport = async (teacher: TeacherSummary) => {
    setExportingUid(teacher.uid);
    try {
      showToast('info', `Generando reporte de ${teacher.displayName}...`);
      const data = await adminGetTeacherData(teacher.uid);
      await exportTeacherDataToExcel(data);
      showToast('success', `Reporte de ${teacher.displayName} exportado.`);
    } catch (err: any) {
      console.error('adminGetTeacherData error:', err);
      showToast('error', err?.message || 'No se pudo exportar el reporte del docente.');
    } finally {
      setExportingUid(null);
    }
  };

  const filtered = teachers.filter(t => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return (
      (t.displayName || '').toLowerCase().includes(q) ||
      (t.email || '').toLowerCase().includes(q)
    );
  });

  const totals = teachers.reduce(
    (acc, t) => ({
      teachers: acc.teachers + 1,
      subjects: acc.subjects + (t.counts?.subjects || 0),
      students: acc.students + (t.counts?.students || 0),
      evaluations: acc.evaluations + (t.counts?.evaluations || 0),
      grades: acc.grades + (t.counts?.grades || 0),
      attendance: acc.attendance + (t.counts?.attendance || 0),
    }),
    { teachers: 0, subjects: 0, students: 0, evaluations: 0, grades: 0, attendance: 0 },
  );

  if (!isAdmin) {
    return (
      <div className="p-8 md:p-12 max-w-5xl mx-auto w-full">
        <div className="bg-amber-50 border border-amber-200 rounded-[2rem] p-10 text-center">
          <AlertTriangle className="w-12 h-12 text-amber-500 mx-auto mb-6" />
          <h2 className="text-2xl font-black text-neutral-900 mb-3">Acceso restringido</h2>
          <p className="text-neutral-500 font-medium">El panel institucional solo está disponible para administradores.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 md:p-12 max-w-7xl mx-auto w-full space-y-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-14 h-14 bg-indigo-600 rounded-[1.25rem] flex items-center justify-center border border-indigo-100 shadow-lg shadow-indigo-500/20">
            <img src="/logo.webp" alt="Logo" className="app-logo w-8 h-8 object-contain" style={{ filter: 'none', backgroundColor: 'transparent' }} />
          </div>
          <div>
            <h2 className="text-4xl font-black text-neutral-900 tracking-tight">Panel Institucional</h2>
            <p className="text-neutral-500 mt-1 font-medium">
              {institutionName ? `Institución: ${institutionName}` : 'Gestión de cuentas docentes'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-white border border-neutral-200 rounded-2xl px-4 py-2.5 shadow-sm">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Acceso de solo lectura</span>
          </div>
          <button
            onClick={loadTeachers}
            disabled={loading}
            title="Actualizar lista de docentes"
            className="flex items-center gap-2 bg-white border border-neutral-200 hover:bg-neutral-50 text-neutral-600 px-4 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-2xl px-5 py-4 text-blue-800 text-sm font-medium">
        <EyeOff className="w-5 h-5 shrink-0" />
        El administrador solo puede consultar y exportar datos. Está prohibido modificar asistencias y calificaciones de los docentes.
      </div>

      {/* Totales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Docentes</p>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2 flex items-center gap-3">
            {totals.teachers}
            <Users className="w-6 h-6 text-blue-500" />
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Asignaturas</p>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2 flex items-center gap-3">
            {totals.subjects}
            <BookOpen className="w-6 h-6 text-indigo-500" />
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Estudiantes</p>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2 flex items-center gap-3">
            {totals.students}
            <GraduationCap className="w-6 h-6 text-emerald-500" />
          </p>
        </div>
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
          <p className="text-neutral-400 text-[10px] font-black uppercase tracking-[0.2em]">Evaluaciones</p>
          <p className="text-4xl font-black text-neutral-900 leading-none mt-2 flex items-center gap-3">
            {totals.evaluations}
            <ClipboardList className="w-6 h-6 text-purple-500" />
          </p>
        </div>
      </div>

      {/* Selección y búsqueda */}
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative md:w-80 shrink-0">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-neutral-500">Docentes activos</span>
            <span className="bg-blue-50 text-blue-600 text-[10px] font-black px-2.5 py-1 rounded-full">{teachers.length}</span>
          </div>
          <select
            value={selectedUid}
            onChange={(e) => loadSummary(e.target.value)}
            disabled={loading}
            className="appearance-none w-full bg-white border border-neutral-200 rounded-2xl pl-4 pr-12 py-3.5 text-sm font-bold text-neutral-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all disabled:opacity-50 cursor-pointer"
            aria-label="Seleccionar docente"
          >
            <option value="">Selecciona un docente...</option>
            {teachers.map(t => (
              <option key={t.uid} value={t.uid}>{t.displayName} — {t.email}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400 pointer-events-none" />
        </div>
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-neutral-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar docente por nombre o email..."
            className="w-full bg-white border border-neutral-200 rounded-2xl pl-12 pr-4 py-3.5 text-sm font-medium text-neutral-900 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/5 transition-all"
          />
        </div>
      </div>

      {selectedUid ? (
        loadingDetail ? (
          <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm">
            <div className="flex flex-col items-center justify-center py-24">
              <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
              <p className="text-sm font-bold text-neutral-500">Cargando detalle del docente...</p>
            </div>
          </div>
        ) : errorDetail ? (
          <div className="bg-white border border-neutral-200 rounded-[2rem] p-12 text-center shadow-sm">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
            <p className="text-lg font-black text-neutral-900 mb-2">Error al cargar el detalle</p>
            <p className="text-sm text-neutral-500 font-medium">{errorDetail}</p>
            <button
              onClick={() => loadSummary(selectedUid)}
              className="mt-6 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-5 py-2.5 rounded-2xl text-xs font-black uppercase tracking-widest transition-all active:scale-95"
            >
              <RefreshCw className="w-4 h-4" />
              Reintentar
            </button>
          </div>
        ) : summary ? (
          <div className="space-y-4">
            <button
              onClick={() => { setSelectedUid(''); setSummary(null); }}
              className="inline-flex items-center gap-2 text-sm font-black text-blue-600 hover:text-blue-700 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver a la lista de docentes
            </button>
            <AdminTeacherDetail data={summary} />
          </div>
        ) : null
      ) : (
      <div className="bg-white border border-neutral-200 rounded-[2rem] shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-4" />
            <p className="text-sm font-bold text-neutral-500">Cargando docentes...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center">
            <AlertTriangle className="w-12 h-12 text-red-400 mx-auto mb-6" />
            <p className="text-lg font-black text-neutral-900 mb-2">Error al cargar</p>
            <p className="text-sm text-neutral-500 font-medium">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <Users className="w-12 h-12 text-neutral-200 mx-auto mb-6" />
            <p className="text-lg font-black text-neutral-900 mb-2">
              {search ? 'Sin resultados' : 'No hay docentes aún'}
            </p>
            <p className="text-sm text-neutral-500 font-medium">
              {search
                ? 'Prueba con otro nombre o email.'
                : 'Los docentes de tu institución aparecerán aquí cuando activen sus cuentas.'}
            </p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-neutral-50 border-b border-neutral-100">
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Docente</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Plan</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Asig.</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Estud.</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Eval.</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-center">Asist.</th>
                <th className="px-4 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400">Última actividad</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-right">Excel</th>
                <th className="px-8 py-4 text-[10px] font-black uppercase tracking-[0.2em] text-neutral-400 text-right">Detalle</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {filtered.map(teacher => (
                <tr key={teacher.uid} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 font-black text-sm shrink-0">
                        {(teacher.displayName || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="font-black text-sm text-neutral-900 truncate">{teacher.displayName}</p>
                        <p className="text-xs text-neutral-400 font-medium truncate">{teacher.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-5">
                    <span className="text-[10px] font-black uppercase tracking-widest bg-neutral-100 text-neutral-600 px-3 py-1.5 rounded-full">
                      {planLabel(teacher.plan)}
                    </span>
                  </td>
                  <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.subjects ?? 0}</td>
                  <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.students ?? 0}</td>
                  <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.evaluations ?? 0}</td>
                  <td className="px-4 py-5 text-center font-bold text-neutral-700">{teacher.counts?.attendance ?? 0}</td>
                  <td className="px-4 py-5">
                    <span className="text-xs font-bold text-neutral-500">{formatActivity(teacher.lastActivity as any)}</span>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button
                      onClick={() => handleExport(teacher)}
                      disabled={exportingUid === teacher.uid}
                      title={`Exportar reporte Excel de ${teacher.displayName}`}
                      className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95 shadow-lg shadow-blue-500/20"
                    >
                      {exportingUid === teacher.uid ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileSpreadsheet className="w-4 h-4" />
                      )}
                      {exportingUid === teacher.uid ? 'Exportando...' : 'Exportar'}
                    </button>
                  </td>
                  <td className="px-8 py-5 text-right">
                    <button
                      onClick={() => loadSummary(teacher.uid)}
                      title={`Ver detalle de ${teacher.displayName}`}
                      className="inline-flex items-center gap-1 bg-white border border-neutral-200 hover:border-blue-300 hover:text-blue-600 text-neutral-500 px-4 py-2.5 rounded-2xl text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                    >
                      Ver
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
    </div>
  );
}
