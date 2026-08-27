# LA AGENDA — Plan Maestro de Producción Audiovisual (NOVA)

> **Concepto**: "Del 85% de tu tiempo en burocracia, al 20% de impacto real"
> **Eslogan**: "Menos Burocracia, Más Impacto"
> **KPI**: conversión de docentes → descargas/pagos de EdiAgil
> **Host demo**: https://ediagil-new-2026.web.app (cuenta demo: `demo@ediagil.com` / `Demo1234!`)

---

## 1. Las 4 tomas

| Toma | Qué grabar | Bruto | Duración en corte |
|---|---|---|---|
| T1 · SÍNTOMA | Planilla en Excel + reloj corriendo + caos de papeles (b-roll de escritorio, no es la app) | 30-40s | 4s |
| T2 · ONBOARDING | Post-login con `demo@ediagil.com` → wizard: nombre, eslogan, directora, logo | 60-90s | 6s |
| T3 · PANEL ADMIN | Docentes activos → **Invitar** → censo de alumnos → **Alertas de riesgo** | 90-120s | 10s |
| T4 · BOLETÍN | Boletín con logo + membrete → Exportar Excel (hoja "Institución") | 30-60s | 6s |

Grabar en 16:9; el 9:16 se hace con zoom/paneado en edición (nunca al revés).

---

## 2. Guion de voz — 30s núcleo (español neutro)

| Tiempo | Texto | Emoción |
|---|---|---|
| 0.0-3.0s | "El 85% de tu tiempo se va en burocracia." | Fría, impacto |
| 3.0-6.4s | "¿Seis planillas el domingo por la noche?" | Ironía |
| 6.5-9.2s | "EdiAgil lo hace por ti." | Confianza |
| 9.2-11.9s | "Syllabus con IA: cinco segundos." | Ritmo up |
| 11.9-14.9s | "Asistencia: dos clics. Calificación sin fricción." | Ritmo up |
| 15.0-18.5s | "Tu institución coordinada: boletín con tu marca, alertas de riesgo." | Orgullo institucional |
| 18.5-21.8s | "Todo en un solo lugar." | Cierre del bloque |
| 22.0-26.0s | "Menos burocracia, más impacto." (eslogan, más lento) | Sello |
| 26.0-29.5s | "Descarga gratis." | CTA directo |

### Script TTS (ElevenLabs)

```
El 85% de tu tiempo... se va en burocracia.
¿Seis planillas el domingo por la noche?
EdiAgil lo hace por ti.
Syllabus con IA: cinco segundos.
Asistencia: dos clics. Calificación sin fricción.
Tu institución coordinada: boletín con tu marca, alertas de riesgo.
Todo en un solo lugar.
Menos burocracia... más impacto.
Descarga gratis.
```

### Configuración de voz (validada)
- **Voz**: Lizy (vibrante, dinámica, persuasiva) · **Modelo**: Eleven Multilingual v2
- **Velocidad**: 1 · **Estabilidad**: 50% · **Similitud**: 75% · **Estilo**: 0% · **Speaker boost**: ON
- Reglas: generar **9 audios separados** (un bloque por generación, ~480 chars total); escuchar "EdiAgil" y "85%" (escribir "ochenta y cinco por ciento" si falla); exportar WAV o MP3 192kbps+; no acelerar >1.1x en edición; el eslogan (bloque 8) se genera 2 veces y se elige la toma más pausada y grave.

---

## 3. Subtítulos

### SRT (30s núcleo)

```srt
1
00:00:00,400 --> 00:00:02,900
El 85% de tu tiempo se va en burocracia.

2
00:00:03,000 --> 00:00:06,400
¿Seis planillas el domingo por la noche?

3
00:00:06,500 --> 00:00:09,200
EdiAgil lo hace por ti.

4
00:00:09,200 --> 00:00:11,900
Syllabus con IA: cinco segundos.

5
00:00:11,900 --> 00:00:14,900
Asistencia: dos clics. Calificación sin fricción.

6
00:00:15,000 --> 00:00:18,500
Tu institución coordinada: boletín con tu marca, alertas de riesgo.

7
00:00:18,500 --> 00:00:21,800
Todo en un solo lugar.

8
00:00:22,000 --> 00:00:26,000
Menos burocracia, más impacto.

9
00:00:26,000 --> 00:00:29,500
Descarga gratis → EdiAgil
```

