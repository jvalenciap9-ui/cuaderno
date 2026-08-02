/**
 * geminiClient.ts — Cliente seguro para el proxy backend
 * 
 * En lugar de llamar directamente a la API de Gemini (exponiendo la key),
 * todas las llamadas pasan por nuestro servidor Express en /api/gemini.
 * La API Key NUNCA llega al navegador.
 */

// URL del proxy backend
// En dev: servidor Express local. En prod: Cloud Run (directo, evita 502 del proxy de Hosting)
const GEMINI_URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : 'https://geminiproxy-t6k4ah2mva-uc.a.run.app';
// Health check / others pasan por hosting
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';

import { auth } from './firebase';

interface GeminiRequestConfig {
  responseMimeType?: string;
  responseSchema?: object;
  temperature?: number;
  maxOutputTokens?: number;
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType: string; fileUri: string };
}

interface GeminiContent {
  role?: string;
  parts: GeminiPart[];
}

interface GeminiResponse {
  text: string;
}

/**
 * Llama al proxy backend de Gemini de forma segura.
 * Equivalente al SDK `ai.models.generateContent(...)`.
 */
export async function callGemini(options: {
  model?: string;
  contents: string | GeminiContent | GeminiContent[];
  config?: GeminiRequestConfig;
}): Promise<GeminiResponse> {
  const { model = 'gemini-2.5-flash', contents, config = {} } = options;

  const url = import.meta.env.DEV
    ? `${API_BASE}/api/gemini`
    : `${GEMINI_URL}/geminiproxy`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  
  // Si hay un usuario activo, adjuntamos su ID Token para validar la cuota en producción
  const user = auth.currentUser;
  if (user) {
    try {
      const idToken = await user.getIdToken();
      headers['Authorization'] = `Bearer ${idToken}`;
    } catch (e) {
      console.warn("No se pudo obtener el ID Token para la llamada de IA:", e);
    }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model, contents, config }),
  });

  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    let errMsg: string;
    try {
      const err = JSON.parse(bodyText);
      errMsg = err.error || `Error HTTP ${response.status}`;
      if (err.details) errMsg += ` — ${String(err.details).slice(0, 500)}`;
    } catch {
      errMsg = bodyText.trim().slice(0, 300) || response.statusText || 'Error desconocido';
    }
    if (response.status === 503 || response.status === 500) {
      throw new Error(`Servidor de IA no disponible. ${errMsg}`);
    }
    if (response.status === 429) {
      throw new Error(`Límite de solicitudes excedido. Espera un momento y vuelve a intentar.`);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(`Error de autenticación con la IA (${response.status}). Verifica la API Key en Configuración.`);
    }
    throw new Error(errMsg);
  }

  let data: any;
  try {
    data = JSON.parse(bodyText);
  } catch {
    throw new Error(`Respuesta inválida del servidor IA. El servidor no devolvió JSON válido.`);
  }

  if (!data.text || typeof data.text !== 'string') {
    throw new Error(`La IA no generó texto en la respuesta.`);
  }

  return { text: data.text };
}

/**
 * Verifica si el servidor proxy está disponible.
 */
export async function checkGeminiHealth(): Promise<{ ok: boolean; hasKey: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      const text = await res.text().catch(() => 'No response body');
      return { ok: false, hasKey: false, error: `HTTP ${res.status}: ${text.trim().slice(0, 300)}` };
    }
    const data = await res.json().catch(async () => {
      const text = await res.text().catch(() => 'No response body');
      return Promise.reject(new Error(`Respuesta inválida del servidor IA: ${text.trim().slice(0, 300)}`));
    });
    return { ok: true, hasKey: data.hasKey };
  } catch (err: unknown) {
    return { ok: false, hasKey: false, error: err instanceof Error ? err.message : String(err) };
  }
}
