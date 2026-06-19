import { supabase } from '../supabase.js';
import { toUUID } from '../db.js';

async function runVerification() {
  console.log('--- STARTING UDHAAR-AI SUPABASE VERIFICATION ---');

  // 1. Audit Table and Column Schema
  const schema = {
    users: ['id', 'name', 'business_name', 'phone', 'created_at'],
    customers: ['id', 'merchant_id', 'name', 'phone', 'created_at', 'alias'],
    transactions: ['id', 'merchant_id', 'customer_id', 'amount', 'type', 'description', 'date'],
    outstanding_balances: ['customer_id', 'merchant_id', 'balance', 'last_updated'],
    reminders: ['id', 'merchant_id', 'customer_id', 'amount', 'due_date', 'days_overdue', 'priority', 'status'],
    daily_summaries: ['id', 'merchant_id', 'date', 'credit_given', 'collections', 'net_change', 'summary_text', 'created_at']
  };

  let schemaOk = true;
  console.log('\nChecking Supabase Schema...');
  
  for (const [table, columns] of Object.entries(schema)) {
    for (const column of columns) {
      const { error } = await supabase.from(table).select(column).limit(1);
      if (error) {
        schemaOk = false;
        if (error.code === '42P01') {
          console.error(`  ❌ Table "${table}" is missing.`);
          break;
        } else if (error.code === '42703' || error.message.includes('does not exist')) {
          console.error(`  ❌ Column "${column}" in table "${table}" is missing.`);
        } else {
          console.error(`  ❌ Error checking ${table}.${column}: ${error.message}`);
        }
      }
    }
  }

  if (schemaOk) {
    console.log('  ✅ Schema is perfectly aligned. All tables and columns exist.');
  } else {
    console.error('\n  ❌ SCHEMA ERROR: Some tables/columns are missing. Please apply the migration.sql script first.');
    process.exit(1);
  }

  // 2. Test E2E CRUD Sanity
  console.log('\nRunning E2E CRUD Sanity Test...');
  const testMerchantId = 'merchant_test_e2e';
  const testCustomerId = 'cust_test_e2e';
  
  try {
    const { addMerchant, addCustomer, addTransaction, getCustomerLedger, deleteCustomer } = await import('../db.js');
    
    // Register merchant
    console.log('  Registering test merchant...');
    await addMerchant({
      id: testMerchantId,
      name: 'Verification Tester',
      business_name: 'Verification Shop',
      phone: '9999999991'
    });
    console.log('  ✅ Merchant registered successfully.');

    // Add Customer
    console.log('  Adding test customer...');
    const customer = await addCustomer({
      name: 'Test Customer',
      phone: '9876543219',
      merchantId: testMerchantId,
      confirmNew: true
    });
    console.log(`  ✅ Customer added successfully (ID: ${customer.id}).`);

    // Record Transaction
    console.log('  Recording credit transaction...');
    await addTransaction({
      customerId: customer.id,
      amount: 1500,
      type: 'credit',
      description: 'Test Credit Entry',
      merchantId: testMerchantId
    });
    console.log('  ✅ Credit transaction recorded successfully.');

    // Verify Balance and Ledger
    console.log('  Fetching customer ledger...');
    const ledger = await getCustomerLedger(customer.id, testMerchantId);
    if (ledger && ledger.customer.balance === 1500) {
      console.log('  ✅ Ledger balance is correct: ₹1500');
    } else {
      throw new Error(`Invalid balance calculated: ${ledger?.customer.balance}`);
    }

    // Clean up
    console.log('  Cleaning up test customer (cascading deletes)...');
    await deleteCustomer(customer.id, testMerchantId);
    console.log('  ✅ Cleanup successful.');

    console.log('\n🎉 ALL VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  } catch (err) {
    console.error('\n❌ VERIFICATION FAILED:', err.message);
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('Fatal Verification Error:', err);
  process.exit(1);
});
