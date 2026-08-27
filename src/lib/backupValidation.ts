/**
 * backupValidation.ts — Validación pura del respaldo institucional de EdiAgil.
 *
 * Regla de producto: el JSON de respaldo es un EXPORT ANALÍTICO
 * (agregados + detalle por docente) con metadata en la raíz. Esta función
 * decide si un archivo puede entrar al pipeline de restauración y produce un
 * resumen con conteos derivados SOLO de datos presentes en el payload (nunca
 * inventa: lo no derivable queda en null → la UI muestra '—').
 *
 * Los errores NUNCA exponen detalles técnicos: se traducen a códigos +
 * mensajes de usuario. Espejo backend: functions/lib/backup-validate.js.
 *
 * POLÍTICA NO DESTRUCTIVA (documentada): validar un respaldo NO implica un
 * reemplazo total. La restauración es de CONFIGURACIÓN por upsert —
 * semántica `institution-config-restore`: "restaurar no elimina registros
 * existentes"; si el respaldo omite información presente en el sistema, esta
 * NO se elimina. NO es un snapshot exacto con reemplazo total. Una hipotética
 * `institution-full-restore` futura (reemplazo total con documentos crudos)
 * DEBE ser una operación SEPARADA con su propia validación — jamás reutilizar
 * silenciosamente esta semántica para ambos propósitos.
 *
 * COMPATIBILIDAD FUTURA (solo preparación): BACKUP_TYPE ('institution-full-backup')
 * y SUPPORTED_BACKUP_VERSIONS son estables. Una futura restauración COMPLETA
 * requeriría un NUEVO tipo de export con documentos crudos (p. ej.
 * 'institution-full-backup-v2') y su propia validación.
 */

export const BACKUP_TYPE = 'institution-full-backup';
export const SUPPORTED_BACKUP_VERSIONS = ['1.0'];

export type BackupErrorCode =
  | 'NOT_JSON'
  | 'NOT_BACKUP'
  | 'VERSION_UNSUPPORTED'
  | 'STRUCTURE_INVALID'
  | 'INSTITUTION_MISMATCH';

export interface AdminBackupExportMeta {
  schemaVersion?: string;
  type?: string;
  generatedBy?: string;
  appVersion?: string;
  exportedAt?: string;
  institutionId?: string;
  institutionName?: string;
}

export interface BackupSummary {
  institutionId: string;
  institutionName: string;
  exportedAt: string | null;
  schemaVersion: string;
  counts: {
    teachers: number | null;
    subjects: number | null;
    evaluations: number | null;
    attendance: number | null;
  };
}

export type BackupValidationResult =
  | { ok: true; summary: BackupSummary }
  | { ok: false; code: BackupErrorCode; userMessage: string };

const INVALID_MESSAGE = 'Este archivo no parece ser un respaldo válido de EdiAgil.';

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const asString = (v: unknown): string => (typeof v === 'string' ? v : '');

// Conteo derivado del detalle por docente (suma sobre teacherDetails) o, en su
// defecto, de los totales agregados de stats. null = no derivable.
function deriveCount(
  details: Record<string, Record<string, unknown>> | null,
  detailKey: string,
  statsTotals: Record<string, unknown> | null,
  totalsKey: string,
): number | null {
  if (details) {
    let total = 0;
    for (const uid of Object.keys(details)) {
      const d = details[uid];
      if (!isObj(d)) return null;
      if (Array.isArray(d[detailKey])) {
        total += d[detailKey].length;
        continue;
      }
      // Filas anidadas por asignatura (TeacherSubjectData.{detailKey}[])
      if (Array.isArray(d.subjects)) {
        let subTotal = 0;
        for (const s of d.subjects as unknown[]) {
          if (!isObj(s) || !Array.isArray((s as Record<string, unknown>)[detailKey])) return null;
          subTotal += ((s as Record<string, unknown>)[detailKey] as unknown[]).length;
        }
        total += subTotal;
        continue;
      }
      return null;
    }
    return total;
  }
  if (statsTotals && typeof statsTotals[totalsKey] === 'number') {
    return statsTotals[totalsKey];
  }
  return null;
}

