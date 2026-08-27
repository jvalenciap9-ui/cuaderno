/**
 * test-backup-validate.mjs — Validación del respaldo institucional (Parte 1
 * del rediseño de exportaciones). Verifica que validateInstitutionBackup:
 *   a) Acepta el formato nuevo (export.type = institution-full-backup) y la
 *      forma legacy (version + institutionId).
 *   b) Rechaza basura, tipos desconocidos, versiones no soportadas y
 *      estructuras mínimas incompletas con códigos amigables.
 *   c) Exige coincidencia de institución (INSTITUTION_MISMATCH).
 *   d) Deriva conteos desde teacherDetails y, en su defecto, stats.totals;
 *      devuelve null (no inventa) cuando nada es derivable.
 *
 * Uso: node scripts/test-backup-validate.mjs   (no requiere emulador)
 */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { validateInstitutionBackup, BACKUP_TYPE } = require('../functions/lib/backup-validate.js');

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, extra = '') {
  if (ok) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; failures.push(name); console.log(`  ❌ ${name} ${extra}`); }
}

function expectFail(name, payload, expectedId, expectedCode) {
  const r = validateInstitutionBackup(payload, expectedId);
  check(name, !r.ok && r.code === expectedCode && typeof r.userMessage === 'string' && r.userMessage.length > 0,
    `(got code=${r.ok ? 'ok' : r.code})`);
}

const INST = 'inst_demo_001';

function fullBackup(overrides = {}) {
  return {
    version: '1.0',
    exportedAt: '2026-08-24T10:00:00.000Z',
    institutionId: INST,
    institutionName: 'Colegio Aurora',
    filters: {},
    export: {
      schemaVersion: '1.0',
      type: BACKUP_TYPE,
      generatedBy: 'EdiAgil',
      appVersion: '1.0.0',
      exportedAt: '2026-08-24T10:00:00.000Z',
      institutionId: INST,
      institutionName: 'Colegio Aurora',
    },
    schoolConfig: { logoUrl: '', slogan: 'Mentes', onboardingDone: true },
    gradingWeight: { mode: 'tradicional', weights: { teoria: 30, practica: 60, apreciativa: 10 }, customWeights: {}, applyTo: 'global' },
    periodos: { matutino: { activo: true, horarioInicio: '07:00', horarioFin: '12:00' } },
    planRules: { reglaSeleccionada: 'trimestral', recomendarADocentes: true },
    teachers: { institutionId: INST, teachers: [{ uid: 't01' }, { uid: 't02' }] },
    teacherDetails: {
      t01: {
        teacher: { uid: 't01' },
        subjects: [{ id: 's1', students: [], evaluations: [1, 2], attendance: [1] }],
      },
      t02: {
        teacher: { uid: 't02' },
        subjects: [{ id: 's2', students: [], evaluations: [], attendance: [1, 2, 3] }],
      },
    },
    ...overrides,
  };
}

console.log('── Formatos aceptados ──');

{
  const r = validateInstitutionBackup(fullBackup(), INST);
  check('backup completo nuevo pasa', r.ok === true);
  check('resumen: institución correcta', r.ok && r.summary.institutionId === INST && r.summary.institutionName === 'Colegio Aurora');
  check('resumen: exportedAt desde metadata', r.ok && r.summary.exportedAt === '2026-08-24T10:00:00.000Z');
  check('conteo docentes = 2', r.ok && r.summary.counts.teachers === 2);
  check('conteo asignaturas derivado de teacherDetails = 2', r.ok && r.summary.counts.subjects === 2);
  check('conteo evaluaciones derivado = 2', r.ok && r.summary.counts.evaluations === 2);
  check('conteo asistencia derivado = 4', r.ok && r.summary.counts.attendance === 4);
}
{
  const legacy = fullBackup();
  delete legacy.export;
  const r = validateInstitutionBackup(legacy, INST);
  check('forma legacy (version+institutionId) pasa sin export meta', r.ok === true && r.summary.schemaVersion === '1.0');
  check('legacy: exportedAt cae al campo raíz', r.ok && r.summary.exportedAt === '2026-08-24T10:00:00.000Z');
}

console.log('── Rechazos ──');

expectFail('null → NOT_JSON', null, INST, 'NOT_JSON');
expectFail('string → NOT_JSON', 'hola', INST, 'NOT_JSON');
expectFail('array → NOT_JSON', [fullBackup()], INST, 'NOT_JSON');
expectFail('objeto vacío → NOT_BACKUP', {}, INST, 'NOT_BACKUP');
expectFail('JSON arbitrario → NOT_BACKUP', { hola: 'mundo', datos: [1, 2, 3] }, INST, 'NOT_BACKUP');
expectFail('export.type desconocido → NOT_BACKUP',
  fullBackup({ export: { type: 'otra-cosa', schemaVersion: '1.0' } }), INST, 'NOT_BACKUP');

console.log('── Versión e institución ──');

expectFail('schemaVersion futura → VERSION_UNSUPPORTED',
  fullBackup({ export: { type: BACKUP_TYPE, schemaVersion: '2.0' } }), INST, 'VERSION_UNSUPPORTED');
expectFail('version legacy "9.9" → VERSION_UNSUPPORTED', { version: '9.9', institutionId: INST }, INST, 'VERSION_UNSUPPORTED');
expectFail('sin institutionId → STRUCTURE_INVALID',
  { version: '1.0', export: { type: BACKUP_TYPE, schemaVersion: '1.0' } }, INST, 'STRUCTURE_INVALID');
expectFail('institución distinta → INSTITUTION_MISMATCH', fullBackup(), 'inst_OTRA', 'INSTITUTION_MISMATCH');
check('expectedInstitutionId vacío no bloquea (el backend siempre lo envía)',
  validateInstitutionBackup(fullBackup(), '').ok === true);

console.log('── Conteos no derivables → null (la UI muestra "—") ──');

{
  const b = fullBackup();
  delete b.teacherDetails;
  delete b.stats;
  const r = validateInstitutionBackup(b, INST);
  check('sin detalles ni stats: asignaturas/evaluaciones/asistencia = null',
    r.ok && r.summary.counts.subjects === null && r.summary.counts.evaluations === null && r.summary.counts.attendance === null);
  check('docentes sigue derivable de teachers', r.ok && r.summary.counts.teachers === 2);
}
{
  const b = fullBackup();
  delete b.teacherDetails;
  b.stats = { totals: { teachers: 7, subjects: 15, evaluations: 60, attendanceCount: 900 } };
  const r = validateInstitutionBackup(b, INST);
  check('fallback a stats.totals cuando no hay teacherDetails',
    r.ok && r.summary.counts.subjects === 15 && r.summary.counts.evaluations === 60 && r.summary.counts.attendance === 900 && r.summary.counts.teachers === 2,
    JSON.stringify(r.ok ? r.summary.counts : r));
}
{
  const b = fullBackup({ teacherDetails: { t01: { teacher: {} } } });
  const r = validateInstitutionBackup(b, INST);
  check('teacherDetails sin arrays → conteo null (estructura inesperada, no se asume)',
    r.ok && r.summary.counts.subjects === null);
}

console.log(`\nResultado: ${pass} pasan, ${fail} fallan`);
if (fail > 0) {
  console.log('Fallos:', failures.join(' | '));
  process.exit(1);
}
