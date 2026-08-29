/**
 * geminiClient.ts — Cliente seguro para el proxy backend
 * 
 * En lugar de llamar directamente a la API de Gemini (exponiendo la key),
 * todas las llamadas pasan por nuestro servidor Express en /api/gemini.
 * La API Key NUNCA llega al navegador.
 */

// URL opcional del proxy backend. Debe contener el endpoint COMPLETO; nunca se
// concatena el nombre de la Function porque las URLs directas de Cloud Run y
// los rewrites de Hosting no comparten el mismo pathname.
const CONFIGURED_GEMINI_PROXY_URL = String(import.meta.env.VITE_GEMINI_PROXY_URL || '').trim();
const API_BASE = import.meta.env.DEV ? 'http://localhost:3001' : '';
const EMULATOR_PROJECT_ID = import.meta.env.VITE_EMULATOR_PROJECT_ID || 'demo-ediagil';

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

  const url = import.meta.env.VITE_EMULATORS === '1'
    ? `http://127.0.0.1:5001/${EMULATOR_PROJECT_ID}/us-central1/geminiproxy`
    : import.meta.env.DEV
      ? `${API_BASE}/api/gemini`
      : CONFIGURED_GEMINI_PROXY_URL || '/api/gemini';

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

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, contents, config }),
    });
  } catch (error) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const detail = error instanceof Error ? error.message : String(error || '');
    console.error('No se pudo conectar con geminiproxy:', { url, detail, offline });
    throw new Error(
      offline
        ? 'No tienes conexión a internet. El contenido permanece guardado y puedes reintentar al recuperar la conexión.'
        : 'No fue posible conectar con Magia IA. El contenido permanece guardado y puedes reintentar.',
    );
  }

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
