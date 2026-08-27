import { useEffect, useState } from 'react';
import { fetchStudentData, fetchGrades, fetchAttendance, fetchSchoolConfig } from '@/lib/reportService';
import { exportInstitutionalReport } from '@/lib/exportUtils';
import { showToast } from '@/hooks/useToast';
import { usePlan } from '@/hooks/usePlan';
import type { Student, Grade, Attendance, SchoolConfig } from '@/types/firestore';

interface InstitutionalReportProps {
  studentId: string;
  period: 'I' | 'II' | 'III';
  schoolId: string;
  /** Callback opcional de cierre: si se provee, se muestra un botón "Cerrar"
   *  y se cierra con Escape (necesario cuando se embebe como modal). */
  onClose?: () => void;
}

export default function InstitutionalReport({
  studentId,
  period,
  schoolId,
  onClose,
}: InstitutionalReportProps) {
  const { isPro, isAdmin } = usePlan();
  const [student, setStudent] = useState<Student | null>(null);
  const [subjects, setSubjects] = useState<Grade[]>([]);
  const [attendance, setAttendance] = useState<Attendance | null>(null);
  const [schoolConfig, setSchoolConfig] = useState<SchoolConfig | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        const [studentData, gradesData, attendanceData, config] = await Promise.all([
          fetchStudentData(studentId),
          fetchGrades(studentId, period),
          fetchAttendance(studentId, period),
          fetchSchoolConfig(schoolId),
        ]);
        if (!isMounted) return;
        setStudent(studentData);
        setSubjects(gradesData);
        setAttendance(attendanceData);
        setSchoolConfig(config);
      } catch (error) {
        console.error('Error cargando datos del boletín:', error);
      } finally {
        if (isMounted) setLoading(false);
      }
    }
    loadData();
    return () => {
      isMounted = false;
    };
  }, [studentId, period, schoolId]);

  // Cerrar con Escape (solo cuando hay un onClose configurado).
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleExport = async () => {
    if (!isPro && !isAdmin) {
      showToast('warning', '¡Actualiza a Premium Pro para exportar tus reportes a PDF!');
      return;
    }
    try {
      await exportInstitutionalReport('institutional-report', 'boletin-institucional.pdf');
      showToast('success', 'Boletín exportado en PDF.');
    } catch (err: any) {
      console.error('exportInstitutionalReport error:', err);
      showToast('error', err?.message || 'No se pudo exportar el boletín.');
    }
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-[#1A3C40]">Cargando boletín...</p>
      </div>
    );
  }

  if (!student || !subjects.length) {
    return (
      <div className="flex h-screen items-center justify-center bg-white">
        <p className="text-[#1A3C40]">No se encontraron datos para el alumno.</p>
      </div>
    );
  }

  const average = subjects.reduce((acc, s) => acc + (s.finalGrade || 0), 0) / subjects.length;

  return (
    <>
      {/* Botones de exportación / cierre (fuera del área imprimible) */}
      <div className="no-print mb-4 flex justify-end gap-2 px-8 pt-6">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Cerrar boletín"
            className="rounded-md bg-neutral-200 px-4 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-300"
          >
            Cerrar
          </button>
        )}
        <button
          onClick={handleExport}
          className="rounded-md bg-[#2E7D32] px-4 py-2 text-sm font-medium text-white hover:bg-[#1E5A24]"
        >
          Exportar PDF
        </button>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-[#1A3C40] px-4 py-2 text-sm font-medium text-white hover:bg-[#0E2A2E]"
        >
          Imprimir
        </button>
      </div>
      {/* Contenedor del boletín compacto */}
      <div
        id="institutional-report"
        className="report-container mx-auto max-w-4xl bg-white p-4 text-[#1A3C40]"
      >
        {/* Encabezado institucional compacto */}
        <div className="mb-3 text-center">
          {schoolConfig?.logoUrl && (
            <img
              src={schoolConfig.logoUrl}
              alt={schoolConfig.schoolName}
              className="mx-auto mb-1 h-14 object-contain"
            />
          )}
          <h1 className="text-lg font-bold uppercase leading-tight tracking-wide">
            {schoolConfig?.schoolName || 'Nombre de la Institución'}
          </h1>
          <h2 className="text-base font-semibold leading-tight">
            BOLETÍN DE CALIFICACIONES
          </h2>
          <p className="text-xs uppercase">{period} TRIMESTRE</p>
        </div>
        {/* Datos del estudiante compactos */}
        <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-1 border border-gray-400 p-2 text-xs">
          <div>
            <span className="font-semibold">Nombre:</span> {student.fullName}
          </div>
          <div>
            <span className="font-semibold">Año Lectivo:</span> {student.academicYear}
          </div>
          <div>
            <span className="font-semibold">Cédula:</span> {student.documentId}
          </div>
          <div>
            <span className="font-semibold">Fecha:</span> {new Date().toLocaleDateString()}
          </div>
          <div>
            <span className="font-semibold">Grupo:</span> {student.grade} {student.section}
          </div>
          <div>
            <span className="font-semibold">Consejero:</span> {student.counselor}
          </div>
        </div>
        {/* Tabla de asignaturas compacta */}
        <h3 className="mb-1 text-sm font-semibold">Asignaturas</h3>
        <table className="mb-3 w-full border-collapse border border-gray-400 text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 px-1 py-0.5 text-left">ASIGNATURA</th>
              <th className="border border-gray-400 px-1 py-0.5">I</th>
              <th className="border border-gray-400 px-1 py-0.5">II</th>
              <th className="border border-gray-400 px-1 py-0.5">III</th>
              <th className="border border-gray-400 px-1 py-0.5">NOTA</th>
              <th className="border border-gray-400 px-1 py-0.5">A1</th>
              <th className="border border-gray-400 px-1 py-0.5">T1</th>
              <th className="border border-gray-400 px-1 py-0.5">A2</th>
              <th className="border border-gray-400 px-1 py-0.5">T2</th>
              <th className="border border-gray-400 px-1 py-0.5">A3</th>
              <th className="border border-gray-400 px-1 py-0.5">T3</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((grade) => (
              <tr key={grade.subjectId}>
                <td className="border border-gray-400 px-1 py-0.5">
                  {grade.subjectName}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {grade.term1}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {grade.term2}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {grade.term3}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center font-bold">
                  {grade.finalGrade}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.A1 || ''}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.T1 || ''}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.A2 || ''}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.T2 || ''}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.A3 || ''}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.T3 || ''}
                </td>
              </tr>
            ))}
            <tr className="bg-gray-50 font-semibold">
              <td colSpan={4} className="border border-gray-400 px-1 py-0.5 text-right">
                PROMEDIO
              </td>
              <td className="border border-gray-400 px-1 py-0.5 text-center">
                {average.toFixed(2)}
              </td>
              <td colSpan={6} className="border border-gray-400"></td>
            </tr>
          </tbody>
        </table>
        {/* Tabla de hábitos y actitudes compacta */}
        <h3 className="mb-1 text-sm font-semibold">Hábitos y Actitudes</h3>
        <table className="mb-3 w-full border-collapse border border-gray-400 text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 px-1 py-0.5 text-left">
                HÁBITOS Y ACTITUDES
              </th>
              <th className="border border-gray-400 px-1 py-0.5">I</th>
              <th className="border border-gray-400 px-1 py-0.5">II</th>
              <th className="border border-gray-400 px-1 py-0.5">III</th>
            </tr>
          </thead>
          <tbody>
            {[
              'RESPONSABILIDAD',
              'PUNTUALIDAD',
              'HONRADEZ',
              'CONCIENCIA CÍVICA',
              'ORGANIZACIÓN DEL TRABAJO',
              'AUTOD. Y CONF. EN SÍ MISMO',
              'INICIATIVA',
              'COOPERACIÓN',
              'RESPETO A LA PROPIEDAD AJENA',
              'MODALES',
              'ORDEN Y ASEO',
              'EMPLEO DEL TIEMPO LIBRE',
            ].map((habit) => (
              <tr key={habit}>
                <td className="border border-gray-400 px-1 py-0.5">{habit}</td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.habits?.[habit]?.I || 'S'}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.habits?.[habit]?.II || 'S'}
                </td>
                <td className="border border-gray-400 px-1 py-0.5 text-center">
                  {attendance?.habits?.[habit]?.III || 'S'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {/* Observaciones compactas (boletín v2). Este componente LEGACY usa el
            esquema de reportService.ts (incompatible con el modelo moderno) y
            NO tiene capa de observaciones: se deja un recuadro en blanco como
            placeholder para escritura a mano, igual que el boletín impreso. */}
        <div className="mb-3">
          <h3 className="mb-1 text-sm font-semibold uppercase">Observaciones</h3>
          <div className="h-16 border border-gray-400 p-1"></div>
        </div>
        {/* Firmas compactas */}
        <div className="mb-3 flex justify-between">
          <div className="text-center">
            <div className="mb-1 h-8 w-56 border-b border-gray-400"></div>
            <p className="text-xs">Profesor consejero</p>
          </div>
          <div className="text-center">
            <div className="mb-1 h-8 w-56 border-b border-gray-400"></div>
            <p className="text-xs">Director</p>
          </div>
        </div>
        {/* Leyenda compacta */}
        <div className="mt-2 border-t border-gray-400 pt-2 text-[10px] leading-tight">
          <p>LEYENDA:</p>
          <p>S - Satisfactorio | R - Regular | X - No Satisface</p>
          <p>5 - Excelente | 4 - Bueno | 3 - Regular | 2 - Apenas Regular | 1 - Mala</p>
        </div>
      </div>
    </>
  );
}