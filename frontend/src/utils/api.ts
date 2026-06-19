import { Customer, Transaction, Reminder, DailySummary, Ledger } from '../types';

// Resolve API URL dynamically using the environment variable VITE_API_URL
let rawApiUrl = import.meta.env.VITE_API_URL;

if (!rawApiUrl) {
  rawApiUrl = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
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

export async function fetchCustomers(date?: string): Promise<Customer[]> {
  const url = date ? `${API_BASE}/customers?date=${date}` : `${API_BASE}/customers`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch customers');
  return res.json();
}

export async function fetchTransactions(date?: string): Promise<Transaction[]> {
  const url = date ? `${API_BASE}/transactions?date=${date}` : `${API_BASE}/transactions`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch transactions');
  return res.json();
}

export async function createCustomer(name: string, phone: string, alias?: string, confirmNew?: boolean): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE}/customers`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, phone, alias, confirmNew })
  });
  if (!res.ok) throw new Error('Failed to create customer');
  return res.json();
}

export async function deleteCustomer(id: string): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE}/customers/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to delete customer');
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
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || 'Failed to update customer');
  }
  return res.json();
}

export async function fetchLedger(customerId: string, date?: string): Promise<Ledger> {
  const url = date ? `${API_BASE}/customers/${customerId}/ledger?date=${date}` : `${API_BASE}/customers/${customerId}/ledger`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch customer ledger');
  return res.json();
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
  if (!res.ok) throw new Error('Failed to record transaction');
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
  if (!res.ok) throw new Error('Failed to process voice transcript');
  return res.json();
}

export async function fetchDailySummary(date?: string): Promise<DailySummary> {
  const url = date ? `${API_BASE}/summary/daily?date=${date}` : `${API_BASE}/summary/daily`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch daily summary');
  return res.json();
}

export async function fetchReminders(date?: string): Promise<Reminder[]> {
  const url = date ? `${API_BASE}/reminders?date=${date}` : `${API_BASE}/reminders`;
  const res = await fetchWithTimeout(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch reminders');
  return res.json();
}

export async function deleteTransaction(id: string): Promise<any> {
  const res = await fetchWithTimeout(`${API_BASE}/transactions/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to delete transaction');
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
