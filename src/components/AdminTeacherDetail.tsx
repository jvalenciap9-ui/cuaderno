import React, { useMemo, useState } from 'react';
import {
  LayoutDashboard, UserCheck, ClipboardList, FileSpreadsheet, Loader2,
  BookOpen, Users, GraduationCap, ChevronDown, AlertTriangle, BarChart3, Award,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { calculateStudentGrades } from '../lib/gradeCalculator';
import { settingsFromUserSettings, exportTeacherSubjectToExcel } from '../lib/exportUtils';
import { AdminActivityCalendar } from './AdminActivityCalendar';
import { AdminTopBottomGrades } from './AdminTopBottomGrades';
import { AdminAttendanceRanking } from './AdminAttendanceRanking';
import { showToast } from '../hooks/useToast';
import type { AdminTeacherSummaryResponse } from '../lib/adminApi';

interface AdminTeacherDetailProps {
  data: AdminTeacherSummaryResponse;
}

type DetailTab = 'summary' | 'attendance' | 'grades';

const TABS: { id: DetailTab; label: string; icon: React.ReactNode }[] = [
  { id: 'summary', label: 'Resumen', icon: <LayoutDashboard className="w-4 h-4" /> },
  { id: 'attendance', label: 'Asistencia', icon: <UserCheck className="w-4 h-4" /> },
  { id: 'grades', label: 'Calificaciones', icon: <ClipboardList className="w-4 h-4" /> },
];

const attBadge = (pct: number) => {
  if (pct >= 80) return 'text-emerald-600 bg-emerald-50 border-emerald-100';
  if (pct >= 70) return 'text-amber-600 bg-amber-50 border-amber-100';
  return 'text-red-600 bg-red-50 border-red-100';
};

const attLabel = (pct: number) => {
  if (pct >= 80) return 'Aprobado';
  if (pct >= 70) return 'Advertencia';
  return 'Reprobado';
};

export function AdminTeacherDetail({ data }: AdminTeacherDetailProps) {
  const [tab, setTab] = useState<DetailTab>('summary');
  const [subjectId, setSubjectId] = useState<string>(data.subjects[0]?.id || '');
  const [exporting, setExporting] = useState(false);

  const settings = useMemo(() => settingsFromUserSettings(data.settings), [data.settings]);

  const subjects = data.subjects || [];
  const activeSubject = subjects.find(s => s.id === subjectId) || subjects[0];
  const showSubjectPicker = subjects.length > 1;

  const totals = useMemo(() => {
    let students = 0, evaluations = 0, grades = 0, attendance = 0;
    subjects.forEach(s => {
      students += (s.students || []).length;
      evaluations += (s.evaluations || []).length;
      grades += (s.grades || []).length;
      attendance += (s.attendance || []).length;
    });
    return { subjects: subjects.length, students, evaluations, grades, attendance };
  }, [subjects]);

  const handleExport = async () => {
    if (!activeSubject) return;
    setExporting(true);
    try {
      await exportTeacherSubjectToExcel(data as any, activeSubject.id);
      showToast('success', `Reporte de ${activeSubject.name} exportado correctamente.`);
    } catch (err) {
      console.error('Error exportando asignatura:', err);
      showToast('error', 'No se pudo exportar el reporte.');
    } finally {
      setExporting(false);
    }
  };

  const renderSummary = () => (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Asignaturas', value: totals.subjects, icon: <BookOpen className="w-5 h-5" />, color: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
          { label: 'Estudiantes', value: totals.students, icon: <GraduationCap className="w-5 h-5" />, color: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Evaluaciones', value: totals.evaluations, icon: <ClipboardList className="w-5 h-5" />, color: 'text-purple-600 bg-purple-50 border-purple-100' },
          { label: 'Registros de asistencia', value: totals.attendance, icon: <UserCheck className="w-5 h-5" />, color: 'text-blue-600 bg-blue-50 border-blue-100' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-neutral-200 rounded-[2rem] p-6 shadow-sm">
            <div className={cn("w-11 h-11 rounded-2xl flex items-center justify-center border mb-4", s.color)}>{s.icon}</div>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-black">{s.label}</p>
            <p className="text-3xl font-black text-neutral-900">{s.value}</p>
          </div>
        ))}
      </div>

      <AdminActivityCalendar subjects={subjects} />

      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center border border-emerald-100">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-lg font-black text-neutral-900">Asistencia de estudiantes</h4>
            <p className="text-xs text-neutral-500 font-medium">Los 5 mejores y los 5 que deben mejorar su asistencia</p>
          </div>
        </div>
        <AdminAttendanceRanking data={data} />
      </div>

      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center border border-amber-100">
            <Award className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-lg font-black text-neutral-900">Rendimiento de estudiantes</h4>
            <p className="text-xs text-neutral-500 font-medium">Los 5 mejores promedios y los 5 que deben mejorar</p>
          </div>
        </div>
        <AdminTopBottomGrades data={data} />
      </div>
    </div>
  );

  const renderAttendanceSummary = (subject: typeof activeSubject) => {
    const attendance = subject?.attendance || [];
    const sessions = Array.from(new Set(attendance.map((a: any) => a.date))).length;
    const present = attendance.filter((a: any) => a.status === 'present').length;
    const late = attendance.filter((a: any) => a.status === 'late').length;
    const absent = attendance.filter((a: any) => a.status === 'absent').length;
    const total = attendance.length;
    const pct = total ? Math.round(((present + late) / total) * 100) : 0;
    const studentsCount = (subject?.students || []).length;
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Estudiantes', value: studentsCount, accent: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
          { label: 'Sesiones', value: sessions, accent: 'text-blue-600 bg-blue-50 border-blue-100' },
          { label: 'Asistencia', value: `${pct}%`, accent: pct >= 80 ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : pct >= 70 ? 'text-amber-600 bg-amber-50 border-amber-100' : 'text-red-600 bg-red-50 border-red-100' },
          { label: 'Presentes/Tardes', value: `${present}/${late}`, accent: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Ausencias', value: absent, accent: 'text-red-600 bg-red-50 border-red-100' },
        ].map(s => (
          <div key={s.label} className={`bg-white border border-neutral-200 rounded-2xl px-4 py-3 shadow-sm ${s.accent.split(' ').slice(1).join(' ')}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-black">{s.label}</p>
            <p className="text-xl font-black text-neutral-900">{s.value}</p>
          </div>
        ))}
      </div>
    );
  };

  const renderAttendanceTable = (subject: typeof activeSubject) => {
    const students = (subject?.students || []).slice().sort((a: any, b: any) => (a.lastName || '').localeCompare(b.lastName || ''));
    const attendance = subject?.attendance || [];
    const sessions = Array.from(new Set(attendance.map((a: any) => a.date))).sort() as string[];

    const studentPct = (studentId: string) => {
      const recs = attendance.filter((a: any) => a.studentId === studentId);
      if (recs.length === 0) return null;
      const attended = recs.filter((a: any) => a.status === 'present' || a.status === 'late').length;
      return Math.round((attended / recs.length) * 100);
    };

    if (students.length === 0) {
      return (
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-10 text-center shadow-sm">
          <Users className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 font-medium">Este docente no tiene estudiantes registrados en {subject?.name}.</p>
        </div>
      );
    }

    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-neutral-100">
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Estudiante</th>
                <th className="text-left px-4 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Cédula</th>
                {sessions.map(d => {
                  const [y, m, day] = d.split('-');
                  return (
                    <th key={d} className="text-center px-2 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">
                      {`${day}/${m}`}
                    </th>
                  );
                })}
                <th className="text-center px-4 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">% Asist.</th>
                <th className="text-left px-4 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {students.map((s: any) => {
                const pct = studentPct(s.id);
                return (
                  <tr key={s.id} className="hover:bg-neutral-50 transition-colors">
                    <td className="px-6 py-3 font-bold text-neutral-800">{`${s.lastName || ''}, ${s.firstName || ''}`}</td>
                    <td className="px-4 py-3 text-neutral-500 font-medium">{s.cedula || '—'}</td>
                    {sessions.map(d => {
                      const rec = attendance.find((a: any) => a.studentId === s.id && a.date === d);
                      let cell = '-', cls = 'text-neutral-300';
                      if (rec?.status === 'present') { cell = 'P'; cls = 'text-emerald-600 font-black'; }
                      else if (rec?.status === 'late') { cell = 'T'; cls = 'text-amber-500 font-black'; }
                      else if (rec?.status === 'absent') { cell = 'A'; cls = 'text-red-500 font-black'; }
                      return (
                        <td key={d} className={cn("text-center px-2 py-3", cls)}>{cell}</td>
                      );
                    })}
                    <td className="text-center px-4 py-3">
                      {pct === null ? <span className="text-neutral-300">—</span> : (
                        <span className={cn("inline-block px-2.5 py-1 rounded-lg border text-xs font-black", attBadge(pct))}>
                          {pct}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {pct === null ? <span className="text-neutral-300 text-xs">—</span> : (
                        <span className="text-xs font-black uppercase tracking-widest text-neutral-500">{attLabel(pct)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderGradesSummary = (subject: typeof activeSubject) => {
    const students = subject?.students || [];
    const evaluations = subject?.evaluations || [];
    const allGrades = subject?.grades || [];
    const modules = subject?.subjectModules || [];

    const scoreValues = allGrades
      .map((g: any) => (typeof g.score === 'number' ? g.score : null))
      .filter((s: number | null): s is number => s !== null);
    const avg = scoreValues.length
      ? (scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length).toFixed(1)
      : '—';

    const approved = students.filter((s: any) => {
      const studentGrades = allGrades.filter((g: any) => g.studentId === s.id);
      const grades = calculateStudentGrades(
        s.id,
        studentGrades,
        evaluations,
        modules,
        settings.useCheckpoint,
        settings.weights,
        settings.gradingScale as any,
        settings.viewMode,
        settings.calculationMode,
      );
      return grades.total >= settings.gradingScale.minPassingScore;
    }).length;

    const studentsCount = students.length;
    const failed = studentsCount - approved;

    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Estudiantes', value: studentsCount, accent: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
          { label: 'Evaluaciones', value: evaluations.length, accent: 'text-purple-600 bg-purple-50 border-purple-100' },
          { label: 'Promedio', value: avg, accent: 'text-indigo-600 bg-indigo-50 border-indigo-100' },
          { label: 'Aprobados', value: approved, accent: 'text-emerald-600 bg-emerald-50 border-emerald-100' },
          { label: 'Reprobados', value: failed, accent: 'text-red-600 bg-red-50 border-red-100' },
        ].map(s => (
          <div key={s.label} className={`bg-white border border-neutral-200 rounded-2xl px-4 py-3 shadow-sm ${s.accent.split(' ').slice(1).join(' ')}`}>
            <p className="text-[10px] uppercase tracking-[0.2em] text-neutral-400 font-black">{s.label}</p>
            <p className="text-xl font-black text-neutral-900">{s.value}</p>
          </div>
        ))}
      </div>
    );
  };

  const renderGradesTable = (subject: typeof activeSubject) => {
    const students = (subject?.students || []).slice().sort((a: any, b: any) => (a.lastName || '').localeCompare(b.lastName || ''));
    const evaluations = (subject?.evaluations || []).slice().sort((a: any, b: any) => (a.date || '').localeCompare(b.date || ''));
    const allGrades = subject?.grades || [];
    const modules = subject?.subjectModules || [];

    const rows = students.map((s: any) => {
      const studentGrades = allGrades.filter((g: any) => g.studentId === s.id);
      const grades = calculateStudentGrades(
        s.id,
        studentGrades,
        evaluations,
        modules,
        settings.useCheckpoint,
        settings.weights,
        settings.gradingScale as any,
        settings.viewMode,
        settings.calculationMode,
      );
      const scoreFor = (evaluationId: string) => {
        const g = allGrades.find((gr: any) => gr.studentId === s.id && gr.evaluationId === evaluationId);
        return g && typeof g.score === 'number' ? g.score : null;
      };
      return { student: s, grades, scoreFor, isPassing: grades.total >= settings.gradingScale.minPassingScore };
    }).sort((a, b) => (a.student.lastName || '').localeCompare(b.student.lastName || ''));

    if (students.length === 0) {
      return (
        <div className="bg-white border border-neutral-200 rounded-[2rem] p-10 text-center shadow-sm">
          <BarChart3 className="w-8 h-8 text-neutral-300 mx-auto mb-3" />
          <p className="text-sm text-neutral-400 font-medium">Este docente no tiene estudiantes registrados en {subject?.name}.</p>
        </div>
      );
    }

    return (
      <div className="bg-white border border-neutral-200 rounded-[2rem] overflow-hidden shadow-sm">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-neutral-50/70 border-b border-neutral-100">
                <th className="text-left px-6 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Estudiante</th>
                <th className="text-left px-4 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Cédula</th>
                {evaluations.map(e => (
                  <th key={e.id} className="text-center px-2 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">
                    {e.title}{e.maxScore ? ` (${e.maxScore})` : ''}
                  </th>
                ))}
                <th className="text-center px-4 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Nota Final</th>
                <th className="text-left px-4 py-4 text-[10px] uppercase tracking-widest text-neutral-500 font-black">Estado</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {rows.map(({ student, grades, scoreFor, isPassing }) => (
                <tr key={student.id} className="hover:bg-neutral-50 transition-colors">
                  <td className="px-6 py-3 font-bold text-neutral-800">{`${student.lastName || ''}, ${student.firstName || ''}`}</td>
                  <td className="px-4 py-3 text-neutral-500 font-medium">{student.cedula || '—'}</td>
                  {evaluations.map(e => {
                    const sc = scoreFor(e.id);
                    return (
                      <td key={e.id} className={cn("text-center px-2 py-3", sc === null ? 'text-neutral-300' : 'font-bold text-neutral-700')}>
                        {sc === null ? '—' : sc}
                      </td>
                    );
                  })}
                  <td className="text-center px-4 py-3">
                    <span className={cn("text-lg font-black", isPassing ? 'text-emerald-600' : 'text-red-500')}>
                      {grades.total.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "inline-block px-2.5 py-1 rounded-lg border text-xs font-black",
                      isPassing ? 'text-emerald-600 bg-emerald-50 border-emerald-100' : 'text-red-600 bg-red-50 border-red-100',
                    )}>
                      {isPassing ? 'Aprobado' : 'Reprobado'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {evaluations.length === 0 && (
          <p className="px-6 py-4 text-xs text-neutral-400 font-medium border-t border-neutral-100">
            Sin evaluaciones registradas: las notas finales se calculan con las ponderaciones del docente cuando existan.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="bg-white border border-neutral-200 rounded-[2.5rem] overflow-hidden shadow-sm">
      <div className="px-6 md:px-8 py-6 border-b border-neutral-100 bg-gradient-to-br from-neutral-50 to-white">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-xl font-black shadow-lg shadow-indigo-500/25">
              {(data.teacher.displayName || '?').charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="text-xl font-black text-neutral-900">{data.teacher.displayName}</h3>
              <p className="text-sm text-neutral-500 font-medium">{data.teacher.email}</p>
              <p className="text-xs text-neutral-400 font-medium">{data.teacher.institutionName || data.teacher.institutionId}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {showSubjectPicker && (
              <div className="relative">
                <select
                  value={activeSubject?.id || ''}
                  onChange={e => setSubjectId(e.target.value)}
                  className="appearance-none bg-white border border-neutral-200 rounded-xl pl-4 pr-10 py-2.5 text-sm font-bold text-neutral-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer"
                  aria-label="Seleccionar asignatura"
                >
                  {subjects.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            )}
            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-bold shadow-lg shadow-indigo-500/25 hover:bg-indigo-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSpreadsheet className="w-4 h-4" />}
              Exportar Excel
            </button>
          </div>
        </div>

        <div className="flex gap-2 mt-6 border-b border-neutral-100 pb-px overflow-x-auto custom-scrollbar">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2.5 text-sm font-black uppercase tracking-widest rounded-t-xl border-b-2 transition-colors shrink-0",
                tab === t.id
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-neutral-400 hover:text-neutral-700",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="p-6 md:p-8">
        {tab === 'summary' && renderSummary()}
        {tab === 'attendance' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center border border-blue-100">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-neutral-900">Asistencia</h4>
                  <p className="text-xs text-neutral-500 font-medium">
                    {activeSubject?.name}{showSubjectPicker ? '' : ''}
                  </p>
                </div>
              </div>
              {showSubjectPicker && (
                <div className="relative">
                  <select
                    value={activeSubject?.id || ''}
                    onChange={e => setSubjectId(e.target.value)}
                    className="appearance-none bg-white border border-neutral-200 rounded-xl pl-4 pr-10 py-2.5 text-sm font-bold text-neutral-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 cursor-pointer"
                    aria-label="Seleccionar asignatura de asistencia"
                  >
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}
            </div>
            {activeSubject && renderAttendanceSummary(activeSubject)}
            {activeSubject && renderAttendanceTable(activeSubject)}
          </div>
        )}
        {tab === 'grades' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center border border-purple-100">
                  <ClipboardList className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-lg font-black text-neutral-900">Calificaciones</h4>
                  <p className="text-xs text-neutral-500 font-medium">
                    {activeSubject?.name}{showSubjectPicker ? '' : ''}
                  </p>
                </div>
              </div>
              {showSubjectPicker && (
                <div className="relative">
                  <select
                    value={activeSubject?.id || ''}
                    onChange={e => setSubjectId(e.target.value)}
                    className="appearance-none bg-white border border-neutral-200 rounded-xl pl-4 pr-10 py-2.5 text-sm font-bold text-neutral-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-purple-500/30 cursor-pointer"
                    aria-label="Seleccionar asignatura de calificaciones"
                  >
                    {subjects.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="w-4 h-4 text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
              )}
            </div>
            {activeSubject && renderGradesSummary(activeSubject)}
            {activeSubject && renderGradesTable(activeSubject)}
          </div>
        )}
      </div>
    </div>
  );
}
