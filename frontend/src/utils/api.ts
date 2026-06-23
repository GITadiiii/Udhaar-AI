import { Customer, Transaction, Reminder, DailySummary, Ledger } from '../types';

// Resolve API URL dynamically using the environment variable VITE_API_URL
let rawApiUrl = import.meta.env.VITE_API_URL;

if (!rawApiUrl) {
  rawApiUrl = import.meta.env.DEV && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000/api'
    : 'https://udhaar-ai.onrender.com/api';
}

// Clean trailing slashes
rawApiUrl = rawApiUrl.replace(/\/+$/, '');

// Ensure /api suffix exists
if (!rawApiUrl.endsWith('/api')) {
  rawApiUrl = `${rawApiUrl}/api`;
}

export const API_BASE = rawApiUrl;
console.log('[UdhaarAI API] Active API Base URL:', API_BASE);

const getHeaders = (headers?: Record<string, string>) => {
  const merchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
  return {
    ...headers,
    'x-merchant-id': merchantId
  };
};

/**
 * Custom fetch wrapper with a timeout safeguard (default 40s to handle Render cold-starts)
 */
export async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit,
  timeoutMs: number = 40000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, {
      ...init,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error: any) {
    clearTimeout(id);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

export async function checkResponse(res: Response, defaultMessage: string) {
  if (!res.ok) {
    let errorMsg = defaultMessage;
    let errCode = undefined;
    try {
      const errorData = await res.json();
      errorMsg = errorData.error || defaultMessage;
      errCode = errorData.code;
    } catch (e) {
      // Ignore parse failure
    }
    const err = new Error(errorMsg) as any;
    err.status = res.status;
    err.code = errCode;
    throw err;
  }
}

// Memory cache registries for fast read and SWR operations
const customersCache: Record<string, Customer[]> = {};
const transactionsCache: Record<string, Transaction[]> = {};
const remindersCache: Record<string, Reminder[]> = {};
const ledgerCache: Record<string, Ledger> = {};
const summaryCache: Record<string, DailySummary> = {};

// Helper to resolve merchant-scoped localStorage key
const getMerchantCacheKey = (prefix: string, key: string) => {
  const merchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
  return `udhaar_cache_${merchantId}_${prefix}_${key}`;
};

function getCachedData<T>(prefix: string, key: string): T | null {
  try {
    const cacheKey = getMerchantCacheKey(prefix, key);
    const serialized = localStorage.getItem(cacheKey);
    if (!serialized) return null;
    return JSON.parse(serialized) as T;
  } catch (e) {
    console.error('[CACHE READ ERROR]', e);
    return null;
  }
}

function setCachedData<T>(prefix: string, key: string, data: T) {
  try {
    const cacheKey = getMerchantCacheKey(prefix, key);
    localStorage.setItem(cacheKey, JSON.stringify(data));
  } catch (e) {
    console.error('[CACHE WRITE ERROR]', e);
  }
}

function deleteCachedData(prefix: string, key: string) {
  try {
    const cacheKey = getMerchantCacheKey(prefix, key);
    localStorage.removeItem(cacheKey);
  } catch (e) {}
}

function clearAllCachedKeys() {
  try {
    const prefix = 'udhaar_cache_';
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}
}

// Cache invalidation helpers
export function clearAllCaches() {
  Object.keys(customersCache).forEach(k => delete customersCache[k]);
  Object.keys(transactionsCache).forEach(k => delete transactionsCache[k]);
  Object.keys(remindersCache).forEach(k => delete remindersCache[k]);
  Object.keys(ledgerCache).forEach(k => delete ledgerCache[k]);
  Object.keys(summaryCache).forEach(k => delete summaryCache[k]);
  
  clearAllCachedKeys();
  console.log('[API CACHE] All caches cleared.');
}

export function clearCacheForDate(date?: string) {
  if (date) {
    const formattedDate = date.slice(0, 10);
    delete customersCache[formattedDate];
    delete customersCache['all'];
    deleteCachedData('customers', formattedDate);
    deleteCachedData('customers', 'all');

    delete transactionsCache[formattedDate];
    delete transactionsCache['all'];
    deleteCachedData('transactions', formattedDate);
    deleteCachedData('transactions', 'all');

    delete remindersCache[formattedDate];
    delete remindersCache['all'];
    deleteCachedData('reminders', formattedDate);
    deleteCachedData('reminders', 'all');

    delete summaryCache[formattedDate];
    delete summaryCache['today'];
    deleteCachedData('summaries', formattedDate);
    deleteCachedData('summaries', 'today');

    console.log(`[API CACHE] Cache cleared for date: ${formattedDate}`);
  } else {
    clearAllCaches();
  }
}

export function clearLedgerCache(customerId: string) {
  delete ledgerCache[customerId];
  deleteCachedData('ledger', customerId);

  try {
    const merchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
    const prefix = `udhaar_cache_${merchantId}_ledger_${customerId}`;
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {}

  console.log(`[API CACHE] Ledger cache cleared for customer: ${customerId}`);
}

export async function fetchCustomers(date?: string, forceRefresh = false): Promise<Customer[]> {
  const cacheKey = date ? date.slice(0, 10) : 'all';
  if (customersCache[cacheKey] && !forceRefresh) {
    return Promise.resolve(customersCache[cacheKey]);
  }

  if (!forceRefresh) {
    const local = getCachedData<Customer[]>('customers', cacheKey);
    if (local) {
      customersCache[cacheKey] = local;
      return Promise.resolve(local);
    }
  }

  const url = date ? `${API_BASE}/customers?date=${date}` : `${API_BASE}/customers`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to fetch customers');
  const data = await res.json();
  customersCache[cacheKey] = data;
  setCachedData('customers', cacheKey, data);
  return data;
}

export async function fetchCustomer(id: string): Promise<Customer> {
  const url = `${API_BASE}/customers/${id}`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to fetch customer profile');
  return res.json();
}

export async function fetchTransactions(date?: string, forceRefresh = false): Promise<Transaction[]> {
  const cacheKey = date ? date.slice(0, 10) : 'all';
  if (transactionsCache[cacheKey] && !forceRefresh) {
    return Promise.resolve(transactionsCache[cacheKey]);
  }

  if (!forceRefresh) {
    const local = getCachedData<Transaction[]>('transactions', cacheKey);
    if (local) {
      transactionsCache[cacheKey] = local;
      return Promise.resolve(local);
    }
  }

  const url = date ? `${API_BASE}/transactions?date=${date}` : `${API_BASE}/transactions`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to fetch transactions');
  const data = await res.json();
  transactionsCache[cacheKey] = data;
  setCachedData('transactions', cacheKey, data);
  return data;
}

export async function createCustomer(name: string, phone: string, alias?: string, confirmNew?: boolean): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE}/customers`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, phone, alias, confirmNew })
  });
  await checkResponse(res, 'Failed to create customer');
  return res.json();
}

export async function deleteCustomer(id: string): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE}/customers/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to delete customer');
  return res.json();
}

export async function updateCustomer(
  id: string,
  updatedFields: {
    name: string;
    phone: string;
    alias?: string;
    address?: string;
    notes?: string;
    customerType?: string;
  }
): Promise<Customer> {
  const res = await fetchWithTimeout(`${API_BASE}/customers/${id}`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updatedFields)
  });
  await checkResponse(res, 'Failed to update customer');
  return res.json();
}

export async function fetchLedger(customerId: string, date?: string, forceRefresh = false): Promise<Ledger> {
  const cacheKey = `${customerId}_${date ? date.slice(0, 10) : 'all'}`;
  if (ledgerCache[cacheKey] && !forceRefresh) {
    return Promise.resolve(ledgerCache[cacheKey]);
  }

  if (!forceRefresh) {
    const local = getCachedData<Ledger>('ledger', cacheKey);
    if (local) {
      ledgerCache[cacheKey] = local;
      return Promise.resolve(local);
    }
  }

  const url = date ? `${API_BASE}/customers/${customerId}/ledger?date=${date}` : `${API_BASE}/customers/${customerId}/ledger`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to fetch customer ledger');
  const data = await res.json();
  ledgerCache[cacheKey] = data;
  setCachedData('ledger', cacheKey, data);
  return data;
}

export async function createTransaction(tx: {
  customerId: string;
  amount: number;
  type: 'credit' | 'collection';
  description?: string;
  date?: string;
  aliasSpoken?: string;
}): Promise<{ transaction: Transaction; newBalance: number }> {
  const res = await fetchWithTimeout(`${API_BASE}/transactions`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(tx)
  });
  await checkResponse(res, 'Failed to record transaction');
  return res.json();
}

export interface VoiceProcessResult {
  name: string;
  amount: number;
  type: 'credit' | 'collection' | 'unknown';
  matchedCustomer: Customer | null;
  status: 'success' | 'multiple_matches';
  candidates?: Customer[];
  isAiFallback?: boolean;
}

export async function processVoice(transcript: string): Promise<VoiceProcessResult> {
  const res = await fetchWithTimeout(`${API_BASE}/voice/process`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ transcript })
  });
  await checkResponse(res, 'Failed to process voice transcript');
  return res.json();
}

export async function fetchDailySummary(date?: string, forceRefresh = false): Promise<DailySummary> {
  const cacheKey = date ? date.slice(0, 10) : 'today';
  if (summaryCache[cacheKey] && !forceRefresh) {
    return Promise.resolve(summaryCache[cacheKey]);
  }

  if (!forceRefresh) {
    const local = getCachedData<DailySummary>('summaries', cacheKey);
    if (local) {
      summaryCache[cacheKey] = local;
      return Promise.resolve(local);
    }
  }

  const url = date ? `${API_BASE}/summary/daily?date=${date}` : `${API_BASE}/summary/daily`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to fetch daily summary');
  const data = await res.json();
  summaryCache[cacheKey] = data;
  setCachedData('summaries', cacheKey, data);
  return data;
}

export async function fetchReminders(date?: string, forceRefresh = false): Promise<Reminder[]> {
  const cacheKey = date ? date.slice(0, 10) : 'all';
  if (remindersCache[cacheKey] && !forceRefresh) {
    return Promise.resolve(remindersCache[cacheKey]);
  }

  if (!forceRefresh) {
    const local = getCachedData<Reminder[]>('reminders', cacheKey);
    if (local) {
      remindersCache[cacheKey] = local;
      return Promise.resolve(local);
    }
  }

  const url = date ? `${API_BASE}/reminders?date=${date}` : `${API_BASE}/reminders`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to fetch reminders');
  const data = await res.json();
  remindersCache[cacheKey] = data;
  setCachedData('reminders', cacheKey, data);
  return data;
}

export async function deleteTransaction(id: string): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE}/transactions/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  await checkResponse(res, 'Failed to delete transaction');
  return res.json();
}

export async function registerMerchant(merchant: {
  id: string;
  name: string;
  businessName: string;
  phone: string;
}): Promise<any> {
  const targetUrl = `${API_BASE}/users`;
  console.log('[REGISTRATION] Request started');
  console.log('[REGISTRATION] Endpoint URL:', targetUrl);
  console.log('[REGISTRATION] Request payload:', JSON.stringify(merchant));
  
  try {
    const res = await fetchWithTimeout(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(merchant)
    });
    
    console.log('[REGISTRATION] HTTP status code:', res.status);
    
    let responseData: any = null;
    try {
      responseData = await res.json();
      console.log('[REGISTRATION] Backend response:', responseData);
    } catch (parseErr) {
      console.warn('[REGISTRATION] Failed to parse backend response as JSON');
    }
    
    if (!res.ok) {
      const errMsg = responseData?.error || `HTTP error ${res.status}`;
      console.error('[REGISTRATION] Registration failed. Reason:', errMsg);
      throw new Error(errMsg);
    }
    
    console.log('[REGISTRATION] Registration successful');
    return responseData;
  } catch (netErr: any) {
    console.error('[REGISTRATION] Network or unexpected error:', netErr);
    if (netErr.message === 'Failed to fetch') {
      throw new Error(
        `Failed to fetch from backend at "${targetUrl}". This is usually a CORS preflight issue or the backend server is offline. Please verify VITE_API_URL in your deployment and that your backend server is running and accessible.`
      );
    }
    throw netErr;
  }
}
