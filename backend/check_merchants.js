import { supabase } from './supabase.js';

async function check() {
  try {
    const { data: users, error: uErr } = await supabase.from('users').select('*');
    if (uErr) throw uErr;

    console.log('--- USERS IN SUPABASE ---');
    const uuidToOriginal = {};
    for (const u of users) {
      let orig = u.id;
      try {
        const parsed = JSON.parse(u.business_name);
        orig = parsed.original_id || u.id;
      } catch (e) {}
      uuidToOriginal[u.id] = { name: u.name, original: orig };
      console.log(`UUID: ${u.id} | Name: ${u.name} | Original: ${orig} | Phone: ${u.phone}`);
    }
  } catch (err) {
    console.error('Check failed:', err);
  }
}

check();
