/**
 * usePlan.ts — Lee el plan de suscripción desde Firestore (fuente de verdad segura)
 * 
 * El plan se almacena en /users/{uid}/plan en Firestore.
 * Solo el backend puede escribir este campo (regla en firestore.rules).
 * Los usuarios NO pueden cambiar su plan desde el navegador.
 */

import { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../components/AuthProvider';
// Modo Demo (VITE_DEMO_MODE=true): perfil admin mock, sin leer Firestore.
import { IS_DEMO_MODE, DEMO_PROFILE } from '../lib/demoAdminData';

export type PlanType = 'free' | 'pro' | 'school';

export type UserRole = 'teacher' | 'admin';

export interface UserProfile {
  plan: PlanType;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: unknown;
  aiCallsThisMonth: number;
  aiCallsResetAt: number;
  role?: UserRole;
  institutionId?: string;
  institutionName?: string;
  lastLoginAt?: number;
  paymentProvider?: string;
  paymentSessionId?: string;
  paymentAmount?: number;
  subscriptionId?: string;
  expiresAt?: number;
  updatedAt?: unknown;
  isTrial?: boolean;
  trialEndsAt?: number;
  trialUsed?: boolean;
}

export const PLAN_LIMITS: Record<PlanType, { maxSubjects: number; aiCallsPerMonth: number; label: string }> = {
  free:   { maxSubjects: 2,    aiCallsPerMonth: 15,   label: 'Gratis'        },
  pro:    { maxSubjects: 999,  aiCallsPerMonth: 2000, label: 'Premium Pro'   },
  school: { maxSubjects: 999,  aiCallsPerMonth: 9999, label: 'Institucional' },
};

export function usePlan() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (IS_DEMO_MODE) {
      setProfile(DEMO_PROFILE);
      setLoading(false);
      return;
    }

    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }

    const userRef = doc(db, 'users', user.uid);

    // Escucha en tiempo real el perfil del usuario
    const unsubscribe = onSnapshot(userRef, async (snap) => {
      if (!snap.exists()) {
        // Primer login: crear documento con plan free
        const newProfile: UserProfile = {
          plan: 'free',
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          createdAt: serverTimestamp(),
          aiCallsThisMonth: 0,
          aiCallsResetAt: Date.now(),
        };
        try {
          await setDoc(userRef, newProfile, { merge: true });
        } catch {
          // Si falla el write (ej. sin conexión), usar defaults
        }
        setProfile(newProfile);
      } else {
        setProfile(snap.data() as UserProfile);
      }
      setLoading(false);
    }, (error) => {
      console.error('Error leyendo perfil de usuario:', error.message);
      // Fallback seguro: plan free si no se puede leer Firestore
      setProfile({ 
        plan: 'free', 
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        createdAt: null,
        aiCallsThisMonth: 0,
        aiCallsResetAt: Date.now(),
      });
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // MEDIUM-6: espejo de HR-01 en el cliente — un trial expirado cuenta como
  // free a efectos de límites (el 'pro' prestado por la prueba no se mantiene),
  // salvo que el usuario haya pagado (paymentProvider != 'trial').
  const rawPlan = profile?.plan || 'free';
  const now = Date.now();
  const paidUser = !!profile?.paymentProvider && profile.paymentProvider !== 'trial';
  const trialExpired = profile?.isTrial === true
    && !paidUser
    && typeof profile.trialEndsAt === 'number'
    && profile.trialEndsAt <= now;
  // En entorno Staging (RC1), las cuentas autenticadas reciben entitlement Pro para pruebas QA
  const isStaging = import.meta.env.VITE_SHOW_RC1_BADGE === 'true' || import.meta.env.VITE_ENVIRONMENT === 'staging';
  const plan: PlanType = isStaging ? 'pro' : (trialExpired ? 'free' : rawPlan);
  const limits = PLAN_LIMITS[plan];
  const isAdmin = profile?.role === 'admin';

  const canUseAI = () => {
    if (!profile) return false;
    // Verificar si hay que resetear el contador mensual
    const resetAt = profile.aiCallsResetAt || 0;
    const oneMonth = 30 * 24 * 60 * 60 * 1000;
    if (now - resetAt > oneMonth) return true; // Se reseteará en el servidor
    return profile.aiCallsThisMonth < limits.aiCallsPerMonth;
  };

  const canCreateSubject = (currentCount: number) => {
    return currentCount < limits.maxSubjects;
  };

  return {
    plan,
    profile,
    loading,
    limits,
    canUseAI,
    canCreateSubject,
    isPro: plan === 'pro' || plan === 'school',
    isSchool: plan === 'school',
    isAdmin,
  };
}
