import { useState, useEffect } from 'react';
import { showToast } from './useToast';

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true);
      showToast('success', 'Conexión restaurada — los datos están sincronizados.');
    };

    const goOffline = () => {
      setIsOnline(false);
      showToast('warning', 'Sin conexión — los cambios se guardarán localmente.');
    };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return isOnline;
}
