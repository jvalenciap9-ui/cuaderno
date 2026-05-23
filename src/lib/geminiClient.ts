/**
 * geminiClient.ts — Cliente seguro para el proxy backend
 * 
 * En lugar de llamar directamente a la API de Gemini (exponiendo la key),
 * todas las llamadas pasan por nuestro servidor Express en /api/gemini.
 * La API Key NUNCA llega al navegador.
 */

// URL del proxy backend (en dev: puerto 3001; en prod: mismo dominio)
const API_BASE = import.meta.env.DEV
  ? 'http://localhost:3001'
  : (import.meta.env.VITE_API_URL || '');

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

  const response = await fetch(`${API_BASE}/api/gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, contents, config }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: response.statusText }));
    const msg = errorData?.error || `Error HTTP ${response.status}`;
    throw new Error(msg);
  }

  const data = await response.json();
  return { text: data.text || '' };
}

/**
 * Verifica si el servidor proxy está disponible.
 */
export async function checkGeminiHealth(): Promise<{ ok: boolean; hasKey: boolean; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return { ok: false, hasKey: false, error: `HTTP ${res.status}` };
    const data = await res.json();
    return { ok: true, hasKey: data.hasKey };
  } catch (err: unknown) {
    return { ok: false, hasKey: false, error: err instanceof Error ? err.message : String(err) };
  }
}
