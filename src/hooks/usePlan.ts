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

export type PlanType = 'free' | 'pro' | 'school';

export interface UserProfile {
  plan: PlanType;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  createdAt: unknown;
  aiCallsThisMonth: number;
  aiCallsResetAt: number;
}

export const PLAN_LIMITS: Record<PlanType, { maxSubjects: number; aiCallsPerMonth: number; label: string }> = {
  free:   { maxSubjects: 3,   aiCallsPerMonth: 15,   label: 'Gratis'        },
  pro:    { maxSubjects: 999, aiCallsPerMonth: 500,  label: 'Pro'           },
  school: { maxSubjects: 999, aiCallsPerMonth: 9999, label: 'Institucional' },
};

export function usePlan() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

  const plan = profile?.plan || 'free';
  const limits = PLAN_LIMITS[plan];

  const canUseAI = () => {
    if (!profile) return false;
    // Verificar si hay que resetear el contador mensual
    const now = Date.now();
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
  };
}
