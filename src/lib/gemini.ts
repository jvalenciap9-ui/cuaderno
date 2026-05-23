/**
 * SEGURIDAD: Este archivo ya NO inicializa el SDK de Gemini directamente.
 * Todas las llamadas pasan por el servidor proxy (server/index.ts).
 * La API Key vive solo en el servidor y nunca llega al navegador.
 */
export { callGemini as ai } from './geminiClient';
export { callGemini } from './geminiClient';
