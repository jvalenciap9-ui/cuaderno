export async function extractTextFromFile(dataUrlOrUrl: string, mimeType: string): Promise<string> {
  let buffer: ArrayBuffer;

  if (dataUrlOrUrl.startsWith('http')) {
    try {
      // Intentar fetch directo primero (puede fallar por CORS)
      const directResponse = await fetch(dataUrlOrUrl);
      if (!directResponse.ok) throw new Error('Falló directo');
      buffer = await directResponse.arrayBuffer();
    } catch (e) {
      // Utilizamos corsproxy.io para evitar problemas de CORS de Firebase con archivos binarios.
      const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(dataUrlOrUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error('No se pudo descargar el archivo de Firebase Storage ni siquiera con el proxy.');
      buffer = await response.arrayBuffer();
    }
  } else if (dataUrlOrUrl.includes(',')) {
    // Es un Data URL base64
    const base64Data = dataUrlOrUrl.split(',')[1];
    if (!base64Data) throw new Error('Data base64 inválida');
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    buffer = bytes.buffer;
  } else {
    throw new Error('Formato de archivo no reconocido');
  }

  try {
    if (mimeType === 'application/pdf') {
      const pdfjsLib = await import('pdfjs-dist');
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
      let text = '';
      const maxPages = 50;
      const pagesToExtract = Math.min(pdf.numPages, maxPages);
      
      for (let i = 1; i <= pagesToExtract; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map((item: any) => item.str).join(' ') + '\n';
      }
      
      if (pdf.numPages > maxPages) {
        text += `\n... [El documento tiene ${pdf.numPages} páginas, pero por límites del sistema de Inteligencia Artificial, solo se extrajeron las primeras ${maxPages} páginas para buscar fechas y evaluaciones]`;
      }
      
      return text.substring(0, 1500000);
    } 
    
    if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || mimeType === 'application/msword') {
      const { default: mammoth } = await import('mammoth');
      const result = await mammoth.extractRawText({ arrayBuffer: buffer });
      return result.value;
    }

    if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimeType === 'application/vnd.ms-excel' || mimeType === 'text/csv') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(buffer, { type: 'array' });
      let text = '';
      workbook.SheetNames.forEach(sheetName => {
        const worksheet = workbook.Sheets[sheetName];
        text += `Hoja: ${sheetName}\n`;
        text += XLSX.utils.sheet_to_txt(worksheet) + '\n';
      });
      return text;
    }

    if (mimeType.startsWith('text/')) {
      return new TextDecoder().decode(buffer);
    }

    return '';
  } catch (error) {
    console.error('Error extracting text from file:', error);
    throw new Error(`No se pudo procesar el documento. Puede que sea demasiado grande o esté en un formato no compatible.`);
  }
}
