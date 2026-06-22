-- Idempotent SQL Migration Script for Udhaar-AI Supabase Schema

-- 1. Users Table (Shopkeepers / Merchants)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure a default merchant exists so foreign key constraints don't fail for orphaned records
INSERT INTO users (id, name, business_name, phone)
VALUES ('00000000-0000-0000-0000-000000000000', 'Default Merchant', 'Default Store', '0000000000')
ON CONFLICT (phone) DO NOTHING;

-- 2. Customers Table
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    phone VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
ADD COLUMN IF NOT EXISTS alias TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_merchant ON customers (merchant_id);
CREATE INDEX IF NOT EXISTS idx_customers_search ON customers (name, phone);

-- 3. Transactions Table (Credits and Collections)
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    type VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'collection')),
    description TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE transactions 
ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

CREATE INDEX IF NOT EXISTS idx_transactions_merchant ON transactions (merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_customer ON transactions (customer_id);

-- 4. Outstanding Balances Table
CREATE TABLE IF NOT EXISTS outstanding_balances (
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE PRIMARY KEY,
    balance NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE outstanding_balances 
ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

CREATE INDEX IF NOT EXISTS idx_balances_merchant ON outstanding_balances (merchant_id);

-- 5. Reminders Table
CREATE TABLE IF NOT EXISTS reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    days_overdue INT NOT NULL,
    priority VARCHAR(10) NOT NULL CHECK (priority IN ('Soft', 'Medium', 'High')),
    status VARCHAR(10) DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'paid'))
);

ALTER TABLE reminders 
ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

CREATE INDEX IF NOT EXISTS idx_reminders_merchant ON reminders (merchant_id);
CREATE INDEX IF NOT EXISTS idx_reminders_status_priority ON reminders (status, priority);

-- 6. Daily Summaries Table
CREATE TABLE IF NOT EXISTS daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    credit_given NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    collections NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    net_change NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    summary_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE daily_summaries 
ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid;

-- Drop and recreate constraint if needed to avoid conflicts
ALTER TABLE daily_summaries DROP CONSTRAINT IF EXISTS daily_summaries_date_key;
ALTER TABLE daily_summaries DROP CONSTRAINT IF EXISTS unique_merchant_date;
ALTER TABLE daily_summaries ADD CONSTRAINT unique_merchant_date UNIQUE (merchant_id, date);

CREATE INDEX IF NOT EXISTS idx_summaries_merchant ON daily_summaries (merchant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_merchant_date ON transactions (merchant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_customer_date ON transactions (customer_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_reminders_customer ON reminders (customer_id);
CREATE INDEX IF NOT EXISTS idx_customers_merchant_name ON customers (merchant_id, name);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers (created_at);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users (created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
CREATE INDEX IF NOT EXISTS idx_summaries_created_at ON daily_summaries (created_at);

-- 7. Enable Row-Level Security (RLS) on all tables for merchant isolation
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE outstanding_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_summaries ENABLE ROW LEVEL SECURITY;

-- 8. Setup RLS Policies (Ensure clean recreate)
DROP POLICY IF EXISTS merchant_isolation_users ON users;
CREATE POLICY merchant_isolation_users ON users FOR ALL USING (id = auth.uid());

DROP POLICY IF EXISTS merchant_isolation_customers ON customers;
CREATE POLICY merchant_isolation_customers ON customers FOR ALL USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS merchant_isolation_transactions ON transactions;
CREATE POLICY merchant_isolation_transactions ON transactions FOR ALL USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS merchant_isolation_balances ON outstanding_balances;
CREATE POLICY merchant_isolation_balances ON outstanding_balances FOR ALL USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS merchant_isolation_reminders ON reminders;
CREATE POLICY merchant_isolation_reminders ON reminders FOR ALL USING (merchant_id = auth.uid());

DROP POLICY IF EXISTS merchant_isolation_summaries ON daily_summaries;
CREATE POLICY merchant_isolation_summaries ON daily_summaries FOR ALL USING (merchant_id = auth.uid());
