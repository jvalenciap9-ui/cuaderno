import { db } from './db';
import { parseDocumentWithAI } from './documentParser';
import type { ExtractedEvent } from './db';

const DAY_OFFSET: Record<string, number> = {
  lunes: 0, martes: 1, 'miércoles': 2, miercoles: 2,
  jueves: 3, viernes: 4, 'sábado': 5, sabado: 5, domingo: 6,
};
const DAY_NAMES = Object.keys(DAY_OFFSET);
const QUIZ_KEYWORDS = ['prueba', 'examen', 'evaluación', 'evaluacion', 'quiz', 'test', 'parcial', 'taller calificado'];

function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeText(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function getDayNameFromString(text: string): string | null {
  const norm = normalizeText(text);
  for (const day of DAY_NAMES) {
    if (norm.includes(day)) {
      return day;
    }
  }
  return null;
}

function isDayName(text: string): boolean {
  return getDayNameFromString(text) !== null;
}

function isQuiz(title: string, description: string): boolean {
  const combined = `${normalizeText(title)} ${normalizeText(description)}`;
  return QUIZ_KEYWORDS.some(kw => combined.includes(kw));
}

function detectDayColumn(rows: (string | null)[][]): number {
  const maxCols = Math.max(...rows.map(r => r.length));
  for (let c = 0; c < maxCols; c++) {
    let dayHits = 0;
    for (let r = 0; r < Math.min(rows.length, 25); r++) {
      const val = rows[r]?.[c];
      if (val && isDayName(val)) dayHits++;
      if (dayHits >= 2) return c;
    }
  }
  return 0;
}

export async function parsePDF(file: File): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    text += pageText + '\n';
  }
  return text;
}

export async function parseWord(file: File): Promise<string> {
  const { default: mammoth } = await import('mammoth');
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value;
}

export async function parseExcel(file: File): Promise<any[]> {
  const xlsx = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = xlsx.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(worksheet);
}

