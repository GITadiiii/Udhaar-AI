import { Capacitor } from '@capacitor/core';

let analyticsInstance: any = null;

// Synchronous simple hash helper to anonymize merchant_id without exposing raw business names or UUIDs
function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}

/**
 * Initializes Firebase App and Analytics lazily.
 * Only runs in production builds if valid environment variables are present.
 */
export async function initAnalytics(): Promise<any> {
  if (analyticsInstance) return analyticsInstance;

  // Enforce production mode check
  if (import.meta.env.MODE !== 'production') {
    return null;
  }

  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
  if (!apiKey) {
    console.warn('[Analytics] Missing Firebase API Key environment variable. Analytics is disabled.');
    return null;
  }

  try {
    const { initializeApp, getApps } = await import('firebase/app');
    const { getAnalytics } = await import('firebase/analytics');

    const firebaseConfig = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
      measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
    };

    const apps = getApps();
    const app = apps.length === 0 ? initializeApp(firebaseConfig) : apps[0];
    analyticsInstance = getAnalytics(app);
    console.log('[Analytics] Firebase Analytics initialized successfully.');
    return analyticsInstance;
  } catch (err) {
    console.error('[Analytics] Failed to initialize Firebase Analytics:', err);
    return null;
  }
}

/**
 * Helper to get global session attributes for event tracking
 */
function getGlobalAttributes(): Record<string, any> {
  const rawMerchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
  const hashedMerchantId = hashString(rawMerchantId);
  const networkStatus = navigator.onLine ? 'online' : 'offline';
  const platform = Capacitor.getPlatform();

  return {
    merchant_id: hashedMerchantId,
    network_status: networkStatus,
    platform: platform
  };
}

/**
 * Tracks a custom business event.
 * In development mode, prints the event directly to console.
 * In production mode, publishes to Firebase Analytics.
 */
export async function trackEvent(eventName: string, eventParams: Record<string, any> = {}) {
  const globalParams = getGlobalAttributes();
  const mergedParams = {
    ...globalParams,
    ...eventParams
  };

  // Local development console logger
  if (import.meta.env.MODE !== 'production') {
    console.log(`%c[Analytics Event]%c ${eventName}`, 'color: #10B981; font-weight: bold;', 'color: inherit;', mergedParams);
    return;
  }

  try {
    const analytics = await initAnalytics();
    if (analytics) {
      const { logEvent } = await import('firebase/analytics');
      logEvent(analytics, eventName, mergedParams);
    }
  } catch (err) {
    // Fail silently in production to avoid disrupting merchant workflow
    console.warn(`[Analytics Fail] Failed to publish event ${eventName}:`, err);
  }
}

/**
 * Helper to hash IDs (such as customer IDs) before logging to preserve data privacy.
 */
export function hashId(id: string): string {
  if (!id) return '';
  return hashString(id);
}
