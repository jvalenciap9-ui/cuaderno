import { db } from './db';
import { parseDocumentWithAI } from './documentParser';

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
