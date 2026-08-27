/**
 * e2e/firestoreRest.ts — Cliente REST de Firebase (Auth + Firestore) para las
 * pruebas de seguridad de la Fase 6 y para verificación/limpieza de datos.
 *
 * Usa las APIs REST públicas de Google: Identity Platform (Auth) y Firestore.
 * NO requiere SDK de Firebase en Node.
 */

import { API_KEY, PROJECT_ID } from './data';

const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`;
export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

export interface AuthSession {
  idToken: string;
  uid: string;
  email: string;
}

export async function signInAs(email: string, password: string): Promise<AuthSession> {
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const json = (await res.json()) as Record<string, string>;
  if (!res.ok || !json.idToken) {
    throw new Error(`signInAs(${email}) falló (${res.status}): ${JSON.stringify(json)}`);
  }
  return { idToken: json.idToken, uid: json.localId, email: json.email };
}

/* ── utilidades de mapeo Firestore REST ↔ objeto JS ───────────────────────── */

export function toFields(obj: Record<string, unknown>): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') fields[k] = { stringValue: v };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else if (typeof v === 'number') fields[k] = { doubleValue: v };
    else if (v === null) fields[k] = { nullValue: null };
    else if (typeof v === 'object') fields[k] = v as Record<string, unknown>;
  }
  return { fields };
}

export function fromDoc(doc: any): Record<string, unknown> | null {
  if (!doc || !doc.fields) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(doc.fields) as [string, any][]) {
    if ('stringValue' in v) out[k] = v.stringValue;
    else if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('timestampValue' in v) out[k] = v.timestampValue;
    else if ('mapValue' in v) out[k] = fromDoc({ fields: v.mapValue?.fields });
    else out[k] = v;
  }
  return { id: String(doc.name).split('/').pop(), ...out };
}

export interface RestResult {
  status: number;
  ok: boolean;
  json: any;
}

export async function restOp(token: string, method: string, url: string, body?: unknown): Promise<RestResult> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, ok: res.ok, json };
}

/* ── Auth: identidad del token ─────────────────────────────────────────────── */

export async function restMe(token: string): Promise<{ uid: string; email: string }> {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  const json = await res.json();
  return { uid: json.users?.[0]?.localId, email: json.users?.[0]?.email };
}

/* ── Lecturas ──────────────────────────────────────────────────────────────── */

export async function restGetDoc(token: string, docPath: string): Promise<RestResult> {
  return restOp(token, 'GET', `${FIRESTORE_BASE}/${docPath}`);
}

export async function restListOwned(token: string, collection: string): Promise<RestResult> {
  const me = await restMe(token);
  const url = `${FIRESTORE_BASE}:runQuery`;
  const body = {
    structuredQuery: {
      collectionId: collection,
      where: {
        fieldFilter: {
          field: { fieldPath: 'userId' },
          op: 'EQUAL',
          value: { stringValue: me.uid },
        },
      },
      limit: 1000,
    },
  };
  return restOp(token, 'POST', url, body);
}

/** Devuelve los documentos de una colección del usuario en forma de objetos JS. */
export async function restListOwnedDocs(token: string, collection: string): Promise<any[]> {
  const r = await restListOwned(token, collection);
  const arr = Array.isArray(r.json) ? r.json : [];
  return arr
    .filter((q: any) => q?.document)
    .map((q: any) => fromDoc(q.document));
}

/* ── Escrituras (para verificar reglas y limpiar) ──────────────────────────── */

export async function restCreateDoc(
  token: string,
  collection: string,
  data: Record<string, unknown>,
  docId?: string,
): Promise<RestResult> {
  const suffix = docId ? `/${encodeURIComponent(docId)}` : '';
  const url = `${FIRESTORE_BASE}/${collection}${suffix}`;
  return restOp(token, docId ? 'POST' : 'POST', url, toFields(data));
}

export async function restPatchDoc(
  token: string,
  docPath: string,
  data: Record<string, unknown>,
): Promise<RestResult> {
  // updateMask solo con el campo raíz 'data' no es válido en la API: usamos
  // un PATCH que envía TODO el doc como fields (las reglas comparan el
  // request.resource.data completo con el existente).
  const url = `${FIRESTORE_BASE}/${docPath}`;
  return restOp(token, 'PATCH', url, toFields(data));
}

export async function restDeleteDoc(token: string, docPath: string): Promise<RestResult> {
  return restOp(token, 'DELETE', `${FIRESTORE_BASE}/${docPath}`);
}

export async function restCommitDeletes(token: string, docPaths: string[]): Promise<RestResult> {
  const writes = docPaths.map((p) => ({ delete: `${FIRESTORE_BASE}/${p}` }));
  return restOp(token, 'POST', `${FIRESTORE_BASE}:commit`, { writes });
}

/**
 * Batch write vía REST. `entries`: [{ path, data }] (usa semántica `update`
 * de Firestore: crea el doc si no existe y reemplaza todo su contenido).
 */
export async function restCommit(
  token: string,
  entries: Array<{ path: string; data: Record<string, unknown> }>,
): Promise<RestResult> {
  const writes = entries.map((e) => ({
    update: { name: `${FIRESTORE_BASE}/${e.path}`, fields: toFields(e.data).fields },
  }));
  return restOp(token, 'POST', `${FIRESTORE_BASE}:commit`, { writes });
}

/* ── limpieza idempotente por fase ─────────────────────────────────────────── */

const CLEAN_COLLECTIONS = [
  'subjects',
  'notes',
  'students',
  'evaluations',
  'grades',
  'attendance',
  'calendarEvents',
  'materials',
  'subjectModules',
];

/**
 * Elimina todos los datos planos del usuario. NO toca userCounters (los
 * contadores solo evolucionan por batch con la app; en plan school el tope
 * 999 nunca bloquea la fase).
 */
export async function resetTeacherData(token: string): Promise<void> {
  for (const coll of CLEAN_COLLECTIONS) {
    const docs = await restListOwnedDocs(token, coll);
    const names = docs.map((d: any) => d.name);
    if (names.length) await restCommitDeletes(token, names);
  }
  const me = await restMe(token);
  await restDeleteDoc(token, `userSettings/${me.uid}`).catch(() => undefined);
}

export function isDenied(res: RestResult): boolean {
  return !res.ok && (res.status === 403 || res.status === 400);
}
