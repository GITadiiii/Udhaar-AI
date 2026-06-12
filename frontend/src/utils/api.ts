import { Customer, Transaction, Reminder, DailySummary, Ledger } from '../types';

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : 'https://udhaar-ai.onrender.com/api';

const getHeaders = (headers?: Record<string, string>) => {
  const merchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
  return {
    ...headers,
    'x-merchant-id': merchantId
  };
};

export async function fetchCustomers(date?: string): Promise<Customer[]> {
  const url = date ? `${API_BASE}/customers?date=${date}` : `${API_BASE}/customers`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch customers');
  return res.json();
}

export async function createCustomer(name: string, phone: string, alias?: string, confirmNew?: boolean): Promise<any> {
  const res = await fetch(`${API_BASE}/customers`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name, phone, alias, confirmNew })
  });
  if (!res.ok) throw new Error('Failed to create customer');
  return res.json();
}

export async function deleteCustomer(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/customers/${id}`, {
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
  const res = await fetch(`${API_BASE}/customers/${id}`, {
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
  const res = await fetch(url, {
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
  const res = await fetch(`${API_BASE}/transactions`, {
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
  const res = await fetch(`${API_BASE}/voice/process`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ transcript })
  });
  if (!res.ok) throw new Error('Failed to process voice transcript');
  return res.json();
}

export async function fetchDailySummary(date?: string): Promise<DailySummary> {
  const url = date ? `${API_BASE}/summary/daily?date=${date}` : `${API_BASE}/summary/daily`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch daily summary');
  return res.json();
}

export async function fetchReminders(date?: string): Promise<Reminder[]> {
  const url = date ? `${API_BASE}/reminders?date=${date}` : `${API_BASE}/reminders`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to fetch reminders');
  return res.json();
}

export async function deleteTransaction(id: string): Promise<any> {
  const res = await fetch(`${API_BASE}/transactions/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Failed to delete transaction');
  return res.json();
}
