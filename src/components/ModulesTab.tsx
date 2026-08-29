import React, { useState, useEffect, useRef } from "react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, orderBy, doc, addDoc, updateDoc, deleteDoc, writeBatch, getDocs, limit } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "./AuthProvider";
import { handleFirestoreError, OperationType } from "../lib/firestoreUtils";
import { showToast, toast } from '../hooks/useToast';
import { usePlan } from '../hooks/usePlan';
import { useGradeSettings } from '../contexts/GradeSettingsContext';
import {
  Plus,
  Trash2,
  Edit3,
  FolderOpen,
  GripVertical,
  ChevronDown,
  ChevronUp,
  FileText,
  Paperclip,
  Download,
  Book,
  Link,
  Video,
  FileQuestion,
  Upload,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import * as XLSX from 'xlsx';
import type { NoteDoc, SubjectModuleDoc, SubjectDoc } from "../types/firestore";
import { MateriaSelector } from "./MateriaSelector";
import { cn, parseLocalDate } from "../lib/utils";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

import { ai } from "../lib/gemini";
import { extractTextFromFile } from "../lib/fileParser";
import { trackEvent, ANALYTICS_CATEGORIES, ANALYTICS_ACTIONS } from "../lib/analytics";
import {
  MAX_PLAN_DRAFT_CHARS,
  buildDistributedModuleWrite,
  buildOriginalPlanData,
  buildPlanRunId,
  distributionDocId,
  filterModulesForMateria,
  useCanonicalSubjectId,
  validateAIDistribution,
} from "../lib/classGroups";

interface ModulesTabProps {
  subjectId: string;
  onOpenNoteModal: (moduleId?: string, note?: NoteDoc | null) => void;
  onDeleteNote: (id: string) => void;
  /** Materias hermanas del aula (≥2 activa el selector de materia). */
  aulaMaterias?: SubjectDoc[];
  /** Solicita a App cambiar de materia dentro del mismo aula. */
  onSelectMateria?: (materiaId: string) => void;
  /** Alcance controlado por App para conservarlo al cambiar de materia. */
  scopeMode?: 'materia' | 'planificacion';
  onScopeModeChange?: (mode: 'materia' | 'planificacion') => void;
}

const MAX_PLAN_IMAGE_BYTES = 6 * 1024 * 1024;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer la imagen seleccionada.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const separator = dataUrl.indexOf(',');
      if (separator < 0) {
        reject(new Error('La imagen no tiene un formato válido.'));
        return;
      }
      resolve(dataUrl.slice(separator + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function ModulesTab({
  subjectId,
  onOpenNoteModal,
  onDeleteNote,
  aulaMaterias,
  onSelectMateria,
  scopeMode,
  onScopeModeChange,
}: ModulesTabProps) {
  const { user } = useAuth();
  const { isPro, isAdmin } = usePlan();
  const { gradingScale } = useGradeSettings();
  
  const subjectRef = doc(db, 'subjects', subjectId);
  const [subject] = useDocumentData(subjectRef);

  const { canonicalId: sharedModuleSubjectId } = useCanonicalSubjectId(subjectId);
  const targetSubjectIdForModules = subject?.groupId ? sharedModuleSubjectId : subjectId;

  // ── Modos de Módulos y Materiales (Sección 10 & 11) ──
  const [internalSubMode, setInternalSubMode] = useState<'materia' | 'planificacion'>('materia');
  const subMode = scopeMode ?? internalSubMode;
  const setSubMode = (mode: 'materia' | 'planificacion') => {
    setInternalSubMode(mode);
    onScopeModeChange?.(mode);
  };
  const [planType, setPlanType] = useState<'semanal' | 'mensual' | 'trimestral'>('semanal');
  const [draftText, setDraftText] = useState('');
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isDistributing, setIsDistributing] = useState(false);
  const [planStatus, setPlanStatus] = useState<'idle' | 'draft_saved' | 'distributed'>('idle');
  const planFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastSavedPlanRef = useRef<any>(null);

  const groupRef = subject?.groupId ? doc(db, 'classGroups', subject.groupId) : null;
  const [groupDoc] = useDocumentData(groupRef);

  useEffect(() => {
    lastSavedPlanRef.current = groupDoc?.originalPlan ?? null;
    if (groupDoc?.planDraft) {
      setDraftText(groupDoc.planDraft);
      setPlanStatus('draft_saved');
    }
    if (groupDoc?.originalPlan?.fileName) {
      setLoadedFileName(groupDoc.originalPlan.fileName);
    }
    if (groupDoc?.planType) {
      setPlanType(groupDoc.planType as any);
    }
    if (groupDoc?.planStatus) {
      setPlanStatus(groupDoc.planStatus as any);
    }
  }, [groupDoc]);

  const handleSaveDraft = async (customContent?: string, fileName?: string, fileType?: string): Promise<number | null> => {
    const textToSave = typeof customContent === 'string' ? customContent : draftText;
    if (!textToSave.trim()) {
      showToast('warning', 'Escribe o carga el borrador del plan antes de guardar.');
      return null;
    }
    if (textToSave.length > MAX_PLAN_DRAFT_CHARS) {
      showToast('error', 'El plan es demasiado extenso para guardarlo. Reduce el contenido o divídelo en varios archivos.');
      return null;
    }
    if (!subject?.groupId) {
      showToast('error', 'No se encontró el aula propietaria de este plan.');
      return null;
    }
    setIsSavingDraft(true);
    try {
      const normalizedContent = textToSave.trim();
      const effectiveFileName = fileName || loadedFileName || 'Plan General';
      const effectiveFileType = fileType || 'text/plain';
      // El ref evita incrementar la versión si el usuario reintenta antes de
      // que onSnapshot refleje el write anterior.
      const previousPlan = lastSavedPlanRef.current || groupDoc?.originalPlan;
      const samePlan = previousPlan
        && previousPlan.content === normalizedContent
        && previousPlan.fileName === effectiveFileName
        && previousPlan.fileType === effectiveFileType
        && previousPlan.format === planType;
      const originalPlanObj = samePlan
        ? previousPlan
        : buildOriginalPlanData(
          textToSave,
          effectiveFileName,
          effectiveFileType,
          planType,
          previousPlan?.version
        );
      await updateDoc(doc(db, 'classGroups', subject.groupId), {
          planDraft: textToSave,
          originalPlan: originalPlanObj,
          planType,
          planStatus: 'draft_saved',
          updatedAt: Date.now(),
        });
      lastSavedPlanRef.current = originalPlanObj;
      setPlanStatus('draft_saved');
      showToast('success', 'Plan original guardado');
      return originalPlanObj.version;
    } catch (err) {
      console.error('Error guardando borrador del plan:', err);
      showToast('error', 'No se pudo guardar el plan.');
      return null;
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handlePlanFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      showToast('info', `Cargando archivo ${file.name}...`);
      let extractedText = '';
      if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        extractedText = await file.text();
      } else if (file.type.startsWith('image/')) {
        if (file.size > MAX_PLAN_IMAGE_BYTES) {
          showToast('warning', 'La imagen supera 6 MB. Reduce su tamaño o conviértela a PDF antes de cargarla.');
          return;
        }
        const base64Data = await fileToBase64(file);
        const transcription = await ai({
          model: 'gemini-2.5-flash',
          contents: [{
            role: 'user',
            parts: [
              {
                text: `Transcribe fielmente todo el texto visible de esta planificación escolar.
Conserva títulos, materias, semanas, fechas, actividades, evaluaciones y el orden de tablas o columnas.
No clasifiques todavía el contenido, no lo resumas y no inventes información.
Devuelve únicamente la transcripción en texto plano.`,
              },
              { inlineData: { data: base64Data, mimeType: file.type } },
            ],
          }],
          config: { temperature: 0 },
        });
        extractedText = transcription.text || '';
      } else {
        const buffer = await file.arrayBuffer();
        extractedText = await extractTextFromFile(buffer, file.type);
      }
      if (!extractedText.trim()) {
        showToast('warning', 'No se pudo extraer texto legible del archivo.');
        return;
      }
      setDraftText(extractedText);
      setLoadedFileName(file.name);
      const savedVersion = await handleSaveDraft(extractedText, file.name, file.type);
      if (savedVersion && file.type.startsWith('image/')) {
        showToast('success', 'Imagen transcrita y plan guardado. Revisa el texto y pulsa “2. Analizar y distribuir”.');
      }
    } catch (err: any) {
      console.error('Error al leer archivo de plan:', err);
      const cause = err instanceof Error ? err.message : '';
      showToast(
        'error',
        cause.includes('permanece guardado')
          ? cause.replace('El contenido permanece guardado', 'El plan permanece guardado')
          : 'No se pudo leer o transcribir el archivo. Intenta pegar el texto manualmente.',
      );
    } finally {
      if (planFileInputRef.current) planFileInputRef.current.value = '';
    }
  };

  const handleDistributeWithAI = async () => {
    if (!draftText.trim()) {
      showToast('warning', 'Ingresa la planificación que deseas distribuir.');
      return;
    }
    // Paso 1 & 2: Guardar el plan original como borrador + Confirmar "Plan original guardado"
    const savedVersion = await handleSaveDraft();
    if (!savedVersion || !subject?.groupId || !user?.uid) return;

    setIsDistributing(true);
    setAiAlertMessage(null);
    try {
      const availableMaterias = (aulaMaterias || []).map((m) => ({ id: String(m.id), name: m.name }));
      if (availableMaterias.length === 0) {
        throw new Error('No hay materias asociadas a este aula.');
      }

      const runId = buildPlanRunId(subject.groupId, savedVersion);
      const prompt = `Analiza la siguiente planificación general del aula y distribúyela entre las materias existentes del grupo.

LISTA DE MATERIAS EXISTENTES EN EL AULA (USA ÚNICAMENTE ESTOS IDs PARA CADA MATERIA):
${JSON.stringify(availableMaterias, null, 2)}

PLANIFICACIÓN A DISTRIBUIR (${planType.toUpperCase()}):
"${draftText}"

INSTRUCCIONES CRÍTICAS:
1. Para cada tema o unidad, asígnalo a UNA de las materias de la lista según corresponda.
2. Extrae también las ACTIVIDADES EVALUATIVAS (dictados, exámenes, prácticas, quices) y asígnalas a su materia correspondiente.
3. USA EXCLUSIVAMENTE los identificadores "id" provistos.
4. Responde ÚNICA Y EXCLUSIVAMENTE con un objeto JSON puro con la siguiente estructura:
{
  "modules": [
    {
      "subjectId": "ID_EXACTO_DE_LA_MATERIA",
      "title": "Título del Módulo o Unidad",
      "description": "Descripción breve de los temas",
      "order": 1
    }
  ],
  "evaluations": [
    {
      "subjectId": "ID_EXACTO_DE_LA_MATERIA",
      "title": "Título de la evaluación",
      "maxScore": ${gradingScale.maxScore || 100},
      "date": "YYYY-MM-DD",
      "type": "teorica|practica|apreciativa"
    }
  ],
  "unclassified": [
    {
      "title": "Título del elemento no clasificado",
      "content": "Descripción"
    }
  ]
}
5. La puntuación máxima de cada evaluación debe ser ${gradingScale.maxScore || 100}, que es la escala configurada por el docente o la institución.
NO incluyas explicaciones adicionales ni bloques fuera del JSON.`;

      const aiRes = await ai({
        contents: prompt,
        config: { temperature: 0, responseMimeType: 'application/json' },
      });
      const aiResponseText = aiRes.text || '';
      
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Formato de respuesta IA no válido.');
      }

      let parsed: any = {};
      try {
        parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        throw new Error('No se pudo interpretar el JSON devuelto por la IA.');
      }

      const validated = validateAIDistribution(
        parsed.modules,
        parsed.evaluations,
        parsed.unclassified,
        availableMaterias,
        gradingScale.maxScore || 100,
      );

      const batch = writeBatch(db);
      let createdModulesCount = 0;
      let createdEvalsCount = 0;

      // Guardar módulos globales / por materia
      for (const item of validated.validModules) {
        const modRef = doc(
          db,
          'subjectModules',
          distributionDocId('module', runId, item.subjectId, item.title, String(item.order || createdModulesCount + 1)),
        );
        batch.set(modRef, buildDistributedModuleWrite(item, {
          userId: user.uid,
          canonicalSubjectId: targetSubjectIdForModules,
          classGroupId: subject.groupId,
          planRunId: runId,
          createdAt: Date.now() + createdModulesCount,
        }));
        createdModulesCount++;
      }

      // Guardar evaluaciones por materia validada
      for (const ev of validated.validEvaluations) {
        const evRef = doc(
          db,
          'evaluations',
          distributionDocId('evaluation', runId, ev.subjectId, ev.title, `${ev.date}|${ev.type}`),
        );
        batch.set(evRef, {
          userId: user?.uid,
          subjectId: ev.subjectId,
          title: ev.title,
          maxScore: ev.maxScore,
          date: ev.date,
          type: ev.type,
          isDraft: ev.isDraft === true,
          planRunId: runId,
          createdAt: Date.now() + createdEvalsCount,
        });
        createdEvalsCount++;
      }

      if (subject?.groupId) {
        batch.update(doc(db, 'classGroups', subject.groupId), {
          planStatus: 'distributed',
          lastPlanRunId: runId,
          unclassifiedItems: validated.unclassified,
          updatedAt: Date.now(),
        });
      }

      await batch.commit();
      setPlanStatus('distributed');

      const summaryText = `Plan distribuido: ${validated.summary.matchedSubjects.length} materias reconocidas (${createdModulesCount} módulos, ${createdEvalsCount} evaluaciones). ${validated.unclassified.length > 0 ? `${validated.unclassified.length} ítems en Pendiente de clasificar.` : ''}`;
      showToast('success', summaryText);
      setAiAlertMessage(summaryText);
      trackEvent(ANALYTICS_CATEGORIES.MODULE, ANALYTICS_ACTIONS.CREATE);
    } catch (error: any) {
      console.error('Error en Magia IA al distribuir plan:', error);
      const cause = error instanceof Error ? error.message : '';
      const msg = cause.includes('permanece guardado')
        ? cause.replace('El contenido permanece guardado', 'El plan original permanece guardado')
        : 'No fue posible distribuir el plan. El original está guardado y puedes reintentar.';
      setAiAlertMessage(msg);
      showToast('error', msg);
    } finally {
      setIsDistributing(false);
    }
  };

  const modulesRef = collection(db, 'subjectModules');
  const modulesQuery = user?.uid ? query(modulesRef, where('userId', '==', user?.uid), where('subjectId', '==', targetSubjectIdForModules), limit(500)) : null;
  const [modulesData] = useCustomCollectionData(modulesQuery);
  const allModules = Array.isArray(modulesData) ? [...modulesData].sort((a, b) => (a.order || 0) - (b.order || 0)) : [];
  const modules = subject?.groupId
    ? filterModulesForMateria(allModules, subjectId, subMode === 'planificacion' ? 'general' : 'subject')
    : allModules;

  const notesRef = collection(db, 'notes');
  const notesQuery = user?.uid ? query(notesRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [notesData] = useCustomCollectionData(notesQuery);
  const notes = Array.isArray(notesData) ? [...notesData].sort((a, b) => parseLocalDate(b.date || 0).getTime() - parseLocalDate(a.date || 0).getTime()) : [];

  const [isAdding, setIsAdding] = useState(false);
  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<string[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<string[]>([]);

  useEffect(() => {
    if (modules.length > 0) {
      const tourSubjectId = localStorage.getItem('tour_subject_id');
      if (tourSubjectId === subjectId) {
        setExpandedModules(prev => {
          if (prev.includes(modules[0].id!)) return prev;
          return [...prev, modules[0].id!];
        });
      }
    }
  }, [modules, subjectId]);
  const [moduleToDelete, setModuleToDelete] = useState<string | null>(null);
  const [processingNoteId, setProcessingNoteId] = useState<string | null>(null);
  const [aiAlertMessage, setAiAlertMessage] = useState<string | null>(null);

  const toggleNote = (id: string) => {
    setExpandedNotes((prev) =>
      prev.includes(id) ? prev.filter((n) => n !== id) : [...prev, id],
    );
  };

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const handleNoteMagicAI = async (note: NoteDoc) => {
    if (!note.id || processingNoteId !== null || !user) return;
    setProcessingNoteId(note.id);
    setAiAlertMessage(null);
    try {
      const contents: any[] = [];
      contents.push(`Aquí están los apuntes tomados:\n${note.content}`);
      
      if (note.attachment) {
        if (note.attachment.type.startsWith('image/')) {
          if (note.attachment.data.startsWith('http')) {
            try {
              const directResponse = await fetch(note.attachment.data);
              const arrayBuffer = await directResponse.arrayBuffer();
              const base64Bytes = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
              contents.push({ inlineData: { data: base64Bytes, mimeType: note.attachment.type } });
            } catch (e) {
              // Utilizamos un proxy para evitar errores de CORS con Firebase Storage (mejor para binarios)
              const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(note.attachment.data)}`;
              const response = await fetch(proxyUrl);
              const arrayBuffer = await response.arrayBuffer();
              const base64Bytes = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
              contents.push({
                inlineData: {
                  data: base64Bytes,
                  mimeType: note.attachment.type
                }
              });
            }
          } else {
            const base64Data = note.attachment.data.split(',')[1];
            contents.push({
              inlineData: {
                data: base64Data,
                mimeType: note.attachment.type
              }
            });
          }
        } else {
          try {
            const text = await extractTextFromFile(note.attachment.data, note.attachment.type);
            contents.push(`Contenido del adjunto:\n${text}`);
          } catch (e) {
            console.error("No se pudo extraer texto del adjunto", e);
          }
        }
      }

      const formattedDate = format(parseISO(note.date), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es });
      
      const moduleInfo = modules.length > 0 
        ? `\n\nCONTEXTO DE MÓDULOS (TRIMESTRES) DE ESTA ASIGNATURA:\n${modules.map(m => `- ID: ${m.id}, Título: ${m.title}`).join('\n')}\nSi los eventos pertenecen a alguno de estos módulos, incluye el "moduleId" correspondiente en el JSON.`
        : "";

      contents.push(
        `Eres un asistente experto en comprensión de lectura y estructuración de sílabos y planes de clase universitarios.
        
        !!! INSTRUCCIÓN CRÍTICA DE TIEMPO !!! 
        Para este documento en particular, HOY ES EXACTAMENTE: ${note.date} (${formattedDate}).
        - Si el documento tiene fechas explícitas, USA LAS FECHAS DEL DOCUMENTO directamente.
        - Si el documento usa "Semana 1, Semana 2...", calcula: Semana 1 empieza en la fecha base, Semana 2 = fecha base + 7 días, etc.
        - Si el documento es una tabla con días de la semana (Lunes, Martes...), asígnale al Lunes de la Semana 1 la fecha base. Si dice "Lunes 8:00" de la Semana 1, es la fecha base a las 8:00.
        
        !!! EXTRACCIÓN MASIVA DE PLANES CON MÚLTIPLES SEMANAS !!!
        - ATENCIÓN: Si el documento detalla actividades para MUCHAS SEMANAS (Semana 1, Semana 2, Semana 3, Semana 4, etc.), DEBES PROCESARLAS TODAS SIN EXCEPCIÓN.
        - LEE TODO EL DOCUMENTO. Si hay 4 semanas, genera eventos y evaluaciones para las 4 semanas completas.
        
        FORMATO DE EXTRACCIÓN - POR CADA DÍA DE CLASE:
        - Crea 1 EVENTO por día con:
          - "title": el TEMA PRINCIPAL de la clase de ese día (ej: "Presente Simple - afirmativo y negativo")
          - "topic": el tema del módulo/unidad (ej: "Gramática Básica")
          - "description": actividades principales del día separadas por " | " (ej: "Explicación teórica | Ejercicios en parejas | Quiz corto")
          - "startTime": hora de inicio si está disponible (ej: "8:00")
          - "endTime": hora de fin si está disponible (ej: "9:30")
          - "order": número de orden del día dentro de la semana (Lunes=1, Martes=2...)
          - "type": "class" para clases normales, "exam" si hay examen/quiz, "deadline" si es solo entrega
        - Si un día tiene EXAMEN o QUIZ, adicionalmente crea una EVALUACIÓN.
        
        ${moduleInfo}

        Extrae OBLIGATORIAMENTE TODOS los datos en un objeto JSON puro (sin bloques Markdown) con este formato estricto:
        {
          "newModules": [{"tempId": "m1", "title": "Nombre Módulo", "description": "", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}],
          "events": [
            {
              "title": "Tema principal de la clase",
              "topic": "Módulo/Unidad al que pertenece",
              "description": "Actividad 1 | Actividad 2 | Actividad 3",
              "date": "YYYY-MM-DD",
              "startTime": "HH:MM",
              "endTime": "HH:MM",
              "order": 1,
              "type": "class|exam|deadline",
              "moduleId": "ID del módulo (usar el ID real si ya existe, o tempId si es nuevo)"
            }
          ],
          "evaluations": [
            {
              "title": "Nombre de la prueba/examen",
              "maxScore": ${gradingScale.maxScore || 100},
              "date": "YYYY-MM-DD",
              "type": "teorica|practica",
              "moduleId": "string"
            }
          ]
        }
        NO RESUMAS NADA. Si hay 4 semanas con 5 días cada una = 20 días lectivos, genera 20 eventos. Usa "tempId" (ej. "m1") en newModules solo si creas módulos nuevos.`
      );

      const response = await ai({
        model: 'gemini-2.5-flash',
        contents,
        config: { 
          temperature: 0.1,
          responseMimeType: "application/json"
        }
      });

if (!response.text) throw new Error("Sin respuesta de Gemini");
console.log("DEBUG response.text:", JSON.stringify(response.text).substring(0, 200));

// La Cloud Function devuelve { text: "..." } donde text puede ser un JSON string
let textToProcess = response.text;

// Si el texto es un JSON escapado, extraerlo
try {
  const parsed = JSON.parse(textToProcess);
  if (parsed && typeof parsed === 'object' && parsed.text) {
    textToProcess = parsed.text;
  }
} catch(e) {
  // No es JSON, usar tal cual
}

// Limpiar bloques de markdown
let cleanText = response.text;
// Si es un JSON con propiedad 'text', extraerlo
try {
  const parsed = JSON.parse(cleanText);
  if (parsed.text) cleanText = parsed.text;
} catch(e) {}
cleanText = cleanText.replace(/```json\n?|\n?```/g, "").trim();

// Extraer el objeto JSON
let match = cleanText.match(/\{[\s\S]*\}/);
if (!match) {
  match = textToProcess.match(/\{[\s\S]*\}/);
}
if (!match) {
  console.warn("Gemini no devolvió JSON válido:", textToProcess.substring(0, 300));
  match = ['{"newModules":[],"newNotes":[],"events":[],"evaluations":[]}'];
}

// Parsear con manejo de errores
let data;
try {
  data = JSON.parse(match[0]);
} catch (parseError) {
  // Intentar arreglar JSON mal formado
  try {
    const fixedJson = match[0]
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3')
      .replace(/'/g, '"');
    data = JSON.parse(fixedJson);
  } catch (e2) {
    console.error("No se pudo parsear JSON:", match[0].substring(0, 200));
    data = { newModules: [], newNotes: [], events: [], evaluations: [] };
  }
}

let addedEvents = 0, addedEvals = 0, addedModules = 0, addedNotes = 0;

      const batch = writeBatch(db);
      const tempIdToRealId: Record<string, string> = {};

      if (data.newModules?.length) {
        let maxOrder = modules.length > 0 ? Math.max(...modules.map(m => m.order)) : 0;
        for (const nm of data.newModules) {
          const modRef = doc(collection(db, 'subjectModules'));
          maxOrder++;
          batch.set(modRef, {
            userId: user.uid,
            subjectId: targetSubjectIdForModules,
            ...(subject?.groupId ? {
              classGroupId: subject.groupId,
              scope: 'subject',
              assignedSubjectId: subjectId,
            } : {}),
            title: nm.title || 'Módulo Extraído',
            description: nm.description || '',
            startDate: nm.startDate || null,
            endDate: nm.endDate || null,
            order: maxOrder,
            createdAt: Date.now(),
            parentId: note.moduleId || null
          });
          if (nm.tempId) {
            tempIdToRealId[nm.tempId] = modRef.id;
          }
          addedModules++;
        }
      }

      const resolveModuleId = (mId: string | undefined | null) => {
        if (!mId) return note.moduleId ?? null;
        if (tempIdToRealId[mId]) return tempIdToRealId[mId];
        return mId;
      };

      if (data.newNotes?.length) {
        for (const nn of data.newNotes) {
          const noteRef = doc(collection(db, 'notes'));
          batch.set(noteRef, {
            userId: user.uid,
            subjectId,
            moduleId: resolveModuleId(nn.moduleId),
            title: nn.title || 'Apunte Extraído',
            content: nn.content || '',
            date: nn.date || note.date,
            createdAt: Date.now(),
            updatedAt: Date.now()
          });
          addedNotes++;
        }
      }

      if (data.events?.length) {
        for (const ev of data.events) {
          const docRef = doc(collection(db, 'calendarEvents'));
          batch.set(docRef, {
            userId: user.uid,
            subjectId,
            moduleId: resolveModuleId(ev.moduleId),
            title: ev.title || 'Evento Extraído',
            date: ev.date || note.date,
            type: ev.type || 'other',
            topic: ev.topic || null,
            description: ev.description || null,
            startTime: ev.startTime || null,
            endTime: ev.endTime || null,
            order: typeof ev.order === 'number' ? ev.order : null,
          });
          addedEvents++;
        }
      }

      if (data.evaluations?.length) {
        for (const ev of data.evaluations) {
          const docRef = doc(collection(db, 'evaluations'));
          batch.set(docRef, {
            userId: user.uid,
            subjectId,
            moduleId: resolveModuleId(ev.moduleId),
            title: ev.title || 'Evaluación Extraída',
            maxScore: gradingScale.maxScore !== 100
              ? gradingScale.maxScore
              : (Number(ev.maxScore) > 0 ? Number(ev.maxScore) : gradingScale.maxScore || 100),
            date: ev.date || note.date,
            type: ev.type || 'teorica'
          });
          addedEvals++;
        }
      }
      
      await batch.commit();

      setAiAlertMessage(`¡Magia completada! Se guardaron: ${addedModules} módulos, ${addedNotes} apuntes, ${addedEvents} eventos, y ${addedEvals} evaluaciones.`);
    } catch (e: unknown) {
      console.error("Error en MAGIC AI:", e);
      const cause = (e instanceof Error ? e.message : '') || 'No se pudo completar el análisis.';
      const msg = cause.includes('permanece guardado')
        ? cause.replace('El contenido permanece guardado', 'El apunte permanece guardado')
        : `No fue posible procesar el apunte con Magia IA. ${cause}`;
      setAiAlertMessage(msg);
      toast.error(msg);
    } finally {
      setProcessingNoteId(null);
    }
  };

  const toggleModule = (id: string) => {
    setExpandedModules((prev) =>
      prev.includes(id) ? prev.filter((mId) => mId !== id) : [...prev, id],
    );
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!title.trim() || !user) return;

    try {
      if (editingId) {
        await updateDoc(doc(db, 'subjectModules', editingId), {
          title,
          description,
          startDate: startDate || null,
          endDate: endDate || null,
          parentId: addingParentId || null,
        });
      } else {
        const maxOrder = modules.length > 0 ? Math.max(...modules.map((m) => m.order)) : 0;
        await addDoc(collection(db, 'subjectModules'), {
          userId: user.uid,
          subjectId: targetSubjectIdForModules,
          ...(subject?.groupId ? {
            classGroupId: subject.groupId,
            scope: subMode === 'planificacion' ? 'classGroup' : 'subject',
            assignedSubjectId: subMode === 'planificacion' ? null : subjectId,
          } : {}),
          title,
          description,
          startDate: startDate || null,
          endDate: endDate || null,
          order: maxOrder + 1,
          createdAt: Date.now(),
          parentId: addingParentId || null,
        });
      }
      resetForm();
    } catch (e) {
      handleFirestoreError(e, OperationType.WRITE, 'subjectModules');
    }
  };

  const handleEdit = (mod: SubjectModuleDoc) => {
    setEditingId(mod.id!);
    setAddingParentId(mod.parentId || null);
    setTitle(mod.title);
    setDescription(mod.description || "");
    setStartDate(mod.startDate || "");
    setEndDate(mod.endDate || "");
  };

  const performDeleteAction = async (id: string, batch = writeBatch(db)) => {
    const children = modules.filter(m => m.parentId === id);
    for (const child of children) {
      await performDeleteAction(child.id!, batch);
    }

    const moduleNotes = notes.filter((n) => n.moduleId === id);
    for (const note of moduleNotes) {
      batch.delete(doc(db, 'notes', note.id!));
    }
    
    const moduleEventsQuery = query(collection(db, 'calendarEvents'), where('moduleId', '==', id), where('userId', '==', user?.uid), limit(500));
    const moduleEvents = await getDocs(moduleEventsQuery);
    for (const ev of moduleEvents.docs) {
      batch.delete(ev.ref);
    }
    
    const moduleEvalsQuery = query(collection(db, 'evaluations'), where('moduleId', '==', id), where('userId', '==', user?.uid), limit(500));
    const moduleEvals = await getDocs(moduleEvalsQuery);
    for (const ev of moduleEvals.docs) {
      const gQuery = query(collection(db, 'grades'), where('evaluationId', '==', ev.id), where('userId', '==', user?.uid), limit(500));
      const gDocs = await getDocs(gQuery);
      const hasGrades = gDocs.docs.some((g) => g.data().score > 0);
      if (hasGrades) {
        batch.update(ev.ref, { moduleId: null });
      } else {
        for (const g of gDocs.docs) batch.delete(g.ref);
        batch.delete(ev.ref);
      }
    }
    batch.delete(doc(db, 'subjectModules', id));
    return batch;
  };

  const handleDelete = async (id: string) => {
    try {
      const batch = await performDeleteAction(id);
      await batch.commit();
      setModuleToDelete(null);
    } catch (e) {
      handleFirestoreError(e, OperationType.DELETE, 'subjectModules');
    }
  };

  const resetForm = () => {
    setIsAdding(false);
    setAddingParentId(null);
    setEditingId(null);
    setTitle("");
    setDescription("");
    setStartDate("");
    setEndDate("");
  };

  const [isConfirmingGeneratePlan, setIsConfirmingGeneratePlan] = React.useState(false);

  const handleGeneratePlanModules = async () => {
    if (!isPro && !isAdmin) {
      toast.warning('El Syllabus Automático es una función exclusiva de Premium Pro.');
      return;
    }
    if (!subject) return;
    setIsConfirmingGeneratePlan(true);
  };
  
  const getPlanLabel = () => {
    return 'Módulo';
  };

  const confirmGeneratePlan = async () => {
    setIsConfirmingGeneratePlan(false);
    if (!subject || !user) return;
    const plan = subject.plan || "otro";
    let numModules = 0;
    let label = getPlanLabel();

    switch (plan) {
      case "semanal":
        numModules = 16;
        break;
      case "mensual":
        numModules = 6;
        break;
      case "trimestral":
        numModules = 3;
        break;
      case "cuatrimestral":
        numModules = 4;
        break;
      case "anual_8":
        numModules = 8;
        break;
      case "anual_10":
        numModules = 10;
        break;
      default:
        numModules = 6;
        label = "Unidad";
        break;
    }

    const ts = Date.now();
    const currentMaxOrder =
      modules.length > 0 ? Math.max(...modules.map((m) => m.order)) : 0;

    let added = 0;
    const batch = writeBatch(db);
    for (let i = 0; i < numModules; i++) {
        const generatedTitle = `${label} ${i + 1}`;
        const exists = modules.find(m => m.title === generatedTitle);
        if (!exists) {
            const docRef = doc(collection(db, 'subjectModules'));
            batch.set(docRef, {
                userId: user.uid,
                subjectId: targetSubjectIdForModules,
                ...(subject?.groupId ? {
                  classGroupId: subject.groupId,
                  scope: subMode === 'planificacion' ? 'classGroup' : 'subject',
                  assignedSubjectId: subMode === 'planificacion' ? null : subjectId,
                } : {}),
                title: generatedTitle,
                order: currentMaxOrder + added + 1,
                createdAt: ts + i,
            });
            added++;
        }
    }
    try {
        await batch.commit();
    } catch(e) {
        handleFirestoreError(e, OperationType.WRITE, 'subjectModules default layout');
    }
  };

  const renderModuleForm = () => {
    const parentOptions = modules.filter(m => !m.parentId && (!editingId || m.id !== editingId));
    
    return (
    <form
      onSubmit={handleSave}
      className={`bg-white border border-neutral-200 p-8 space-y-8 animate-in fade-in zoom-in-95 duration-300 ${!editingId ? 'rounded-[3rem] shadow-2xl slide-in-from-top-4' : 'rounded-[2.5rem]'}`}
    >
      <div className="grid grid-cols-1 gap-8">
        <div>
          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">
            Título
          </label>
          <input
            required
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-lg placeholder:text-neutral-300"
            placeholder="Ej. Unidad 1: Introducción"
          />
        </div>
        
        {(parentOptions.length > 0) && (
          <div>
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">
              ¿Pertenece a un módulo/período?
            </label>
            <select
              value={addingParentId || ""}
              onChange={(e) => setAddingParentId(e.target.value || null)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-lg cursor-pointer"
            >
              <option value="">No (Crear/Mantener como Período/Sección principal)</option>
              {parentOptions.map(p => (
                <option key={p.id} value={p.id!}>Sí, dentro de: {p.title}</option>
              ))}
            </select>
            <p className="text-xs text-neutral-500 mt-2 ml-2 font-medium">Si seleccionas un módulo, se agrupará dentro de él.</p>
          </div>
        )}

        <div>
          <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">
            Descripción (Opcional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold text-lg resize-none h-40 placeholder:text-neutral-300"
            placeholder="Breve descripción de los temas a tratar..."
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
          <div>
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">
              Fecha Inicio
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em] mb-4 px-1">
              Fecha Final
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl px-6 py-4 text-neutral-900 outline-none focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/5 transition-all font-bold"
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row justify-between items-center gap-6 pt-8 border-t border-neutral-100">
        <div>
          {editingId && (
            <button
              type="button"
              onClick={() => setModuleToDelete(editingId)}
              className="flex items-center gap-3 px-6 py-3 rounded-2xl text-red-600 hover:bg-red-50 transition-all text-xs font-black uppercase tracking-widest active:scale-95"
              title="Eliminar este módulo permanentemente"
            >
              <Trash2 className="w-5 h-5" />
              Eliminar
            </button>
          )}
        </div>
        <div className="flex gap-4 w-full sm:w-auto flex-wrap justify-end">
          <button
            type="button"
            onClick={resetForm}
            className="flex-1 sm:flex-none px-6 py-4 text-xs font-black text-neutral-400 hover:text-neutral-900 transition-colors uppercase tracking-widest"
            title="Cancelar la edición y cerrar el formulario"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 sm:flex-none px-8 py-4 text-xs font-black bg-indigo-600 text-white rounded-2xl hover:bg-indigo-50 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest"
            title="Guardar o actualizar la información del módulo"
          >
            {editingId ? "Actualizar" : "Guardar"}
          </button>
        </div>
      </div>
    </form>
  )};

  const renderModuleContent = (
    moduleNotes: NoteDoc[],
    moduleId?: string,
    moduleTitle: string = "Sin Módulo",
  ) => {
    return (
      <div className="mt-10 space-y-10">
        <div className="flex items-center justify-between">
          <h5 className="text-[10px] font-black text-neutral-400 uppercase tracking-[0.2em]">
            Contenido del Módulo
          </h5>
          <div className="flex flex-wrap items-center gap-4">
            <button
              id="add-note-btn"
              onClick={() => onOpenNoteModal(moduleId)}
              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-500 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
              title="Añadir un apunte o material a este módulo"
            >
              <Plus className="w-4 h-4" />
              Nuevo Apunte
            </button>
          </div>
        </div>

        {moduleNotes.length > 0 && (
          <div className="space-y-6">
            <h6 className="text-[10px] font-black text-neutral-300 uppercase tracking-widest">
              Apuntes
            </h6>
            <div className="grid grid-cols-1 gap-6">
              {moduleNotes.map((note) => {
                const isExpanded = expandedNotes.includes(note.id!);
                return (
                  <div
                    key={note.id}
                    className="bg-white border border-neutral-100 rounded-[2rem] p-8 group hover:border-indigo-200 hover:shadow-2xl transition-all duration-500 relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                    <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-50 rounded-full -mr-12 -mt-12 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none" />

                    <div className="flex items-start justify-between gap-6 relative z-10">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-4">
                          <h6 className="text-xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors leading-tight truncate">
                            {note.title}
                          </h6>
                          <time className="text-[10px] font-black uppercase tracking-widest text-indigo-600 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 shrink-0 shadow-sm">
                            {format(parseISO(note.date), "d 'de' MMMM, yyyy", {
                              locale: es,
                            })}
                          </time>
                        </div>
                        <div className="relative">
                          <p
                            className="text-neutral-500 font-medium text-base leading-relaxed mb-6 opacity-80 group-hover:opacity-100 transition-all duration-300 whitespace-pre-wrap"
                          >
                            {note.content}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                        {note.attachment && (
                          <a
                            href={note.attachment.data}
                            download={note.attachment.name}
                            className="inline-flex items-center gap-3 bg-neutral-900 hover:bg-neutral-800 text-white px-6 py-3.5 rounded-2xl text-xs font-black transition-all active:scale-95 uppercase tracking-widest shadow-lg shadow-neutral-900/10"
                          >
                            <Paperclip className="w-4 h-4 shrink-0" />
                            <span className="truncate max-w-[200px]">
                              {note.attachment.name}
                            </span>
                          </a>
                        )}
                          <button
                            onClick={() => handleNoteMagicAI(note)}
                            disabled={processingNoteId === note.id}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-pink-500 to-indigo-600 hover:from-pink-400 hover:to-indigo-500 text-white px-5 py-3.5 rounded-2xl text-xs font-black transition-all shadow-md shadow-indigo-500/20 active:scale-95 uppercase tracking-widest disabled:opacity-50"
                            title="Procesar apunte y adjuntos con IA Mágica"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn(processingNoteId === note.id && "animate-spin")}><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72ZM14 7l3 3M5 6v4M19 14v4M10 2v2M2 10h2M14 20h2"/></svg>
                            {processingNoteId === note.id ? "Procesando..." : "IA Mágica"}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-4 group-hover:translate-x-0">
                        {moduleId === undefined && modules.length > 0 && (
                          <select
                            className="mb-2 w-full text-[10px] font-black uppercase tracking-widest bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-lg p-2 outline-none cursor-pointer"
                            onChange={async (e) => {
                              if (e.target.value) {
                                try {
                                  await updateDoc(doc(db, 'notes', note.id!), {
                                    moduleId: e.target.value,
                                  });
                                } catch (error) {
                                  handleFirestoreError(error, OperationType.UPDATE, `notes/${note.id}`);
                                }
                              }
                            }}
                            defaultValue=""
                          >
                            <option value="" disabled>
                              Asignar a módulo
                            </option>
                            {modules.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.title}
                              </option>
                            ))}
                          </select>
                        )}
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => onOpenNoteModal(moduleId, note)}
                            className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-90 border border-transparent hover:border-indigo-100"
                            title="Editar apunte"
                          >
                            <Edit3 className="w-5 h-5" />
                          </button>
                          <button
                            onClick={() => onDeleteNote(note.id!)}
                            className="p-3 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90 border border-transparent hover:border-red-100"
                            title="Eliminar apunte"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {moduleNotes.length === 0 && (
          <div className="text-center py-12 bg-neutral-50 rounded-[2rem] border border-dashed border-neutral-200">
            <FolderOpen className="w-12 h-12 text-neutral-200 mx-auto mb-4" />
            <p className="text-neutral-400 font-bold">Este módulo está vacío</p>
          </div>
        )}
      </div>
    );
  };

  const unassignedNotes = notes.filter((n) => !n.moduleId);

  return (
    <div className="space-y-8">
      {/* ── Sub-modos para Aula Multiasignatura (Sección 10): Planificación del aula / Contenido por materia */}
      {aulaMaterias && aulaMaterias.length >= 2 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-neutral-50 p-2 rounded-2xl border border-neutral-200">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSubMode('planificacion')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all min-h-[40px]",
                subMode === 'planificacion'
                  ? "bg-[#1A3C40] text-white shadow-sm"
                  : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
              )}
            >
              Planificación del aula
            </button>
            <button
              type="button"
              onClick={() => setSubMode('materia')}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all min-h-[40px]",
                subMode === 'materia'
                  ? "bg-[#1A3C40] text-white shadow-sm"
                  : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100"
              )}
            >
              Contenido por materia
            </button>
          </div>
          {subMode === 'materia' && onSelectMateria && (
            <MateriaSelector
              currentSubject={{ id: subjectId } as SubjectDoc}
              materias={aulaMaterias}
              onSwitch={(id) => { if (String(id) !== String(subjectId)) onSelectMateria(String(id)); }}
              hint="Seleccionar materia activa"
            />
          )}
        </div>
      )}

      {/* ══════════ VISTA: PLANIFICACIÓN DEL AULA (Sección 11) ══════════ */}
      {aulaMaterias && aulaMaterias.length >= 2 && subMode === 'planificacion' ? (
        <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-6 md:p-8 space-y-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-100">
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xl md:text-2xl font-black text-neutral-900 tracking-tight">
                  Planificación General del Aula
                </h3>
                <span className="bg-[#1A3C40] text-white text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-wider">
                  Alcance: General
                </span>
              </div>
              <p className="text-xs md:text-sm text-neutral-500 font-medium mt-1">
                Escribe, pega o carga un documento con el plan del aula y distribúyelo entre sus {aulaMaterias.length} materias con Magia IA.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {planStatus === 'draft_saved' && (
                <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-900 text-xs font-black px-3.5 py-1.5 rounded-full border border-amber-300 uppercase tracking-wider">
                  <CheckCircle2 className="w-3.5 h-3.5 text-amber-700" />
                  Plan original guardado
                </span>
              )}
              {planStatus === 'distributed' && (
                <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-900 text-xs font-black px-3.5 py-1.5 rounded-full border border-emerald-300 uppercase tracking-wider">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />
                  Plan distribuido
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2">
                Tipo de Plan
              </label>
              <select
                value={planType}
                onChange={(e) => setPlanType(e.target.value as any)}
                className="w-full h-11 px-3.5 text-sm font-bold border border-neutral-200 rounded-xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              >
                <option value="semanal">Plan Semanal</option>
                <option value="mensual">Plan Mensual</option>
                <option value="trimestral">Plan Trimestral</option>
              </select>
            </div>
            <div className="md:col-span-2 flex items-center justify-end gap-3 flex-wrap">
              <input
                ref={planFileInputRef}
                type="file"
                accept=".txt,.md,.docx,.xlsx,.pdf,.json,image/*"
                onChange={handlePlanFileUpload}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => planFileInputRef.current?.click()}
                disabled={isSavingDraft || isDistributing}
                className="bg-white border border-neutral-300 hover:bg-neutral-50 disabled:opacity-50 text-neutral-800 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-colors min-h-[44px] flex items-center gap-2"
                title="Cargar un documento, PDF, Excel o imagen con el plan de aula"
              >
                <Upload className="w-4 h-4 text-neutral-600" />
                Cargar plan / archivo
              </button>
              <button
                type="button"
                onClick={() => handleSaveDraft()}
                disabled={isSavingDraft || isDistributing}
                className="bg-neutral-100 hover:bg-neutral-200 disabled:opacity-50 text-neutral-800 px-5 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-colors min-h-[44px]"
              >
                {isSavingDraft ? 'Guardando...' : '1. Guardar borrador'}
              </button>
              <button
                type="button"
                onClick={handleDistributeWithAI}
                disabled={isDistributing || isSavingDraft}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white px-6 py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-colors shadow-lg shadow-indigo-500/20 min-h-[44px] flex items-center gap-2"
              >
                <Book className="w-4 h-4" />
                {isDistributing ? 'Analizando y distribuyendo...' : '2. Analizar y distribuir'}
              </button>
            </div>
          </div>

          {groupDoc?.originalPlan && (
            <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-4 text-xs font-medium text-amber-900 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-amber-700 shrink-0" />
                <span>
                  <strong>Plan original guardado:</strong> {groupDoc.originalPlan.fileName || 'Documento'} (v{groupDoc.originalPlan.version}) — Ámbito: <strong className="uppercase">{groupDoc.originalPlan.scope || 'classGroup'}</strong>
                </span>
              </div>
              <span className="text-[10px] uppercase font-bold text-amber-700">
                Idempotente y persistido
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-neutral-700 uppercase tracking-wider mb-2">
              Borrador / Texto del Plan Académico
            </label>
            <textarea
              rows={8}
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder="Ingresa aquí los temas, semanas o módulos generales del aula. Por ejemplo:
Semana 1: Comprensión lectora de cuentos cortos y sumas con llevadas de 2 dígitos.
Semana 2: Los seres vivos y sus hábitats, palabras agudas y llanas, y mapas de Panamá..."
              className="w-full p-4 text-sm font-medium border border-neutral-200 rounded-2xl bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-neutral-900 placeholder:text-neutral-300"
            />
          </div>

          {groupDoc?.unclassifiedItems && groupDoc.unclassifiedItems.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center gap-2 text-red-800 text-xs font-black uppercase tracking-wider">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                <span>Pendiente de clasificar ({groupDoc.unclassifiedItems.length})</span>
              </div>
              <p className="text-xs text-red-700">
                Los siguientes elementos no pudieron asignarse con certeza a una materia y se guardaron aquí para revisión manual:
              </p>
              <ul className="list-disc list-inside text-xs text-red-900 space-y-1 font-medium pl-1">
                {groupDoc.unclassifiedItems.map((item: any, idx: number) => (
                  <li key={idx}>
                    <strong>{item.title}</strong>{item.content ? `: ${item.content}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4">
            <h4 className="text-xs font-black text-neutral-700 uppercase tracking-wider mb-2">
              Materias destino en este aula ({aulaMaterias.length}):
            </h4>
            <div className="flex flex-wrap gap-2">
              {aulaMaterias.map((m) => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-2 bg-white border border-neutral-200 px-3 py-1.5 rounded-xl text-xs font-bold text-neutral-800"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: m.color || '#3b82f6' }}
                  />
                  {m.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmation Modal for Modules */}
      {moduleToDelete !== null && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <Trash2 className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">
              Eliminar Módulo
            </h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">
              ¿Estás seguro de eliminar este módulo? Esta acción eliminará
              permanentemente todos los apuntes y materiales creados dentro del
              módulo, y no se puede deshacer.
            </p>
            <div className="flex gap-4">
              <button
                onClick={() => setModuleToDelete(null)}
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                title="Cancelar y mantener el módulo"
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(moduleToDelete)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20 active:scale-95"
                title="Eliminar permanentemente el módulo y todo su contenido"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}

      {isConfirmingGeneratePlan && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <FolderOpen className="w-8 h-8" />
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-2 text-center tracking-tight">
              Generar Formato
            </h3>
            <p className="text-neutral-500 mb-6 text-center font-medium leading-relaxed text-sm">
              Esto creará automáticamente los módulos según el tipo de plan configurado.
            </p>

            <div className="flex gap-4">
              <button
                onClick={() => setIsConfirmingGeneratePlan(false)}
                className="flex-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-900 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all active:scale-95"
                title="Cancelar generación de formato"
              >
                Cancelar
              </button>
              <button
                onClick={confirmGeneratePlan}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
                title="Generar la estructura de módulos de acuerdo al plan"
              >
                Sí, generar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center border border-indigo-100 shadow-sm">
            <FolderOpen className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-2xl font-black text-neutral-900 tracking-tight">
              Módulos y Apuntes
            </h3>
            <p className="text-sm text-neutral-500 font-medium mt-1">
              Organiza el contenido en unidades o temas
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          {modules.length > 0 && (
            <button
              onClick={() => {
                const data = modules.map((m, idx) => ({
                  'N°': idx + 1,
                  Módulo: m.title,
                  'Descripción': m.description || '—',
                  'Módulo Padre': m.parentId ? (modules.find(p => p.id === m.parentId)?.title || '—') : '—',
                  'Fecha Inicio': m.startDate || '—',
                  'Fecha Fin': m.endDate || '—',
                }));
                const ws = XLSX.utils.json_to_sheet(data);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Módulos');
                XLSX.writeFile(wb, `modulos_${new Date().toISOString().split('T')[0]}.xlsx`);
              }}
              className="flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-6 py-4 rounded-2xl text-sm font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest"
              title="Exportar la lista de módulos a Excel"
            >
              <Download className="w-5 h-5" />
              Exportar
            </button>
          )}
          {modules.length === 0 && (
            <button
              onClick={handleGeneratePlanModules}
              className="flex items-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-indigo-600 px-6 py-4 rounded-2xl text-sm font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest"
              title="Generar módulos predefinidos según el plan de la materia"
            >
              Generar formato
            </button>
          )}
          {!isAdding && (
            <button
              id="add-module-btn"
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest"
              title="Crear un nuevo módulo o sección manualmente"
            >
              <Plus className="w-5 h-5" />
              Nueva Sección / Módulo
            </button>
          )}
        </div>
      </div>

      {isAdding && !addingParentId && !editingId && renderModuleForm()}

      <div className="space-y-6">
        {modules.length === 0 && !isAdding ? (
          <div className="p-32 text-center text-neutral-400 bg-white border border-neutral-200 rounded-[3rem] shadow-sm">
            <div className="w-24 h-24 bg-neutral-50 rounded-[2rem] flex items-center justify-center mx-auto mb-8 border border-neutral-100">
              <FolderOpen className="w-12 h-12 text-neutral-200" />
            </div>
            <p className="text-3xl font-black text-neutral-900 tracking-tight">
              No hay módulos creados
            </p>
            <p className="text-lg mt-4 font-medium text-neutral-500">
              Crea módulos para organizar el temario de tu asignatura, o
              presiona "Generar Formato" para cargar los módulos automáticamente
              según el tipo de plan (mensual, trimestral, etc).
            </p>
          </div>
        ) : (
          modules.filter((v,i,a)=>a.findIndex(t =>
            t.title === v.title && String(t.assignedSubjectId || '') === String(v.assignedSubjectId || '')
          )===i).filter(m => !m.parentId).map((mod, index) => {
            const isExpanded = expandedModules.includes(mod.id!);
            const moduleNotes = notes.filter((n) => n.moduleId === mod.id);

            if (editingId === mod.id) {
              return (
                <div key={mod.id} className="mb-6 shadow-2xl rounded-[2.5rem]">
                  {renderModuleForm()}
                </div>
              );
            }

            return (
              <div
                key={mod.id}
                className="bg-white border border-neutral-200 p-8 rounded-[2.5rem] group hover:border-indigo-200 hover:shadow-2xl transition-all duration-500"
              >
                <div className="flex items-start gap-6">
                  <button
                    onClick={() => toggleModule(mod.id!)}
                    className="mt-1 text-neutral-400 hover:text-indigo-600 transition-all p-3 rounded-2xl hover:bg-indigo-50 border border-neutral-100 bg-neutral-50 shadow-sm active:scale-90"
                    title={isExpanded ? "Contraer módulo" : "Expandir módulo"}
                  >
                    {isExpanded ? (
                      <ChevronUp className="w-6 h-6" />
                    ) : (
                      <ChevronDown className="w-6 h-6" />
                    )}
                  </button>
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => toggleModule(mod.id!)}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center gap-4 mb-3">
                      <span className="bg-neutral-100 text-neutral-500 text-[10px] font-black px-4 py-1.5 rounded-full uppercase tracking-widest border border-neutral-200 shrink-0">
                        {getPlanLabel()} {index + 1}
                      </span>
                      <h4 className="text-2xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors leading-tight">
                        {mod.title}
                      </h4>
                      {mod.assignedSubjectId && (
                        <span className="bg-indigo-50 text-indigo-700 text-[10px] font-black px-3 py-1.5 rounded-full uppercase tracking-wider border border-indigo-100 shrink-0">
                          {aulaMaterias?.find((materia) => String(materia.id) === String(mod.assignedSubjectId))?.name || 'Materia asignada'}
                        </span>
                      )}
                    </div>
                    {(mod.startDate || mod.endDate) && (
                      <div className="flex items-center gap-2 mt-3 text-[10px] font-black tracking-widest uppercase bg-indigo-50/50 text-indigo-600 border border-indigo-100 rounded-lg px-3 py-1.5 inline-flex shadow-sm">
                        <span>
                          {mod.startDate
                            ? format(parseISO(mod.startDate), "d 'de' MMMM", {
                                locale: es,
                              })
                            : "---"}
                        </span>
                        <span className="text-indigo-300">-</span>
                        <span>
                          {mod.endDate
                            ? format(
                                parseISO(mod.endDate),
                                "d 'de' MMMM, yyyy",
                                { locale: es },
                              )
                            : "---"}
                        </span>
                      </div>
                    )}
                    {mod.description && (
                      <p className="text-base text-neutral-500 mt-4 leading-relaxed font-medium">
                        {mod.description}
                      </p>
                    )}
                    <div className="flex items-center gap-6 mt-6">
                      <div className="flex items-center gap-2 text-[10px] font-black text-neutral-400 uppercase tracking-widest">
                        <FileText className="w-3.5 h-3.5" />
                        {moduleNotes.length} Apuntes
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEdit(mod);
                      }}
                      className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-90"
                      title="Editar módulo"
                    >
                      <Edit3 className="w-6 h-6" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setModuleToDelete(mod.id!);
                      }}
                      className="p-3 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90"
                      title="Eliminar módulo"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-8 border-t border-neutral-100 pt-8 pl-4 sm:pl-12 border-l-2 border-l-indigo-100">
                    <div className="flex flex-wrap justify-between items-center mb-6 gap-4">
                      <div className="flex items-center gap-4">
                        <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Módulos</h4>
                      </div>
                      <button
                        onClick={() => {
                          setIsAdding(true);
                          setAddingParentId(mod.id!);
                        }}
                        className="flex items-center gap-2 text-indigo-600 hover:text-indigo-500 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                        title="Agregar un submódulo a esta sección"
                      >
                        <Plus className="w-4 h-4" />
                        Nuevo Módulo
                      </button>
                    </div>

                    {isAdding && addingParentId === mod.id && !editingId && (
                      <div className="mb-6">
                        {renderModuleForm()}
                      </div>
                    )}

                    <div className="space-y-6">
                      {modules.filter(m => m.parentId === mod.id).map((child, cIdx) => {
                        const isChildExpanded = expandedModules.includes(child.id!);
                        const childNotes = notes.filter((n) => n.moduleId === child.id);

                        if (editingId === child.id) {
                          return <div key={child.id}>{renderModuleForm()}</div>;
                        }

                        return (
                          <div key={child.id} className="bg-neutral-50 border border-neutral-200 p-6 rounded-[2.5rem] hover:border-indigo-200 transition-all duration-300 shadow-sm hover:shadow-xl">
                             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 cursor-pointer" onClick={() => toggleModule(child.id!)}>
                                <div className="flex-1">
                                   <div className="flex items-center gap-3">
                                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100/50">{getPlanLabel()} {cIdx + 1}</span>
                                      <h5 className="text-xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors">{child.title}</h5>
                                   </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(child); }} className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-90" title="Editar módulo"><Edit3 className="w-5 h-5" /></button>
                                    <button onClick={(e) => { e.stopPropagation(); setModuleToDelete(child.id!); }} className="p-3 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90" title="Eliminar módulo"><Trash2 className="w-5 h-5" /></button>
                                    <button className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all cursor-pointer" title={isChildExpanded ? "Contraer submódulo" : "Expandir submódulo"}>
                                        {isChildExpanded ? <ChevronUp className="w-6 h-6" /> : <ChevronDown className="w-6 h-6" />}
                                    </button>
                                </div>
                             </div>
                             
                             {isChildExpanded && renderModuleContent(childNotes, child.id, child.title)}
                          </div>
                        );
                      })}
                    </div>
                    
                    <div className="mt-8 pt-8 border-t border-neutral-200/50">
                       <h4 className="text-[10px] font-black uppercase tracking-widest text-neutral-400 mb-2">Apuntes Directos</h4>
                       {renderModuleContent(moduleNotes, mod.id, mod.title)}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {(unassignedNotes.length > 0 || modules.length === 0) && (
          <div className="mt-16 pt-16 border-t border-neutral-200">
            <div className="flex items-center gap-4 mb-10">
              <div className="w-12 h-12 bg-neutral-100 rounded-2xl flex items-center justify-center border border-neutral-200 shadow-sm">
                <FileText className="w-6 h-6 text-neutral-400" />
              </div>
              <div>
                <h4 className="text-2xl font-black text-neutral-900 tracking-tight">
                  Contenido sin módulo
                </h4>
                <p className="text-sm text-neutral-500 font-medium mt-1">
                  Apuntes que aún no han sido categorizados
                </p>
              </div>
            </div>
            {renderModuleContent(
              unassignedNotes,
              undefined,
              "Sin Módulo",
            )}
          </div>
        )}
      </div>
      {aiAlertMessage && (
        <div className="fixed inset-0 bg-neutral-900/40 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white border border-neutral-200 rounded-[2.5rem] p-10 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in duration-300">
            <div className="w-16 h-16 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center mb-8 mx-auto">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72ZM14 7l3 3M5 6v4M19 14v4M10 2v2M2 10h2M14 20h2"/></svg>
            </div>
            <h3 className="text-2xl font-black text-neutral-900 mb-4 text-center tracking-tight">Magia IA</h3>
            <p className="text-neutral-500 mb-10 text-center font-medium leading-relaxed">{aiAlertMessage}</p>
            <button onClick={() => setAiAlertMessage(null)} title="Cerrar mensaje de IA" className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs">
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
