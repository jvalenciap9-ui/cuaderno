/**
 * test-class-groups.mjs — Pruebas del núcleo puro del Aula/Grupo
 * multiasignatura (functions/lib/class-groups.js). SIN emulador.
 *
 * Cubre la especificación del piloto:
 * - Modelo/migración: asignatura antigua = aula virtual de una materia,
 *   idempotente, sin fusión automática, identificadores intactos.
 * - Creación: validación de materias (vacíos/duplicados/mínimo 2).
 * - Participantes compartidos: resolución canónica única para N materias.
 * - Asistencia diaria: misma lista canónica; porcentajes no se multiplican.
 * - Calificaciones: aislamiento por materia.
 * - Planes: Gratis = 2 unidades O 1 aula; materias internas no consumen.
 * - Eliminación inteligente dentro de un aula.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cg = require(path.join(__dirname, '..', 'functions', 'lib', 'class-groups.js'));

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name}`);
  }
}

console.log('── Sugerencias curriculares ──');
check('Inicial y Primaria tienen las 8 materias sugeridas', cg.SUGERENCIAS_MATERIAS.inicial.length === 8 && cg.SUGERENCIAS_MATERIAS.primaria.length === 8);
check('Las sugerencias incluyen Español y Matemáticas', cg.SUGERENCIAS_MATERIAS.primaria.includes('Español') && cg.SUGERENCIAS_MATERIAS.primaria.includes('Matemáticas'));

console.log('── validateMateriaNames (máximo técnico 20 materias) ──');
check('8 materias válidas pasan', cg.validateMateriaNames(['Español', 'Matemáticas', 'Ciencias Naturales', 'Ciencias Sociales', 'Inglés', 'Educación Física', 'Arte', 'Informática']).ok === true);
check('20 materias válidas pasan (máximo técnico)', cg.validateMateriaNames(Array.from({ length: 20 }, (_, i) => `Materia ${i + 1}`)).ok === true);
check('rechaza 21 materias (supera máximo técnico de 20)', cg.validateMateriaNames(Array.from({ length: 21 }, (_, i) => `Materia ${i + 1}`)).ok === false);
check('rechaza lista vacía', cg.validateMateriaNames([]).ok === false);
check('rechaza 1 sola materia (mínimo 2)', cg.validateMateriaNames(['Solo una']).ok === false);
check('rechaza nombre vacío', cg.validateMateriaNames(['Matemáticas', '   ']).ok === false);
check('rechaza duplicado exacto', cg.validateMateriaNames(['Matemáticas', 'Matemáticas']).ok === false);
check('rechaza duplicado con espacios/tildes ("Matematicas " == "Matemáticas")', cg.validateMateriaNames(['Matemáticas', 'matematicas']).ok === false);
check('normaliza espacios internos en el resultado', JSON.stringify(cg.validateMateriaNames(['Ciencias   Naturales', 'Arte']).names) === JSON.stringify(['Ciencias Naturales', 'Arte']));
check('nombres distintos con prefijo común NO son duplicado', cg.validateMateriaNames(['Arte', 'Artistica']).ok === true);

console.log('── validateClassGroupInput ──');
const gOk = cg.validateClassGroupInput({ name: '3.º A', modality: 'varias', nivelEducativo: 'primaria', grado: '3er grado', seccion: 'A', periodo: 'matutino', materias: ['Español', 'Matemáticas'] });
check('entrada completa válida', gOk.ok === true && gOk.group.name === '3.º A' && gOk.group.modalidad === 'varias');
check('modalidad "una" no crea documento de aula', cg.validateClassGroupInput({ name: 'X', modality: 'una', materias: ['a', 'b'] }).ok === false);
check('nombre vacío rechazado', cg.validateClassGroupInput({ name: '  ', modality: 'varias', materias: ['a', 'b'] }).ok === false);
check('campos opcionales ausentes → cadenas vacías', cg.validateClassGroupInput({ name: 'Aula', modality: 'varias', materias: ['a', 'b'] }).group.grado === '');

console.log('── Migración virtual (asignatura antigua = aula de una materia) ──');
const legacy = { id: 's1', name: 'Física', groupId: undefined };
const v1 = cg.toVirtualGroup(legacy);
check('asignatura sin groupId produce aula virtual modalidad "una"', v1.virtual === true && v1.modalidad === 'una');
check('el id del miembro es el MISMO identificador (sin reescribir datos)', v1.memberIds[0] === 's1');
const v2 = cg.toVirtualGroup(legacy);
check('idempotente: dos pasadas producen el mismo resultado', JSON.stringify(v1) === JSON.stringify(v2));
check('NO fusiona asignaturas con estudiantes similares (cada una su aula)', cg.toVirtualGroup({ id: 's2', name: 'Química' }).id !== v1.id);

console.log('── Resolución canónica (participantes/asistencia compartidos) ──');
const subjects = [
  { id: 'm1', name: 'Español', groupId: 'g1', createdAt: 100 },
  { id: 'm2', name: 'Matemáticas', groupId: 'g1', createdAt: 50 },
  { id: 'm3', name: 'Inglés', groupId: 'g1', createdAt: 200 },
  { id: 'solo', name: 'Física', createdAt: 999 },
];
check('el canonical del aula g1 es la materia más antigua (m2)', cg.resolveCanonicalSubjectId(subjects, 'm1') === 'm2');
check('resolver m2 → m2 (idempotente)', cg.resolveCanonicalSubjectId(subjects, 'm2') === 'm2');
check('resolver m3 → m2', cg.resolveCanonicalSubjectId(subjects, 'm3') === 'm2');
check('asignatura independiente se resuelve a sí misma', cg.resolveCanonicalSubjectId(subjects, 'solo') === 'solo');
check('groupId huérfano cae a comportamiento legacy (ella misma)', cg.resolveCanonicalSubjectId([{ id: 'x', groupId: 'fantasma' }], 'x') === 'x');
check('orden estable no depende del orden del array', (() => {
  const shuffled = [subjects[2], subjects[0], subjects[3], subjects[1]];
  return cg.resolveCanonicalSubjectId(shuffled, 'm1') === 'm2';
})());

console.log('── Aislamiento de calificaciones por materia ──');
const grades = [
  { subjectId: 'm1', studentId: 'st1', score: 90 }, // Español
  { subjectId: 'm2', studentId: 'st1', score: 70 }, // Matemáticas
];
const evals = [
  { subjectId: 'm1', title: 'Lectura' },
  { subjectId: 'm2', title: 'Álgebra' },
];
check('una nota de Matemáticas NO aparece en Español', cg.filterGradesByMateria(grades, 'm1').every((g) => g.subjectId !== 'm2'));
check('Español muestra SOLO su nota', cg.filterGradesByMateria(grades, 'm1').length === 1 && cg.filterGradesByMateria(grades, 'm1')[0].score === 90);
check('evaluaciones aisladas por materia', cg.filterEvaluationsByMateria(evals, 'm2').length === 1 && cg.filterEvaluationsByMateria(evals, 'm2')[0].title === 'Álgebra');

console.log('── Unidades de plan (límites) ──');
const groups = [{ id: 'g1' }];
const uFree1 = cg.planUnits(subjects, groups);
check('unidades = independientes + aulas (1 indep + 1 grupo = 2)', uFree1.units === 2 && uFree1.groups === 1);
check('las 3 materias internas NO consumen cuota adicional', uFree1.internalMaterias === 3 && uFree1.standaloneSubjects === 1);
check('free bloquea aula siempre (exclusivo Pro)', cg.canCreateClassGroup('free', [], []).allowed === false);
check('free bloquea 2.º aula', cg.canCreateClassGroup('free', [], [{ id: 'g1' }]).allowed === false);
check('free bloquea aula cuando ya hay 2 unidades', cg.canCreateClassGroup('free', [{ id: 'a' }, { id: 'b' }], []).allowed === false);
check('free bloquea aula con 1 unidad usada', cg.canCreateClassGroup('free', [{ id: 'a' }], []).allowed === false);
check('free permite asignatura independiente junto a 1 aula (2 unidades)', cg.canCreateStandaloneSubject('free', subjects.slice(0, 3), groups).allowed === true);
check('free bloquea independiente al llegar a 2 unidades', cg.canCreateStandaloneSubject('free', [...subjects.slice(0, 3)], [{ id: 'g1' }, { id: 'g9' }]).allowed === false);
check('pro permite múltiples aulas', cg.canCreateClassGroup('pro', [], [{ id: 'g1' }, { id: 'g2' }]).allowed === true);
check('grupo huérfano cuenta como unidad (no regala cuota)', cg.planUnits([{ id: 'h', groupId: 'muerto' }], []).units === 1);

console.log('── Eliminación inteligente ──');
const d1 = cg.planSubjectDeletion(subjects, groups, 'solo');
check('independiente: counter -1, sin tocar grupos', d1.counterDelta === -1 && d1.deleteGroup === false);
const dMid = cg.planSubjectDeletion(subjects, groups, 'm3');
check('materia intermedia: counter 0, sin reasignar', dMid.isGrouped === true && dMid.counterDelta === 0 && dMid.reassignTo === null);
const dCanon = cg.planSubjectDeletion(subjects, groups, 'm2');
check('borrar la CANÓNICA reasigna participantes a la siguiente hermana (m1)', dCanon.reassignTo === 'm1' && dCanon.counterDelta === 0);
const dLast = cg.planSubjectDeletion([...subjects.filter((s) => s.groupId !== 'g1'), { id: 'm2', groupId: 'g1' }], groups, 'm2');
check('borrar la ÚLTIMA materia elimina el aula y libera unidad (-1)', dLast.deleteGroup === true && dLast.counterDelta === -1);
check('planSubjectDeletion de id inexistente marca found:false', cg.planSubjectDeletion(subjects, groups, 'zzz').found === false);

console.log('── Clave de memoria por aula ──');
check('clave estable y sanitizada', cg.lastMateriaStorageKey('g1') === 'ediagil_aula_ultima_materia_g1');

console.log('── Distribución IA y Plan Original ──');
const originalPlan = cg.buildOriginalPlanData('Plan de 2 semanas', 'plan-semanal.pdf', 'application/pdf', 'semanal', 1);
check('buildOriginalPlanData establece scope = classGroup', originalPlan.scope === 'classGroup');
check('buildOriginalPlanData incrementa versión (v2)', originalPlan.version === 2);

const validSubjectsList = [
  { id: 'm1', name: 'Español' },
  { id: 'm2', name: 'Matemáticas' },
  { id: 'm3', name: 'Ciencias Naturales' },
];

const rawModules = [
  { subjectId: 'm1', title: 'Lectura comprensiva', description: 'Cuentos' },
  { subjectId: 'm2', title: 'Fracciones', description: 'Operaciones' },
  { subjectId: 'm99', title: 'Tema sin materia válida', description: 'Desconocido' },
];

const rawEvals = [
  { subjectId: 'm1', title: 'Dictado #1', maxScore: 100, date: '2026-09-10', type: 'teorica' },
  { subjectId: 'm3', title: 'Experimento de fotosíntesis' }, // sin date/maxScore -> borrador
  { subjectId: 'invalid', title: 'Quiz huerfano' },
];

const distResult = cg.validateAIDistribution(rawModules, rawEvals, [], validSubjectsList);
check('asigna 2 módulos a materias válidas', distResult.validModules.length === 2);
check('asigna 2 evaluaciones a materias válidas', distResult.validEvaluations.length === 2);
check('mueve ítem con subjectId invalido m99 a unclassified', distResult.unclassified.some(u => u.title.includes('Tema sin materia')));
check('mueve evaluación huerfana a unclassified (NUNCA a Español por defecto)', distResult.unclassified.some(u => u.title.includes('Quiz huerfano')));
check('evaluación sin fecha se marca como borrador', distResult.validEvaluations.some(e => e.title.includes('Borrador')));
check('ningún contenido ajeno termina en Español (m1)', distResult.validModules.every(m => m.subjectId === 'm1' ? m.title === 'Lectura comprensiva' : true));

console.log('──────────────────────────────');
console.log(`Resultado: ${passed} ✅ / ${failed} ❌`);
if (failed > 0) process.exit(1);
