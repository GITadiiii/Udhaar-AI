import { supabase } from './supabase.js';

async function check() {
  try {
    const merchantUuid = '41362257-2619-46ee-aff1-88e6161cf7b3'; // merchant_pp96i3ttr
    const { data: txs, error } = await supabase.from('transactions').select('id, customer_id, amount, type').eq('merchant_id', merchantUuid);
    if (error) throw error;

    console.log('--- SUPABASE TRANSACTIONS ---');
    for (const t of txs) {
      console.log(`Tx ID: ${t.id} | Customer UUID ID: ${t.customer_id} | Amount: ₹${t.amount} | Type: ${t.type}`);
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
}

check();
