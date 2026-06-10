import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_FILE = path.join(__dirname, 'db.json');

// Ensure db.json exists, if not create it with initial empty structure
if (!fs.existsSync(DB_FILE)) {
  const initialStructure = {
    users: [{ id: "merchant_1", name: "Karan Kumar", business_name: "Karan Kirana Store", phone: "+919876543210" }],
    customers: [],
    transactions: [],
    outstanding_balances: [],
    reminders: [],
    daily_summaries: []
  };
  fs.writeFileSync(DB_FILE, JSON.stringify(initialStructure, null, 2), 'utf-8');
}

export function readDb() {
  try {
    const data = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return {};
  }
}

export function writeDb(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error writing to database file:', error);
    return false;
  }
}

// ----------------------------------------------------
// Core Helper & Search Functions for Customer Uniqueness
// ----------------------------------------------------

/**
 * Strips all spaces and converts to lowercase for unique key identifiers
 */
export function getNormalizedNameIdentifier(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '');
}

/**
 * Phonetic Devanagari to English phonetic transliteration solver
 */
export function transliterateHindiToEnglish(text) {
  if (!text) return '';
  
  // Skip if it contains no Devanagari characters (Unicode range U+0900 to U+097F)
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (!hasDevanagari) return text.toLowerCase().trim().replace(/\s+/g, ' ');

  const vowels = {
    'अ': 'a', 'आ': 'aa', 'इ': 'i', 'ई': 'ee', 'उ': 'u', 'ऊ': 'oo', 'ऋ': 'ri', 'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au'
  };
  
  const matras = {
    'ा': 'a', 'ि': 'i', 'ी': 'ee', 'ु': 'u', 'ू': 'oo', 'ृ': 'ri', 'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au', 'ं': 'n', 'ः': 'h'
  };

  const consonants = {
    'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'n',
    'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'n',
    'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
    'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
    'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
    'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
    'ळ': 'l'
  };

  let result = '';
  let i = 0;
  
  while (i < text.length) {
    const char = text[i];
    
    if (vowels[char]) {
      result += vowels[char];
      i++;
    } 
    else if (consonants[char]) {
      let ph = consonants[char];
      let nextChar = text[i + 1];
      
      if (nextChar === '्') {
        result += ph;
        i += 2;
      } else if (matras[nextChar]) {
        result += ph + matras[nextChar];
        i += 2;
      } else if (nextChar && consonants[nextChar]) {
        result += ph + 'a';
        i++;
      } else {
        result += ph;
        i++;
      }
    } 
    else {
      result += matras[char] || char;
      i++;
    }
  }

  return result.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Generates a simplified phonetic key to match name variations across English and Hindi transliterations.
 */
export function getPhoneticKey(text) {
  if (!text) return '';
  let clean = text.toLowerCase().trim().replace(/[^a-z0-9\s]/g, '');
  
  // Normalize common phonetic spelling differences between Hindi transliterations and English
  clean = clean
    .replace(/ch/g, 'k')
    .replace(/c/g, 'k')
    .replace(/q/g, 'k')
    .replace(/sh/g, 's')
    .replace(/z/g, 'j')
    .replace(/y/g, 'i')
    .replace(/v/g, 'w')
    .replace(/ph/g, 'f')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/aa/g, 'a')
    .replace(/(.)\1+/g, '$1'); // deduplicate letters

  if (clean.length === 0) return '';
  
  const firstChar = clean[0];
  let rest = clean.substring(1);
  rest = rest.replace(/[aeiou]/g, '');
  
  return (firstChar + rest).replace(/\s+/g, '');
}

/**
 * Normalizes customer name: converts to lowercase, trims, collapses multiple spaces
 */
export function normalizeCustomerName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Rule-based pre-save and pre-process name sanitization layer.
 * Removes all transaction-related words, prepositions, numbers, and cleans whitespace.
 */
export function sanitizeCustomerName(name) {
  if (!name) return '';
  
  // 1. Remove numbers
  let clean = name.replace(/\d+/g, '');

  // 2. Remove blacklisted transaction words (whole words only)
  const blacklistRegex = /\b(ko\s+diye|ko\s+diya|ko\s+die|de\s+diya|de\s+diye|de\s+die|le\s+liye|se\s+liya|wapas\s+mila|wapas\s+mile|paisa\s+diya|paisa\s+liya|laut\s+aae|laut\s+aye|laut\s+ae|se\s+mile|ne\s+diye|ne\s+die|laut\s+aaya|laut\s+aaye|paise\s+lautaye|paisa\s+lautaya|paisa\s+lautaye|payment\s+receive\s+hua|receive\s+hua|receive\s+huye|jama\s+karaya|chuka\s+diya|chuka\s+diye|paise\s+wapas\s+diye|paisa\s+diya\s+wapas|credit\s+diya|ko|ki|ke|ne|le|lie|liye|liya|die|diya|diye|udhaar|udhar|rupaye|rupees|paisa|se|mila|mile|wapas|wps|received|paid|payment|lotaaye|lotaye|lotaya|lautaaya|lautaaye|lautaye|lautaya|chuka|kiya|kia|kar|di|dii|ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|dass|derh|dedh|dhai|adhai|sawa|savva|paune|sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|karor|amount|maal|samaan|paise|settle)\b/gi;
  clean = clean.replace(blacklistRegex, '');

  // 2b. Remove Devanagari Hindi number, unit, and fraction words (safely handling word boundaries for non-ASCII characters)
  const hindiStopwords = /(?:^|\s)(एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस|सौ|हज़ार|हजार|हजारों|लाख|करोड़|डेढ़|ढाई|सवा|पौने)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  clean = clean.replace(hindiStopwords, ' ');

  // 3. Clean punctuation and multiple whitespace
  clean = clean
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // 4. Return default if empty
  if (!clean || clean.length < 2) {
    return "Unknown Customer";
  }

  // Convert to Title Case
  return clean.split(' ').map(w => w.charAt(0).toUpperCase() + w.substring(1)).join(' ');
}

