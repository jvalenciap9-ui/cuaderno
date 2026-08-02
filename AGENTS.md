# EdiAgil — Agente Instructions

## Architecture

React 19 SPA (Vite + TypeScript + Tailwind CSS 4) with offline-first Dexie (IndexedDB), Firebase Auth + Firestore for sync, Gemini AI via Cloud Function proxy, and Stripe payments.

- **Entry**: `src/main.tsx` → `src/App.tsx` (988 loc, tabs: modules/students/attendance/grades)
- **Local DB**: `src/lib/db.ts` — tables: subjects, notes, students, evaluations, grades, attendance, calendarEvents, materials, subjectModules, extractedEvents, uploadedDocs
- **Firebase**: `src/lib/firebase.ts` reads config from `firebase-applet-config.json` (gitignored). Firestore collections mirror Dexie tables.
- **AI**: `src/lib/geminiClient.ts` calls proxy; `src/lib/gemini.ts` re-exports it. **API Key NEVER in frontend** — only in server env vars or Cloud Function secrets.
- **Cloud Functions**: `functions/index.js` (geminiproxy, health, createCheckoutSession, stripeWebhook, setupStripeProducts)
- **Local proxy**: `server/index.ts` (Express, port 3001, for dev only)
- **Root `@` alias**: `@/` maps to project root (not `src/`), e.g. `@/src/App.tsx`

## Commands

| Command | What |
|---------|------|
| `npm run dev` | Vite on `:3000` |
| `npm run server` | Express proxy on `:3001` (needed for AI in dev) |
| `npm run dev:full` | Both concurrently |
| `npm run build` | `vite build` → `dist/` |
| `npm run lint` | `tsc --noEmit` (the only lint/typecheck) |
| `npm run deploy:hosting` | build + `firebase deploy --only hosting` |
| `npm run deploy` | build + full firebase deploy |

## Workflow

1. Edit → `npm run build` (errors = tsc type issues)
2. Deploy: `npm run deploy:hosting`
3. Dev requires two shells (or `npm run dev:full`)
4. **No test framework** — no tests to run

## Firebase

- Project: `ediagil-new-2026` (`.firebaserc` default)
- Hosting: serves `dist/`, SPA fallback to `index.html`, cache assets 1y
- Functions: Node 22, GCFv2, secrets: `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Rewrites: `/api/gemini` → geminiproxy function, `/api/health` → health function

## Key conventions

- CSS: Tailwind 4 via `@tailwindcss/vite` plugin (no PostCSS config, no `@tailwind` directives)
- No ESLint, Prettier, or formatter — `tsc --noEmit` is the only check
- `AGENTS.md` at repo root; also see `.agents/ediagil-expert.md` for detailed troubleshooting guide
- `.env*` gitignored; copy `.env.example` to `.env.local` and fill `GEMINI_API_KEY`
- `firebase-applet-config.json`, `gemini_key.txt` — sensitive, never commit
