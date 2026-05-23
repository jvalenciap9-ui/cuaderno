import { callGemini } from "../lib/geminiClient";
import { db, type Note, type Evaluation, type CalendarEvent, type Material, type SubjectModule } from "../lib/db";
import { extractTextFromFile } from "../lib/fileParser";

export interface AnalysisResult {
  evaluations: Omit<Evaluation, 'id' | 'subjectId'>[];
  calendarEvents: Omit<CalendarEvent, 'id' | 'subjectId'>[];
  materials: Omit<Material, 'id' | 'subjectId'>[];
}

export async function analyzeNotes(subjectId: number, notes: Note[], modules: SubjectModule[] = []): Promise<AnalysisResult> {
  const materials = await db.materials.where('subjectId').equals(subjectId).toArray();

  if (notes.length === 0 && materials.length === 0) return { evaluations: [], calendarEvents: [], materials: [] };

  const notesWithExtractedText = await Promise.all(notes.map(async n => {
    let extractedText = "";
    if (n.attachment && n.attachment.data) {
      extractedText = await extractTextFromFile(n.attachment.data, n.attachment.type);
    }
    return {
      title: n.title,
      date: n.date,
      content: n.content,
      attachmentText: extractedText
    };
  }));

  const materialsWithExtractedText = await Promise.all(materials.map(async m => {
    let extractedText = "";
    if (m.attachment && m.attachment.data) {
      extractedText = await extractTextFromFile(m.attachment.data, m.attachment.type);
    }
    return {
      title: m.title,
      type: m.type,
      description: m.description,
      observations: m.observations,
      attachmentText: extractedText
    };
  }));

  let notesContent = notesWithExtractedText.map(n => 
    `Título: ${n.title}\nFecha: ${n.date}\nContenido: ${n.content}${n.attachmentText ? `\nContenido Extraído del Adjunto: ${n.attachmentText}` : ''}`
  ).join("\n\n---\n\n");

  let materialsContent = materialsWithExtractedText.length > 0
    ? `Materiales existentes:\n${materialsWithExtractedText.map(m => `- ${m.title} (${m.type}): ${m.description || ''} ${m.observations || ''}${m.attachmentText ? `\nContenido Extraído del Documento Material: ${m.attachmentText}` : ''}`).join("\n")}\n\n`
    : "";

  // Evitar que el payload sea demasiado grande y cause un error 400 Bad Request
  const MAX_COMBINED_LENGTH = 1500000; // ~1.5M chars (~300k tokens)
  if (notesContent.length + materialsContent.length > MAX_COMBINED_LENGTH) {
    if (notesContent.length > MAX_COMBINED_LENGTH / 2) {
      notesContent = notesContent.substring(0, MAX_COMBINED_LENGTH / 2) + "\n...[Apuntes truncados por límite de tamaño]";
    }
    if (materialsContent.length > MAX_COMBINED_LENGTH / 2) {
      materialsContent = materialsContent.substring(0, MAX_COMBINED_LENGTH / 2) + "\n...[Materiales truncados por límite de tamaño]";
    }
  }

  const modulesContext = modules.length > 0 
    ? `Módulos de la asignatura:\n${modules.map(m => `- ID: ${m.id} | Título: ${m.title}`).join("\n")}\n\n`
    : "";

  const todayStr = new Date().toISOString().split('T')[0];
    const response = await callGemini({
      model: "gemini-2.5-flash",
      contents: `Contexto de tiempo: Hoy es ${todayStr}.
      
      Analiza TODOS los siguientes apuntes de clase y materiales existentes de manera exhaustiva (no omitas ninguno) para extraer información estructurada sobre:
      1. Evaluaciones futuras (exámenes, tareas, proyectos).
      2. Eventos de calendario (clases, fechas importantes).
      3. Materiales de estudio adicionales (libros, enlaces, videos, documentos mencionados).
      
      ${modulesContext}
      ${materialsContent}
      Apuntes:
      ${notesContent}
      
      Reglas:
      1. Si mencionan lecturas, temas de clase, actividades, exámenes o evaluaciones, EXTRÁELOS ABSOLUTAMENTE TODOS.
      2. SOPORTE MULTI-SEMANAL: Para planes de múltiples semanas, PROCESA Y EXTRAE TODAS LAS SEMANAS SIN EXCEPCIÓN.
         - Calcula fechas exactas (YYYY-MM-DD) para cada día de la semana mencionado.
         - Si la semana base comienza un Lunes, asume +7 días para cada semana siguiente.
      3. OBLIGATORIO: Analiza TODOS los documentos separados por '---'. No te detengas al analizar el primero.
      4. RELACIÓN CON MÓDULOS: Para cada evento/evaluación, asigna el 'moduleId' correspondiente si el texto menciona trimestre/unidad y coincide con la lista de módulos.
      5. Usa la fecha del apunte (no la de hoy) para calcular fechas relativas ("mañana", "próxima semana", etc.).
      6. Tipos de evaluación: 'teorica' (conocimientos teóricos), 'practica' (talleres, tareas, proyectos), 'apreciativa' (participación, conducta). Sin puntaje explícito: asumir 100.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            evaluations: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  maxScore: { type: "NUMBER" },
                  date: { type: "STRING" },
                  type: { type: "STRING" },
                  moduleId: { type: "INTEGER" }
                },
                required: ["title", "maxScore", "date", "type"]
              }
            },
            calendarEvents: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  date: { type: "STRING" },
                  startTime: { type: "STRING" },
                  endTime: { type: "STRING" },
                  type: { type: "STRING" },
                  moduleId: { type: "INTEGER" }
                },
                required: ["title", "date", "type"]
              }
            },
            materials: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  title: { type: "STRING" },
                  type: { type: "STRING" },
                  description: { type: "STRING" },
                  observations: { type: "STRING" },
                  date: { type: "STRING" },
                  startTime: { type: "STRING" },
                  endTime: { type: "STRING" },
                  moduleId: { type: "INTEGER" }
                },
                required: ["title", "type", "date"]
              }
            }
          },
          required: ["evaluations", "calendarEvents", "materials"]
        }
      }
    });

  try {
    const text = response.text || "{}";
    const cleanText = text.replace(/```json\n?|\n?```/g, "").trim();
    const result = JSON.parse(cleanText) as AnalysisResult;
    return result;
  } catch (error) {
    console.error("Error parsing Gemini JSON:", error);
    return { evaluations: [], calendarEvents: [], materials: [] };
  }
}

export async function applyAnalysis(subjectId: number, analysis: AnalysisResult) {
  // Add evaluations
  if (analysis.evaluations && Array.isArray(analysis.evaluations)) {
    for (const evalData of analysis.evaluations) {
      const existing = await db.evaluations.where({ subjectId, title: evalData.title }).first();
      if (!existing) {
        await db.evaluations.add({ ...evalData, subjectId });
      } else {
        await db.evaluations.update(existing.id!, { ...evalData });
      }
    }
  }

  // Add calendar events
  if (analysis.calendarEvents && Array.isArray(analysis.calendarEvents)) {
    for (const eventData of analysis.calendarEvents) {
      const existing = await db.calendarEvents.where({ subjectId, title: eventData.title, date: eventData.date }).first();
      if (!existing) {
        await db.calendarEvents.add({ ...eventData, subjectId });
      } else {
        await db.calendarEvents.update(existing.id!, { ...eventData });
      }
    }
  }

  // Add materials
  if (analysis.materials && Array.isArray(analysis.materials)) {
    for (const materialData of analysis.materials) {
      const existing = await db.materials.where({ subjectId, title: materialData.title }).first();
      if (!existing) {
        await db.materials.add({ ...materialData, subjectId });
      } else {
        await db.materials.update(existing.id!, { ...materialData });
      }
    }
  }
}
