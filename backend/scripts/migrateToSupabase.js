import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { supabase } from '../supabase.js';
import { toUUID } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, '../db.json');

async function runMigration() {
  console.log('--- Starting Supabase One-Time Migration ---');

  if (!fs.existsSync(DB_FILE)) {
    console.error(`Error: Local database file not found at ${DB_FILE}`);
    process.exit(1);
  }

  const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));

  // 1. Migrate Users
  const users = dbData.users || [];
  console.log(`Mapping ${users.length} users...`);
  const usersToUpsert = users.map(u => ({
    id: toUUID(u.id),
    name: u.name,
    business_name: JSON.stringify({ business_name: u.business_name, original_id: u.id }),
    phone: u.phone || '0000000000',
    created_at: u.created_at || new Date().toISOString()
  }));

  if (usersToUpsert.length > 0) {
    const { error: uErr } = await supabase.from('users').upsert(usersToUpsert);
    if (uErr) {
      console.error('Error migrating users:', uErr.message);
      process.exit(1);
    }
    console.log(`Successfully migrated ${usersToUpsert.length} users.`);
  }

  // 2. Migrate Customers
  const customers = dbData.customers || [];
  console.log(`Mapping ${customers.length} customers...`);
  const customersToUpsert = customers.map(c => ({
    id: toUUID(c.id),
    merchant_id: toUUID(c.merchant_id || 'merchant_1'),
    name: c.name,
    alias: JSON.stringify({
      alias: c.alias,
      aliases: c.aliases,
      normalizedName: c.normalizedName,
      deleted: c.deleted || false,
      original_id: c.id,
      original_merchant_id: c.merchant_id
    }),
    phone: c.phone || '0000000000',
    created_at: c.created_at || new Date().toISOString()
  }));

  if (customersToUpsert.length > 0) {
    const { error: cErr } = await supabase.from('customers').upsert(customersToUpsert);
    if (cErr) {
      console.error('Error migrating customers:', cErr.message);
      process.exit(1);
    }
    console.log(`Successfully migrated ${customersToUpsert.length} customers.`);
  }

  // 3. Migrate Transactions
  const transactions = dbData.transactions || [];
  console.log(`Mapping ${transactions.length} transactions...`);
  const transactionsToUpsert = transactions.map(t => ({
    id: toUUID(t.id),
    merchant_id: toUUID(t.merchant_id || 'merchant_1'),
    customer_id: toUUID(t.customer_id),
    amount: parseFloat(t.amount),
    type: t.type,
    description: JSON.stringify({
      description: t.description || '',
      original_id: t.id,
      original_customer_id: t.customer_id,
      merchant_id: t.merchant_id
    }),
    date: t.date || new Date().toISOString()
  }));

  if (transactionsToUpsert.length > 0) {
    const { error: tErr } = await supabase.from('transactions').upsert(transactionsToUpsert);
    if (tErr) {
      console.error('Error migrating transactions:', tErr.message);
      process.exit(1);
    }
    console.log(`Successfully migrated ${transactionsToUpsert.length} transactions.`);
  }

  // 4. Migrate Outstanding Balances
  const balances = dbData.outstanding_balances || [];
  console.log(`Mapping ${balances.length} outstanding balances...`);
  const balancesToUpsert = balances.map(b => ({
    customer_id: toUUID(b.customer_id),
    merchant_id: toUUID(b.merchant_id || 'merchant_1'),
    balance: parseFloat(b.balance),
    last_updated: b.last_updated || new Date().toISOString()
  }));

  if (balancesToUpsert.length > 0) {
    const { error: bErr } = await supabase.from('outstanding_balances').upsert(balancesToUpsert);
    if (bErr) {
      console.error('Error migrating outstanding balances:', bErr.message);
      process.exit(1);
    }
    console.log(`Successfully migrated ${balancesToUpsert.length} outstanding balances.`);
  }

  // 5. Migrate Reminders
  const reminders = dbData.reminders || [];
  console.log(`Mapping ${reminders.length} reminders...`);
  const remindersToUpsert = reminders.map(r => ({
    id: toUUID(r.id),
    merchant_id: toUUID(r.merchant_id || 'merchant_1'),
    customer_id: toUUID(r.customer_id),
    amount: parseFloat(r.amount),
    due_date: r.due_date || new Date().toISOString(),
    days_overdue: parseInt(r.days_overdue) || 0,
    priority: r.priority,
    status: r.status
  }));

  if (remindersToUpsert.length > 0) {
    const { error: rErr } = await supabase.from('reminders').upsert(remindersToUpsert);
    if (rErr) {
      console.error('Error migrating reminders:', rErr.message);
      process.exit(1);
    }
    console.log(`Successfully migrated ${remindersToUpsert.length} reminders.`);
  }

  // 6. Migrate Daily Summaries
  const summaries = dbData.daily_summaries || [];
  console.log(`Mapping ${summaries.length} daily summaries...`);
  const summariesToUpsert = summaries.map(s => {
    // Generate deterministic UUID for each summary based on merchant_id and date to prevent duplicates
    const summaryKey = `${s.merchant_id || 'merchant_1'}_${s.date}`;
    return {
      id: toUUID(summaryKey),
      merchant_id: toUUID(s.merchant_id || 'merchant_1'),
      date: s.date,
      credit_given: parseFloat(s.credit_given),
      collections: parseFloat(s.collections),
      net_change: parseFloat(s.net_change),
      summary_text: s.summary_text,
      created_at: s.created_at || new Date().toISOString()
    };
  });

  if (summariesToUpsert.length > 0) {
    const { error: sErr } = await supabase.from('daily_summaries').upsert(summariesToUpsert, { onConflict: 'merchant_id,date' });
    if (sErr) {
      console.error('Error migrating daily summaries:', sErr.message);
      process.exit(1);
    }
    console.log(`Successfully migrated ${summariesToUpsert.length} daily summaries.`);
  }

  console.log('\n🎉 MIGRATION COMPLETED SUCCESSFULLY!');
  console.log('Summary of records migrated:');
  console.log(`- Users: ${usersToUpsert.length}`);
  console.log(`- Customers: ${customersToUpsert.length}`);
  console.log(`- Transactions: ${transactionsToUpsert.length}`);
  console.log(`- Outstanding Balances: ${balancesToUpsert.length}`);
  console.log(`- Reminders: ${remindersToUpsert.length}`);
  console.log(`- Daily Summaries: ${summariesToUpsert.length}`);
}

runMigration().catch(err => {
  console.error('Fatal Migration Error:', err);
  process.exit(1);
});
