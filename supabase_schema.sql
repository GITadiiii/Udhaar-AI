-- Supabase PostgreSQL Schema for UdhaarAI

-- 1. Users Table (Shopkeepers / Merchants)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Customers Table
CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    name TEXT NOT NULL,
    alias TEXT,
    phone VARCHAR(20) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Index for searching customers quickly
CREATE INDEX idx_customers_search ON customers (name, alias, phone);

-- 3. Transactions Table (Credits and Collections)
CREATE TABLE transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL CHECK (amount >= 0),
    type VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'collection')),
    description TEXT,
    date TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. Outstanding Balances Table (Materialized state for fast dashboard queries)
CREATE TABLE outstanding_balances (
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE PRIMARY KEY,
    balance NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 5. Automated Database Trigger to update outstanding balance upon transaction insert
CREATE OR REPLACE FUNCTION update_outstanding_balance()
RETURNS TRIGGER AS $$
BEGIN
    -- Ensure balance record exists for the customer
    INSERT INTO outstanding_balances (customer_id, balance, last_updated)
    VALUES (NEW.customer_id, 0.00, NEW.date)
    ON CONFLICT (customer_id) DO NOTHING;

    -- Adjust balance based on transaction type
    IF NEW.type = 'credit' THEN
        UPDATE outstanding_balances
        SET balance = balance + NEW.amount,
            last_updated = NEW.date
        WHERE customer_id = NEW.customer_id;
    ELSIF NEW.type = 'collection' THEN
        UPDATE outstanding_balances
        SET balance = GREATEST(0.00, balance - NEW.amount),
            last_updated = NEW.date
        WHERE customer_id = NEW.customer_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_balance
AFTER INSERT ON transactions
FOR EACH ROW
EXECUTE FUNCTION update_outstanding_balance();

-- 6. Reminders Table (Auto-generated payment schedules)
CREATE TABLE reminders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    days_overdue INT NOT NULL,
    priority VARCHAR(10) NOT NULL CHECK (priority IN ('Soft', 'Medium', 'High')),
    status VARCHAR(10) DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'paid'))
);

CREATE INDEX idx_reminders_status_priority ON reminders (status, priority);

-- 7. Daily Summaries Table (AI Narrative Cache)
CREATE TABLE daily_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID REFERENCES users(id) ON DELETE CASCADE DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    date DATE NOT NULL UNIQUE,
    credit_given NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    collections NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    net_change NUMERIC(12, 2) DEFAULT 0.00 NOT NULL,
    summary_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