### Estilo ASS (firma de marca)
- `Fontname: Montserrat Bold` (36-72pt en 1080×1920) · `PrimaryColour: &H0000FFC7` (amarillo #FFC107)
- Outline negro + `BackColour &H66000000` (box 40%) · `Alignment: 2` + `MarginV: 260` (safe zone central 1080×1440)
- Kinetic word-by-word en CapCut: palabra activa escala 110%, previas opacidad 60%

---

## 4. Música y mezcla

- **Uppbeat** (10 descargas gratis/mes): filtra energy baja + "no vocals", lo-fi/acústico
- **Pixabay Music**: sin cuenta, 230k pistas, descargar **certificado de licencia** (seguro anti-claims)
- **SFX**: whoosh (revelado de textos), reloj/papel (T1), clics UI suaves (T2-T4), "pop" en logo final
- **Mezcla**: voz −6 dB peak · música ducking a −28/−25 dB · SFX +6 dB sobre música · limiter −1 dB · sin silencios >0.5s

---

## 5. Edición — "LA AGENDA v2" (con fixes de @axel)

Proyecto CapCut: 1080×1920 · 30fps · H.264 → `LA_AGENDA_MASTER`
Colores: fondo #F0F7F4 · texto #1A3C40 · dolor #D32F2F · solución #2E7D32 · resalte #FFC107

| Beat | Toma | Corte | Efecto |
|---|---|---|---|
| 0-3s | T1 acelerada + hook | hard cut en el "85%" | zoom lento al reloj |
| 3-7s | T1 + overlay stats | corte en "¿domingo?" | shake 8px |
| 7-15s | T3 (invitar) → T2 (onboarding) | cortes 2s | **zoom al cursor en cada clic** |
| 15-22s | T4 (boletín) + T2 logo | corte en "coordinada" | paneo al membrete |
| 22-30s | Card final + logo | fade suave | pop del logo |

### Fixes v2 (obligatorios)
1. **Hook con movimiento**: contador "98%" → "85%" con keyframes (0.0s→2.2s, ease-out); "85%" entra con pop scale 1.4→1.0 (0.25s) en 2.2s
2. **Loop-trick**: card final = espejo visual del hook (mismo negro, misma tipografía); fade a negro 0.4s, card congelada 1.5s → bucle imperceptible (replay >1.1)
3. **Fricción en T1**: sello rojo golpeando, cursor errático, papel volando; acelerar 1.5-2x + shake de cámara; nada de zooms elegantes
4. **Save-trigger numerado** (7-15s): `【1】5s` · `【2】2 clics` · `【3】1 solo lugar` — número en caja amarilla #FFC107, slide-up 0.2s, mínimo 2s en pantalla
5. **Un solo CTA** en los últimos 3s (ya ok, no tocar)

- Transiciones: hard cuts 95%, dissolve 6 frames solo en beat 4→5. Whoosh 2 frames antes de cada revelado de texto.
- Hook del 0s: PNG full-screen (blanco sobre negro) con scale 1.3→1.0 (0.25s).

---

## 6. Export maestro y variantes (FFmpeg)

Maestro: 1080×1920 · 30fps · H.264 · 15 Mbps · MP4

```powershell
# TikTok/Reels (12 Mbps)
ffmpeg -i master.mp4 -c:v libx264 -crf 17 -maxrate 12M -bufsize 24M -c:a aac -b:a 192k tiktok_reels_30s.mp4

# Stories (15s: beats 1 + 5)
ffmpeg -i master.mp4 -ss 0 -t 3 -c copy a.mp4
ffmpeg -i master.mp4 -ss 22 -t 8 -c copy b.mp4

# Instagram Feed 4:5 (1080×1350)
ffmpeg -i master.mp4 -vf "crop=1080:1350:0:285,eq=sharpness=0.2" -c:v libx264 -crf 18 feed_45.mp4

# Facebook 1:1 60s (versión institucional)
ffmpeg -i master.mp4 -vf "crop=1080:1080:0:420,setpts=1.176*PTS,ass=version_institucional.ass" -c:v libx264 -crf 17 fb_60s.mp4

# LinkedIn 16:9 60s
ffmpeg -i master.mp4 -vf "crop=1920:1080:0:420,ass=linkedin_caps.ass" -c:v libx264 -crf 18 linkedin_60s.mp4
```

Ajustar offsets de crop según encuadre real. Previsualizar: `ffmpeg -ss 1 -i master.mp4 -frames:v 1 out.png`

### Checklist pre-publicación
- [ ] Vista previa en teléfono real · text legible · zona UI libre (150px inferiores)
- [ ] Sin texto <2s en pantalla · sin picos de audio · sin silencio >0.5s
- [ ] Subtítulos 100% · colores de marca · gancho funciona sin audio

---

## 7. Paquete multiplataforma (7 versiones)

| Versión | Formato | Duración | Fuente |
|---|---|---|---|
| TikTok | 9:16 · 1080×1920 · 15Mbps | 30s | maestro v2 (raw) |
| Reels | 9:16 · 12Mbps | 30s | mismo corte, text mitad superior |
| Shorts | 9:16 · 15-20Mbps | 30s | maestro (60fps opcional) |
| Stories | 9:16 | 15s | hook + card CTA "Desliza ↑" |
| Feed IG | 4:5 · 1080×1350 | 30s | crop centro + sharpen |
| Facebook | 1:1 · subtítulos quemados | 60s | núcleo 0.85x + intertítulos |
| LinkedIn | 1:1 / 16:9 | 60s | versión directora, sin cortes bruscos |

---

## 8. Copys por plataforma

**TikTok**
> ¿Cuántas horas perdiste la semana pasada en planillas? 🕐 No es tu culpa: el sistema está diseñado para robarte el tiempo. Hay una forma de recuperarlo. Descarga gratis y en 5 min recupera tu domingo. #Docentes #Edutok

**Reels**
> POV: ya no miras el reloj el domingo por la noche. El 85% del tiempo docente se va en burocracia. Lo cambiamos por impacto. Guarda esto para tu próxima planilla 📌 Descarga gratis — 14 días de prueba. #Docentes #PlanillasEscolares

**YouTube Shorts**
> 📌 GUARDA este video. 5 segundos: syllabus. 2 clics: asistencia. 1 lugar: tu cuaderno digital. Así recuperas 10 horas semanales. #Docentes #Edutok

**Stories**
> "¿Tu domingo o la planilla?" → Desliza ↑ para descargar + sticker encuesta

**Facebook**
> La burocracia nos come el domingo. Te muestro cómo una institución entera cambió eso: syllabus con IA, asistencia en 2 clics, boletines con la marca del colegio y alertas de riesgo. Comparte a esa colega que vive con Excel abierto. #Docentes #ComunidadEducativa

**LinkedIn**
> El 85% del tiempo administrativo docente no enseña a nadie. Con EdiAgil, la gestión escolar se reduce a minutos: syllabus con IA, asistencia en dos clics, alertas de riesgo tempranas y boletín con la identidad de tu institución. La tecnología no reemplaza al docente — le devuelve su tiempo. ¿Cuántas horas administrativas recuperarías en tu colegio? 👇

**CTA general**: "Descarga gratis — prueba de 14 días" · bio: link a https://ediagil-new-2026.web.app

---

## 9. Calendario 2 semanas (hora pico 20:00-21:00 local)

| Día | Publicación | A/B |
|---|---|---|
| S1 · Lun | TikTok — núcleo Hook A (85%) | Test A vs B |
| S1 · Mar | Reels — núcleo Hook A + Feed | |
| S1 · Mié | Stories teaser + Feed IG 4:5 | |
| S1 · Jue | YouTube Shorts (keyword SEO) | |
| S1 · Vie | Facebook — 60s institucional | |
| S1 · Dom | **TikTok Hook B** ("¿Cuántas horas pierdes...") 19:00 (noche de planillas) | Test A vs B |
| S2 · Lun | Lectura métricas vs kill-floors | mata al perdedor |
| S2 · Mié | Ganador → todas las plataformas | escala |
| S2 · Vie | LinkedIn — versión directora + Insights | |
| S2 · Dom | Hook C si B ganó ("Este video te devuelve 10 horas") | Test C |

Reglas: domingo = día de planillas (timing psicológico); nunca comparar métricas cross-platform; responder comentarios la primera hora.

---

## 10. Métricas y kill-floors

| Métrica | TikTok (2s) | Reels (3s) | Señal de muerte |
|---|---|---|---|
| Hook rate | <25% | <20% | el gancho no para el scroll |
| Hold 3s | <30% | <30% | el cuerpo no paga la promesa |
| Hold 15s | <12% | <10% | mitad del video sin interés |
| CTR ads | <0.84% mediana | <1.78% mediana | promesa/CTA débiles |

Targets: 15-30s → TikTok 50-60% avg (strong >70%) · Reels 45-55% (strong >65%) · Shorts 50-65% (strong >65%).
Proyección v2 tras fixes: 55-60% promedio.

### A/B hooks
- **A**: "El 85% de tu tiempo se va en burocracia." (autoridad)
- **B**: "¿Cuántas horas pierdes en planillas esta semana?" (curiosidad + saves)
- **C**: "Este video te devuelve 10 horas a la semana." (promesa directa)
- Regla: mismo cuerpo, solo cambia primer frame + primera frase; 500-1.000 impresiones y kill al perdedor.

---

*Pack completo: Fases 1-5 del workflow NOVA · Versión 1.0 · [fecha]: 2026-08-11*