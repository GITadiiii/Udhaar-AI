const BOOT_START = Date.now();
let isFirstRequest = true;

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { supabase } from './supabase.js';
import { 
  getCustomers, 
  addCustomer, 
  getCustomerLedger, 
  addTransaction, 
  getReminders, 
  readDb, 
  writeDb,
  normalizeCustomerName,
  findExistingCustomer,
  mergeDuplicateCustomers,
  deleteCustomer,
  updateCustomer,
  getLevenshteinDistance,
  getLocalDateStr,
  getTodayStr,
  syncFromSupabase,
  getTransactions,
  toUUID
} from './db.js';
import { 
  extractTransactionFromVoice, 
  generateDailySummary,
  resolveSemanticMatch,
  getCanonicalName,
  getGeminiMetrics,
  isGeminiActive
} from './services/gemini.js';

dotenv.config();

function isConfidentMatch(customerName, queryName) {
  if (!customerName || !queryName) return false;
  const cn = customerName.toLowerCase().trim().replace(/\s+/g, ' ');
  const qn = queryName.toLowerCase().trim().replace(/\s+/g, ' ');
  if (cn === qn) return true;

  const dist = getLevenshteinDistance(cn, qn);
  const maxLen = Math.max(cn.length, qn.length);
  const similarity = maxLen > 0 ? (maxLen - dist) / maxLen : 0;
  return similarity >= 0.95;
}

// getTodayStr is now imported from db.js

const getMerchantId = (req) => {
  return req.headers['x-merchant-id'] || 'merchant_1';
};

const validateMerchant = async (req, res, next) => {
  const merchantId = getMerchantId(req);
  if (!merchantId) {
    return res.status(403).json({ error: 'Merchant ID is required', code: 'MERCHANT_MISSING' });
  }

  try {
    const db = readDb();
    const existsLocal = db.users && db.users.some(u => u.id === merchantId);

    let existsSupabase = false;
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.DISABLE_SUPABASE_SYNC !== 'true') {
      const { supabase } = await import('./supabase.js');
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('id', toUUID(merchantId))
        .maybeSingle();
      if (!error && data) {
        existsSupabase = true;
      }
    } else {
      existsSupabase = true;
    }

    if (!existsLocal && !existsSupabase) {
      console.error(`[MERCHANT VALIDATION FAILURE] Merchant ID: ${merchantId} does not exist in users table.`);
      return res.status(403).json({
        error: 'Merchant record missing from database.',
        code: 'MERCHANT_MISSING'
      });
    }
  } catch (err) {
    console.error('[MERCHANT VALIDATION ERROR]', err.message);
  }

  next();
};

const app = express();
app.get('/api/test-supabase', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*');

    if (error) throw error;

    res.json(data);
  } catch (err) {
    res.status(500).json({
      error: err.message
    });
  }
});

const PORT = process.env.PORT || 5000;

app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "x-merchant-id"]
}));
app.use(express.json());

// Log incoming requests and record performance metrics
app.use((req, res, next) => {
  const start = Date.now();
  if (isFirstRequest) {
    isFirstRequest = false;
    const coldStartDuration = Date.now() - BOOT_START;
    console.log(`[COLD START DIAGNOSTIC] First request received at server. Time since boot start: ${coldStartDuration}ms`);
  }
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[API LOG] ${req.method} ${req.originalUrl} - Status: ${res.statusCode} - Duration: ${duration}ms`);
  });
  next();
});

// API Endpoints

// User/Merchant registration endpoint
app.post('/api/users', async (req, res) => {
  const startTime = Date.now();
  console.log(`[REGISTRATION START] ID: ${req.body.id}, Name: ${req.body.name}, Phone: ${req.body.phone}`);
  try {
    const { id, name, businessName, phone } = req.body;
    if (!id || !name || !businessName) {
      return res.status(400).json({ error: 'id, name, and businessName are required' });
    }
    
    const { addMerchant } = await import('./db.js');
    const result = await addMerchant({ id, name, business_name: businessName, phone });
    console.log(`[REGISTRATION SUCCESS] in ${Date.now() - startTime}ms`);
    res.status(201).json(result);
  } catch (error) {
    console.error(`[REGISTRATION FAILURE] ${error.message} in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: error.message });
  }
});

// Get Gemini Performance Metrics
app.get('/api/gemini/metrics', (req, res) => {
  res.json(getGeminiMetrics());
});

