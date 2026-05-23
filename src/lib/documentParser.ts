import { ai } from './gemini';

export async function parseDocumentWithAI(rawText: string, fileName: string, context?: string) {
  const currentDate = new Date().toISOString().split('T')[0];
  const prompt = `
Eres un asistente educativo. Analiza el siguiente documento (puede ser un plan semanal, una programación o una lista de eventos).
Extrae una lista de eventos con los siguientes campos: 
- title (título del evento o actividad)
- description (breve descripción)
- startDate (en formato ISO, intenta deducir día y hora)
- type (puede ser "event", "quiz", "homework", "resource")
- courseId (asigna un número de curso según el contexto, si no hay, usa 1)

IMPORTANTE: Hoy es ${currentDate}. Usa este año y mes como base para las fechas que no tengan año especificado.
${context ? `Contexto adicional para asignar courseId:\n${context}\n` : ''}
Devuelve SOLO un JSON válido con un array "events". Ejemplo:
{"events": [{"title": "Toma de asistencia", "description": "Registro en plataforma", "startDate": "${currentDate}T08:15:00", "type": "event", "courseId": 1}]}

Documento:
${rawText}
`;
  const response = await ai({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: { 
      temperature: 0.2,
      responseMimeType: "application/json"
    }
  });
  if (!response.text) {
      throw new Error("No text found in response");
  }
  const jsonMatch = response.text.match(/\{.*\}/s);
  if (!jsonMatch) {
      throw new Error("No JSON found in response");
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return parsed.events;
}
