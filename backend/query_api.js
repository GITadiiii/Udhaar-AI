import { getCustomers } from './db.js';

async function test() {
  try {
    const mId = 'merchant_pp96i3ttr'; // arav
    const customers = await getCustomers(mId);
    console.log('--- DB GETCUSTOMERS RESULT ---');
    console.log('Merchant ID:', mId);
    console.log('Customer Count:', customers.length);
    if (customers.length > 0) {
      console.log('First customer:', customers[0]);
    }
  } catch (err) {
    console.error('getCustomers failed:', err);
  }
}

test();
