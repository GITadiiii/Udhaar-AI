import dotenv from 'dotenv';
dotenv.config();
import { getCustomers } from './db.js';

async function test() {
  try {
    const mId = 'merchant_pp96i3ttr'; // arav
    const customers = await getCustomers(mId);
    console.log('--- ALL CUSTOMERS RETURNED WITH SUPABASE ---');
    console.log('Count:', customers.length);
    for (const c of customers) {
      console.log(`ID: ${c.id} | Name: ${c.name} | Deleted: ${c.deleted}`);
    }
  } catch (err) {
    console.error('getCustomers failed:', err);
  }
}

test();
