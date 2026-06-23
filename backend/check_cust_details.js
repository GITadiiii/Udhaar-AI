import { supabase } from './supabase.js';

async function check() {
  try {
    const merchantUuid = '41362257-2619-46ee-aff1-88e6161cf7b3'; // merchant_pp96i3ttr
    const { data: customers, error } = await supabase.from('customers').select('*').eq('merchant_id', merchantUuid);
    if (error) throw error;

    console.log('--- ALL CUSTOMERS FOR MERCHANT IN SUPABASE ---');
    for (const c of customers) {
      console.log(`Name: ${c.name} | Alias: ${c.alias}`);
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
}

check();
