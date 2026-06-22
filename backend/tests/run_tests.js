process.env.DISABLE_SUPABASE_SYNC = 'true';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  normalizeCustomerName, 
  findExistingCustomer, 
  mergeDuplicateCustomers, 
  addCustomer, 
  addTransaction, 
  getCustomerLedger,
  getCustomers,
  readDb,
  writeDb,
  transliterateHindiToEnglish,
  sanitizeCustomerName,
  getLevenshteinDistance,
  getReminders,
  deleteCustomer,
  deleteTransaction
} from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, '..', 'db.json');
const BACKUP_FILE = path.join(__dirname, '..', 'db.json.bak');

console.log('--- Starting Automated Multilingual & Alias Tests ---');
if (fs.existsSync(DB_FILE)) {
  fs.copyFileSync(DB_FILE, BACKUP_FILE);
  console.log('[TEST SETUP] Backed up existing db.json.');
}

let testFailures = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ [FAIL] ${message}`);
    testFailures++;
  } else {
    console.log(`✅ [PASS] ${message}`);
  }
}

// Initialize clean test DB
function resetTestDb() {
  const testStructure = {
    users: [{ id: "merchant_test", name: "Test Merchant", business_name: "Test Store", phone: "+919999999999" }],
    customers: [
      { id: "test_cust_1", name: "Rahul Mechanic", alias: "Rahul M", phone: "+919800011111", created_at: "2026-06-01T10:00:00.000Z", normalizedName: "rahulmechanic", aliases: ["Rahul Mechanic", "rahul mechanic"] },
      { id: "test_cust_2", name: "Raju Milkman", alias: "Raju", phone: "+919800022222", created_at: "2026-06-02T10:00:00.000Z", normalizedName: "rajumilkman", aliases: ["Raju Milkman"] }
    ],
    transactions: [
      { id: "test_tx_1", customer_id: "test_cust_1", amount: 1000, type: "credit", description: "Credit entry 1", date: "2026-06-01T10:05:00.000Z" }
    ],
    outstanding_balances: [
      { customer_id: "test_cust_1", balance: 1000, last_updated: "2026-06-01T10:05:00.000Z" },
      { customer_id: "test_cust_2", balance: 0, last_updated: "2026-06-02T10:00:00.000Z" }
    ],
    reminders: [],
    daily_summaries: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(testStructure, null, 2), 'utf-8');
}

try {
  resetTestDb();

  // Test Case 1: Hindi Transliteration
  console.log('\n--- Test Case 1: Hindi Transliteration ---');
  assert(transliterateHindiToEnglish('राहुल') === 'rahul', 'Transliterates "राहुल" to "rahul"');
  assert(transliterateHindiToEnglish('मेकेनिक') === 'mekenik', 'Transliterates "मेकेनिक" to "mekenik"');
  assert(transliterateHindiToEnglish('राहुल मेकेनिक') === 'rahul mekenik', 'Transliterates composite name "राहुल मेकेनिक"');
  assert(transliterateHindiToEnglish('Raju Milkman') === 'raju milkman', 'Ignores non-Hindi scripts');

  // Test Case 2: Multilingual Name Resolution
  console.log('\n--- Test Case 2: Multilingual Name Resolution ---');
  const match2 = findExistingCustomer('राहुल मेकेनिक');
  assert(match2.length === 1 && match2[0].id === 'test_cust_1', 'Resolves Devanagari script to English customer record (Rahul Mechanic)');

  // Test Case 3: Priority lookup tests
  console.log('\n--- Test Case 3: Priority Matching Hierarchy ---');
  const matchID = findExistingCustomer('test_cust_2');
  assert(matchID.length === 1 && matchID[0].id === 'test_cust_2', 'Step 1 ID match works');
  
  const matchPhone = findExistingCustomer('Unknown Name', '+919800022222');
  assert(matchPhone.length === 1 && matchPhone[0].id === 'test_cust_2', 'Step 2 Mobile number match works');
  
  const matchNorm = findExistingCustomer('rahul mechanic');
  assert(matchNorm.length === 1 && matchNorm[0].id === 'test_cust_1', 'Step 3 Normalized English name match works');

  // Test Case 4: Automatic Alias Learning
  console.log('\n--- Test Case 4: Automatic Alias Learning ---');
  // Record transaction with Devanagari alias spoken
  addTransaction({ 
    customerId: 'test_cust_1', 
    amount: 500, 
    type: 'credit', 
    description: 'Voice: "राहुल मेकेनिक को 500 उधार"',
    aliasSpoken: 'राहुल मेकेनिक'
  });

  const ledgerAfter = getCustomerLedger('test_cust_1');
  const updatedAliases = ledgerAfter.customer.aliases || [];
  assert(updatedAliases.includes('राहुल मेकेनिक'), 'Learns and saves new alias "राहुल मेकेनिक" to master profile');

  // Test Case 5: Duplicate Prevention with Alias Match
  console.log('\n--- Test Case 5: Duplicate Prevention via Learned Alias ---');
  const match5 = findExistingCustomer('राहुल मेकेनिक');
  assert(match5.length === 1 && match5[0].id === 'test_cust_1', 'Finds customer via learned alias list (Step 5)');

  // Test Case 6: Duplicate merging across scripts (Hindi vs English)
  console.log('\n--- Test Case 6: Duplicate merging across scripts ---');
  const db6 = readDb();
  // Manually insert pre-existing duplicate in Devanagari script
  db6.customers.push({ 
    id: "test_cust_hindi_dup", 
    name: "राहुल मेकेनिक", 
    alias: "Rahul Hindi", 
    phone: "+919800011111", 
    created_at: "2026-06-03T10:00:00.000Z", 
    normalizedName: "राहुलमेकेनिक", 
    aliases: ["राहुल मेकेनिक"] 
  });
  db6.outstanding_balances.push({ customer_id: "test_cust_hindi_dup", balance: 300, last_updated: "2026-06-03T10:00:00.000Z" });
  db6.transactions.push({ id: "test_tx_hindi_dup", customer_id: "test_cust_hindi_dup", amount: 300, type: "credit", description: "Credit entry hindi", date: "2026-06-03T10:05:00.000Z" });
  writeDb(db6);

  // Run auto-merger
  mergeDuplicateCustomers();

  const finalCustomers = getCustomers();
  const hindiProfile = finalCustomers.find(c => c.id === 'test_cust_hindi_dup');
  const englishProfile = finalCustomers.find(c => c.id === 'test_cust_1');
  const combinedLedger = getCustomerLedger('test_cust_1');

  assert(!hindiProfile, 'Removes Devanagari duplicate profile record');
  assert(englishProfile.name === 'Rahul Mechanic', 'Keeps English display name as the master record');
  assert(englishProfile.balance === 1800, 'Aggregates correct outstanding balance (1000 master + 500 transaction + 300 duplicate = 1800)');
  assert(combinedLedger.transactions.length === 3, 'Preserves and consolidates transaction history timeline');

  // Test Case 7: 4-Variation Canonical Resolution Verification
  console.log('\n--- Test Case 7: 4-Variation Verification ---');
  resetTestDb(); // Reset to clean state (Rahul Mechanic has initial balance 1000)
  
  const transcripts = [
    { text: "Rahul Mechanic ko 500 udhaar", spoken: "Rahul Mechanic" },
    { text: "राहुल मेकेनिक को 500 उधार", spoken: "राहुल मेकेनिक" },
    { text: "rahul mechanic ko 500 udhaar", spoken: "rahul mechanic" },
    { text: "Rahul Mekanik ko 500 udhaar", spoken: "Rahul Mekanik" }
  ];

  for (const t of transcripts) {
    const matches = findExistingCustomer(t.spoken);
    assert(matches.length === 1 && matches[0].id === 'test_cust_1', `"${t.spoken}" resolves to test_cust_1`);
    
    if (matches.length === 1) {
      addTransaction({
        customerId: matches[0].id,
        amount: 500,
        type: 'credit',
        description: `Voice: "${t.text}"`,
        aliasSpoken: t.spoken
      });
    }
  }

  const currentCustomers = getCustomers();
  const mainCustomer = currentCustomers.find(c => c.id === 'test_cust_1');
  const allCustomers = currentCustomers.filter(c => c.id !== 'test_cust_2'); // Exclude Raju Milkman

  assert(allCustomers.length === 1, 'Only one customer record exists for Rahul Mechanic (no duplicates created)');
  assert(mainCustomer.balance === 3000, `Aggregates correct outstanding balance: 1000 (initial) + 500 * 4 = 3000 (got: ${mainCustomer.balance})`);
  
  const ledger = getCustomerLedger('test_cust_1');
  assert(ledger.transactions.length === 5, `Ledger has exactly 5 transactions (1 initial + 4 new) (got: ${ledger.transactions.length})`);

  // Test Case 8: Gemini Multi-Key Configuration & Failover Check
  console.log('\n--- Test Case 8: Gemini Multi-Key Failover ---');
  process.env.GEMINI_API_KEYS = 'dummy_key_1,dummy_key_2';
  
  try {
    const { callWithGemini } = await import('../services/gemini.js');
    await callWithGemini(async (genAI) => {
      throw new Error('API Key Invalid');
    });
    assert(false, 'Should throw error when all keys fail');
  } catch (err) {
    assert(err.message.includes('All configured Gemini API keys failed'), 'Propagates correct multiple API key exhaustion message');
  }

  delete process.env.GEMINI_API_KEYS;

  // Test Case 9: Tightened Duplicate Detection & False Duplicate Prevention
  console.log('\n--- Test Case 9: False Duplicate Prevention ---');
  const db9 = readDb();
  
  // Set up specific customer records
  db9.customers = [
    { id: "cust_aditi", name: "Aditi", displayName: "Aditi", normalizedName: "aditi", aliases: ["Aditi"], phone: "+919876543210", created_at: "2026-06-01T10:00:00.000Z" },
    { id: "cust_rahul", name: "Rahul Mechanic", displayName: "Rahul Mechanic", normalizedName: "rahulmechanic", aliases: ["Rahul Mechanic", "rahul mechanic"], phone: "+919800011111", created_at: "2026-06-01T10:00:00.000Z" }
  ];
  db9.outstanding_balances = [
    { customer_id: "cust_aditi", balance: 0, last_updated: "2026-06-01T10:00:00.000Z" },
    { customer_id: "cust_rahul", balance: 1000, last_updated: "2026-06-01T10:00:00.000Z" }
  ];
  db9.transactions = [];
  writeDb(db9);

  // Scenario 9.1: Existing: Aditi, Add: Aarti -> Should treat as DIFFERENT and return no match
  const matchesAarti = findExistingCustomer("Aarti");
  assert(matchesAarti.length === 0, 'Aditi and Aarti are treated as different customers (no match found)');

  // Scenario 9.2: Existing: Rahul Mechanic, Add: Rahul Mechanic -> Duplicate detected
  const matchesRahulExact = findExistingCustomer("Rahul Mechanic");
  assert(matchesRahulExact.length === 1 && matchesRahulExact[0].id === 'cust_rahul', 'Exact duplicate detected for Rahul Mechanic');

  // Scenario 9.3: Existing: Rahul Mechanic, Add: राहुल मेकेनिक -> Same customer matched phonetically
  const matchesRahulHindi = findExistingCustomer("राहुल मेकेनिक");
  assert(matchesRahulHindi.length === 1 && matchesRahulHindi[0].id === 'cust_rahul', 'Devanagari script matches same English customer Rahul Mechanic');

  // Scenario 9.4: Existing: Aditi, Add: Aaditi -> Close spelling variant, matches as candidate (requires confirmation)
  const matchesAaditi = findExistingCustomer("Aaditi");
  assert(matchesAaditi.length === 1 && matchesAaditi[0].id === 'cust_aditi', 'Aaditi matches Aditi as candidate (distance = 1)');

  // Scenario 9.5: Existing: Raju, Add: Rajesh -> Separate customers
  // Let's insert Raju first
  addCustomer({ name: "Raju", phone: "+919800022222" });
  const matchesRajesh = findExistingCustomer("Rajesh");
  assert(matchesRajesh.length === 0, 'Raju and Rajesh are treated as different customers');

  // Scenario 9.5b: Similar names (Pingu/Mingu, Ramesh/Dinesh, Sonu/Monu) -> Separate customers
  addCustomer({ name: "Sonu", phone: "+919800077777" });
  const matchesMonu = findExistingCustomer("Monu");
  assert(matchesMonu.length === 0, 'Sonu and Monu are treated as different customers');

  addCustomer({ name: "Ramesh", phone: "+919800088888" });
  const matchesDinesh = findExistingCustomer("Dinesh");
  assert(matchesDinesh.length === 0, 'Ramesh and Dinesh are treated as different customers');

  addCustomer({ name: "Pingu", phone: "+919800099999" });
  const matchesMingu = findExistingCustomer("Mingu");
  assert(matchesMingu.length === 0, 'Pingu and Mingu are treated as different customers');

  // Scenario 9.6: Mobile Number Priority
  // Aditi has phone +919876543210. Query for "Aditi" with phone +919876543222 -> Different mobile numbers, MUST NOT merge!
  const matchesAditiDiffPhone = findExistingCustomer("Aditi", "+919876543222");
  assert(matchesAditiDiffPhone.length === 0, 'Aditi with different mobile number is treated as a separate customer (no merge)');

  // Scenario 9.7: Existing: Pooja, Add: Puja -> Separate customers
  addCustomer({ name: "Pooja", phone: "+919800033333" });
  const matchesPuja = findExistingCustomer("Puja");
  assert(matchesPuja.length === 0, 'Pooja and Puja are treated as different customers (no match found)');

  // Scenario 9.8: Existing: Ankit, Add: Ankita -> Separate customers
  addCustomer({ name: "Ankit", phone: "+919800044444" });
  const matchesAnkita = findExistingCustomer("Ankita");
  assert(matchesAnkita.length === 0, 'Ankit and Ankita are treated as different customers (no match found)');

  // Scenario 9.9: Existing: Rohan, Add: Mohan -> Separate customers
  addCustomer({ name: "Rohan", phone: "+919800055555" });
  const matchesMohan = findExistingCustomer("Mohan");
  assert(matchesMohan.length === 0, 'Rohan and Mohan are treated as different customers (no match found)');

  // Test Case 10: Customer Deletion and Database Cleanup
  console.log('\n--- Test Case 10: Customer Deletion and Database Cleanup ---');
  resetTestDb();

  // Scenario 10.1: Delete Customer
  // Create a test customer first
  const newCust = addCustomer({ name: "Test User", phone: "+919800066666" });
  assert(newCust.id, 'Created new test customer successfully');
  
  // Record a transaction for them
  addTransaction({ 
    customerId: newCust.id, 
    amount: 1500, 
    type: 'credit', 
    description: 'Test transaction' 
  });
  
  // Check that balance, transaction, and reminders exist
  const dbBeforeDelete = readDb();
  const balanceBefore = dbBeforeDelete.outstanding_balances.find(b => b.customer_id === newCust.id);
  const txsBefore = dbBeforeDelete.transactions.filter(t => t.customer_id === newCust.id);
  const remsBefore = dbBeforeDelete.reminders.filter(r => r.customer_id === newCust.id);
  
  assert(balanceBefore && balanceBefore.balance === 1500, 'Test customer has outstanding balance');
  assert(txsBefore.length === 1, 'Test customer has 1 transaction');
  assert(remsBefore.length > 0, 'Test customer has reminders');

  // Deleting the customer
  const deleteRes = await deleteCustomer(newCust.id);
  assert(deleteRes === true, 'deleteCustomer returns true on successful deletion');

  // Verify DB references are cleaned up
  const dbAfterDelete = readDb();
  const deletedCustObj = dbAfterDelete.customers.find(c => c.id === newCust.id);
  const balanceAfter = dbAfterDelete.outstanding_balances.find(b => b.customer_id === newCust.id);
  const txsAfter = dbAfterDelete.transactions.filter(t => t.customer_id === newCust.id);
  const remsAfter = dbAfterDelete.reminders.filter(r => r.customer_id === newCust.id);

  assert(deletedCustObj && deletedCustObj.deleted === true, 'Customer profile soft-deleted (deleted = true)');
  assert(!getCustomers().find(c => c.id === newCust.id), 'Deleted customer excluded from getCustomers() directory list');
  assert(!balanceAfter, 'Customer balance entry removed from outstanding_balances');
  assert(txsAfter.length === 0, 'All customer transactions removed from transactions list');
  assert(remsAfter.length === 0, 'All customer reminders removed from reminders list');

  // Scenario 10.2: Cancel Deletion simulation
  // Ensure that if we do NOT call deleteCustomer, the data is not removed
  const matchRahul = getCustomers().find(c => c.id === 'test_cust_1');
  assert(matchRahul, 'Rahul Mechanic exists before deletion simulation');
  // Simulating cancel (no-op): Rahul should still exist
  assert(getCustomers().find(c => c.id === 'test_cust_1'), 'Rahul Mechanic remains intact when deletion is canceled');

  // Test Case 11: Voice Parsing and Filler Word Removal (Local NLP Engine)
  console.log('\n--- Test Case 11: Voice Parsing Filler Word Purge ---');
  // Temporarily delete api keys to force local engine fallback
  const savedKeys = process.env.GEMINI_API_KEYS;
  delete process.env.GEMINI_API_KEYS;
  const savedKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  const { extractTransactionFromVoice } = await import('../services/gemini.js');

  const testCases11 = [
    { 
      input: "Rahul ko 500 rupaye udhaar diye", 
      expectedName: "Rahul", 
      expectedAmount: 500, 
      expectedType: "credit" 
    },
    { 
      input: "Aarti se 300 rupaye wapas mile", 
      expectedName: "Aarti", 
      expectedAmount: 300, 
      expectedType: "collection" 
    },
    { 
      input: "Rakesh ko 1000 rupaye diye", 
      expectedName: "Rakesh", 
      expectedAmount: 1000, 
      expectedType: "credit" 
    },
    { 
      input: "Reshap ko 500 rupaye diye", 
      expectedName: "Reshap", 
      expectedAmount: 500, 
      expectedType: "credit" 
    },
    { 
      input: "Raj ko 500 diye", 
      expectedName: "Raj", 
      expectedAmount: 500, 
      expectedType: "credit" 
    },
    { 
      input: "Rahul Mechanic ko 1000 udhaar diye", 
      expectedName: "Rahul Mechanic", 
      expectedAmount: 1000, 
      expectedType: "credit" 
    },
    { 
      input: "Aditi ne 500 lotaaye", 
      expectedName: "Aditi", 
      expectedAmount: 500, 
      expectedType: "collection" 
    },
    { 
      input: "Rahul ne 1000 wapas diye", 
      expectedName: "Rahul", 
      expectedAmount: 1000, 
      expectedType: "collection" 
    },
    { 
      input: "Rahul ko 500 diye", 
      expectedName: "Rahul", 
      expectedAmount: 500, 
      expectedType: "credit" 
    },
    { 
      input: "Aditi ko 500 diye", 
      expectedName: "Aditi", 
      expectedAmount: 500, 
      expectedType: "credit" 
    },
    { 
      input: "Aditi ne 500 lautaye", 
      expectedName: "Aditi", 
      expectedAmount: 500, 
      expectedType: "collection" 
    },
    { 
      input: "Rahul ne 1000 chuka diye", 
      expectedName: "Rahul", 
      expectedAmount: 1000, 
      expectedType: "collection" 
    },
    { 
      input: "Raju ne 300 chuka diye", 
      expectedName: "Raju", 
      expectedAmount: 300, 
      expectedType: "collection" 
    },
    { 
      input: "Sanskriti ne 800 paise wapas diye", 
      expectedName: "Sanskriti", 
      expectedAmount: 800, 
      expectedType: "collection" 
    }
  ];

  for (const tc of testCases11) {
    const res = await extractTransactionFromVoice(tc.input, []);
    assert(res.name === tc.expectedName, `"${tc.input}" extracts name "${tc.expectedName}" (got: "${res.name}")`);
    assert(res.amount === tc.expectedAmount, `"${tc.input}" extracts amount ${tc.expectedAmount} (got: "${res.amount}")`);
    assert(res.type === tc.expectedType, `"${tc.input}" extracts type "${tc.expectedType}" (got: "${res.type}")`);
  }

  // Test Case 12: Rule-Based Customer Name Sanitization Layer
  console.log('\n--- Test Case 12: Rule-Based Customer Name Sanitization ---');
  const testCases12 = [
    { input: "Shivansh ko diye", expected: "Shivansh" },
    { input: "Shivansh ko die", expected: "Shivansh" },
    { input: "Sanskriti ko 800 diye", expected: "Sanskriti" },
    { input: "Rahul Mechanic ko 1000 udhaar diye", expected: "Rahul Mechanic" },
    { input: "Raju Milkman se 300 wapas mile", expected: "Raju Milkman" },
    { input: "Aditi ki payment", expected: "Aditi" },
    { input: "Amit Kumar ke 500", expected: "Amit Kumar" },
    { input: "Shivansh ne 500 rupaye liye", expected: "Shivansh" },
    { input: "Sanskriti ne 800 rupaye diye", expected: "Sanskriti" },
    { input: "Sanskriti ne 500 lotaaye", expected: "Sanskriti" },
    { input: "Raju ne 300 lautaaye", expected: "Raju" },
    { input: "Rahul ne 1000 wapas diye", expected: "Rahul" },
    { input: "Aditi ne 500 lautaye", expected: "Aditi" },
    { input: "Rahul ne 1000 chuka diye", expected: "Rahul" },
    { input: "Raju ne 300 chuka diye", expected: "Raju" },
    { input: "Sanskriti ne 800 paise wapas diye", expected: "Sanskriti" },
    { input: "Aarti ne 500 liye", expected: "Aarti" }
  ];

  for (const tc of testCases12) {
    const cleaned = sanitizeCustomerName(tc.input);
    assert(cleaned === tc.expected, `"${tc.input}" sanitizes to "${tc.expected}" (got: "${cleaned}")`);
  }

  // Test Case 13: Transaction Balance Calculation (Credit vs Collection)
  console.log('\n--- Test Case 13: Outstanding Balance Calculations ---');
  resetTestDb(); // Reset to clean state (Rahul Mechanic has 1000 balance, Raju Milkman has 0 balance)
  
  // 13.1 Add credit of 500 to Rahul Mechanic
  addTransaction({ 
    customerId: 'test_cust_1', 
    amount: 500, 
    type: 'credit', 
    description: 'Credit of 500' 
  });
  const ledgerRahul1 = getCustomerLedger('test_cust_1');
  assert(ledgerRahul1.customer.balance === 1500, 'Credit transaction increases outstanding balance (1000 + 500 = 1500)');

  // 13.2 Add collection of 300 from Rahul Mechanic
  addTransaction({
    customerId: 'test_cust_1',
    amount: 300,
    type: 'collection',
    description: 'Collection of 300'
  });
  const ledgerRahul2 = getCustomerLedger('test_cust_1');
  assert(ledgerRahul2.customer.balance === 1200, 'Collection transaction decreases outstanding balance (1500 - 300 = 1200)');

  // Test Case 14: Transaction Deletion and Recalculations
  console.log('\n--- Test Case 14: Transaction Deletion and Matching Confidence ---');
  
  // Get the last added collection transaction
  const txs = ledgerRahul2.transactions;
  const lastTx = txs[txs.length - 1]; // Collection transaction of 300
  
  const deleteTxRes = await deleteTransaction(lastTx.id);
  
  assert(deleteTxRes === true, 'deleteTransaction returns true on successful deletion');
  const ledgerRahul3 = getCustomerLedger('test_cust_1');
  // Balance should go back to 1500 (since the collection of 300 was deleted)
  assert(ledgerRahul3.customer.balance === 1500, 'Deleting collection transaction restores outstanding balance (1200 + 300 = 1500)');
  
  // Verify reminders have amount 1500
  const remsRahul = readDb().reminders.filter(r => r.customer_id === 'test_cust_1');
  assert(remsRahul.length > 0 && remsRahul[0].amount === 1500, 'Reminders recalculated with restored balance amount');

  // Verify similarity calculations for "Raj" vs "Raju"
  const distRajRaju = getLevenshteinDistance("raju", "raj");
  const similarityRajRaju = (Math.max("raju".length, "raj".length) - distRajRaju) / Math.max("raju".length, "raj".length);
  assert(similarityRajRaju === 0.75 && similarityRajRaju < 0.95, 'Raj vs Raju similarity score is 75% (below 95% confidence threshold)');

  // Verify similarity calculations for "Rishirh" vs "Raj"
  const distRajRish = getLevenshteinDistance("rishirh", "raj");
  const similarityRajRish = (Math.max("rishirh".length, "raj".length) - distRajRish) / Math.max("rishirh".length, "raj".length);
  assert(similarityRajRish < 0.95, 'Raj vs Rishirh similarity score is below 95% confidence threshold');

  // Test Case 15: Prefix Matching and Fuzzy Candidates
  console.log('\n--- Test Case 15: Prefix Matching & Fuzzy Candidates ---');
  
  // Set up specific customer records
  const db15 = readDb();
  db15.customers = [
    { id: "cust_sanskriti_1", name: "Sanskriti Sharma", displayName: "Sanskriti Sharma", normalizedName: "sanskritisharma", aliases: ["Sanskriti Sharma"], phone: "+919876543201", created_at: "2026-06-01T10:00:00.000Z" },
    { id: "cust_sanskriti_2", name: "Sanskriti Store", displayName: "Sanskriti Store", normalizedName: "sanskritistore", aliases: ["Sanskriti Store"], phone: "+919876543202", created_at: "2026-06-01T10:00:00.000Z" },
    { id: "cust_raju", name: "Raju", displayName: "Raju", normalizedName: "raju", aliases: ["Raju"], phone: "+919876543203", created_at: "2026-06-01T10:00:00.000Z" }
  ];
  db15.outstanding_balances = [
    { customer_id: "cust_sanskriti_1", balance: 0, last_updated: "2026-06-01T10:00:00.000Z" },
    { customer_id: "cust_sanskriti_2", balance: 0, last_updated: "2026-06-01T10:00:00.000Z" },
    { customer_id: "cust_raju", balance: 0, last_updated: "2026-06-01T10:00:00.000Z" }
  ];
  db15.transactions = [];
  writeDb(db15);

  // 15.1 Prefix matching: Sanskriti should return both Sanskriti Sharma and Sanskriti Store
  const matchesSanskriti = findExistingCustomer("Sanskriti");
  assert(matchesSanskriti.length === 2, `Sanskriti returns exactly 2 candidates (got: ${matchesSanskriti.length})`);
  const hasSharma = matchesSanskriti.some(c => c.id === "cust_sanskriti_1");
  const hasStore = matchesSanskriti.some(c => c.id === "cust_sanskriti_2");
  assert(hasSharma && hasStore, 'Sanskriti returns Sanskriti Sharma and Sanskriti Store');

  // 15.2 Fuzzy matching: Kaju should return Raju (similarity: 75% >= 70%)
  const matchesKaju = findExistingCustomer("Kaju");
  assert(matchesKaju.length === 1 && matchesKaju[0].id === "cust_raju", `Kaju matches Raju as a candidate (got match: ${matchesKaju[0]?.name})`);

  // 15.3 Bypass check when confirmNew is true (using addCustomer)
  const newCustConfirm = addCustomer({ name: "Raju", phone: "+919876543203", confirmNew: true });
  assert(newCustConfirm.id !== "cust_raju", `addCustomer with confirmNew=true bypasses duplicate check and creates new ID (got: ${newCustConfirm.id})`);

  // Test Case 16: Hindi/Hinglish Amount Recognition and Normalization
  console.log('\n--- Test Case 16: Hindi/Hinglish Amount Recognition ---');
  
  const testCases16 = [
    { 
      input: "Rahul ko paanch hazar diye", 
      expectedName: "Rahul", 
      expectedAmount: 5000, 
      expectedType: "credit" 
    },
    { 
      input: "Raju ne derh hazar lautaaye", 
      expectedName: "Raju", 
      expectedAmount: 1500, 
      expectedType: "collection" 
    },
    { 
      input: "Aditi ne dhai sau lotaye", 
      expectedName: "Aditi", 
      expectedAmount: 250, 
      expectedType: "collection" 
    },
    { 
      input: "Sanskriti ko sawa hazar diye", 
      expectedName: "Sanskriti", 
      expectedAmount: 1250, 
      expectedType: "credit" 
    },
    { 
      input: "Amit ko teen lakh diye", 
      expectedName: "Amit", 
      expectedAmount: 300000, 
      expectedType: "credit" 
    },
    { 
      input: "Rahul ko ek hazar diye", 
      expectedName: "Rahul", 
      expectedAmount: 1000, 
      expectedType: "credit" 
    },
    { 
      input: "Raju ne 1.5 hazar wapas diye", 
      expectedName: "Raju", 
      expectedAmount: 1500, 
      expectedType: "collection" 
    },
    { 
      input: "Rahul ko डेढ़ हज़ार credit kiya", 
      expectedName: "Rahul", 
      expectedAmount: 1500, 
      expectedType: "credit" 
    },
    { 
      input: "Raju ko ढाई हज़ार wapas diye", 
      expectedName: "Raju", 
      expectedAmount: 2500, 
      expectedType: "collection" 
    }
  ];

  for (const tc of testCases16) {
    const res = await extractTransactionFromVoice(tc.input, []);
    assert(res.name === tc.expectedName, `"${tc.input}" extracts name "${tc.expectedName}" (got: "${res.name}")`);
    assert(res.amount === tc.expectedAmount, `"${tc.input}" extracts amount ${tc.expectedAmount} (got: "${res.amount}")`);
    assert(res.type === tc.expectedType, `"${tc.input}" extracts type "${tc.expectedType}" (got: "${res.type}")`);
  }

  // Test Case 17: Combined Fractions, Name Cleanup & Type Classification Verification
  console.log('\n--- Test Case 17: Combined Fractions, Name Cleanup & Type Classification ---');
  
  const testCases17 = [
    {
      input: "Rahul ko hajar diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Rahul ko hazar diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Rahul ko hazaar diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Rahul ko hzaar diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Rahul ko hjaar diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Rahul ko हजार diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Rahul ko हज़ार diye",
      expectedName: "Rahul",
      expectedAmount: 1000,
      expectedType: "credit"
    },
    {
      input: "Sanskriti ko do hajar diye",
      expectedName: "Sanskriti",
      expectedAmount: 2000,
      expectedType: "credit"
    },
    {
      input: "Aditi ne ek hajar lotaye",
      expectedName: "Aditi",
      expectedAmount: 1000,
      expectedType: "collection"
    },
    { 
      input: "Rahul ko paune do hazar diye", 
      expectedName: "Rahul", 
      expectedAmount: 1750, 
      expectedType: "credit" 
    },
    { 
      input: "Aditi ne sawa do hazar payment kiya", 
      expectedName: "Aditi", 
      expectedAmount: 2250, 
      expectedType: "collection" 
    },
    { 
      input: "Amit ko paune teen hazar diye", 
      expectedName: "Amit", 
      expectedAmount: 2750, 
      expectedType: "credit" 
    },
    { 
      input: "Rahul ne sawa teen lakh wapas diye", 
      expectedName: "Rahul", 
      expectedAmount: 325000, 
      expectedType: "collection" 
    },
    {
      input: "Aditi ne amount diya",
      expectedName: "Aditi",
      expectedAmount: 0,
      expectedType: "collection"
    },
    {
      input: "Sanskriti ko maal diya",
      expectedName: "Sanskriti",
      expectedAmount: 0,
      expectedType: "credit"
    },
    {
      input: "Raju ko samaan diya",
      expectedName: "Raju",
      expectedAmount: 0,
      expectedType: "credit"
    },
    {
      input: "Pooja ne paise diye",
      expectedName: "Pooja",
      expectedAmount: 0,
      expectedType: "collection"
    },
    {
      input: "Mohan ne settle kiya",
      expectedName: "Mohan",
      expectedAmount: 0,
      expectedType: "collection"
    }
  ];

  for (const tc of testCases17) {
    const res = await extractTransactionFromVoice(tc.input, []);
    assert(res.name === tc.expectedName, `"${tc.input}" extracts name "${tc.expectedName}" (got: "${res.name}")`);
    assert(res.amount === tc.expectedAmount, `"${tc.input}" extracts amount ${tc.expectedAmount} (got: "${res.amount}")`);
    assert(res.type === tc.expectedType, `"${tc.input}" extracts type "${tc.expectedType}" (got: "${res.type}")`);
  }

  // Test Case 18: Account Isolation & Merchant Database Separation
  console.log('\n--- Test Case 18: Account Isolation & Merchant Database Separation ---');
  
  const emptyStructure = {
    users: [
      { id: "merchant_1", name: "Karan Kumar", business_name: "Karan Kirana Store", phone: "+919876543210" },
      { id: "merchant_2", name: "Aditi Sinha", business_name: "Aditi Kirana Store", phone: "+919876543210" }
    ],
    customers: [],
    transactions: [],
    outstanding_balances: [],
    reminders: [],
    daily_summaries: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(emptyStructure, null, 2), 'utf-8');

  // Create two isolated merchant spaces
  const m1 = "merchant_1";
  const m2 = "merchant_2";

  // Add customer for merchant_1
  const custM1 = addCustomer({ name: "Rahul Mechanic", phone: "+919800011111", alias: "Rahul", confirmNew: true, merchantId: m1 });
  // Add customer for merchant_2 with the exact same name to test overlap isolation
  const custM2 = addCustomer({ name: "Rahul Mechanic", phone: "+919800022222", alias: "Rahul", confirmNew: true, merchantId: m2 });

  assert(custM1.id !== custM2.id, 'Different merchants get distinct customer IDs even with identical names');

  // Verify getCustomers isolation
  const customersM1 = getCustomers(m1);
  const customersM2 = getCustomers(m2);

  assert(customersM1.length === 1 && customersM1[0].id === custM1.id, 'Merchant 1 only retrieves Merchant 1 customers');
  assert(customersM2.length === 1 && customersM2[0].id === custM2.id, 'Merchant 2 only retrieves Merchant 2 customers');

  // Verify lookup isolation
  const lookupM1 = findExistingCustomer("Rahul Mechanic", "", m1);
  const lookupM2 = findExistingCustomer("Rahul Mechanic", "", m2);

  assert(lookupM1.length === 1 && lookupM1[0].id === custM1.id, 'Merchant 1 lookup resolves only Merchant 1 customers');
  assert(lookupM2.length === 1 && lookupM2[0].id === custM2.id, 'Merchant 2 lookup resolves only Merchant 2 customers');

  // Add transaction for Merchant 1 customer
  addTransaction({ customerId: custM1.id, amount: 2000, type: "credit", description: "M1 loan", merchantId: m1 });
  // Add transaction for Merchant 2 customer
  addTransaction({ customerId: custM2.id, amount: 500, type: "credit", description: "M2 loan", merchantId: m2 });

  // Verify ledger and balance isolation
  const ledgerM1 = getCustomerLedger(custM1.id, m1);
  const ledgerM2 = getCustomerLedger(custM2.id, m2);

  assert(ledgerM1.transactions.length === 1 && ledgerM1.transactions[0].amount === 2000, 'Merchant 1 ledger shows correct transaction');
  assert(ledgerM2.transactions.length === 1 && ledgerM2.transactions[0].amount === 500, 'Merchant 2 ledger shows correct transaction');

  // Cross-access verification: query Merchant 1 customer using Merchant 2 ID
  const crossLedger = getCustomerLedger(custM1.id, m2);
  assert(crossLedger === null, 'Merchant 2 cannot access Merchant 1 customer ledger data');

  // Verify reminders isolation
  const remindersM1 = getReminders(m1);
  const remindersM2 = getReminders(m2);

  assert(remindersM1.length === 1 && remindersM1[0].amount === 2000, 'Merchant 1 retrieves only Merchant 1 reminders');
  assert(remindersM2.length === 1 && remindersM2[0].amount === 500, 'Merchant 2 retrieves only Merchant 2 reminders');

  // Test Case 19: Customer Detail Modifications and Validations
  console.log('\n--- Test Case 19: Customer Detail Modifications and Validations ---');
  resetTestDb(); // Reset to clean state (Rahul Mechanic has 1000 balance, Raju Milkman has 0 balance)
  const m1Test = 'merchant_1';
  
  // Set up pending reminders for Rahul Mechanic (id: test_cust_1)
  addTransaction({ customerId: 'test_cust_1', amount: 500, type: 'credit', description: 'Credit for reminder generation', merchantId: m1Test });
  
  const remindersBeforeUpdate = getReminders(m1Test).filter(r => r.customer_id === 'test_cust_1');
  assert(remindersBeforeUpdate.length > 0, 'Rahul Mechanic has pending reminders generated');
  
  // Import updateCustomer
  const { updateCustomer } = await import('../db.js');
  
  // 19.1 Verify valid update of details
  const updatedCust = updateCustomer('test_cust_1', {
    name: 'Rahul Updated',
    phone: '+919800099999',
    alias: 'Rahul U',
    address: '123 Test Street, New Delhi',
    notes: 'Important customer notes',
    customerType: 'Wholesaler',
    merchantId: m1Test
  });
  
  assert(updatedCust.name === 'Rahul Updated', 'Customer name updated successfully');
  assert(updatedCust.phone === '+919800099999', 'Customer phone updated successfully');
  assert(updatedCust.address === '123 Test Street, New Delhi', 'Customer address updated successfully');
  assert(updatedCust.notes === 'Important customer notes', 'Customer notes updated successfully');
  assert(updatedCust.customerType === 'Wholesaler', 'Customer type updated successfully');
  
  // Verify propagation to reminders
  const remindersAfterUpdate = getReminders(m1Test).filter(r => r.customer_id === 'test_cust_1');
  assert(remindersAfterUpdate.length > 0, 'Rahul Updated has pending reminders');
  assert(remindersAfterUpdate.every(r => r.customer_name === 'Rahul Updated' && r.customer_phone === '+919800099999'), 'Updated customer name and phone successfully propagated to pending reminders');

  // 19.2 Verify duplicate conflict prevention
  try {
    updateCustomer('test_cust_2', {
      name: 'Rahul Updated', // Conflict with Rahul Updated
      phone: '+919800099999',
      merchantId: m1Test
    });
    assert(false, 'Should throw error when updating name to match an existing customer');
  } catch (err) {
    assert(err.message.includes('already exists'), 'Duplicate name update blocked with correct message');
  }

  // 19.3 Verify short name validation error
  try {
    updateCustomer('test_cust_2', {
      name: 'R', // Short name (< 2 chars)
      phone: '+919800022222',
      merchantId: m1Test
    });
    assert(false, 'Should throw error when updating name to a string shorter than 2 characters');
  } catch (err) {
    assert(err.message.includes('at least 2 characters'), 'Short name update validation error blocked with correct message');
  }

  // 19.4 Verify invalid phone number format validation error
  try {
    updateCustomer('test_cust_2', {
      name: 'Raju Milkman',
      phone: '12345', // Invalid phone format
      merchantId: m1Test
    });
    assert(false, 'Should throw error when phone format is invalid');
  } catch (err) {
    assert(err.message.includes('Invalid phone number format') || err.message.includes('Invalid phone format'), 'Invalid phone number format blocked with correct message');
  }

  // 19.5 Verify customers created today are placed in Soft priority (0 days overdue)
  const cToday = addCustomer({ name: 'Today Customer', phone: '+919800033333', merchantId: m1Test });
  addTransaction({ customerId: cToday.id, amount: 100, type: 'credit', description: 'Credit today', merchantId: m1Test });
  const remindersToday = getReminders(m1Test).filter(r => r.customer_id === cToday.id);
  assert(remindersToday.length === 1, 'Should have exactly one reminder for Today Customer');
  assert(remindersToday[0].priority === 'Soft', `Today Customer priority should be Soft (got: ${remindersToday[0].priority})`);
  assert(remindersToday[0].days_overdue === 0, `Today Customer days overdue should be 0 (got: ${remindersToday[0].days_overdue})`);
  console.log('✅ [PASS] Customers created today fall into the Soft Priority bucket');

  // 19.6 Verify calendar-day overdue calculation and priority transitions (Soft -> Medium -> High)
  const cPast = addCustomer({ name: 'Past Customer', phone: '+919800044444', merchantId: m1Test });
  
  // Test case for 1 day overdue (yesterday) -> Soft
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  addTransaction({ customerId: cPast.id, amount: 100, type: 'credit', description: 'Credit yesterday', date: yesterday.toISOString(), merchantId: m1Test });
  const reminders1Day = getReminders(m1Test).filter(r => r.customer_id === cPast.id);
  assert(reminders1Day.length === 1 && reminders1Day[0].days_overdue === 1 && reminders1Day[0].priority === 'Soft', `Should be 1 day overdue and Soft priority (got days: ${reminders1Day[0]?.days_overdue}, priority: ${reminders1Day[0]?.priority})`);

  // Test case for 5 days overdue -> Medium
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const dbTest = readDb();
  dbTest.transactions = dbTest.transactions.filter(t => t.customer_id !== cPast.id);
  writeDb(dbTest);
  addTransaction({ customerId: cPast.id, amount: 100, type: 'credit', description: 'Credit 5 days ago', date: fiveDaysAgo.toISOString(), merchantId: m1Test });
  const reminders5Days = getReminders(m1Test).filter(r => r.customer_id === cPast.id);
  assert(reminders5Days.length === 1 && reminders5Days[0].days_overdue === 5 && reminders5Days[0].priority === 'Medium', `Should be 5 days overdue and Medium priority (got days: ${reminders5Days[0]?.days_overdue}, priority: ${reminders5Days[0]?.priority})`);

  // Test case for 11 days overdue -> High
  const elevenDaysAgo = new Date();
  elevenDaysAgo.setDate(elevenDaysAgo.getDate() - 11);
  const dbTest2 = readDb();
  dbTest2.transactions = dbTest2.transactions.filter(t => t.customer_id !== cPast.id);
  writeDb(dbTest2);
  addTransaction({ customerId: cPast.id, amount: 100, type: 'credit', description: 'Credit 11 days ago', date: elevenDaysAgo.toISOString(), merchantId: m1Test });
  const reminders11Days = getReminders(m1Test).filter(r => r.customer_id === cPast.id);
  assert(reminders11Days.length === 1 && reminders11Days[0].days_overdue === 11 && reminders11Days[0].priority === 'High', `Should be 11 days overdue and High priority (got days: ${reminders11Days[0]?.days_overdue}, priority: ${reminders11Days[0]?.priority})`);

  console.log('✅ [PASS] Calendar-day overdue calculation and priority transitions (Soft -> Medium -> High) verified successfully');

  // Test Case 20: FIFO Overdue Days Outstanding Calculation Fix
  console.log('\n--- Test Case 20: FIFO Overdue Days Outstanding Calculation ---');
  const cFifo = addCustomer({ name: 'FIFO Customer', phone: '+919800055555', merchantId: m1Test });
  
  // June 1 -> Credit 1000 (9 days ago)
  const june1 = new Date();
  june1.setDate(june1.getDate() - 9);
  addTransaction({ customerId: cFifo.id, amount: 1000, type: 'credit', description: 'June 1 credit', date: june1.toISOString(), merchantId: m1Test });
  
  // June 5 -> Credit 500 (5 days ago)
  const june5 = new Date();
  june5.setDate(june5.getDate() - 5);
  addTransaction({ customerId: cFifo.id, amount: 500, type: 'credit', description: 'June 5 credit', date: june5.toISOString(), merchantId: m1Test });
  
  // June 8 -> Collection 300 (2 days ago)
  const june8 = new Date();
  june8.setDate(june8.getDate() - 2);
  addTransaction({ customerId: cFifo.id, amount: 300, type: 'collection', description: 'June 8 collection', date: june8.toISOString(), merchantId: m1Test });
  
  // Balance: 1000 + 500 - 300 = 1200.
  // Oldest outstanding credit is still June 1 (9 days ago), since only 300 of it was recovered.
  let remindersFifo = getReminders(m1Test).filter(r => r.customer_id === cFifo.id);
  assert(remindersFifo.length === 1 && remindersFifo[0].days_overdue === 9 && remindersFifo[0].priority === 'Medium', 
    `FIFO Example 1: Should be 9 days overdue (from June 1 credit) and Medium priority (got days: ${remindersFifo[0]?.days_overdue}, priority: ${remindersFifo[0]?.priority})`);
  
  // June 9 -> Collection 700 (1 day ago) (Total collections = 1000)
  // This fully recovers June 1 credit (1000). Oldest outstanding is now June 5 (5 days ago).
  const june9 = new Date();
  june9.setDate(june9.getDate() - 1);
  addTransaction({ customerId: cFifo.id, amount: 700, type: 'collection', description: 'June 9 collection', date: june9.toISOString(), merchantId: m1Test });
  
  remindersFifo = getReminders(m1Test).filter(r => r.customer_id === cFifo.id);
  assert(remindersFifo.length === 1 && remindersFifo[0].days_overdue === 5 && remindersFifo[0].priority === 'Medium', 
    `FIFO Example 2: Should be 5 days overdue (from June 5 credit) and Medium priority (got days: ${remindersFifo[0]?.days_overdue}, priority: ${remindersFifo[0]?.priority})`);

  // June 10 -> Collection 500 (Total collections = 1500, balance = 0)
  // Fully settled. No reminders.
  addTransaction({ customerId: cFifo.id, amount: 500, type: 'collection', description: 'June 10 collection', merchantId: m1Test });
  remindersFifo = getReminders(m1Test).filter(r => r.customer_id === cFifo.id);
  assert(remindersFifo.length === 0, `FIFO Example 3: Customer is fully settled, should have no reminders (got: ${remindersFifo.length})`);

  console.log('✅ [PASS] FIFO outstanding credit date calculation verified successfully');

  // Test Case 21: Merchant Registration & Phone Uniqueness
  console.log('\n--- Test Case 21: Merchant Registration & Phone Uniqueness ---');
  const { addMerchant } = await import('../db.js');
  
  // Set up clean database
  const db21 = readDb();
  db21.users = [
    { id: "m_existing", name: "Existing Merchant", business_name: "Existing Store", phone: "+919876543210" }
  ];
  writeDb(db21);
  
  // 21.1: Register with unique phone
  try {
    const res = await addMerchant({
      id: "m_new",
      name: "New Merchant",
      business_name: "New Store",
      phone: "+918888888888"
    });
    assert(res.status === 'success' && res.id === 'm_new', 'Successfully registers merchant with unique phone');
  } catch (err) {
    assert(false, `Should register unique phone without error. Got: ${err.message}`);
  }
  
  // 21.2: Register duplicate phone suffix
  try {
    await addMerchant({
      id: "m_dup",
      name: "Duplicate Phone Merchant",
      business_name: "Duplicate Store",
      phone: "9876543210" // Matches +919876543210 suffix
    });
    assert(false, 'Should throw error when registering duplicate phone');
  } catch (err) {
    assert(err.message.includes('This mobile number is already registered.'), `Blocked duplicate phone with correct message (got: ${err.message})`);
  }
  
  // 21.3: Update same merchant with same phone
  try {
    const res = await addMerchant({
      id: "m_existing",
      name: "Existing Merchant Updated",
      business_name: "Existing Store Updated",
      phone: "+919876543210"
    });
    assert(res.status === 'success' && res.id === 'm_existing', 'Updating existing merchant with same phone succeeds');
  } catch (err) {
    assert(false, `Should update same merchant without error. Got: ${err.message}`);
  }

  // Restore keys
  if (savedKeys) process.env.GEMINI_API_KEYS = savedKeys;
  if (savedKey) process.env.GEMINI_API_KEY = savedKey;

} catch (err) {
  console.error('Test execution failed with error:', err);
  testFailures++;
} finally {
  if (fs.existsSync(BACKUP_FILE)) {
    fs.copyFileSync(BACKUP_FILE, DB_FILE);
    fs.unlinkSync(BACKUP_FILE);
    console.log('[TEST CLEANUP] Restored original db.json from backup.');
  }
}

console.log('\n--- Automated Test Summary ---');
if (testFailures === 0) {
  console.log('🎉 ALL MULTILINGUAL TESTS PASSED SUCCESSFULLY!');
  process.exit(0);
} else {
  console.error(`💥 ${testFailures} TEST(S) FAILED.`);
  process.exit(1);
}