/**
 * Normalizes phone number: extracts digits only
 */
function normalizePhone(phone) {
  if (!phone) return '';
  return phone.replace(/\D/g, '');
}

export function getCalendarDaysDiff(date1, date2) {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.max(0, Math.floor((utc1 - utc2) / (1000 * 60 * 60 * 24)));
}

/**
 * Helper to compute Levenshtein distance between two strings
 */
export function getLevenshteinDistance(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const d = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i][0] = i;
  for (let j = 0; j <= n; j++) d[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,      // deletion
        d[i][j - 1] + 1,      // insertion
        d[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return d[m][n];
}

/**
 * Checks if two customer names are known to be distinct/different people.
 */
export function areNamesDistinct(name1, name2) {
  if (!name1 || !name2) return false;
  const n1 = name1.toLowerCase().trim().replace(/\s+/g, '');
  const n2 = name2.toLowerCase().trim().replace(/\s+/g, '');
  if (n1 === n2) return false;

  const distinctPairs = [
    ['aditi', 'aarti'],
    ['raju', 'rajesh'],
    ['rahul', 'rakesh'],
    ['pooja', 'puja'],
    ['ankit', 'ankita'],
    ['rohan', 'mohan']
  ];

  for (const [d1, d2] of distinctPairs) {
    if ((n1 === d1 && n2 === d2) || (n1 === d2 && n2 === d1)) {
      return true;
    }
  }
  return false;
}

/**
 * Finds existing customer based on normalized names, phone, aliases, or fuzzy matching.
 * Returns array of matches.
 */
export function findExistingCustomer(nameOrId, phone = '', merchantId) {
  const customers = getCustomers(merchantId);
  if (!nameOrId) return [];

  const normPhone = phone ? phone.replace(/\D/g, '') : '';
  const hasDifferentPhone = (c) => {
    if (!normPhone || normPhone.length < 10) return false;
    const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
    if (!cp || cp.length < 10) return false;
    return !cp.endsWith(normPhone.slice(-10));
  };

  // Step 1: Match by customerId
  const idMatch = customers.filter(c => c.id === nameOrId);
  if (idMatch.length > 0) {
    return idMatch;
  }

  // Step 2: Match by phone number if a valid phone number is provided
  if (normPhone && normPhone.length >= 10) {
    const phoneMatch = customers.filter(c => {
      const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
      return cp && cp.endsWith(normPhone.slice(-10));
    });
    if (phoneMatch.length > 0) {
      console.log(`[LOOKUP] Mobile number match found: [${phoneMatch.map(c=>c.name).join(', ')}]`);
      return phoneMatch;
    }
  }

  // Pre-process and sanitize name query to strip transaction words
  const sanitizedName = sanitizeCustomerName(nameOrId);
  if (!sanitizedName || sanitizedName === 'Unknown Customer') return [];

  const queryNormalized = getNormalizedNameIdentifier(sanitizedName);
  const queryTransliteratedNormalized = getNormalizedNameIdentifier(transliterateHindiToEnglish(sanitizedName));
  const queryNormalizedWithSpaces = normalizeCustomerName(sanitizedName);
  const queryTransliteratedWithSpaces = normalizeCustomerName(transliterateHindiToEnglish(sanitizedName));
  
  const queryPhonetic = getPhoneticKey(transliterateHindiToEnglish(sanitizedName));

  // We want to find matches using a set to deduplicate
  const matchedIds = new Set();
  const matchedCustomers = [];

  const addMatch = (c) => {
    if (!matchedIds.has(c.id)) {
      matchedIds.add(c.id);
      matchedCustomers.push(c);
    }
  };

  // 1. Exact match (case-insensitive, normalized spaces)
  customers.forEach(c => {
    if (hasDifferentPhone(c)) return;
    if (areNamesDistinct(c.name, sanitizedName)) return;

    const cn = normalizeCustomerName(c.name);
    if (cn === queryNormalizedWithSpaces || cn === queryTransliteratedWithSpaces) {
      addMatch(c);
    }
  });

  // If we have exact matches, return them immediately to prioritize exact matches!
  if (matchedCustomers.length > 0) {
    console.log(`[LOOKUP] Exact match found: [${matchedCustomers.map(c=>c.name).join(', ')}]`);
    return matchedCustomers;
  }

  // 2. Transliteration / Phonetic match
  customers.forEach(c => {
    if (hasDifferentPhone(c)) return;
    if (areNamesDistinct(c.name, sanitizedName)) return;

    const custTranslitNorm = getNormalizedNameIdentifier(transliterateHindiToEnglish(c.name));
    const custPhonetic = getPhoneticKey(transliterateHindiToEnglish(c.name));

    if (
      c.normalizedName === queryTransliteratedNormalized ||
      custTranslitNorm === queryTransliteratedNormalized ||
      (queryPhonetic && custPhonetic === queryPhonetic)
    ) {
      addMatch(c);
    }
  });

  // 3. Substring/Prefix whole-word boundaries matches
  // E.g. Query "Sanskriti" matches "Sanskriti Sharma", "Sanskriti Store", etc.
  // Query "Rahul" matches "Rahul Mechanic"
  const escapedQuery = queryNormalizedWithSpaces.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const queryRegex = new RegExp('\\b' + escapedQuery + '\\b', 'i');

  customers.forEach(c => {
    if (hasDifferentPhone(c)) return;
    if (areNamesDistinct(c.name, sanitizedName)) return;

    const cn = normalizeCustomerName(c.name);
    const cnTranslit = normalizeCustomerName(transliterateHindiToEnglish(c.name));

    if (queryRegex.test(cn) || queryRegex.test(cnTranslit)) {
      addMatch(c);
    }
  });

  // 4. Fuzzy similarity matching (with threshold >= 70%)
  customers.forEach(c => {
    if (hasDifferentPhone(c)) return;
    if (areNamesDistinct(c.name, sanitizedName)) return;

    const cn = normalizeCustomerName(c.name);
    const cnTranslit = normalizeCustomerName(transliterateHindiToEnglish(c.name));

    const distName = getLevenshteinDistance(cn, queryNormalizedWithSpaces);
    const distTranslit = getLevenshteinDistance(cn, queryTransliteratedWithSpaces);

    const maxLen = Math.max(cn.length, queryNormalizedWithSpaces.length);
    const similarityName = maxLen > 0 ? (maxLen - distName) / maxLen : 0;

    const maxLenTranslit = Math.max(cnTranslit.length, queryTransliteratedWithSpaces.length);
    const similarityTranslit = maxLenTranslit > 0 ? (maxLenTranslit - distTranslit) / maxLenTranslit : 0;

    const maxSimilarity = Math.max(similarityName, similarityTranslit);

    // Check aliases
    const aliases = c.aliases || [];
    const aliasFuzzy = aliases.some(alias => {
      if (areNamesDistinct(alias, sanitizedName)) return false;
      const na = normalizeCustomerName(alias);
      const distAlias = getLevenshteinDistance(na, queryNormalizedWithSpaces);
      const maxLenAlias = Math.max(na.length, queryNormalizedWithSpaces.length);
      const similarityAlias = maxLenAlias > 0 ? (maxLenAlias - distAlias) / maxLenAlias : 0;
      return similarityAlias >= 0.70;
    });

    if (maxSimilarity >= 0.70 || aliasFuzzy) {
      addMatch(c);
    }
  });

  console.log(`[LOOKUP] Candidate matches found for "${sanitizedName}": [${matchedCustomers.map(c=>c.name).join(', ')}]`);
  return matchedCustomers;
}

/**
 * Scan database, locate duplicate profiles with same normalized name or alias entries, and merge them
 */
export function mergeDuplicateCustomers(merchantId) {
  const db = readDb();
  if (!merchantId) {
    const merchantIds = new Set((db.users || []).map(u => u.id));
    (db.customers || []).forEach(c => merchantIds.add(c.merchant_id || 'merchant_1'));
    
    for (const mId of merchantIds) {
      mergeDuplicateCustomersForMerchant(mId);
    }
    return;
  }
  mergeDuplicateCustomersForMerchant(merchantId);
}

function mergeDuplicateCustomersForMerchant(merchantId) {
  console.log(`[MERGE] Auto-merge scanner started for merchant: ${merchantId}`);
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const customers = (db.customers || []).filter(c => !c.deleted && (c.merchant_id || 'merchant_1') === targetMerchantId);
  const transactions = db.transactions || [];
  const balances = db.outstanding_balances || [];
  const reminders = db.reminders || [];

  if (customers.length === 0) {
    console.log(`[MERGE] Merchant ${targetMerchantId} has no customers. Scanner ended.`);
    return;
  }

  let mergedCount = 0;
  const mergedIdsMap = {}; // Key: old duplicate ID, Value: master ID
  const masterAliasesMap = {}; // Key: master ID, Value: Set of aliases

  // Initialize alias sets
  customers.forEach(c => {
    masterAliasesMap[c.id] = new Set(c.aliases || []);
    masterAliasesMap[c.id].add(c.name);
    if (c.alias) masterAliasesMap[c.id].add(c.alias);
  });

  const mergedCustomerIds = new Set();

  for (let i = 0; i < customers.length; i++) {
    const c1 = customers[i];
    if (mergedCustomerIds.has(c1.id)) continue;

    for (let j = i + 1; j < customers.length; j++) {
      const c2 = customers[j];
      if (mergedCustomerIds.has(c2.id)) continue;

      if (areNamesDistinct(c1.name, c2.name)) {
        continue;
      }

      const norm1 = getNormalizedNameIdentifier(c1.name);
      const norm2 = getNormalizedNameIdentifier(c2.name);
      
      const trans1 = getNormalizedNameIdentifier(transliterateHindiToEnglish(c1.name));
      const trans2 = getNormalizedNameIdentifier(transliterateHindiToEnglish(c2.name));

      const phone1 = c1.phone ? c1.phone.replace(/\D/g, '') : '';
      const phone2 = c2.phone ? c2.phone.replace(/\D/g, '') : '';

      let shouldMerge = false;
      let reason = '';

      if (norm1 === norm2) {
        shouldMerge = true;
        reason = 'identical normalized name';
      }
      else if (trans1 === trans2) {
        shouldMerge = true;
        reason = 'transliterated Hindi/English name match';
      }
      else if (phone1 && phone2 && phone1.slice(-10) === phone2.slice(-10)) {
        shouldMerge = true;
        reason = 'matching phone number';
      }
      else {
        const c1Aliases = Array.from(masterAliasesMap[c1.id]);
        const c2Aliases = Array.from(masterAliasesMap[c2.id]);
        
        const c1MatchesC2Alias = c1Aliases.some(a => 
          getNormalizedNameIdentifier(a) === norm2 || 
          getNormalizedNameIdentifier(transliterateHindiToEnglish(a)) === trans2
        );
        const c2MatchesC1Alias = c2Aliases.some(a => 
          getNormalizedNameIdentifier(a) === norm1 || 
          getNormalizedNameIdentifier(transliterateHindiToEnglish(a)) === trans1
        );
        
        if (c1MatchesC2Alias || c2MatchesC1Alias) {
          shouldMerge = true;
          reason = 'cross-matching alias reference';
        }
      }

      if (shouldMerge) {
        // Choose master: prefer Latin/English display name, else oldest profile
        const isC1English = !/[\u0900-\u097F]/.test(c1.name);
        const isC2English = !/[\u0900-\u097F]/.test(c2.name);
        
        let master, duplicate;
        if (isC1English && !isC2English) {
          master = c1;
          duplicate = c2;
        } else if (!isC1English && isC2English) {
          master = c2;
          duplicate = c1;
        } else {
          master = new Date(c1.created_at).getTime() <= new Date(c2.created_at).getTime() ? c1 : c2;
          duplicate = master.id === c1.id ? c2 : c1;
        }

        mergedIdsMap[duplicate.id] = master.id;
        mergedCustomerIds.add(duplicate.id);

        // Merge aliases
        masterAliasesMap[duplicate.id].forEach(alias => {
          masterAliasesMap[master.id].add(alias);
        });
        masterAliasesMap[master.id].add(duplicate.name);
        if (duplicate.alias) masterAliasesMap[master.id].add(duplicate.alias);

        console.log(`[MERGE] Consolidating duplicate profile "${duplicate.name}" (ID: ${duplicate.id}) into master "${master.name}" (ID: ${master.id}) for merchant ${targetMerchantId}. Reason: ${reason}`);
        mergedCount++;
        
        i--;
        break;
      }
    }
  }

  if (mergedCount > 0) {
    const currentDb = readDb();
    
    // 1. Remap transactions
    currentDb.transactions = (currentDb.transactions || []).map(tx => {
      if (mergedIdsMap[tx.customer_id] && (tx.merchant_id || 'merchant_1') === targetMerchantId) {
        console.log(`[MERGE] Remapped transaction ${tx.id} from duplicate customer ID ${tx.customer_id} to master ID ${mergedIdsMap[tx.customer_id]}`);
        return { ...tx, customer_id: mergedIdsMap[tx.customer_id] };
      }
      return tx;
    });

    // 2. Remap reminders
    currentDb.reminders = (currentDb.reminders || []).map(rem => {
      if (mergedIdsMap[rem.customer_id] && (rem.merchant_id || 'merchant_1') === targetMerchantId) {
        console.log(`[MERGE] Remapped reminder ${rem.id} from duplicate customer ID ${rem.customer_id} to master ID ${mergedIdsMap[rem.customer_id]}`);
        return { ...rem, customer_id: mergedIdsMap[rem.customer_id] };
      }
      return rem;
    });

    // 3. Update customer list
    currentDb.customers = (currentDb.customers || []).map(c => {
      if (mergedCustomerIds.has(c.id)) {
        return { ...c, deleted: true };
      }
      if (c.id in masterAliasesMap) {
        const aliases = Array.from(masterAliasesMap[c.id]);
        return {
          ...c,
          normalizedName: getNormalizedNameIdentifier(c.name),
          aliases: aliases.filter(a => a.toLowerCase() !== c.name.toLowerCase())
        };
      }
      return c;
    });

    // 4. Recalculate outstanding balances
    const newBalances = (currentDb.outstanding_balances || []).filter(b => !mergedCustomerIds.has(b.customer_id));
    
    customers.filter(c => !mergedCustomerIds.has(c.id)).forEach(c => {
      const customerTxs = currentDb.transactions.filter(tx => tx.customer_id === c.id && (tx.merchant_id || 'merchant_1') === targetMerchantId);
      const balance = customerTxs.reduce((sum, tx) => {
        if (tx.type === 'credit') return sum + tx.amount;
        return Math.max(0, sum - tx.amount);
      }, 0);

      let bEntry = newBalances.find(b => b.customer_id === c.id);
      if (bEntry) {
        bEntry.balance = balance;
        bEntry.last_updated = customerTxs.length > 0 
          ? [...customerTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date 
          : c.created_at;
      } else {
        newBalances.push({
          customer_id: c.id,
          merchant_id: targetMerchantId,
          balance,
          last_updated: customerTxs.length > 0 
            ? [...customerTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date 
            : c.created_at
        });
      }

      currentDb.reminders = currentDb.reminders.map(rem => {
        if (rem.customer_id === c.id && rem.status === 'pending' && (rem.merchant_id || 'merchant_1') === targetMerchantId) {
          if (balance === 0) {
            return { ...rem, status: 'paid', amount: 0 };
          }
          return { ...rem, amount: balance };
        }
        return rem;
      });
    });

    currentDb.outstanding_balances = newBalances;
    writeDb(currentDb);
    console.log(`[MERGE] Consolidation complete for merchant ${targetMerchantId}. Merged ${mergedCount} duplicate profile(s).`);
  } else {
    console.log(`[MERGE] No duplicate customer profiles found for merchant ${targetMerchantId}.`);
  }
}

/**
 * Learns a new customer alias dynamically
 */
export function learnAlias(customerId, aliasName) {
  if (!aliasName) return false;
  const db = readDb();
  const customer = db.customers.find(c => c.id === customerId);
  if (!customer) return false;

  if (!customer.aliases) {
    customer.aliases = [];
  }

  const cleanAlias = aliasName.trim();
  const exists = customer.aliases.some(a => a.toLowerCase() === cleanAlias.toLowerCase());
  
  if (!exists) {
    customer.aliases.push(cleanAlias);
    console.log(`[ALIAS LEARNED] Added alias "${cleanAlias}" to customer "${customer.name}" (ID: ${customer.id})`);
    writeDb(db);
    return true;
  }
  return false;
}

// ----------------------------------------------------
// Existing Database Drivers
// ----------------------------------------------------

export function getCustomers(merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const targetDate = dateStr ? dateStr.slice(0, 10) : null;
  
  return (db.customers || [])
    .filter(customer => {
      if (customer.deleted || (customer.merchant_id || 'merchant_1') !== targetMerchantId) return false;
      if (targetDate && customer.created_at.slice(0, 10) > targetDate) return false;
      return true;
    })
    .map(customer => {
      const custTxs = (db.transactions || []).filter(t => 
        t.customer_id === customer.id && 
        (t.merchant_id || 'merchant_1') === targetMerchantId
      );

      const filteredTxs = targetDate 
        ? custTxs.filter(t => t.date.slice(0, 10) <= targetDate)
        : custTxs;

      const balance = filteredTxs.reduce((sum, t) => {
        if (t.type === 'credit') return sum + t.amount;
        return Math.max(0, sum - t.amount);
      }, 0);

      const lastTx = filteredTxs.length > 0 
        ? [...filteredTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] 
        : null;
      const lastActiveDate = lastTx ? lastTx.date : customer.created_at;

      return {
        ...customer,
        balance,
        last_updated: lastActiveDate
      };
    });
}

export function invalidateMerchantSummaries(db, merchantId) {
  const targetMerchantId = merchantId || 'merchant_1';
  db.daily_summaries = (db.daily_summaries || []).filter(s => (s.merchant_id || 'merchant_1') !== targetMerchantId);
}

export function invalidateSpecificSummary(db, merchantId, dateStr) {
  const targetMerchantId = merchantId || 'merchant_1';
  const txDateStr = dateStr.slice(0, 10);
  const todayDateStr = new Date().toISOString().slice(0, 10);
  db.daily_summaries = (db.daily_summaries || []).filter(s => 
    (s.merchant_id || 'merchant_1') !== targetMerchantId || 
    (s.date !== txDateStr && s.date !== todayDateStr)
  );
}

export function addCustomer({ name, phone, alias, aliases, confirmNew = false, merchantId }) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  
  // Pre-process and sanitize name query to strip transaction words
  const sanitizedName = sanitizeCustomerName(name);
  const norm = getNormalizedNameIdentifier(sanitizedName);

  const normPhone = phone ? phone.replace(/\D/g, '') : '';
  const hasDifferentPhone = (c) => {
    if (!normPhone || normPhone.length < 10) return false;
    const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
    if (!cp || cp.length < 10) return false;
    return !cp.endsWith(normPhone.slice(-10));
  };

  // Validation: Prevent duplicate insertion at Database Driver layer if confirmNew is false
  if (!confirmNew) {
    const existing = db.customers.find(c => 
      !c.deleted &&
      (c.merchant_id || 'merchant_1') === targetMerchantId &&
      !hasDifferentPhone(c) && 
      !areNamesDistinct(c.name, sanitizedName) && (
        c.normalizedName === norm || 
        getNormalizedNameIdentifier(c.name) === norm ||
        (c.aliases || []).some(a => getNormalizedNameIdentifier(a) === norm)
      )
    );
    
    if (existing) {
      console.log(`[PREVENTED] Duplicate customer profile creation blocked for: "${sanitizedName}". returning existing ID: ${existing.id}`);
      
      const balanceEntry = db.outstanding_balances.find(b => b.customer_id === existing.id);
      return {
        ...existing,
        balance: balanceEntry ? balanceEntry.balance : 0,
        last_updated: balanceEntry ? balanceEntry.last_updated : existing.created_at,
        was_existing: true
      };
    }
  }

  const cleanName = sanitizedName;
  const cleanAlias = sanitizeCustomerName(alias || name.split(' ')[0] || '');
  const defaultAliases = new Set(aliases || []);
  defaultAliases.add(cleanName);
  defaultAliases.add(normalizeCustomerName(cleanName));
  defaultAliases.add(getNormalizedNameIdentifier(cleanName));
  
  const transliterated = transliterateHindiToEnglish(cleanName);
  defaultAliases.add(transliterated);
  defaultAliases.add(normalizeCustomerName(transliterated));
  defaultAliases.add(getNormalizedNameIdentifier(transliterated));

  if (cleanAlias) {
    defaultAliases.add(cleanAlias);
    defaultAliases.add(normalizeCustomerName(cleanAlias));
  }

  const newCustomer = {
    id: 'cust_' + uuidv4().substring(0, 8),
    merchant_id: targetMerchantId,
    name: cleanName,
    displayName: cleanName,
    alias: cleanAlias,
    normalizedName: norm,
    aliases: Array.from(defaultAliases),
    phone: phone && phone.trim() ? phone.trim() : null,
    created_at: new Date().toISOString()
  };

  db.customers.push(newCustomer);
  db.outstanding_balances.push({
    customer_id: newCustomer.id,
    merchant_id: targetMerchantId,
    balance: 0,
    last_updated: newCustomer.created_at
  });

  invalidateMerchantSummaries(db, targetMerchantId);
  writeDb(db);
  console.log(`[CREATED] New customer profile created: "${newCustomer.name}" (ID: ${newCustomer.id}) for merchant ${targetMerchantId}`);
  return { ...newCustomer, balance: 0, last_updated: newCustomer.created_at };
}

export function deleteCustomer(id, merchantId) {
  const db = readDb();
  const customer = db.customers.find(c => c.id === id && (c.merchant_id || 'merchant_1') === (merchantId || 'merchant_1'));
  if (!customer) return false;

  // Soft delete customer
  customer.deleted = true;

  // Cleanup outstanding balances
  db.outstanding_balances = (db.outstanding_balances || []).filter(b => b.customer_id !== id);

  // Cleanup reminders
  db.reminders = (db.reminders || []).filter(r => r.customer_id !== id);

  // Cleanup transactions
  db.transactions = (db.transactions || []).filter(t => t.customer_id !== id);

  invalidateMerchantSummaries(db, merchantId);
  writeDb(db);
  console.log(`[DELETED] Customer profile soft-deleted and records cleaned up: "${customer.name}" (ID: ${id})`);
  return true;
}

export function updateCustomer(id, { name, phone, alias, address, notes, customerType, merchantId }) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  
  const customer = db.customers.find(c => c.id === id && !c.deleted && (c.merchant_id || 'merchant_1') === targetMerchantId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  if (!name || name.trim().length < 2) {
    throw new Error('Customer name must be at least 2 characters');
  }

  let cleanPhone = phone;
  if (phone) {
    cleanPhone = phone.trim();
    // Validate: 10-digit Indian mobile number, optionally prefixed with +91
    const phoneRegex = /^(?:\+?91)?[6-9]\d{9}$/;
    if (!phoneRegex.test(cleanPhone)) {
      throw new Error('Invalid phone number format');
    }
  }

  const sanitizedName = sanitizeCustomerName(name);
  const norm = getNormalizedNameIdentifier(sanitizedName);

  const normPhone = cleanPhone ? cleanPhone.replace(/\D/g, '') : '';
  const hasDifferentPhone = (c) => {
    if (!normPhone || normPhone.length < 10) return false;
    const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
    if (!cp || cp.length < 10) return false;
    return !cp.endsWith(normPhone.slice(-10));
  };

  const duplicate = db.customers.find(c =>
    c.id !== id &&
    !c.deleted &&
    (c.merchant_id || 'merchant_1') === targetMerchantId &&
    !hasDifferentPhone(c) &&
    !areNamesDistinct(c.name, sanitizedName) && (
      c.normalizedName === norm ||
      getNormalizedNameIdentifier(c.name) === norm ||
      (c.aliases || []).some(a => getNormalizedNameIdentifier(a) === norm)
    )
  );

  if (duplicate) {
    throw new Error('Customer with this name already exists');
  }

  customer.name = sanitizedName;
  customer.displayName = sanitizedName;
  customer.normalizedName = norm;

  if (phone === '' || phone === null || phone === undefined) {
    customer.phone = null;
  } else if (cleanPhone) {
    customer.phone = cleanPhone;
  }

  const cleanAlias = sanitizeCustomerName(alias || name.split(' ')[0] || '');
  customer.alias = cleanAlias;

  const defaultAliases = new Set(customer.aliases || []);
  defaultAliases.add(sanitizedName);
  defaultAliases.add(normalizeCustomerName(sanitizedName));
  defaultAliases.add(getNormalizedNameIdentifier(sanitizedName));

  const transliterated = transliterateHindiToEnglish(sanitizedName);
  defaultAliases.add(transliterated);
  defaultAliases.add(normalizeCustomerName(transliterated));
  defaultAliases.add(getNormalizedNameIdentifier(transliterated));

  if (cleanAlias) {
    defaultAliases.add(cleanAlias);
    defaultAliases.add(normalizeCustomerName(cleanAlias));
  }

  customer.aliases = Array.from(defaultAliases);

  if (address !== undefined) customer.address = address;
  if (notes !== undefined) customer.notes = notes;
  if (customerType !== undefined) customer.customerType = customerType;

  db.reminders = (db.reminders || []).map(r => {
    if (r.customer_id === id && (r.merchant_id || 'merchant_1') === targetMerchantId) {
      return {
        ...r,
        customer_name: sanitizedName,
        customer_phone: customer.phone
      };
    }
    return r;
  });

  invalidateMerchantSummaries(db, targetMerchantId);
  writeDb(db);
  console.log(`[UPDATED] Customer profile updated: "${customer.name}" (ID: ${id})`);
  
  const custTxs = (db.transactions || []).filter(t => t.customer_id === id && (t.merchant_id || 'merchant_1') === targetMerchantId);
  const lastTx = custTxs.length > 0 
    ? [...custTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] 
    : null;
  const lastActiveDate = lastTx ? lastTx.date : customer.created_at;

  const balanceEntry = db.outstanding_balances.find(b => b.customer_id === id);
  return {
    ...customer,
    balance: balanceEntry ? balanceEntry.balance : 0,
    last_updated: lastActiveDate
  };
}

export function syncRemindersForCustomer(db, customerId, merchantId) {
  const targetMerchantId = merchantId || 'merchant_1';
  
  // Find customer balance
  const balanceEntry = db.outstanding_balances.find(b => b.customer_id === customerId && (b.merchant_id || 'merchant_1') === targetMerchantId);
  const balance = balanceEntry ? balanceEntry.balance : 0;

  // Clear existing pending reminders for this customer
  db.reminders = (db.reminders || []).filter(r => !(r.customer_id === customerId && r.status === 'pending' && (r.merchant_id || 'merchant_1') === targetMerchantId));

  if (balance > 0) {
    // Find all transactions for this customer
    const customerTxs = (db.transactions || []).filter(t => t.customer_id === customerId && (t.merchant_id || 'merchant_1') === targetMerchantId);
    
    // Sort credits chronologically (ascending date)
    const credits = customerTxs
      .filter(t => t.type === 'credit')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(t => ({ date: t.date, amount: t.amount, remaining: t.amount }));

    // Sort collections chronologically (ascending date)
    const collections = customerTxs
      .filter(t => t.type === 'collection')
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Apply collections to credits using First-In-First-Out (FIFO) logic
    for (const col of collections) {
      let colAmount = col.amount;
      for (const cred of credits) {
        if (cred.remaining > 0) {
          const deduct = Math.min(colAmount, cred.remaining);
          cred.remaining -= deduct;
          colAmount -= deduct;
          if (colAmount <= 0) break;
        }
      }
    }

    // Find the oldest outstanding credit transaction (remaining > 0)
    const oldestOutstanding = credits.find(c => c.remaining > 0);
    const customerObj = db.customers.find(c => c.id === customerId);
    
    // Fallback: oldest credit date, or customer creation date
    const refDate = oldestOutstanding 
      ? new Date(oldestOutstanding.date) 
      : (credits.length > 0 ? new Date(credits[0].date) : new Date(customerObj?.created_at || new Date()));

    const daysOverdue = getCalendarDaysDiff(new Date(), refDate);

    let priority = 'Soft';
    if (daysOverdue >= 10) {
      priority = 'High';
    } else if (daysOverdue >= 5) {
      priority = 'Medium';
    }

    db.reminders.push({
      id: 'rem_' + uuidv4().substring(0, 8),
      merchant_id: targetMerchantId,
      customer_id: customerId,
      customer_name: customerObj ? customerObj.name : 'Unknown',
      customer_phone: customerObj ? customerObj.phone : null,
      amount: balance,
      priority,
      status: 'pending',
      days_overdue: daysOverdue,
      due_date: refDate.toISOString(),
      created_at: new Date().toISOString()
    });
  }
}

export function deleteTransaction(id, merchantId) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const txIndex = (db.transactions || []).findIndex(t => t.id === id && (t.merchant_id || 'merchant_1') === targetMerchantId);
  if (txIndex === -1) return false;

  const tx = db.transactions[txIndex];
  const customerId = tx.customer_id;

  // Remove the transaction
  db.transactions.splice(txIndex, 1);

  // Recalculate outstanding balance
  const customerTxs = db.transactions.filter(t => t.customer_id === customerId && (t.merchant_id || 'merchant_1') === targetMerchantId);
  const newBalance = customerTxs.reduce((sum, t) => {
    if (t.type === 'credit') return sum + t.amount;
    return Math.max(0, sum - t.amount);
  }, 0);

  let balanceEntry = db.outstanding_balances.find(b => b.customer_id === customerId && (b.merchant_id || 'merchant_1') === targetMerchantId);
  if (balanceEntry) {
    balanceEntry.balance = newBalance;
    balanceEntry.last_updated = customerTxs.length > 0 
      ? [...customerTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date 
      : new Date().toISOString();
  }

  syncRemindersForCustomer(db, customerId, targetMerchantId);

  invalidateSpecificSummary(db, targetMerchantId, tx.date);

  writeDb(db);
  console.log(`[DELETED] Transaction deleted: ID ${id}, recalculated balance for customer ${customerId} to ₹${newBalance}`);
  return true;
}

export function getCustomerLedger(customerId, merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const customer = getCustomers(targetMerchantId, dateStr).find(c => c.id === customerId);
  if (!customer) return null;

  const targetDate = dateStr ? dateStr.slice(0, 10) : null;
  const transactions = (db.transactions || [])
    .filter(t => t.customer_id === customerId && (t.merchant_id || 'merchant_1') === targetMerchantId && (!targetDate || t.date.slice(0, 10) <= targetDate))
    .sort((a, b) => new Date(a.date).getTime() - new Date(a.date).getTime());

  const reminders = getReminders(targetMerchantId, dateStr).filter(r => r.customer_id === customerId);

  return {
    customer,
    transactions,
    reminders
  };
}

export function addTransaction({ customerId, amount, type, description, date, aliasSpoken, merchantId }) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';

  if (aliasSpoken) {
    const customer = db.customers.find(c => c.id === customerId && (c.merchant_id || 'merchant_1') === targetMerchantId);
    if (customer) {
      if (!customer.aliases) {
        customer.aliases = [];
      }
      const cleanAlias = aliasSpoken.trim();
      const exists = customer.aliases.some(a => a.toLowerCase() === cleanAlias.toLowerCase());
      if (!exists) {
        customer.aliases.push(cleanAlias);
        console.log(`[ALIAS LEARNED] Added alias "${cleanAlias}" to customer "${customer.name}" (ID: ${customer.id})`);
      }
    }
  }

  const parsedAmount = Math.max(0, parseFloat(amount));
  const txDate = date ? new Date(date).toISOString() : new Date().toISOString();

  const newTx = {
    id: 'tx_' + uuidv4().substring(0, 8),
    merchant_id: targetMerchantId,
    customer_id: customerId,
    amount: parsedAmount,
    type, // 'credit' or 'collection'
    description: description || (type === 'credit' ? 'Udhaar entry' : 'Wapas received'),
    date: txDate
  };

  db.transactions.push(newTx);
  console.log(`[TRANSACTION ATTACHED] Added ${type} of ₹${parsedAmount} to customer ID ${customerId}`);

  // Update Outstanding Balance
  let balanceEntry = db.outstanding_balances.find(b => b.customer_id === customerId && (b.merchant_id || 'merchant_1') === targetMerchantId);
  if (!balanceEntry) {
    balanceEntry = { customer_id: customerId, merchant_id: targetMerchantId, balance: 0, last_updated: txDate };
    db.outstanding_balances.push(balanceEntry);
  }

  const oldBalance = balanceEntry.balance;
  if (type === 'credit') {
    balanceEntry.balance += parsedAmount;
  } else {
    balanceEntry.balance = Math.max(0, balanceEntry.balance - parsedAmount);
  }
  balanceEntry.last_updated = txDate;

  syncRemindersForCustomer(db, customerId, targetMerchantId);

  invalidateSpecificSummary(db, targetMerchantId, txDate);

  writeDb(db);
  return { transaction: newTx, newBalance: balanceEntry.balance };
}

export function getReminders(merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const customers = (db.customers || []).filter(c => !c.deleted && (c.merchant_id || 'merchant_1') === targetMerchantId);
  const transactions = db.transactions || [];
  
  const targetDate = dateStr ? dateStr.slice(0, 10) : new Date().toISOString().slice(0, 10);

  const remindersList = [];

  for (const customer of customers) {
    const customerTxs = transactions.filter(t => 
      t.customer_id === customer.id && 
      (t.merchant_id || 'merchant_1') === targetMerchantId &&
      t.date.slice(0, 10) <= targetDate
    );

    const balance = customerTxs.reduce((sum, t) => {
      if (t.type === 'credit') return sum + t.amount;
      return Math.max(0, sum - t.amount);
    }, 0);

    if (balance > 0) {
      const credits = customerTxs
        .filter(t => t.type === 'credit')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .map(t => ({ date: t.date, amount: t.amount, remaining: t.amount }));

      const collections = customerTxs
        .filter(t => t.type === 'collection')
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      for (const col of collections) {
        let colAmount = col.amount;
        for (const cred of credits) {
          if (cred.remaining > 0) {
            const deduct = Math.min(colAmount, cred.remaining);
            cred.remaining -= deduct;
            colAmount -= deduct;
            if (colAmount <= 0) break;
          }
        }
      }

      const oldestOutstanding = credits.find(c => c.remaining > 0);
      const refDate = oldestOutstanding 
        ? new Date(oldestOutstanding.date) 
        : (credits.length > 0 ? new Date(credits[0].date) : new Date(customer.created_at || new Date()));

      const daysOverdue = getCalendarDaysDiff(targetDate, refDate);

      let priority = 'Soft';
      if (daysOverdue >= 10) {
        priority = 'High';
      } else if (daysOverdue >= 5) {
        priority = 'Medium';
      }

      remindersList.push({
        id: `rem_${customer.id}`,
        merchant_id: targetMerchantId,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_phone: customer.phone || '',
        amount: balance,
        priority,
        status: 'pending',
        days_overdue: daysOverdue,
        due_date: refDate.toISOString(),
        created_at: new Date().toISOString()
      });
    }
  }

  return remindersList;
}
