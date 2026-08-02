import { ai } from './gemini';

function extractJSON(text: string): string {
  const trimmed = text.trim();
  // Try direct parse first
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // not plain JSON
  }
  // Try extracting from ```json ... ``` block
  const jsonBlockMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonBlockMatch) {
    const candidate = jsonBlockMatch[1].trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // not valid JSON inside block
    }
  }
  // Fallback: find outermost {...} or [...] using brace matching
  const braceMatch = trimmed.match(/\{[\s\S]*\}/);
  if (braceMatch) return braceMatch[0];
  const bracketMatch = trimmed.match(/\[[\s\S]*\]/);
  if (bracketMatch) return bracketMatch[0];
  throw new Error('No se encontró JSON válido en la respuesta de la IA.');
}

export async function parseDocumentWithAI(rawText: string, fileName: string, context?: string) {
  if (!rawText || rawText.trim().length < 10) {
    throw new Error('El documento no contiene suficiente texto legible para analizar.');
  }

  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = `
Eres un asistente educativo. Analiza el siguiente documento educativo (puede ser un plan semanal, una programación académica o una lista de eventos).

Debes extraer una lista de eventos con los siguientes campos:
- title (título del evento o actividad, obligatorio)
- description (breve descripción, puede ser string vacío)
- startDate (fecha en formato ISO, intenta deducir día y hora. Si no hay hora, usa las 08:00)
- type (puede ser "event", "quiz", "homework", "resource")
- courseId (asigna un número de curso según el contexto; si no hay contexto, usa 1)

IMPORTANTE: Hoy es ${currentDate}. Usa este año y mes como base para las fechas que no tengan año especificado.
${context ? `Contexto adicional para asignar courseId:\n${context}\n` : ''}

INSTRUCCIONES ESTRICTAS:
- Devuelve ÚNICA y EXCLUSIVAMENTE un objeto JSON válido.
- NO uses bloques de código markdown (\`\`\`).
- NO incluyas explicaciones, comentarios ni texto adicional.
- El JSON debe tener un array "events".
- Si no encuentras eventos, devuelve: {"events": []}

Ejemplo con plan semanal de matemáticas:
{"events": [{"title": "Clase: Álgebra lineal", "description": "Introducción a vectores y matrices", "startDate": "${currentDate}T08:00:00", "type": "event", "courseId": 1}, {"title": "Prueba parcial 1", "description": "Evaluación de álgebra", "startDate": "${currentDate}T10:00:00", "type": "quiz", "courseId": 1}]}

Ejemplo con plan de lenguaje:
{"events": [{"title": "Taller de lectura crítica", "description": "Análisis de texto narrativo", "startDate": "${currentDate}T14:00:00", "type": "event", "courseId": 2}, {"title": "Entrega de ensayo", "description": "Ensayo sobre literatura contemporánea", "startDate": "${currentDate}T23:59:00", "type": "homework", "courseId": 2}]}

Documento a analizar (${fileName}):
${rawText}
`;
  const response = await ai({
    model: 'gemini-2.0-flash',
    contents: prompt,
    config: {
      temperature: 0.1,
      responseMimeType: "application/json"
    }
  });
  if (!response.text || !response.text.trim()) {
    throw new Error('La IA no generó ninguna respuesta. Verifica que la API Key de Gemini sea válida y que el documento contenga texto legible.');
  }
  const jsonStr = extractJSON(response.text);
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed.events)) {
    throw new Error('La respuesta de la IA no contiene un array "events" válido.');
  }
  return parsed.events;
}
