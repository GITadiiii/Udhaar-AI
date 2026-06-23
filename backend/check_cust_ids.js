import { supabase } from './supabase.js';

async function check() {
  try {
    const merchantUuid = '41362257-2619-46ee-aff1-88e6161cf7b3'; // merchant_pp96i3ttr
    const { data: customers, error } = await supabase.from('customers').select('id, name, alias').eq('merchant_id', merchantUuid);
    if (error) throw error;

    console.log('--- SUPABASE CUSTOMERS ---');
    for (const c of customers) {
      console.log(`UUID ID: ${c.id} | Name: ${c.name} | Alias: ${c.alias.substring(0, 80)}...`);
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
}

check();