export function validateInstitutionBackup(
  payload: unknown,
  expectedInstitutionId: string,
): BackupValidationResult {
  // (a) JSON válido y objeto raíz
  if (!isObj(payload)) {
    return { ok: false, code: 'NOT_JSON', userMessage: INVALID_MESSAGE };
  }

  const meta = isObj(payload.export) ? (payload.export as AdminBackupExportMeta) : null;

  // (b) Tipo reconocido: export.type explícito O forma legacy (version + institutionId)
  const declaredType = meta ? asString(meta.type) : '';
  const legacyVersion = asString(payload.version);
  const legacyForm = legacyVersion !== '' && asString(payload.institutionId) !== '';
  if (declaredType && declaredType !== BACKUP_TYPE) {
    return { ok: false, code: 'NOT_BACKUP', userMessage: INVALID_MESSAGE };
  }
  if (!declaredType && !legacyForm) {
    return { ok: false, code: 'NOT_BACKUP', userMessage: INVALID_MESSAGE };
  }

  // (c) Versión soportada (schemaVersion nuevo o version legacy)
  const schemaVersion = (meta && asString(meta.schemaVersion)) || legacyVersion || '1.0';
  if (!SUPPORTED_BACKUP_VERSIONS.includes(schemaVersion)) {
    return {
      ok: false,
      code: 'VERSION_UNSUPPORTED',
      userMessage: 'Este respaldo fue generado con una versión no compatible.',
    };
  }

  // (d) Estructura mínima: institutionId presente
  const backupInstitutionId = asString(payload.institutionId);
  if (!backupInstitutionId) {
    return {
      ok: false,
      code: 'STRUCTURE_INVALID',
      userMessage: INVALID_MESSAGE,
    };
  }

  // (e) El respaldo debe pertenecer a la institución del admin
  if (expectedInstitutionId && backupInstitutionId !== expectedInstitutionId) {
    return {
      ok: false,
      code: 'INSTITUTION_MISMATCH',
      userMessage: 'Este respaldo pertenece a otra institución. No puedes restaurarlo aquí.',
    };
  }

  // Resumen con conteos SOLO derivables del payload
  const details = isObj(payload.teacherDetails)
    ? (payload.teacherDetails as Record<string, Record<string, unknown>>)
    : null;
  const hasDetailArrays = !!details &&
    Object.keys(details).length > 0 &&
    Object.values(details).every(d => isObj(d));
  const statsTotals = isObj(payload.stats) && isObj((payload.stats as Record<string, unknown>).totals)
    ? ((payload.stats as Record<string, unknown>).totals as Record<string, unknown>)
    : null;

  const teachersList = isObj(payload.teachers) && Array.isArray((payload.teachers as Record<string, unknown>).teachers)
    ? ((payload.teachers as Record<string, unknown>).teachers as unknown[]).length
    : (statsTotals && typeof statsTotals.teachers === 'number' ? statsTotals.teachers : null);

  const summary: BackupSummary = {
    institutionId: backupInstitutionId,
    institutionName: (meta && asString(meta.institutionName)) || asString(payload.institutionName),
    exportedAt: (meta && asString(meta.exportedAt)) || asString(payload.exportedAt) || null,
    schemaVersion,
    counts: {
      teachers: teachersList,
      subjects: deriveCount(hasDetailArrays ? details : null, 'subjects', statsTotals, 'subjects'),
      evaluations: deriveCount(hasDetailArrays ? details : null, 'evaluations', statsTotals, 'evaluations'),
      attendance: deriveCount(hasDetailArrays ? details : null, 'attendance', statsTotals, 'attendanceCount'),
    },
  };

  return { ok: true, summary };
}
