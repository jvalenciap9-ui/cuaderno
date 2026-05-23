"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.geminiProxy = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const genai_1 = require("@google/genai");
const cors_1 = __importDefault(require("cors"));
admin.initializeApp();
const corsHandler = (0, cors_1.default)({ origin: true });
const db = admin.firestore();
// OBTENER LA CLAVE DEL SECRET MANAGER:
// La clave debe configurarse en Firebase con:
// firebase functions:secrets:set GEMINI_API_KEY
exports.geminiProxy = functions
    .runWith({
    secrets: ['GEMINI_API_KEY'], // <-- Inyecta el secreto desde Google Cloud Secret Manager
    enforceAppCheck: true // <-- PROTECCIÓN EXTREMA: Bloquea POSTMAN, CURL o bots
})
    .https.onRequest((req, res) => {
    corsHandler(req, res, async () => {
        try {
            // 1. VALIDACIONES DE SEGURIDAD EXTREMA
            if (req.method !== 'POST') {
                res.status(405).json({ error: 'Method Not Allowed' });
                return;
            }
            // 2. VERIFICACIÓN DE AUTENTICACIÓN (El usuario DEBE estar logueado en la app real)
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                res.status(401).json({ error: 'No autorizado. Falta el token Bearer.' });
                return;
            }
            const idToken = authHeader.split('Bearer ')[1];
            let decodedToken;
            try {
                decodedToken = await admin.auth().verifyIdToken(idToken);
            }
            catch (authErr) {
                res.status(403).json({ error: 'Token de sesión inválido o expirado.' });
                return;
            }
            const uid = decodedToken.uid;
            const { contents, model = 'gemini-2.5-flash', config = {} } = req.body;
            if (!contents) {
                res.status(400).json({ error: 'El campo "contents" es requerido.' });
                return;
            }
            // 3. VERIFICAR CUOTA DEL USUARIO EN FIRESTORE ANTES DE EJECUTAR
            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) {
                res.status(404).json({ error: 'Perfil de usuario no encontrado.' });
                return;
            }
            const userData = userDoc.data();
            const plan = (userData === null || userData === void 0 ? void 0 : userData.plan) || 'free';
            const aiCalls = (userData === null || userData === void 0 ? void 0 : userData.aiCallsThisMonth) || 0;
            // Límite extremo estricto de prueba: Usuarios Free solo tienen 50 llamadas.
            if (plan === 'free' && aiCalls >= 50) {
                res.status(403).json({
                    error: 'Has agotado tus consultas gratuitas de IA este mes. Actualiza al Plan Pro.'
                });
                return;
            }
            // 4. LLAMAR A GEMINI DE FORMA SEGURA EN EL BACKEND
            const ai = new genai_1.GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await ai.models.generateContent({
                model,
                contents,
                config,
            });
            // 5. INCREMENTAR LA CUOTA EN FIRESTORE TRAS ÉXITO
            await db.collection('users').doc(uid).update({
                aiCallsThisMonth: admin.firestore.FieldValue.increment(1)
            });
            // Enviar respuesta al cliente
            res.status(200).json({ text: response.text });
        }
        catch (error) {
            console.error('🔥 Error Crítico en Cloud Function:', error);
            res.status(500).json({
                error: 'Fallo interno en el Proxy de IA',
                details: error.message
            });
        }
    });
});
//# sourceMappingURL=index.js.map