import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth, db } from '../lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { clearAppStorage } from '../lib/storageKeys';
// Modo Demo (VITE_DEMO_MODE=true): el usuario se simula, sin Auth/Firestore reales.
import { IS_DEMO_MODE, getDemoUser } from '../lib/demoAdminData';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signUp: async () => {},
  signIn: async () => {},
  signInWithGoogle: async () => {},
  logOut: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    clearAppStorage();

    // Modo Demo: no tocar Auth/Firestore; entrar como usuario demo admin.
    if (IS_DEMO_MODE) {
      setUser(getDemoUser());
      setLoading(false);
      return;
    }

    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      if (currentUser) {
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              plan: 'free',
              email: currentUser.email,
              displayName: currentUser.displayName || currentUser.email?.split('@')[0] || 'Usuario',
              photoURL: currentUser.photoURL || null,
              createdAt: Date.now(),
              aiCallsThisMonth: 0,
              aiCallsResetAt: Date.now(),
              lastLoginAt: Date.now(),
            });
          } else {
            // Registrar la última actividad del usuario (lo usa el panel admin
            // para mostrar "última actividad"). No toca plan/role/institution.
            await setDoc(userRef, { lastLoginAt: Date.now() }, { merge: true });
          }
        } catch (error) {
          console.warn("Could not handle user record in Firestore:", error);
        }
      }
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const signUp = async (email: string, password: string) => {
    await createUserWithEmailAndPassword(auth, email, password);
  };

  const signIn = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const logOut = async () => {
    try {
      await signOut(auth);
    } catch (e) {
      // Ignore
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, signUp, signIn, signInWithGoogle, logOut }}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