// 1. Get Customers (includes outstanding balance)
app.get('/api/customers', validateMerchant, async (req, res) => {
  const startTime = Date.now();
  const merchantId = getMerchantId(req);
  console.log(`[CUSTOMERS START] Merchant: ${merchantId}`);
  try {
    const dateStr = req.query.date; // YYYY-MM-DD
    const customers = await getCustomers(merchantId, dateStr);
    console.log(`[CUSTOMERS END] Merchant: ${merchantId} Duration: ${Date.now() - startTime}ms`);
    res.json(customers);
  } catch (error) {
    console.error(`[CUSTOMERS FAILURE] Merchant: ${merchantId} Error: ${error.message} in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: error.message });
  }
});

// Get All Transactions for Merchant
app.get('/api/transactions', validateMerchant, async (req, res) => {
  const startTime = Date.now();
  const merchantId = getMerchantId(req);
  console.log(`[DASHBOARD REFRESH START] Get Transactions. Merchant: ${merchantId}`);
  try {
    const dateStr = req.query.date; // YYYY-MM-DD
    const transactions = await getTransactions(merchantId, dateStr);
    console.log(`[DASHBOARD REFRESH SUCCESS] Get Transactions. Merchant: ${merchantId} in ${Date.now() - startTime}ms`);
    res.json(transactions);
  } catch (error) {
    console.error(`[DASHBOARD REFRESH FAILURE] Get Transactions. Merchant: ${merchantId} Error: ${error.message} in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: error.message });
  }
});

