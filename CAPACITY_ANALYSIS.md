# 📊 Análisis de Capacidad: Usuarios Concurrentes en EdiAgil

## Resumen Ejecutivo
**Usuarios concurrentes recomendados:** `100-500 usuarios simultáneos`
**Máximo teórico:** `1,000-10,000+ dependiendo de la carga`

---

## 🏗️ Arquitectura Actual

```
┌─────────────────────┐
│  FRONTEND (Vite)    │  ← React + Firebase SDK
│  http://localhost:3000  (Browser)
└──────────┬──────────┘
           │ (REST + WebSocket)
┌──────────▼──────────┐
│  EXPRESS SERVER     │  ← Proxy Gemini AI
│  http://localhost:3001
└──────────┬──────────┘
           │ (HTTP)
┌──────────▼──────────┐
│  FIREBASE          │  ← Firestore + Auth + Storage
│  (Cloud)           │  ← Google-managed infrastructure
└────────────────────┘
```

---

## 1️⃣ Límites de FIREBASE FIRESTORE

### 📉 Límites de Lectura/Escritura
| Métrica | Límite | Notas |
|---------|--------|-------|
| **Escrituras/segundo** | 500 ops/sec por colección | Con indexing correcto |
| **Lecturas/segundo** | Ilimitadas | Pero costo aumenta |
| **Conexiones simultáneas** | 1 millón+ | Firebase maneja esto |
| **Tamaño documento** | 1 MB máx | Archivos grandes → Storage |
| **Transacciones** | 500 por segundo | Por DB |

### 💰 Coste por operación (Spark Plan)
- Lectura: **$0.06 por 100K lecturas**
- Escritura: **$0.18 por 100K escrituras**

### 📋 Consultas por usuario
Analizando el código, cada usuario típicamente hace:
- **Initial load:** 5-10 queries (subjects, students, grades, evaluations, modules)
- **Por interacción:** 1-3 queries/minuto en promedio
- **Peak (calificando):** 10-20 queries/minuto

---

## 2️⃣ Límites del SERVIDOR EXPRESS (Proxy IA)

### 🖥️ Capacidad por Instancia
```
Config Actual:
- Node.js single process (no clustering)
- Express + JSON parsing (20MB limit)
- Gemini API proxy

Estimado:
- 100-200 req/segundo en 1 máquina (t2.medium AWS)
- 1000+ req/segundo con clustering
```

### ⚙️ Request al Servidor IA
- **Endpoint:** `POST /api/gemini` (extracción de notas)
- **Payload:** 5-20 MB (imágenes en base64)
- **Timeout:** Gemini tarda 2-10 segundos/request
- **Frecuencia:** Solo cuando usuario usa "IA Mágica" (no es crítico)

---

## 3️⃣ Límites de GEMINI API

### 🤖 Cuota de Google
| Plan | Límite | Coste |
|------|--------|-------|
| **Free (Spark)** | 60 req/minuto | Gratis |
| **Pay-as-you-go** | 30 req/segundo | $0.075 por 1M tokens |

**Conclusion:** La función IA es el cuello de botella para uso masivo.

---

## 4️⃣ Análisis por Escenarios

### 🟢 Escenario 1: Clase Pequeña (30-100 estudiantes)
**Usuarios concurrentes:** `5-10 profesores`
**Carga mensual:** ~1,000 operaciones Firestore
**Coste:** ~$0.18/mes (Spark)
**Servidor:** Ni necesita

### 🟡 Escenario 2: Institución Mediana (500-2,000 estudiantes)
**Usuarios concurrentes:** `50-100 profesores`
**Operaciones/minuto:** ~500-1,000
**Coste:** ~$10-50/mes
**Servidor:** 1x t2.small (4GB RAM, 1 vCPU)
**Gemini:** Free tier o Pay-as-you-go

### 🔴 Escenario 3: Empresa/Universidad Grande (10K+ estudiantes)
**Usuarios concurrentes:** `500-1,000+ profesores`
**Operaciones/minuto:** ~5,000-20,000
**Coste Firestore:** ~$100-500/mes
**Servidor IA:** 3-5x t2.medium con load balancer
**Gemini:** Pay-as-you-go (~$50-200/mes según uso)

---

## 5️⃣ Cuellos de Botella Identificados

