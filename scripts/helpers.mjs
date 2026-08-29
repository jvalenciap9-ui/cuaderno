/**
 * helpers.mjs — Utilidades para interactuar con los emuladores:
 * signup de usuarios (Auth REST), llamadas a Cloud Functions y HMAC de webhook.
 */
import { createHmac } from 'node:crypto';

export const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-ediagil';
export const AUTH_EMULATOR = 'http://127.0.0.1:9099';
export const FUNCTIONS_EMULATOR = `http://127.0.0.1:5001/${PROJECT_ID}/us-central1`;
export const WEBHOOK_SECRET = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET || 'emulator-webhook-secret';
export const PRO_VARIANT_ID = '1158973';
export const SCHOOL_VARIANT_ID = '900001';

export async function signUp(email, password = 'test123456') {
  let res = await fetch(
    `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=emulator`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  let data = await res.json();
  if (res.status === 400 && data?.error?.message === 'EMAIL_EXISTS') {
    res = await fetch(
      `${AUTH_EMULATOR}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      },
    );
    data = await res.json();
  }
  if (!res.ok) throw new Error(`signUp ${email}: ${JSON.stringify(data)}`);
  return { uid: data.localId, idToken: data.idToken, email: data.email };
}

/** Llamada a una Cloud Function onCall v2 del emulador. */
export async function callFunction(name, data = {}, idToken) {
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

/** Llamada a una Cloud Function onRequest v2 del emulador (checkout/portal). */
export async function postFunction(name, bodyObj, { idToken, signature, rawBody } = {}) {
  const payload = rawBody ?? JSON.stringify(bodyObj);
  const res = await fetch(`${FUNCTIONS_EMULATOR}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      ...(signature ? { 'x-signature': signature } : {}),
    },
    body: payload,
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

export function computeSignature(rawBody, secret = WEBHOOK_SECRET) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function lsEvent(eventName, data, custom = {}) {
  return {
    meta: { event_name: eventName, custom_data: custom },
    data: {
      id: data.id,
      type: 'subscriptions',
      attributes: {
        checkout_data: { custom: { user_id: custom.user_id, ...(custom.institutionName ? { institutionName: custom.institutionName } : {}) } },
        renews_at: data.renews_at || '2027-01-01T00:00:00.000Z',
        ends_at: data.ends_at,
        status: data.status,
        urls: { customer_portal: 'https://portal.test.local/cp' },
      },
      relationships: { variant: { data: { type: 'variants', id: data.variantId } } },
    },
  };
}
