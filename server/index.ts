/**
 * Servidor Express — Proxy seguro para Gemini AI
 * La API Key NUNCA sale al frontend. Solo este servidor la usa.
 */

import express, { Request, Response, NextFunction } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Cargar variables de entorno desde .env.local o .env
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const app = express();
app.use(express.json({ limit: '20mb' })); // Soportar payloads grandes (imágenes en base64)

// ── RATE LIMITING: Evitar abuse de Gemini API ────────────────────────────────
interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minuto
const RATE_LIMIT_MAX = 5; // 5 requests por minuto por usuario

const getRateLimitKey = (req: Request): string => {
  // Usar IP + User-Agent como key (simple pero efectivo)
  return `${req.ip}:${req.get('user-agent') || 'unknown'}`;
};

const checkRateLimit = (req: Request, res: Response, next: NextFunction) => {
  const key = getRateLimitKey(req);
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (entry && now < entry.resetTime) {
    // Ventana activa
    if (entry.count >= RATE_LIMIT_MAX) {
      const remainingTime = Math.ceil((entry.resetTime - now) / 1000);
      return res.status(429).json({
        error: 'Demasiadas solicitudes de IA',
        message: `Espera ${remainingTime}s antes de otro análisis`,
        retryAfter: remainingTime
      });
    }
    entry.count++;
  } else {
    // Nueva ventana
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + RATE_LIMIT_WINDOW
    });
  }

  // Limpiar entries expiradas cada minuto
  if (Math.random() < 0.1) {
    for (const [k, v] of rateLimitMap.entries()) {
      if (now >= v.resetTime) {
        rateLimitMap.delete(k);
      }
    }
  }

  next();
};

// ── CORS: solo permitir el frontend local (Vite :3000) ──────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const allowed = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    process.env.APP_URL,
  ].filter(Boolean);
  const origin = req.headers.origin || '';
  if (allowed.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ── Validar que la API Key existe ────────────────────────────────────────────
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
if (!GEMINI_API_KEY) {
  console.error('❌ ERROR: GEMINI_API_KEY no está configurada en .env.local');
  console.error('   Crea el archivo .env.local con: GEMINI_API_KEY=tu_key_aqui');
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    hasKey: !!GEMINI_API_KEY,
    timestamp: new Date().toISOString()
  });
});

// ── Endpoint principal: Proxy para Gemini (con rate limiting) ─────────────────
app.post('/api/gemini', checkRateLimit, async (req: Request, res: Response) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(503).json({ 
        error: 'Servidor no configurado. Falta GEMINI_API_KEY en .env.local' 
      });
    }

    const { contents, model = 'gemini-2.5-flash', config = {} } = req.body;

    if (!contents) {
      return res.status(400).json({ error: 'El campo "contents" es requerido.' });
    }

    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model,
      contents,
      config,
    });

    return res.json({ text: response.text });
  } catch (err: any) {
    console.error('❌ Error en /api/gemini:', err?.message || err);
    const status = err?.status || 500;
    return res.status(status).json({ 
      error: err?.message || 'Error al llamar a Gemini',
      code: err?.code || 'UNKNOWN'
    });
  }
});

// ── Iniciar servidor ─────────────────────────────────────────────────────────
const PORT = parseInt(process.env.API_PORT || '3001', 10);
app.listen(PORT, () => {
  console.log(`✅ Servidor proxy Gemini corriendo en http://localhost:${PORT}`);
  console.log(`   API Key: ${GEMINI_API_KEY ? '✓ Configurada' : '✗ FALTANTE'}`);
  console.log(`   Rate Limit: ${RATE_LIMIT_MAX} requests/${RATE_LIMIT_WINDOW / 1000}s por usuario`);
  console.log(`   Endpoints: GET /api/health | POST /api/gemini`);
});

export default app;