// 2. Add New Customer (with Canonical English standardization)
app.post('/api/customers', validateMerchant, async (req, res) => {
  const startTime = Date.now();
  const merchantId = getMerchantId(req);
  const { name, phone, alias, confirmNew } = req.body;
  
  console.log(`[CUSTOMER CREATE START] Name: ${name}, Phone: ${phone || 'none'}, confirmNew: ${!!confirmNew}, Merchant: ${merchantId}`);
  
  try {
    if (!name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    const customers = await getCustomers(merchantId);

    // If confirmNew is true, bypass slow Gemini lookup and check immediately
    if (confirmNew) {
      const { sanitizeCustomerName } = await import('./db.js');
      const clean = sanitizeCustomerName(name);
      const titleCased = clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.substring(1)).join(' ');
      
      const customer = await addCustomer({ 
        name: titleCased, 
        phone, 
        alias, 
        aliases: [name], 
        confirmNew: true, 
        merchantId,
        preloadedCustomers: customers
      });
      console.log(`[CUSTOMER INSERT SUCCESS] in ${Date.now() - startTime}ms`);
      console.log(`[CUSTOMER RESPONSE SENT] in ${Date.now() - startTime}ms`);
      console.log(`[TOTAL DURATION] customer creation total: ${Date.now() - startTime}ms`);
      return res.status(201).json(customer);
    }

    // Standard flow (confirmNew is false)
    // 1. Clean customer name locally first
    const { sanitizeCustomerName } = await import('./db.js');
    const localCanonicalName = sanitizeCustomerName(name);
    const normLocalName = normalizeCustomerName(localCanonicalName);

    // Rule B: Check if same mobile number exists
    const normPhone = phone ? phone.replace(/\D/g, '') : '';
    let phoneMatch = null;
    if (normPhone && normPhone.length >= 10) {
      phoneMatch = customers.find(c => {
        if (c.deleted) return false;
        const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
        return cp && cp.endsWith(normPhone.slice(-10));
      });
    }

    if (phoneMatch) {
      console.log(`[DUPLICATE CHECK]
Input Name: ${localCanonicalName}
Matched Name: ${phoneMatch.name}
Similarity Score: 1.00 (Phone Match)
Decision: Block`);
      console.log(`[PREVENTED] Duplicate customer creation blocked at API layer (Phone Match) for: "${localCanonicalName}" (phone: "${phone}"). Returning existing ID: ${phoneMatch.id}`);
      console.log(`[CUSTOMER RESPONSE SENT] in ${Date.now() - startTime}ms`);
      return res.json({ ...phoneMatch, was_existing: true });
    }

    // Rule A: Check if exact normalized name match exists
    const exactNameMatch = customers.find(c => 
      !c.deleted && 
      (normalizeCustomerName(c.name) === normLocalName || 
       (c.aliases || []).some(a => normalizeCustomerName(a) === normLocalName))
    );

    if (exactNameMatch) {
      console.log(`[DUPLICATE CHECK]
Input Name: ${localCanonicalName}
Matched Name: ${exactNameMatch.name}
Similarity Score: 1.00 (Exact Name Match)
Decision: Block`);
      console.log(`[PREVENTED] Duplicate customer creation blocked at API layer (Local Exact Match) for: "${localCanonicalName}" (original: "${name}"). Returning existing ID: ${exactNameMatch.id}`);
      const { learnAlias } = await import('./db.js');
      learnAlias(exactNameMatch.id, name);
      console.log(`[CUSTOMER RESPONSE SENT] in ${Date.now() - startTime}ms`);
      return res.json({ ...exactNameMatch, was_existing: true });
    }

    // Perform local match using local canonical name to find fuzzy candidates
    const matches = await findExistingCustomer(localCanonicalName, phone, merchantId, customers);
    const highConfidenceMatches = [];

    for (const m of matches) {
      if (m.id === exactNameMatch?.id || m.id === phoneMatch?.id) continue;
      const mn = normalizeCustomerName(m.name);
      
      // Calculate similarity score
      const dist = getLevenshteinDistance(mn, normLocalName);
      const maxLen = Math.max(mn.length, normLocalName.length);
      const similarity = maxLen > 0 ? (maxLen - dist) / maxLen : 0;

      let decision = 'Allow';
      const isHighConfidence = (similarity >= 0.95);
      
      if (isHighConfidence) {
        decision = 'Block';
        highConfidenceMatches.push(m);
      }

      console.log(`[DUPLICATE CHECK]
Input Name: ${localCanonicalName}
Matched Name: ${m.name}
Similarity Score: ${similarity.toFixed(2)}
Decision: ${decision}`);
    }

    // Only block if high confidence duplicate matches are found
    if (highConfidenceMatches.length > 0) {
      console.log(`[LOOKUP] High confidence local matches found for new customer request: [${highConfidenceMatches.map(m => m.name).join(', ')}]. Prompting smart resolution.`);
      console.log(`[CUSTOMER RESPONSE SENT] in ${Date.now() - startTime}ms`);
      return res.json({
        status: 'multiple_matches',
        candidates: highConfidenceMatches
      });
    }

    // 3. Create the customer profile immediately using local canonical name (takes ~150-300ms)
    const customer = await addCustomer({ 
      name: localCanonicalName, 
      phone, 
      alias, 
      aliases: [name], 
      confirmNew: false, 
      merchantId,
      preloadedCustomers: customers
    });
    
    console.log(`[CUSTOMER INSERT SUCCESS] (Async AI enrichment queued) in ${Date.now() - startTime}ms`);
    console.log(`[CUSTOMER RESPONSE SENT] in ${Date.now() - startTime}ms`);
    
    // Return HTTP 201 response immediately to the client
    res.status(201).json(customer);

    // 4. Run AI enrichment and semantic duplicate matching in the background
    // Defer to low-priority queue to keep customer creation extremely fast
    setTimeout(async () => {
      if (!isGeminiActive()) {
        console.log(`[BACKGROUND AI] Gemini is currently disabled (Quota Exhausted/Circuit Open). Skipping background enrichment.`);
        return;
      }

      const bgStartTime = Date.now();
      try {
        console.log(`[BACKGROUND AI START] Standardizing customer ID: ${customer.id} ("${localCanonicalName}")`);
        
        // Refresh customer list to ensure we have latest records in memory
        const currentCustomers = await getCustomers(merchantId);
        
        // Step A: Standardize to canonical English name using Gemini
        const canonicalName = await getCanonicalName(name, currentCustomers);
        
        let targetName = localCanonicalName;
        
        if (canonicalName && canonicalName !== localCanonicalName && canonicalName !== 'Unknown Customer') {
          targetName = canonicalName;
          console.log(`[BACKGROUND AI] Gemini standardized name to: "${canonicalName}" (was: "${localCanonicalName}")`);
          
          // Update customer display name and aliases
          const { updateCustomerNameInDb } = await import('./db.js');
          await updateCustomerNameInDb(customer.id, canonicalName, merchantId);
        }

        // Step B: Run Gemini semantic duplicate checks
        const semanticMatchedId = await resolveSemanticMatch(targetName, currentCustomers.filter(c => c.id !== customer.id));
        if (semanticMatchedId) {
          const matchedCust = currentCustomers.find(c => c.id === semanticMatchedId);
          if (matchedCust) {
            console.log(`[BACKGROUND AI DETECTED DUPLICATE] Merging duplicate customer ID ${customer.id} ("${targetName}") into master customer ${matchedCust.id} ("${matchedCust.name}")`);
            
            // Execute background auto-merge consolidation
            const { mergeSpecificCustomers } = await import('./db.js');
            await mergeSpecificCustomers(matchedCust.id, customer.id, merchantId);
            
            console.log(`[BACKGROUND AI MERGE SUCCESS] Consolidating complete for merchant ${merchantId}`);
          }
        }
        
        console.log(`[BACKGROUND AI SUCCESS] Customer ID ${customer.id} processed in ${Date.now() - bgStartTime}ms`);
      } catch (bgErr) {
        console.error(`[BACKGROUND AI ERROR] Enrichment or merge failed: ${bgErr.message}`);
      }
    }, 50);
  } catch (error) {
    console.error(`[CUSTOMER CREATE FAILURE] ${error.message} in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: error.message });
  }
});

// 3. Get Detailed Customer Ledger
app.get('/api/customers/:id/ledger', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const dateStr = req.query.date; // YYYY-MM-DD
    const ledger = await getCustomerLedger(id, merchantId, dateStr);
    if (!ledger) {
      return res.status(404).json({ error: 'Customer ledger not found' });
    }
    res.json(ledger);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Customer details
app.put('/api/customers/:id', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const { name, phone, alias, address, notes, customerType } = req.body;

    const updatedCustomer = await updateCustomer(id, {
      name,
      phone,
      alias,
      address,
      notes,
      customerType,
      merchantId
    });

    res.json(updatedCustomer);
  } catch (error) {
    if (error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
    } else {
      res.status(400).json({ error: error.message });
    }
  }
});

// Delete Customer (and cleanup associated records)
app.delete('/api/customers/:id', validateMerchant, async (req, res) => {
  const startTime = Date.now();
  const merchantId = getMerchantId(req);
  const { id } = req.params;
  console.log(`[CUSTOMER DELETE START] ID: ${id}, Merchant: ${merchantId}`);
  try {
    const success = await deleteCustomer(id, merchantId);
    if (!success) {
      console.log(`[CUSTOMER DELETE FAILED] ID: ${id} not found in ${Date.now() - startTime}ms`);
      return res.status(404).json({ error: 'Customer not found' });
    }
    console.log(`[CUSTOMER DELETE SUCCESS] in ${Date.now() - startTime}ms`);
    res.json({ status: 'success', message: 'Customer deleted successfully' });
  } catch (error) {
    console.error(`[CUSTOMER DELETE FAILURE] ${error.message} in ${Date.now() - startTime}ms`);
    res.status(500).json({ error: error.message });
  }
});

// Delete Transaction
app.delete('/api/transactions/:id', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const { deleteTransaction } = await import('./db.js');
    const success = await deleteTransaction(id, merchantId);
    if (!success) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ status: 'success', message: 'Transaction deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Record a Transaction (Credit/Collection)
app.post('/api/transactions', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { customerId, amount, type, description, date, aliasSpoken } = req.body;
    if (!customerId || !amount || !type) {
      return res.status(400).json({ error: 'customerId, amount, and type are required' });
    }
    if (type !== 'credit' && type !== 'collection') {
      return res.status(400).json({ error: "type must be 'credit' or 'collection'" });
    }
    const result = await addTransaction({ customerId, amount, type, description, date, aliasSpoken, merchantId });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Process Voice Recording (AI Extraction & Duplicate Resolution check)
app.post('/api/voice/process', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const customers = await getCustomers(merchantId);
    const extracted = await extractTransactionFromVoice(transcript, customers);

    // Lookups should use the standardized canonicalName, passing preloaded customers list to avoid duplicate DB reads
    if (extracted.canonicalName) {
      let matches = await findExistingCustomer(extracted.canonicalName, '', merchantId, customers);

      // If local matches is empty, try Step 7: Gemini Semantic match fallback
      if (matches.length === 0) {
        const semanticMatchedId = await resolveSemanticMatch(extracted.canonicalName, customers);
        if (semanticMatchedId) {
          const matchedCust = customers.find(c => c.id === semanticMatchedId);
          if (matchedCust) {
            matches = [matchedCust];
          }
        }
      }

      if (matches.length === 1) {
        const match = matches[0];
        const matchName = match.name;
        
        // Check if there's a mobile phone match or it matches with >= 95% similarity
        const matchPhone = match.phone ? match.phone.replace(/\D/g, '') : '';
        const extPhone = extracted.phone ? extracted.phone.replace(/\D/g, '') : '';
        const phoneMatch = matchPhone && extPhone && matchPhone.endsWith(extPhone.slice(-10));
        
        const hasAliasMatch = (match.aliases || []).some(
          a => a.toLowerCase() === (extracted.canonicalName || '').toLowerCase() ||
               a.toLowerCase() === (extracted.name || '').toLowerCase()
        );
        
        if (phoneMatch || hasAliasMatch || isConfidentMatch(matchName, extracted.canonicalName) || isConfidentMatch(matchName, extracted.name)) {
          console.log(`[MATCHED] Voice transaction uniquely matched customer: "${match.name}" (ID: ${match.id})`);
          
          const { learnAlias } = await import('./db.js');
          await learnAlias(match.id, extracted.canonicalName);
          await learnAlias(match.id, extracted.name);

          return res.json({
            ...extracted,
            matchedCustomer: match,
            name: match.name,
            status: 'success'
          });
        } else {
          console.log(`[CANDIDATE] Match similarity below 95% for query: "${extracted.canonicalName}" and match: "${matchName}". Treating as candidate.`);
          return res.json({
            ...extracted,
            matchedCustomer: null,
            status: 'multiple_matches',
            candidates: matches
          });
        }
      } else if (matches.length > 1) {
        // Multiple matches: Trigger Smart Customer Resolution candidate overlay
        console.log(`[LOOKUP] Smart Customer Resolution triggered. Multiple candidates for name "${extracted.canonicalName}": [${matches.map(m => m.name).join(', ')}]`);
        return res.json({
          ...extracted,
          matchedCustomer: null,
          status: 'multiple_matches',
          candidates: matches
        });
      }
    }

    res.json({
      ...extracted,
      name: extracted.canonicalName || extracted.name,
      status: 'success'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 6. Get AI Daily Summary
app.get('/api/summary/daily', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    // Default to the current system date in user local timezone
    const dateStr = req.query.date || getTodayStr();
    const targetDate = dateStr.slice(0, 10);
    
    const db = readDb();
    
    // Check if daily summary is already cached
    let existingSummary = null;
    if (process.env.DISABLE_SUPABASE_SYNC !== 'true' && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      try {
        const { supabase } = await import('./supabase.js');
        const summaryUuid = toUUID(`${merchantId}_${targetDate}`);
        const { data, error } = await supabase
          .from('daily_summaries')
          .select('*')
          .eq('id', summaryUuid)
          .maybeSingle();
        if (!error && data) {
          existingSummary = {
            date: data.date,
            merchant_id: merchantId,
            credit_given: parseFloat(data.credit_given),
            collections: parseFloat(data.collections),
            net_change: parseFloat(data.net_change),
            summary_text: data.summary_text,
            created_at: data.created_at
          };
        }
      } catch (e) {
        console.error('[SUPABASE] Failed to fetch cached summary:', e.message);
      }
    } else {
      existingSummary = (db.daily_summaries || []).find(
        s => s.date === targetDate && (s.merchant_id || 'merchant_1') === merchantId
      );
    }
    
    if (existingSummary) {
      return res.json(existingSummary);
    }
    
    // Otherwise, generate a new daily summary in parallel
    const [merchantTransactions, customers] = await Promise.all([
      getTransactions(merchantId, targetDate),
      getCustomers(merchantId, targetDate)
    ]);
    
    const summaryText = await generateDailySummary(targetDate, merchantTransactions, customers);
    
    // Timezone-aware date matching using getLocalDateStr
    const todayTxs = merchantTransactions.filter(t => getLocalDateStr(t.date) === targetDate);
    const creditGiven = todayTxs.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
    const collections = todayTxs.filter(t => t.type === 'collection').reduce((sum, t) => sum + t.amount, 0);
    const netChange = creditGiven - collections;

    console.log(`[AI SUMMARY GENERATION]
      Merchant ID: ${merchantId}
      Selected Date: ${targetDate}
      Transaction Count: ${todayTxs.length}
      Credit Total: ₹${creditGiven}
      Collection Total: ₹${collections}
      Outstanding Total: ₹${customers.reduce((sum, c) => sum + c.balance, 0)}
    `);

    const newSummary = {
      date: targetDate,
      merchant_id: merchantId,
      credit_given: creditGiven,
      collections: collections,
      net_change: netChange,
      summary_text: summaryText,
      created_at: new Date().toISOString()
    };

    // Clean up any stale summary for this date and merchant to avoid duplicates, then add
    db.daily_summaries = (db.daily_summaries || []).filter(
      s => !(s.date === targetDate && (s.merchant_id || 'merchant_1') === merchantId)
    );
    db.daily_summaries.push(newSummary);
    writeDb(db);

    res.json(newSummary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 7. Get Reminders
app.get('/api/reminders', validateMerchant, async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const dateStr = req.query.date; // YYYY-MM-DD
    const reminders = await getReminders(merchantId, dateStr);
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
async function startServer() {
  // Start listening immediately to avoid blocking cold starts
  app.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
    console.log(`[BOOT] Server listening initialized in ${Date.now() - BOOT_START}ms.`);
    
    // Trigger background initialization tasks
    runBackgroundInitialization();
  });
}

async function runBackgroundInitialization() {
  if (process.env.DISABLE_SUPABASE_SYNC !== 'true' && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    console.log('[STARTUP] Running Supabase schema validation and initial synchronization in background...');
    try {
      const { supabase } = await import('./supabase.js');
      const schema = {
        users: ['id', 'name', 'business_name', 'phone', 'created_at'],
        customers: ['id', 'merchant_id', 'name', 'phone', 'created_at', 'alias'],
        transactions: ['id', 'merchant_id', 'customer_id', 'amount', 'type', 'description', 'date'],
        outstanding_balances: ['customer_id', 'merchant_id', 'balance', 'last_updated'],
        reminders: ['id', 'merchant_id', 'customer_id', 'amount', 'due_date', 'days_overdue', 'priority', 'status'],
        daily_summaries: ['id', 'merchant_id', 'date', 'credit_given', 'collections', 'net_change', 'summary_text', 'created_at']
      };

      const errors = [];
      // Run table verification concurrently to speed up checks
      await Promise.all(Object.entries(schema).map(async ([table, columns]) => {
        for (const column of columns) {
          const { error } = await supabase.from(table).select(column).limit(1);
          if (error) {
            if (error.code === '42P01') {
              errors.push(`Table "${table}" is missing.`);
              break;
            } else if (error.code === '42703' || error.message.includes('does not exist')) {
              errors.push(`Column "${column}" in table "${table}" is missing.`);
            } else {
              errors.push(`Error checking ${table}.${column}: ${error.message} (code ${error.code})`);
            }
          }
        }
      }));

      if (errors.length > 0) {
        console.error('\n❌ CRITICAL SCHEMA ERROR: Supabase database schema is out of sync!');
        errors.forEach(err => console.error(`  - ${err}`));
        console.error('\nPlease run the migration SQL script in your Supabase SQL Editor to align the schema.\n');
        process.exit(1);
      } else {
        console.log('✅ Supabase Schema Validation Passed: All tables and columns match.');
        console.log('[STARTUP] Syncing database state from Supabase in background...');
        const syncStart = Date.now();
        await syncFromSupabase();
        console.log(`[STARTUP] Initial database sync completed in ${Date.now() - syncStart}ms.`);
      }
    } catch (validationErr) {
      console.warn('⚠️ [STARTUP WARNING] Failed to complete Supabase schema validation or initial sync in background:', validationErr.message);
    }
  } else {
    console.log('ℹ️ Supabase integration is disabled or credentials not provided. Running in local db.json-only fallback mode.');
  }

  // Run merge duplicate customers scanner asynchronously in background
  setTimeout(() => {
    console.log('[STARTUP] Running background merge duplicate customers scanner...');
    try {
      mergeDuplicateCustomers();
      console.log('[STARTUP] Background merge duplicate customers scanner completed.');
    } catch (err) {
      console.error('[STARTUP ERROR] Background merge duplicate customers failed:', err.message);
    }
  }, 1000);
}

startServer();