export async function parseWeeklyPlanExcel(
  file: File,
  subjectId: number,
  baseDate?: Date,
): Promise<number> {
  const XLSX = await import('xlsx');
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = worksheet['!merges'] || [];
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:Z100');
  const refDate = baseDate ? getMonday(baseDate) : getMonday(new Date());

  const getCell = (row: number, col: number): string | null => {
    const addr = XLSX.utils.encode_cell({ r: row, c: col });
    const cell = worksheet[addr];
    if (cell && cell.v !== undefined && cell.v !== null) {
      return String(cell.v).trim();
    }
    for (const m of merges) {
      if (row >= m.s.r && row <= m.e.r && col >= m.s.c && col <= m.e.c) {
        if (row !== m.s.r || col !== m.s.c) {
          const topAddr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c });
          const topCell = worksheet[topAddr];
          return topCell ? String(topCell.v).trim() : null;
        }
      }
    }
    return null;
  };

  const rows: (string | null)[][] = [];
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: (string | null)[] = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      row.push(getCell(r, c));
    }
    rows.push(row);
  }

  const dayCol = detectDayColumn(rows);
  const subjectColor = (await db.subjects.get(subjectId))?.color || '#6366f1';
  const students = await db.students.where('subjectId').equals(subjectId).toArray();
  const existingEvals = await db.evaluations.where('subjectId').equals(subjectId).toArray();

  interface RawRow {
    day: string | null;
    time: string | null;
    title: string;
    description: string;
  }

  const parsed: RawRow[] = [];
  let currentDay: string | null = null;

  for (let r = 0; r < rows.length; r++) {
    const dayVal = rows[r][dayCol];
    if (dayVal) {
      const detectedDay = getDayNameFromString(dayVal);
      if (detectedDay) {
        currentDay = detectedDay;
      }
    }
    if (!currentDay) continue;

    let detectedTimeCol = -1;
    let detectedTitleCol = -1;
    let detectedDescCol = -1;

    const maxC = rows[r].length;
    let timeCandidate = -1;
    let firstTextCol = -1;

    for (let c = dayCol + 1; c < maxC; c++) {
      const val = rows[r][c];
      if (!val) continue;
      if (/^\d{1,2}:\d{2}/.test(val) || /^\d{1,2}:\d{2}\s*(am|pm)/i.test(val)) {
        timeCandidate = c;
        break;
      }
    }

    if (timeCandidate >= 0) {
      for (let c = timeCandidate + 1; c < maxC; c++) {
        if (rows[r][c]) { firstTextCol = c; break; }
      }
    } else {
      for (let c = dayCol + 1; c < maxC; c++) {
        if (rows[r][c]) { firstTextCol = c; break; }
      }
    }

    detectedTitleCol = timeCandidate >= 0 ? (firstTextCol >= 0 ? firstTextCol : timeCandidate + 1) : (firstTextCol >= 0 ? firstTextCol : dayCol + 1);
    detectedTimeCol = timeCandidate >= 0 ? timeCandidate : -1;

    for (let c = detectedTitleCol + 1; c < maxC; c++) {
      if (rows[r][c]) { detectedDescCol = c; break; }
    }

    const timeVal = detectedTimeCol >= 0 ? rows[r][detectedTimeCol] : null;
    const titleVal = rows[r][detectedTitleCol];
    const descVal = detectedDescCol >= 0 ? rows[r][detectedDescCol] : null;

    if (!titleVal) continue;

    parsed.push({
      day: currentDay,
      time: timeVal,
      title: titleVal,
      description: descVal || '',
    });
  }

  if (parsed.length === 0) {
    return 0;
  }

  const color = subjectColor;
  const events: ExtractedEvent[] = [];
  const quizEvalIds: number[] = [];

  const docId = await db.uploadedDocs.add({
    name: file.name,
    fileType: 'xlsx',
    rawText: JSON.stringify(parsed),
    processedAt: new Date(),
  });

  for (const row of parsed) {
    const dayOffset = DAY_OFFSET[normalizeText(row.day!)];
    const eventDate = new Date(refDate);
    eventDate.setDate(eventDate.getDate() + dayOffset);

    const startDate = new Date(eventDate);
    if (row.time) {
      const parts = row.time.match(/^(\d{1,2}):(\d{2})/);
      if (parts) {
        startDate.setHours(parseInt(parts[1]), parseInt(parts[2]), 0, 0);
      } else {
        startDate.setHours(8, 0, 0, 0);
      }
    } else {
      startDate.setHours(8, 0, 0, 0);
    }

    const endDate = new Date(startDate);
    endDate.setHours(endDate.getHours() + 1);

    const type: ExtractedEvent['type'] = isQuiz(row.title, row.description) ? 'quiz' : 'event';

    events.push({
      title: row.title,
      description: row.description,
      startDate,
      endDate,
      type,
      courseId: subjectId,
      color,
      sourceDocId: docId as number,
      durationMinutes: 60,
    });

    if (type === 'quiz') {
      const normTitle = normalizeText(row.title);
      const existing = [...existingEvals].find(e => normalizeText(e.title) === normTitle);
      if (!existing) {
        const evalId = await db.evaluations.add({
          subjectId,
          title: row.title,
          maxScore: 100,
          date: formatDate(startDate),
          type: 'teorica',
        });
        quizEvalIds.push(evalId);

        const gradeRecords = students.map(s => ({
          subjectId,
          evaluationId: evalId,
          studentId: s.id!,
          score: 0,
        }));
        if (gradeRecords.length > 0) {
          await db.grades.bulkAdd(gradeRecords);
        }
      }
    }
  }

  await db.extractedEvents.bulkAdd(events);
  return events.length;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function processFileAndExtractEvents(file: File, courseId: number) {
  let rawText = '';
  const extension = file.name.split('.').pop()?.toLowerCase();

  try {
    if (extension === 'pdf') {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      
      let text = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const pageText = content.items.map((item: any) => item.str).join(' ');
        text += pageText + '\n';
      }
      rawText = text;
    } else if (extension === 'docx') {
      const { default: mammoth } = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      rawText = result.value;
    } else if (extension === 'xlsx' || extension === 'xls') {
      const xlsx = await import('xlsx');
      const arrayBuffer = await file.arrayBuffer();
      const workbook = xlsx.read(arrayBuffer, { type: 'array' });
      let text = '';
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        text += xlsx.utils.sheet_to_txt(worksheet) + '\n';
      });
      rawText = text;
    } else if (extension === 'txt' || extension === 'csv') {
      rawText = await file.text();
    } else {
      throw new Error("Formato de archivo no soportado. Por favor, sube un PDF, DOCX, XLSX, TXT o CSV.");
    }

    if (!rawText.trim()) {
      throw new Error("No se pudo extraer texto del archivo.");
    }

    const docId = await db.uploadedDocs.add({
      name: file.name,
      fileType: extension || 'unknown',
      rawText: rawText,
      processedAt: new Date(),
    });

    const courses = await db.subjects.toArray();
    const context = `Cursos disponibles: ${courses.map(c => `${c.name} (id:${c.id})`).join(', ')}`;

    const events = await parseDocumentWithAI(rawText, file.name, context);

    if (events && events.length > 0) {
      const extractedEventsToSave = events.map((ev: any) => ({
        title: ev.title || 'Evento importado',
        description: ev.description || '',
        startDate: ev.startDate ? new Date(ev.startDate) : new Date(),
        endDate: ev.endDate ? new Date(ev.endDate) : undefined,
        type: ev.type || 'event',
        courseId: ev.courseId || courseId,
        color: ev.color || courses.find(c => c.id === (ev.courseId || courseId))?.color || '#3b82f6',
        sourceDocId: docId as number
      }));

      await db.extractedEvents.bulkAdd(extractedEventsToSave);
      return extractedEventsToSave.length;
    }

    return 0;
  } catch (error) {
    console.error("Error processing document:", error);
    throw error;
  }
}
