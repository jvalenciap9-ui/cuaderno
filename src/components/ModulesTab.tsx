import React, { useState, useEffect } from "react";
import { useDocumentData } from "react-firebase-hooks/firestore";
import { useCustomCollectionData } from "../lib/firestoreUtils";
import { collection, query, where, orderBy, doc, addDoc, updateDoc, deleteDoc, writeBatch, getDocs, limit } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "./AuthProvider";
import { handleFirestoreError, OperationType } from "../lib/firestoreUtils";
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
} from "lucide-react";
import type { NoteDoc, SubjectModuleDoc } from "../types/firestore";
import { cn } from "../lib/utils";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

import { ai } from "../lib/gemini";
import { extractTextFromFile } from "../lib/fileParser";
import { trackEvent, ANALYTICS_CATEGORIES, ANALYTICS_ACTIONS } from "../lib/analytics";

interface ModulesTabProps {
  subjectId: string;
  onOpenNoteModal: (moduleId?: string, note?: NoteDoc | null) => void;
  onDeleteNote: (id: string) => void;
}

export function ModulesTab({
  subjectId,
  onOpenNoteModal,
  onDeleteNote,
}: ModulesTabProps) {
  const { user } = useAuth();
  
  const subjectRef = doc(db, 'subjects', subjectId);
  const [subject] = useDocumentData(subjectRef);

  const modulesRef = collection(db, 'subjectModules');
  const modulesQuery = user?.uid ? query(modulesRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [modulesData] = useCustomCollectionData(modulesQuery);
  const modules = Array.isArray(modulesData) ? [...modulesData].sort((a, b) => (a.order || 0) - (b.order || 0)) : [];

  const notesRef = collection(db, 'notes');
  const notesQuery = user?.uid ? query(notesRef, where('userId', '==', user?.uid), where('subjectId', '==', subjectId), limit(500)) : null;
  const [notesData] = useCustomCollectionData(notesQuery);
  const notes = Array.isArray(notesData) ? [...notesData].sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime()) : [];

  const [isAdding, setIsAdding] = useState(false);
  const [addingParentId, setAddingParentId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<string[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<string[]>([]);
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
        `Eres un asistente experto en comprensión de lectura y estructuración de sílabos universitarios.
        
        !!! INSTRUCCIÓN CRÍTICA DE TIEMPO !!! 
        Para este documento en particular, HOY ES EXACTAMENTE: ${note.date} (${formattedDate}).
        Cualquier referencia temporal (como "hoy", "mañana", "el próximo jueves") DEBE calcularse matemáticamente a partir de esta fecha base.
        
        !!! EXTRACCIÓN MASIVA Y EXHAUSTIVA DE PLANES Y MÚLTIPLES SEMANAS !!!
        - Este documento puede contener un sílabo completo o un plan trimestral/semestral.
        - ATENCIÓN: Si el documento detalla actividades para MUCHAS SEMANAS (Semana 1, Semana 2, Semana 3, Semana 4, Semana 5, etc.), DEBES PROCESARLAS TODAS SIN EXCEPCIÓN. NO TE DETENGAS en la primera o segunda semana.
        - ES OBLIGATORIO LEER TODO EL DOCUMENTO. Si hay planes para 16 semanas, genera eventos y clases para las 16 semanas.
        - El estudiante te pide que extraigas de forma MASIVA Y OBLIGATORIA la lista COMPLETA de:
          1. MÓDULOS (e.g., Unidades, Trimestres, Semanas principales). EXTRAE TODOS (pueden ser 7+).
          2. APUNTES / CLASES (notes). Extrae el título y la fecha exacta para CADA clase/apunte de cada módulo (pueden ser 12+ por módulo, ¡EXTRAE TODOS!).
          3. EVENTOS DE CALENDARIO (events). Tareas, fechas límite, clases específicas si aplican diferenciadas. 
          4. EVALUACIONES (evaluations). Exámenes y pruebas referenciadas.
        - Identifica a qué fecha exacta (YYYY-MM-DD) corresponde CADA día de clase detallado en el documento (sumando días a la fecha base según correspondan las semanas. Ej. Semana 2 es +7 días, Semana 3 es +14 días).
        
        ${moduleInfo}

        Extrae OBLIGATORIAMENTE TODOS los datos en un objeto JSON puro (sin bloques Markdown) con este formato estricto:
        {
          "newModules": [{"tempId": "m1", "title": "Nombre Módulo", "description": "Descripción opcional", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD"}],
          "newNotes": [{"title": "Título del apunte/clase", "content": "Breve descripción", "date": "YYYY-MM-DD", "moduleId": "string|tempId"}],
          "events": [{"title": "Título evento", "date": "YYYY-MM-DD", "type": "class|exam|deadline|other", "moduleId": "string|tempId"}],
          "evaluations": [{"title": "Título evaluación", "maxScore": 100, "date": "YYYY-MM-DD", "type": "teorica|practica", "moduleId": "string|tempId"}]
        }
        NO RESUMAS NADA. Si el documento detalla 84 clases, genera 84 objetos dentro de "newNotes" o "events". Usa un "tempId" (ej. "m1") en "newModules" para referenciarlo en las clases/eventos extraídos si son nuevos.`
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
      const cleanText = response.text.replace(/```json\n?|\n?```/g, "").trim();
      const match = cleanText.match(/\{[\s\S]*\}/);
      if (!match) throw new Error("La IA no devolvió un JSON válido");
      
      const data = JSON.parse(match[0]);
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
            subjectId,
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
            type: ev.type || 'other'
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
            maxScore: ev.maxScore || 100,
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
      const msg = 'Hubo un error al procesar la IA: ' + ((e instanceof Error ? e.message : '') || 'Desconocido');
      setAiAlertMessage(msg);
      alert(msg);
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
          subjectId,
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
    if (!subject) return;
    setIsConfirmingGeneratePlan(true);
  };
  
  const confirmGeneratePlan = async () => {
    setIsConfirmingGeneratePlan(false);
    if (!subject || !user) return;
    const plan = subject.plan || "otro";
    let numModules = 0;
    let label = "Módulo";

    switch (plan) {
      case "semanal":
        numModules = 16;
        label = "Semana";
        break;
      case "mensual":
        numModules = 6;
        label = "Mes";
        break;
      case "trimestral":
        numModules = 3;
        label = "Trimestre";
        break;
      case "cuatrimestral":
        numModules = 4;
        label = "Cuatrimestre / Mes";
        break;
      case "anual_8":
        numModules = 8;
        label = "Mes";
        break;
      case "anual_10":
        numModules = 10;
        label = "Mes";
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
                subjectId,
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
              ¿Pertenece a un período/trimestre?
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
            <p className="text-xs text-neutral-500 mt-2 ml-2 font-medium">Si seleccionas un trimestre, se agrupará dentro de él.</p>
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
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="flex-1 sm:flex-none px-8 py-4 text-xs font-black bg-indigo-600 text-white rounded-2xl hover:bg-indigo-50 transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest"
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
              onClick={() => onOpenNoteModal(moduleId)}
              className="flex items-center gap-2 text-indigo-600 hover:text-indigo-500 text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
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
              >
                Cancelar
              </button>
              <button
                onClick={() => handleDelete(moduleToDelete)}
                className="flex-1 bg-red-600 hover:bg-red-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20 active:scale-95"
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
              >
                Cancelar
              </button>
              <button
                onClick={confirmGeneratePlan}
                className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
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
          {modules.length === 0 && (
            <button
              onClick={handleGeneratePlanModules}
              className="flex items-center gap-2 bg-neutral-100 hover:bg-neutral-200 text-indigo-600 px-6 py-4 rounded-2xl text-sm font-black transition-all shadow-sm active:scale-95 uppercase tracking-widest"
            >
              Generar formato
            </button>
          )}
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-3 bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-4 rounded-2xl text-sm font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest"
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
          modules.filter((v,i,a)=>a.findIndex(t=>(t.title === v.title))===i).filter(m => !m.parentId).map((mod, index) => {
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
                        Módulo {index + 1}
                      </span>
                      <h4 className="text-2xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors leading-tight">
                        {mod.title}
                      </h4>
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
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-all duration-300 translate-x-4 group-hover:translate-x-0">
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
                          <div key={child.id} className="bg-neutral-50 border border-neutral-200 p-6 rounded-[2.5rem] group hover:border-indigo-200 transition-all duration-300 shadow-sm hover:shadow-xl">
                             <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 cursor-pointer" onClick={() => toggleModule(child.id!)}>
                                <div className="flex-1">
                                   <div className="flex items-center gap-3">
                                      <span className="text-[10px] font-black uppercase tracking-widest text-indigo-500 bg-indigo-50 px-3 py-1.5 rounded-full border border-indigo-100/50">Módulo {cIdx + 1}</span>
                                      <h5 className="text-xl font-black text-neutral-900 group-hover:text-indigo-600 transition-colors">{child.title}</h5>
                                   </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); handleEdit(child); }} className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all active:scale-90" title="Editar módulo"><Edit3 className="w-5 h-5" /></button>
                                    <button onClick={(e) => { e.stopPropagation(); setModuleToDelete(child.id!); }} className="p-3 text-neutral-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-all active:scale-90" title="Eliminar módulo"><Trash2 className="w-5 h-5" /></button>
                                    <button className="p-3 text-neutral-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all cursor-pointer">
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

        {(unassignedNotes.length > 0) && (
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
            <button onClick={() => setAiAlertMessage(null)} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-indigo-500/20 active:scale-95 uppercase tracking-widest text-xs">
              Aceptar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
