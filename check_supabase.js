import dotenv from 'dotenv';
dotenv.config({ path: 'C:/Users/BIT/.gemini/antigravity/scratch/udhaar-ai/backend/.env' });
import { createClient } from '@supabase/supabase-base-js'; // Wait, let's use the local supabase.js directly
import { supabase } from './backend/supabase.js';

async function check() {
  try {
    const { data: users, error: uErr } = await supabase.from('users').select('*');
    const { data: customers, error: cErr } = await supabase.from('customers').select('*');
    const { data: transactions, error: tErr } = await supabase.from('transactions').select('*');
    const { data: balances, error: bErr } = await supabase.from('outstanding_balances').select('*');

    console.log('--- SUPABASE STATUS ---');
    console.log(`Users count: ${users ? users.length : 0} (error: ${uErr ? uErr.message : 'none'})`);
    console.log(`Customers count: ${customers ? customers.length : 0} (error: ${cErr ? cErr.message : 'none'})`);
    console.log(`Transactions count: ${transactions ? transactions.length : 0} (error: ${tErr ? tErr.message : 'none'})`);
    console.log(`Balances count: ${balances ? balances.length : 0} (error: ${bErr ? bErr.message : 'none'})`);

    if (users && users.length > 0) {
      console.log('First user:', users[0]);
    }
    if (customers && customers.length > 0) {
      console.log('First customer:', customers[0]);
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
}

check();
