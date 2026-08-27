// backup-validate.js — Espejo backend de src/lib/backupValidation.ts.
//
// Revalida en el SERVIDOR (adminRestoreInstitutionBackup) que el payload sea
// un respaldo institucional legítimo y de la institución del admin: nunca se
// confía en la validación del frontend. Lógica pura, sin dependencias de
// Firebase, testeada en scripts/test-backup-validate.mjs.

const BACKUP_TYPE = 'institution-full-backup';
const SUPPORTED_BACKUP_VERSIONS = ['1.0'];

const INVALID_MESSAGE = 'Este archivo no parece ser un respaldo válido de EdiAgil.';

function isObj(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

function deriveCount(details, detailKey, statsTotals, totalsKey) {
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
        for (const s of d.subjects) {
          if (!isObj(s) || !Array.isArray(s[detailKey])) return null;
          subTotal += s[detailKey].length;
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

function validateInstitutionBackup(payload, expectedInstitutionId) {
  if (!isObj(payload)) {
    return { ok: false, code: 'NOT_JSON', userMessage: INVALID_MESSAGE };
  }

  const meta = isObj(payload.export) ? payload.export : null;

  const declaredType = meta ? asString(meta.type) : '';
  const legacyVersion = asString(payload.version);
  const legacyForm = legacyVersion !== '' && asString(payload.institutionId) !== '';
  if (declaredType && declaredType !== BACKUP_TYPE) {
    return { ok: false, code: 'NOT_BACKUP', userMessage: INVALID_MESSAGE };
  }
  if (!declaredType && !legacyForm) {
    return { ok: false, code: 'NOT_BACKUP', userMessage: INVALID_MESSAGE };
  }

  const schemaVersion = (meta && asString(meta.schemaVersion)) || legacyVersion || '1.0';
  if (!SUPPORTED_BACKUP_VERSIONS.includes(schemaVersion)) {
    return {
      ok: false,
      code: 'VERSION_UNSUPPORTED',
      userMessage: 'Este respaldo fue generado con una versión no compatible.',
    };
  }

  const backupInstitutionId = asString(payload.institutionId);
  if (!backupInstitutionId) {
    return { ok: false, code: 'STRUCTURE_INVALID', userMessage: INVALID_MESSAGE };
  }

  if (expectedInstitutionId && backupInstitutionId !== expectedInstitutionId) {
    return {
      ok: false,
      code: 'INSTITUTION_MISMATCH',
      userMessage: 'Este respaldo pertenece a otra institución. No puedes restaurarlo aquí.',
    };
  }

  const details = isObj(payload.teacherDetails) ? payload.teacherDetails : null;
  const hasDetailArrays = !!details &&
    Object.keys(details).length > 0 &&
    Object.values(details).every((d) => isObj(d));
  const statsTotals = isObj(payload.stats) && isObj(payload.stats.totals)
    ? payload.stats.totals
    : null;

  const teachersList = isObj(payload.teachers) && Array.isArray(payload.teachers.teachers)
    ? payload.teachers.teachers.length
    : (statsTotals && typeof statsTotals.teachers === 'number' ? statsTotals.teachers : null);

  const summary = {
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

module.exports = {
  BACKUP_TYPE,
  SUPPORTED_BACKUP_VERSIONS,
  validateInstitutionBackup,
};
