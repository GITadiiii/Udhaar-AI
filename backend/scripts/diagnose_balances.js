import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { getCustomers, toUUID } from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

async function diagnoseMerchantCustomers() {
  const merchantId = 'merchant_57rtuwycc';
  console.log(`--- FETCHING CUSTOMERS FOR MERCHANT: ${merchantId} ---`);
  
  try {
    const customers = await getCustomers(merchantId);
    console.log(`Returned customers:`, JSON.stringify(customers, null, 2));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

diagnoseMerchantCustomers();
