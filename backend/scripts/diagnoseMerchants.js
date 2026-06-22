import { supabase } from '../supabase.js';
import { toUUID } from '../db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, '../db.json');

async function runDiagnosis() {
  console.log('====================================================');
  console.log('          UDHAAR-AI DATABASE INTEGRITY AUDIT        ');
  console.log('====================================================\n');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.error('❌ Error: Supabase credentials missing in environment.');
    process.exit(1);
  }

  console.log('1. Connecting to Supabase...');
  console.log(`   URL: ${process.env.SUPABASE_URL}`);
  
  // 1. Fetch tables
  console.log('\n2. Fetching records from Supabase...');
  
  const [
    { data: users, error: uErr },
    { data: customers, error: cErr },
    { data: transactions, error: tErr },
    { data: balances, error: bErr },
    { data: reminders, error: rErr },
    { data: summaries, error: sErr }
  ] = await Promise.all([
    supabase.from('users').select('*'),
    supabase.from('customers').select('*'),
    supabase.from('transactions').select('*'),
    supabase.from('outstanding_balances').select('*'),
    supabase.from('reminders').select('*'),
    supabase.from('daily_summaries').select('*')
  ]);

  if (uErr) console.error('   ❌ Error fetching users:', uErr.message);
  if (cErr) console.error('   ❌ Error fetching customers:', cErr.message);
  if (tErr) console.error('   ❌ Error fetching transactions:', tErr.message);
  if (bErr) console.error('   ❌ Error fetching outstanding_balances:', bErr.message);
  if (rErr) console.error('   ❌ Error fetching reminders:', rErr.message);
  if (sErr) console.error('   ❌ Error fetching daily_summaries:', sErr.message);

  if (uErr || cErr || tErr || bErr || rErr || sErr) {
    console.error('\n❌ Critical: Failed to retrieve complete database state. Audit aborted.');
    process.exit(1);
  }

  console.log(`   Fetched:
   - Users: ${users.length}
   - Customers: ${customers.length}
   - Transactions: ${transactions.length}
   - Outstanding Balances: ${balances.length}
   - Reminders: ${reminders.length}
   - Daily Summaries: ${summaries.length}`);

  // 2. Audit Merchant References
  console.log('\n3. Auditing merchant references...');

  const userIds = new Set(users.map(u => u.id));
  const merchantRefs = new Map(); // merchant_id -> { customers: 0, transactions: 0, balances: 0, reminders: 0, summaries: 0 }

  const trackRef = (merchantId, type) => {
    if (!merchantId) return;
    if (!merchantRefs.has(merchantId)) {
      merchantRefs.set(merchantId, { customers: 0, transactions: 0, balances: 0, reminders: 0, summaries: 0 });
    }
    merchantRefs.get(merchantId)[type]++;
  };

  customers.forEach(c => trackRef(c.merchant_id, 'customers'));
  transactions.forEach(t => trackRef(t.merchant_id, 'transactions'));
  balances.forEach(b => trackRef(b.merchant_id, 'balances'));
  reminders.forEach(r => trackRef(r.merchant_id, 'reminders'));
  summaries.forEach(s => trackRef(s.merchant_id, 'summaries'));

  console.log('\n====================================================');
  console.log('                  MERCHANT REPORT                   ');
  console.log('====================================================');

  let totalInconsistencies = 0;
  const missingMerchants = [];

  for (const [merchantId, stats] of merchantRefs.entries()) {
    const exists = userIds.has(merchantId);
    console.log(`\nMerchant ID: ${merchantId}`);
    console.log(`- Exists in "users" table: ${exists ? '✅ YES' : '❌ NO (ORPHANED REFERENCES)'}`);
    console.log(`- Associated Records:
  * Customers: ${stats.customers}
  * Transactions: ${stats.transactions}
  * Outstanding Balances: ${stats.balances}
  * Reminders: ${stats.reminders}
  * Daily Summaries: ${stats.summaries}`);

    if (!exists) {
      totalInconsistencies++;
      missingMerchants.push(merchantId);
    }
  }

  // 3. Audit Customer References
  console.log('\n====================================================');
  console.log('                  CUSTOMER REPORT                   ');
  console.log('====================================================');
  
  const customerIds = new Set(customers.map(c => c.id));
  let orphanBalances = 0;
  let orphanTransactions = 0;
  let orphanReminders = 0;

  balances.forEach(b => {
    if (!customerIds.has(b.customer_id)) {
      console.log(`❌ Balance record found for non-existent customer ID: ${b.customer_id}`);
      orphanBalances++;
      totalInconsistencies++;
    }
  });

  transactions.forEach(t => {
    if (!customerIds.has(t.customer_id)) {
      console.log(`❌ Transaction ID ${t.id} references non-existent customer ID: ${t.customer_id}`);
      orphanTransactions++;
      totalInconsistencies++;
    }
  });

  reminders.forEach(r => {
    if (!customerIds.has(r.customer_id)) {
      console.log(`❌ Reminder ID ${r.id} references non-existent customer ID: ${r.customer_id}`);
      orphanReminders++;
      totalInconsistencies++;
    }
  });

  if (orphanBalances === 0 && orphanTransactions === 0 && orphanReminders === 0) {
    console.log('✅ Customer references are perfectly consistent. No orphaned records.');
  } else {
    console.log(`\nFound:
  - Orphaned Outstanding Balances: ${orphanBalances}
  - Orphaned Transactions: ${orphanTransactions}
  - Orphaned Reminders: ${orphanReminders}`);
  }

  // 4. Local db.json check
  console.log('\n====================================================');
  console.log('                 LOCAL DATABASE AUDIT               ');
  console.log('====================================================');
  if (fs.existsSync(DB_FILE)) {
    try {
      const dbData = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
      const localUsers = dbData.users || [];
      const localCustomers = dbData.customers || [];
      console.log(`   db.json contains ${localUsers.length} users and ${localCustomers.length} customers.`);
      
      const missingLocalInSupabase = localUsers.filter(u => !userIds.has(toUUID(u.id)));
      if (missingLocalInSupabase.length > 0) {
        console.log(`❌ Found ${missingLocalInSupabase.length} users in db.json that do NOT exist in Supabase:`);
        missingLocalInSupabase.forEach(u => {
          console.log(`   - ID: ${u.id} (UUID: ${toUUID(u.id)}) | Name: ${u.name}`);
        });
        totalInconsistencies += missingLocalInSupabase.length;
      } else {
        console.log('   ✅ All local users exist in Supabase.');
      }
    } catch (e) {
      console.error('❌ Failed to audit local db.json:', e.message);
    }
  } else {
    console.log('   ℹ️ Local db.json does not exist. Skipping local audit.');
  }

  // 5. Final Report Summary
  console.log('\n====================================================');
  console.log('                     SUMMARY                        ');
  console.log('====================================================');
  if (totalInconsistencies === 0) {
    console.log('\n🎉 ALL CHECKS PASSED! Database relationships are 100% consistent.');
  } else {
    console.log(`\n❌ INCONSISTENCIES DETECTED: Found ${totalInconsistencies} issues.`);
    if (missingMerchants.length > 0) {
      console.log('\n💡 Resolution Tip: Run migrations to seed missing default users, or edit profile / register missing merchant IDs:');
      missingMerchants.forEach(mId => {
        console.log(`   For merchant UUID "${mId}":`);
        console.log(`   INSERT INTO users (id, name, business_name, phone)`);
        console.log(`   VALUES ('${mId}', 'Karan Kumar', '{"business_name":"Karan Kirana Store","original_id":"merchant_1"}', '9876543210') ON CONFLICT DO NOTHING;\n`);
      });
    }
  }
}

runDiagnosis().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});
