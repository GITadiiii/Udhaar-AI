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
  syncFromSupabase
} from './db.js';
import { 
  extractTransactionFromVoice, 
  generateDailySummary,
  resolveSemanticMatch,
  getCanonicalName
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

// Log incoming requests
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// API Endpoints

// 1. Get Customers (includes outstanding balance)
app.get('/api/customers', (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const dateStr = req.query.date; // YYYY-MM-DD
    const customers = getCustomers(merchantId, dateStr);
    res.json(customers);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 2. Add New Customer (with Canonical English standardization)
app.post('/api/customers', async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { name, phone, alias, confirmNew } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }

    const customers = getCustomers(merchantId);
    const canonicalName = await getCanonicalName(name, customers);
    const normCanonicalName = normalizeCustomerName(canonicalName);
    const matches = findExistingCustomer(canonicalName, phone, merchantId);

    // 1. Exact normalized name match: Always prevent duplication and return existing
    const exact = matches.find(m => normalizeCustomerName(m.name) === normCanonicalName);
    if (exact) {
      console.log(`[PREVENTED] Duplicate customer creation blocked at API layer for canonical name: "${canonicalName}" (original: "${name}"). Returning existing ID: ${exact.id}`);
      
      const { learnAlias } = await import('./db.js');
      learnAlias(exact.id, name);
      
      return res.json({ ...exact, was_existing: true });
    }

    // 2. Step 7: Try Gemini semantic matching if local matches is empty and confirmNew is false
    if (matches.length === 0 && !confirmNew) {
      const semanticMatchedId = await resolveSemanticMatch(canonicalName, customers);
      if (semanticMatchedId) {
        const matchedCust = customers.find(c => c.id === semanticMatchedId);
        if (matchedCust) {
          console.log(`[PREVENTED] Gemini semantic match resolved query "${canonicalName}" (original: "${name}") to existing customer "${matchedCust.name}" (ID: ${matchedCust.id})`);
          
          const { learnAlias } = await import('./db.js');
          learnAlias(matchedCust.id, canonicalName);
          learnAlias(matchedCust.id, name);
          
          return res.json({ ...matchedCust, was_existing: true });
        }
      }
    }

    // 3. Multiple matches or fuzzy matches found: return candidate list for smart resolution
    if (matches.length > 0 && !confirmNew) {
      console.log(`[LOOKUP] Matches found for new customer request canonical name "${canonicalName}": [${matches.map(m => m.name).join(', ')}]. Prompting smart resolution.`);
      return res.json({
        status: 'multiple_matches',
        candidates: matches
      });
    }

    // 4. No matches or merchant explicitly confirmed creation
    const customer = addCustomer({ name: canonicalName, phone, alias, aliases: [name], confirmNew, merchantId });
    res.status(201).json(customer);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 3. Get Detailed Customer Ledger
app.get('/api/customers/:id/ledger', (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const dateStr = req.query.date; // YYYY-MM-DD
    const ledger = getCustomerLedger(id, merchantId, dateStr);
    if (!ledger) {
      return res.status(404).json({ error: 'Customer ledger not found' });
    }
    res.json(ledger);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Customer details
app.put('/api/customers/:id', (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const { name, phone, alias, address, notes, customerType } = req.body;

    const updatedCustomer = updateCustomer(id, {
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
app.delete('/api/customers/:id', (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const success = deleteCustomer(id, merchantId);
    if (!success) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ status: 'success', message: 'Customer deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Transaction
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { id } = req.params;
    const { deleteTransaction } = await import('./db.js');
    const success = deleteTransaction(id, merchantId);
    if (!success) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ status: 'success', message: 'Transaction deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 4. Record a Transaction (Credit/Collection)
app.post('/api/transactions', (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { customerId, amount, type, description, date, aliasSpoken } = req.body;
    if (!customerId || !amount || !type) {
      return res.status(400).json({ error: 'customerId, amount, and type are required' });
    }
    if (type !== 'credit' && type !== 'collection') {
      return res.status(400).json({ error: "type must be 'credit' or 'collection'" });
    }
    const result = addTransaction({ customerId, amount, type, description, date, aliasSpoken, merchantId });
    res.status(201).json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 5. Process Voice Recording (AI Extraction & Duplicate Resolution check)
app.post('/api/voice/process', async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const { transcript } = req.body;
    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const customers = getCustomers(merchantId);
    const extracted = await extractTransactionFromVoice(transcript, customers);

    // Lookups should use the standardized canonicalName
    if (extracted.canonicalName) {
      let matches = findExistingCustomer(extracted.canonicalName, '', merchantId);

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
          learnAlias(match.id, extracted.canonicalName);
          learnAlias(match.id, extracted.name);

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
app.get('/api/summary/daily', async (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    // Default to the current system date in user local timezone
    const dateStr = req.query.date || getTodayStr();
    const targetDate = dateStr.slice(0, 10);
    
    const db = readDb();
    
    // Check if daily summary is already cached
    const existingSummary = (db.daily_summaries || []).find(
      s => s.date === targetDate && (s.merchant_id || 'merchant_1') === merchantId
    );
    if (existingSummary) {
      return res.json(existingSummary);
    }
    
    // Otherwise, generate a new daily summary
    const customers = getCustomers(merchantId, targetDate);
    
    // Safety fallback: if transaction lacks merchant_id, associate it by customer's merchant_id
    const customerMap = new Map((db.customers || []).map(c => [c.id, c]));
    const merchantTransactions = (db.transactions || []).filter(t => {
      const txMerchantId = t.merchant_id || customerMap.get(t.customer_id)?.merchant_id || 'merchant_1';
      return txMerchantId === merchantId;
    });
    
    const summaryText = await generateDailySummary(targetDate, merchantTransactions, customers);
    
    // Timezone-aware date matching using getLocalDateStr
    const todayTxs = merchantTransactions.filter(t => getLocalDateStr(t.date) === targetDate);
    const creditGiven = todayTxs.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
    const collections = todayTxs.filter(t => t.type === 'collection').reduce((sum, t) => sum + t.amount, 0);
    const netChange = creditGiven - collections;

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
app.get('/api/reminders', (req, res) => {
  try {
    const merchantId = getMerchantId(req);
    const dateStr = req.query.date; // YYYY-MM-DD
    const reminders = getReminders(merchantId, dateStr);
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start Server
syncFromSupabase().then(() => {
  mergeDuplicateCustomers();
  
  app.listen(PORT, () => {
    console.log(`Express server running on http://localhost:${PORT}`);
  });
});
