/**
 * Centralized localStorage key management with app namespace
 * This prevents conflicts between landing page and app
 */

const APP_PREFIX = 'ediagil_app_';

export const STORAGE_KEYS = {
  ACTIVE_SUBSCRIPTION: `${APP_PREFIX}active_subscription`,
  GRADING_WEIGHTS: `${APP_PREFIX}grading_weights`,
  USE_CHECKPOINT: `${APP_PREFIX}use_checkpoint`,
  GRADING_SCALE: `${APP_PREFIX}grading_scale`,
} as const;

/**
 * Get value from localStorage with prefix
 */
export function getStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch (error) {
    console.warn('localStorage access error:', error);
    return null;
  }
}

/**
 * Set value in localStorage with prefix
 */
export function setStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch (error) {
    console.warn('localStorage write error:', error);
  }
}

/**
 * Remove value from localStorage with prefix
 */
export function removeStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch (error) {
    console.warn('localStorage remove error:', error);
  }
}

/**
 * Clear all app-specific storage
 */
export function clearAppStorage(): void {
  try {
    Object.values(STORAGE_KEYS).forEach(key => {
      localStorage.removeItem(key);
    });
  } catch (error) {
    console.warn('localStorage clear error:', error);
  }
}