### 🔴 **Críticos:**
1. **Gemini API** (solo 60 req/min gratis)
   - Solución: Implementar cola de procesos + rate limiting
   
2. **Firestore limite de escritura** (500 ops/sec)
   - Solución: Batch writes, agregar datos antes de escribir

3. **Servidor Express single-process**
   - Solución: Usar clustering (Node cluster module)

### 🟡 **Importantes:**
1. **localStorage compartido** (recientemente reparado ✅)
   - Ya solucionado con prefijos `ediagil_app_`

2. **Falta caché en frontend**
   - Solución: Implementar service workers / IndexedDB

3. **Queries sin índices optimizadas**
   - Solución: Revisar Firestore indexes

---

## 6️⃣ Recomendaciones de Escalabilidad

### 🔧 Mejoras Inmediatas (Bajo Esfuerzo)
1. **Implementar rate limiting en Gemini**
   ```typescript
   // Limitar a 1 request por usuario/minuto
   const queueGeminiRequest = (userId, payload) => {
     if (userQueue[userId] && Date.now() - userQueue[userId] < 60000) {
       return "Espera un minuto antes de otro análisis";
     }
   }
   ```

2. **Batch writes en calificaciones**
   ```typescript
   // En lugar de 30 escrituras, hacer 1 batch
   const batch = writeBatch(db);
   grades.forEach(g => batch.set(doc(...), g));
   await batch.commit(); // 1 op en lugar de 30
   ```

3. **Caché local con IndexedDB**
   ```typescript
   // Ya usas Dexie! Aprovechar más:
   - Cachear resultados de queries
   - Sincronizar en background
   ```

### 📈 Mejoras de Escalabilidad (Mediano Plazo)
1. **Clustering del servidor Node.js**
   ```bash
   npm install pm2
   pm2 start server/index.ts -i max  # 1 proceso por CPU core
   ```

2. **Redis para sesiones + caché**
   ```typescript
   // Session store: Express → Redis
   // Cache: Gemini responses → Redis
   ```

3. **Cloud Functions en lugar de servidor dedicado**
   - Firebase Cloud Functions para proxy IA
   - Auto-scaling automático
   - Pago por uso

4. **Índices de Firestore optimizados**
   ```firestore
   // Agregar índices para queries frecuentes:
   - (userId, subjectId, createdAt)
   - (userId, type, date)
   ```

### 🚀 Escalabilidad Masiva (Largo Plazo)
1. **Migrar a arquitectura serverless**
   - Cloud Run + Cloud Functions
   - Auto-scaling a 0-10,000 instancias

2. **CDN + Caching**
   - Cloudflare/AWS CloudFront para static assets
   - API caching inteligente

3. **Database replication**
   - Firestore multi-region
   - Read replicas

4. **Microservicios**
   - Servicio IA separado
   - Servicio de reportes
   - Servicio de exportación

---

## 7️⃣ Métricas para Monitorear

```typescript
// Agregar monitoreo a Analytics
- Users concurrentes (real-time)
- Requests/segundo a Firestore
- Latencia promedio de queries
- Errores 429 (rate limit) de Gemini
- Tiempo de respuesta del servidor IA
```

---

## 📋 Tabla Resumen

| Métrica | 100 Usuarios | 500 Usuarios | 5,000 Usuarios |
|---------|-------------|-------------|----------------|
| Ops Firestore/min | 100-200 | 500-1K | 5K-20K |
| Costo Firestore | <$1 | $5-10 | $50-100 |
| Servidor Necesario | Ninguno | t2.small | 3-5x t2.medium |
| Gemini Cost | Free | Free-$5 | $50-200 |
| Latencia (p95) | <1s | <2s | <3s |

---

## 🎯 Conclusión

**EdiAgil está bien diseñada** para:
- ✅ Instituciones educativas medianas (hasta 500 profesores concurrentes)
- ✅ Bajo costo (Firebase Spark = gratis/muy barato)
- ✅ Buena UX (real-time con Firestore)

**Necesita mejoras para:**
- ⚠️ Más de 1,000 usuarios concurrentes
- ⚠️ Alto uso de función IA
- ⚠️ Datos masivos (1M+ documentos)

**Recomendación:** Implementar mejoras inmediatas (batch writes, rate limiting) ahora. Escalar arquitectura cuando llegues a 500+ usuarios.
