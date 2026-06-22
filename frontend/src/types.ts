export interface Customer {
  id: string;
  name: string;
  alias: string;
  phone: string;
  created_at: string;
  balance: number;
  last_updated: string;
  address?: string;
  notes?: string;
  customerType?: string;
  normalizedName?: string;
  aliases?: string[];
  deleted?: boolean;
}

export interface Transaction {
  id: string;
  customer_id: string;
  amount: number;
  type: 'credit' | 'collection';
  description: string;
  date: string;
}

export interface Reminder {
  id: string;
  customer_id: string;
  amount: number;
  due_date: string;
  days_overdue: number;
  priority: 'Soft' | 'Medium' | 'High';
  status: 'pending' | 'paid';
  customer_name?: string;
  customer_phone?: string;
}

export interface DailySummary {
  date: string;
  credit_given: number;
  collections: number;
  net_change: number;
  summary_text: string;
  created_at: string;
}

export interface Ledger {
  customer: Customer;
  transactions: Transaction[];
  reminders: Reminder[];
}
