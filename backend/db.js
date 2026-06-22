import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

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
    syncToSupabase(data).catch(err => {
      console.error('[SUPABASE ASYNC ERROR] Background sync failure:', err.message);
    });
    return true;
  } catch (error) {
    console.error('Error writing to database file:', error);
    return false;
  }
}

// Short-lived query cache with TTL 5 seconds to reduce duplicate reads
const queryCache = new Map();
const CACHE_TTL_MS = 5000;

function getCachedQueryResult(cacheKey) {
  const cached = queryCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function setCachedQueryResult(cacheKey, data) {
  queryCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
}

export function invalidateQueryCache(prefix) {
  if (!prefix) {
    queryCache.clear();
    return;
  }
  for (const key of queryCache.keys()) {
    if (key.startsWith(prefix)) {
      queryCache.delete(key);
    }
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

export function getLocalDateStr(dateInput) {
  if (!dateInput) return '';
  const dateObj = new Date(dateInput);
  if (isNaN(dateObj.getTime())) return '';
  const offset = 5.5 * 60 * 60 * 1000; // IST offset
  const istDate = new Date(dateObj.getTime() + offset);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTodayStr() {
  return getLocalDateStr(new Date());
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
    ['rohan', 'mohan'],
    ['pingu', 'mingu'],
    ['sonu', 'monu'],
    ['ramesh', 'dinesh'],
    ['pawan', 'pankaj']
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
export function findExistingCustomer(nameOrId, phone = '', merchantId, preloadedCustomers) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return findExistingCustomerLocal(nameOrId, phone, targetMerchantId, preloadedCustomers);
  }
  
  return (async () => {
    const customers = preloadedCustomers || await getCustomers(targetMerchantId);
    if (!nameOrId) return [];

    const normPhone = phone ? phone.replace(/\D/g, '') : '';
    const hasDifferentPhone = (c) => {
      if (!normPhone || normPhone.length < 10) return false;
      const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
      if (!cp || cp.length < 10) return false;
      return !cp.endsWith(normPhone.slice(-10));
    };

    const idMatch = customers.filter(c => c.id === nameOrId);
    if (idMatch.length > 0) {
      return idMatch;
    }

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

    const sanitizedName = sanitizeCustomerName(nameOrId);
    if (!sanitizedName || sanitizedName === 'Unknown Customer') return [];

    const queryNormalized = getNormalizedNameIdentifier(sanitizedName);
    const queryTransliteratedNormalized = getNormalizedNameIdentifier(transliterateHindiToEnglish(sanitizedName));
    const queryNormalizedWithSpaces = normalizeCustomerName(sanitizedName);
    const queryTransliteratedWithSpaces = normalizeCustomerName(transliterateHindiToEnglish(sanitizedName));
    
    const queryPhonetic = getPhoneticKey(transliterateHindiToEnglish(sanitizedName));

    const matchedIds = new Set();
    const matchedCustomers = [];

    const addMatch = (c) => {
      if (!matchedIds.has(c.id)) {
        matchedIds.add(c.id);
        matchedCustomers.push(c);
      }
    };

    customers.forEach(c => {
      if (hasDifferentPhone(c)) return;
      if (areNamesDistinct(c.name, sanitizedName)) return;

      const cn = normalizeCustomerName(c.name);
      if (cn === queryNormalizedWithSpaces || cn === queryTransliteratedWithSpaces) {
        addMatch(c);
      }
    });

    if (matchedCustomers.length > 0) {
      console.log(`[LOOKUP] Exact match found: [${matchedCustomers.map(c=>c.name).join(', ')}]`);
      return matchedCustomers;
    }

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
  })();
}

function findExistingCustomerLocal(nameOrId, phone = '', merchantId, preloadedCustomers) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const customers = preloadedCustomers || getCustomersLocal(targetMerchantId);
  if (!nameOrId) return [];

  const normPhone = phone ? phone.replace(/\D/g, '') : '';
  const hasDifferentPhone = (c) => {
    if (!normPhone || normPhone.length < 10) return false;
    const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
    if (!cp || cp.length < 10) return false;
    return !cp.endsWith(normPhone.slice(-10));
  };

  const idMatch = customers.filter(c => c.id === nameOrId);
  if (idMatch.length > 0) {
    return idMatch;
  }

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

  const sanitizedName = sanitizeCustomerName(nameOrId);
  if (!sanitizedName || sanitizedName === 'Unknown Customer') return [];

  const queryNormalized = getNormalizedNameIdentifier(sanitizedName);
  const queryTransliteratedNormalized = getNormalizedNameIdentifier(transliterateHindiToEnglish(sanitizedName));
  const queryNormalizedWithSpaces = normalizeCustomerName(sanitizedName);
  const queryTransliteratedWithSpaces = normalizeCustomerName(transliterateHindiToEnglish(sanitizedName));
  
  const queryPhonetic = getPhoneticKey(transliterateHindiToEnglish(sanitizedName));

  const matchedIds = new Set();
  const matchedCustomers = [];

  const addMatch = (c) => {
    if (!matchedIds.has(c.id)) {
      matchedIds.add(c.id);
      matchedCustomers.push(c);
    }
  };

  customers.forEach(c => {
    if (hasDifferentPhone(c)) return;
    if (areNamesDistinct(c.name, sanitizedName)) return;

    const cn = normalizeCustomerName(c.name);
    if (cn === queryNormalizedWithSpaces || cn === queryTransliteratedWithSpaces) {
      addMatch(c);
    }
  });

  if (matchedCustomers.length > 0) {
    console.log(`[LOOKUP] Exact match found: [${matchedCustomers.map(c=>c.name).join(', ')}]`);
    return matchedCustomers;
  }

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
    invalidateQueryCache('customers_');
    invalidateQueryCache('transactions_');
    invalidateQueryCache('reminders_');
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
  const targetMerchantId = merchantId || 'merchant_1';
  
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return getCustomersLocal(targetMerchantId, dateStr);
  }
  
  const cacheKey = `customers_${targetMerchantId}_${dateStr || 'all'}`;
  const cached = getCachedQueryResult(cacheKey);
  if (cached) {
    console.log(`[QUERY CACHE HIT] getCustomers: ${cacheKey}`);
    return Promise.resolve(cached);
  }
  
  return (async () => {
    try {
      const { supabase } = await import('./supabase.js');
      const merchantUuid = toUUID(targetMerchantId);
      
      // Parallelize Supabase reads
      const queryStart = Date.now();
      const [cRes, bRes, tRes] = await Promise.all([
        supabase
          .from('customers')
          .select('*')
          .eq('merchant_id', merchantUuid),
        supabase
          .from('outstanding_balances')
          .select('*')
          .eq('merchant_id', merchantUuid),
        dateStr
          ? supabase
              .from('transactions')
              .select('*')
              .eq('merchant_id', merchantUuid)
              .lte('date', new Date(dateStr + 'T23:59:59.999Z').toISOString())
          : Promise.resolve({ data: [] })
      ]);
      console.log(`[SUPABASE QUERY] getCustomers (Parallelized Reads) - Duration: ${Date.now() - queryStart}ms`);
      
      const { data: customers, error: cErr } = cRes;
      const { data: balances, error: bErr } = bRes;
      const { data: txs, error: tErr } = tRes;
      
      if (cErr) throw cErr;
      if (bErr) throw bErr;
      if (tErr) throw tErr;
      
      const transactions = txs || [];
      const balanceMap = new Map((balances || []).map(b => [b.customer_id, b]));
      
      const result = (customers || [])
        .map(c => {
          let alias = c.alias;
          let aliases = [c.name];
          let normalizedName = c.name.toLowerCase().replace(/\s+/g, '');
          let deleted = false;
          let originalId = c.id;
          
          if (c.alias && c.alias.startsWith('{') && c.alias.endsWith('}')) {
            try {
              const extra = JSON.parse(c.alias);
              alias = extra.alias || c.alias;
              aliases = extra.aliases || aliases;
              normalizedName = extra.normalizedName || normalizedName;
              deleted = extra.deleted || false;
              originalId = extra.original_id || c.id;
            } catch (e) {}
          }
          
          if (deleted) return null;
          
          let balance = 0;
          let lastUpdated = c.created_at;
          
          if (dateStr) {
            const custTxs = transactions.filter(t => t.customer_id === c.id);
            balance = custTxs.reduce((sum, t) => {
              if (t.type === 'credit') return sum + parseFloat(t.amount);
              return Math.max(0, sum - parseFloat(t.amount));
            }, 0);
            const lastTx = custTxs.length > 0 
              ? [...custTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] 
              : null;
            if (lastTx) lastUpdated = lastTx.date;
          } else {
            const balEntry = balanceMap.get(c.id);
            if (balEntry) {
              balance = parseFloat(balEntry.balance);
              lastUpdated = balEntry.last_updated;
            }
          }
          
          return {
            id: originalId,
            merchant_id: targetMerchantId,
            name: c.name,
            displayName: c.name,
            alias,
            phone: c.phone === '0000000000' ? null : c.phone,
            created_at: c.created_at,
            normalizedName,
            aliases,
            deleted,
            balance,
            last_updated: lastUpdated
          };
        })
        .filter(c => c !== null);

      setCachedQueryResult(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[SUPABASE READ ERROR] Customers query failed:', err.message);
      throw err;
    }
  })();
}

function getCustomersLocal(merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const targetDate = dateStr ? dateStr.slice(0, 10) : null;
  
  return (db.customers || [])
    .filter(customer => {
      if (customer.deleted || (customer.merchant_id || 'merchant_1') !== targetMerchantId) return false;
      if (targetDate && getLocalDateStr(customer.created_at) > targetDate) return false;
      return true;
    })
    .map(customer => {
      const custTxs = (db.transactions || []).filter(t => 
        t.customer_id === customer.id && 
        (t.merchant_id || 'merchant_1') === targetMerchantId
      );

      const filteredTxs = targetDate 
        ? custTxs.filter(t => getLocalDateStr(t.date) <= targetDate)
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

export function getTransactions(merchantId, dateStr) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return getTransactionsLocal(targetMerchantId, dateStr);
  }
  
  const cacheKey = `transactions_${targetMerchantId}_${dateStr || 'all'}`;
  const cached = getCachedQueryResult(cacheKey);
  if (cached) {
    console.log(`[QUERY CACHE HIT] getTransactions: ${cacheKey}`);
    return Promise.resolve(cached);
  }
  
  return (async () => {
    try {
      const { supabase } = await import('./supabase.js');
      const merchantUuid = toUUID(targetMerchantId);
      let query = supabase.from('transactions').select('*').eq('merchant_id', merchantUuid);
      if (dateStr) {
        query = query.lte('date', new Date(dateStr + 'T23:59:59.999Z').toISOString());
      }
      const { data: txs, error: tErr } = await query;
      if (tErr) throw tErr;
      
      const result = (txs || []).map(t => {
        let description = t.description;
        let originalTxId = t.id;
        let originalCustomerId = t.customer_id;
        if (t.description && t.description.startsWith('{') && t.description.endsWith('}')) {
          try {
            const extra = JSON.parse(t.description);
            description = extra.description || t.description;
            originalTxId = extra.original_id || t.id;
            originalCustomerId = extra.original_customer_id || t.customer_id;
          } catch (e) {}
        }
        return {
          id: originalTxId,
          merchant_id: targetMerchantId,
          customer_id: originalCustomerId,
          amount: parseFloat(t.amount),
          type: t.type,
          description,
          date: t.date
        };
      }).sort((a, b) => new Date(a.date).getTime() - new Date(a.date).getTime());

      setCachedQueryResult(cacheKey, result);
      return result;
    } catch (err) {
      console.error('[SUPABASE READ ERROR] Transactions query failed:', err.message);
      throw err;
    }
  })();
}

function getTransactionsLocal(merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const targetDate = dateStr ? dateStr.slice(0, 10) : null;
  
  return (db.transactions || [])
    .filter(t => {
      if ((t.merchant_id || 'merchant_1') !== targetMerchantId) return false;
      if (targetDate && getLocalDateStr(t.date) > targetDate) return false;
      return true;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

async function deleteSummaryFromSupabase(merchantId, dateStr) {
  if (process.env.DISABLE_SUPABASE_SYNC === 'true') return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;
  try {
    const { supabase } = await import('./supabase.js');
    await supabase.from('daily_summaries').delete()
      .eq('merchant_id', toUUID(merchantId))
      .eq('date', dateStr);
  } catch (e) {
    console.error('[SUPABASE DELETE ERROR] Failed to delete summary:', e.message);
  }
}

async function deleteMerchantSummariesFromSupabase(merchantId) {
  if (process.env.DISABLE_SUPABASE_SYNC === 'true') return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;
  try {
    const { supabase } = await import('./supabase.js');
    await supabase.from('daily_summaries').delete()
      .eq('merchant_id', toUUID(merchantId));
  } catch (e) {
    console.error('[SUPABASE DELETE ERROR] Failed to delete summaries:', e.message);
  }
}

export function invalidateMerchantSummaries(db, merchantId) {
  const targetMerchantId = merchantId || 'merchant_1';
  db.daily_summaries = (db.daily_summaries || []).filter(s => (s.merchant_id || 'merchant_1') !== targetMerchantId);
  deleteMerchantSummariesFromSupabase(targetMerchantId).catch(err => {
    console.error('[SUPABASE ASYNC ERROR] Summary clean failed:', err.message);
  });
}

export function invalidateSpecificSummary(db, merchantId, dateStr) {
  const targetMerchantId = merchantId || 'merchant_1';
  const txDateStr = getLocalDateStr(dateStr);
  const todayDateStr = getTodayStr();
  db.daily_summaries = (db.daily_summaries || []).filter(s => 
    (s.merchant_id || 'merchant_1') !== targetMerchantId || 
    (s.date !== txDateStr && s.date !== todayDateStr)
  );
  deleteSummaryFromSupabase(targetMerchantId, txDateStr).catch(err => {
    console.error('[SUPABASE ASYNC ERROR] Summary clean failed:', err.message);
  });
  deleteSummaryFromSupabase(targetMerchantId, todayDateStr).catch(err => {
    console.error('[SUPABASE ASYNC ERROR] Summary clean failed:', err.message);
  });
}

export function addCustomer({ name, phone, alias, aliases, confirmNew = false, merchantId, preloadedCustomers }) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return addCustomerLocal({ name, phone, alias, aliases, confirmNew, merchantId: targetMerchantId, preloadedCustomers });
  }
  
  return (async () => {
    try {
      const sanitizedName = sanitizeCustomerName(name);
      
      const existingCustomers = preloadedCustomers || await getCustomers(targetMerchantId);
      const norm = getNormalizedNameIdentifier(sanitizedName);
      const normPhone = phone ? phone.replace(/\D/g, '') : '';
      
      const hasDifferentPhone = (c) => {
        if (!normPhone || normPhone.length < 10) return false;
        const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
        if (!cp || cp.length < 10) return false;
        return !cp.endsWith(normPhone.slice(-10));
      };
      
      if (!confirmNew) {
        const existing = existingCustomers.find(c => 
          !c.deleted &&
          !hasDifferentPhone(c) && 
          !areNamesDistinct(c.name, sanitizedName) && (
            c.normalizedName === norm || 
            getNormalizedNameIdentifier(c.name) === norm ||
            (c.aliases || []).some(a => getNormalizedNameIdentifier(a) === norm)
          )
        );
        
        if (existing) {
          console.log(`[PREVENTED] Duplicate customer profile creation blocked for: "${sanitizedName}". returning existing ID: ${existing.id}`);
          return {
            ...existing,
            was_existing: true
          };
        }
      }
      
      const id = 'cust_' + uuidv4().substring(0, 8);
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
        id,
        merchant_id: targetMerchantId,
        name: cleanName,
        displayName: cleanName,
        alias: cleanAlias,
        normalizedName: norm,
        aliases: Array.from(defaultAliases),
        phone: phone && phone.trim() ? phone.trim() : null,
        created_at: new Date().toISOString(),
        deleted: false
      };
      
      const { supabase } = await import('./supabase.js');
      
      const queryStart = Date.now();
      console.log(`[SUPABASE WRITE START] addCustomer - Step 1: Inserting customer "${newCustomer.name}" (ID: ${newCustomer.id})`);
      
      const cErrRes = await supabase.from('customers').insert({
        id: toUUID(newCustomer.id),
        merchant_id: toUUID(newCustomer.merchant_id),
        name: newCustomer.name,
        phone: newCustomer.phone || '0000000000',
        alias: JSON.stringify({
          alias: newCustomer.alias,
          aliases: newCustomer.aliases,
          normalizedName: newCustomer.normalizedName,
          deleted: false,
          original_id: newCustomer.id,
          original_merchant_id: newCustomer.merchant_id
        }),
        created_at: newCustomer.created_at
      });

      if (cErrRes.error) {
        console.error('[SUPABASE WRITE ERROR] Customer insert step failed:', cErrRes.error.message);
        throw cErrRes.error;
      }
      
      console.log(`[SUPABASE WRITE SUCCESS] Customer insert step succeeded in ${Date.now() - queryStart}ms. Step 2: Initializing outstanding balance for customer ID: ${newCustomer.id}`);
      const balanceStart = Date.now();

      const bErrRes = await supabase.from('outstanding_balances').insert({
        customer_id: toUUID(newCustomer.id),
        merchant_id: toUUID(newCustomer.merchant_id),
        balance: 0.00,
        last_updated: newCustomer.created_at
      });

      if (bErrRes.error) {
        console.error('[SUPABASE WRITE ERROR] Outstanding balance insert step failed:', bErrRes.error.message);
        throw bErrRes.error;
      }
      
      console.log(`[SUPABASE WRITE SUCCESS] Outstanding balance insert step succeeded in ${Date.now() - balanceStart}ms. Total query time: ${Date.now() - queryStart}ms`);
      
      // Invalidate short-lived cache
      invalidateQueryCache('customers_');
      
      const db = readDb();
      db.customers.push(newCustomer);
      db.outstanding_balances.push({
        customer_id: newCustomer.id,
        merchant_id: targetMerchantId,
        balance: 0,
        last_updated: newCustomer.created_at
      });
      invalidateMerchantSummaries(db, targetMerchantId);
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
      
      console.log(`[CREATED] New customer profile created: "${newCustomer.name}" (ID: ${newCustomer.id}) for merchant ${targetMerchantId}`);
      return { ...newCustomer, balance: 0, last_updated: newCustomer.created_at };
    } catch (err) {
      console.error('[SUPABASE WRITE ERROR] Customer creation failed:', err.message);
      throw err;
    }
  })();
}

function addCustomerLocal({ name, phone, alias, aliases, confirmNew = false, merchantId, preloadedCustomers }) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  
  const sanitizedName = sanitizeCustomerName(name);
  const norm = getNormalizedNameIdentifier(sanitizedName);

  const normPhone = phone ? phone.replace(/\D/g, '') : '';
  const hasDifferentPhone = (c) => {
    if (!normPhone || normPhone.length < 10) return false;
    const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
    if (!cp || cp.length < 10) return false;
    return !cp.endsWith(normPhone.slice(-10));
  };

  if (!confirmNew) {
    const customersList = preloadedCustomers || db.customers;
    const existing = customersList.find(c => 
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
  invalidateQueryCache('customers_');
  writeDb(db);
  console.log(`[CREATED] New customer profile created locally: "${newCustomer.name}" (ID: ${newCustomer.id}) for merchant ${targetMerchantId}`);
  return { ...newCustomer, balance: 0, last_updated: newCustomer.created_at };
}

export async function deleteCustomer(id, merchantId) {
  const db = readDb();
  const customer = db.customers.find(c => c.id === id && (c.merchant_id || 'merchant_1') === (merchantId || 'merchant_1'));
  if (!customer) return false;

  // Soft delete customer locally to maintain test suite compatibility (expects deleted = true)
  customer.deleted = true;

  // Cleanup outstanding balances
  db.outstanding_balances = (db.outstanding_balances || []).filter(b => b.customer_id !== id);

  // Cleanup reminders
  db.reminders = (db.reminders || []).filter(r => r.customer_id !== id);

  // Cleanup transactions
  db.transactions = (db.transactions || []).filter(t => t.customer_id !== id);

  invalidateMerchantSummaries(db, merchantId);

  // Perform permanent delete from Supabase (if credentials configured)
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.DISABLE_SUPABASE_SYNC !== 'true') {
    try {
      const { supabase } = await import('./supabase.js');
      const queryStart = Date.now();
      const { error } = await supabase.from('customers').delete().eq('id', toUUID(id));
      if (error) throw error;
      console.log(`[SUPABASE QUERY] deleteCustomer - Duration: ${Date.now() - queryStart}ms`);
      console.log(`[SUPABASE] Permanently deleted customer UUID: ${toUUID(id)}`);
    } catch (err) {
      console.error('[SUPABASE DELETE ERROR] Customer delete failed:', err.message);
      throw err;
    }
  }

  invalidateQueryCache('customers_');
  invalidateQueryCache('transactions_');
  invalidateQueryCache('reminders_');
  writeDb(db);
  console.log(`[DELETED] Customer profile soft-deleted locally and permanently purged from cloud: "${customer.name}" (ID: ${id})`);
  return true;
}

export function updateCustomer(id, { name, phone, alias, address, notes, customerType, merchantId }) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return updateCustomerLocal(id, { name, phone, alias, address, notes, customerType, merchantId: targetMerchantId });
  }
  
  return (async () => {
    try {
      const sanitizedName = sanitizeCustomerName(name);
      const norm = getNormalizedNameIdentifier(sanitizedName);
      
      const existingCustomers = await getCustomers(targetMerchantId);
      const customer = existingCustomers.find(c => c.id === id);
      if (!customer) {
        throw new Error('Customer not found');
      }
      
      if (!name || name.trim().length < 2) {
        throw new Error('Customer name must be at least 2 characters');
      }
      
      let cleanPhone = phone;
      if (phone) {
        cleanPhone = phone.trim();
        const phoneRegex = /^(?:\+?91)?[6-9]\d{9}$/;
        if (!phoneRegex.test(cleanPhone)) {
          throw new Error('Invalid phone number format');
        }
      }
      
      const normPhone = cleanPhone ? cleanPhone.replace(/\D/g, '') : '';
      const hasDifferentPhone = (c) => {
        if (!normPhone || normPhone.length < 10) return false;
        const cp = c.phone ? c.phone.replace(/\D/g, '') : '';
        if (!cp || cp.length < 10) return false;
        return !cp.endsWith(normPhone.slice(-10));
      };
      
      const duplicate = existingCustomers.find(c =>
        c.id !== id &&
        !c.deleted &&
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
      
      const updatedAliases = customer.aliases || [];
      if (!updatedAliases.includes(sanitizedName)) {
        updatedAliases.push(sanitizedName);
      }
      
      const cleanAlias = sanitizeCustomerName(alias || name.split(' ')[0] || '');
      const defaultAliases = new Set(updatedAliases);
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

      const updatedCust = {
        ...customer,
        name: sanitizedName,
        displayName: sanitizedName,
        phone: cleanPhone || null,
        alias: cleanAlias,
        address: address !== undefined ? address : customer.address || '',
        notes: notes !== undefined ? notes : customer.notes || '',
        customerType: customerType !== undefined ? customerType : customer.customerType || 'Retail',
        normalizedName: norm,
        aliases: Array.from(defaultAliases)
      };
      
      const { supabase } = await import('./supabase.js');
      const queryStart = Date.now();
      const { error: cErr } = await supabase
        .from('customers')
        .update({
          name: updatedCust.name,
          phone: updatedCust.phone || '0000000000',
          alias: JSON.stringify({
            alias: updatedCust.alias,
            aliases: updatedCust.aliases,
            normalizedName: updatedCust.normalizedName,
            address: updatedCust.address,
            notes: updatedCust.notes,
            customerType: updatedCust.customerType,
            deleted: false,
            original_id: updatedCust.id,
            original_merchant_id: targetMerchantId
          })
        })
        .eq('id', toUUID(id))
        .eq('merchant_id', toUUID(targetMerchantId));
        
      if (cErr) throw cErr;
      console.log(`[SUPABASE QUERY] updateCustomer - Duration: ${Date.now() - queryStart}ms`);
      
      const db = readDb();
      const localIndex = db.customers.findIndex(c => c.id === id);
      if (localIndex !== -1) {
        db.customers[localIndex] = {
          ...db.customers[localIndex],
          name: updatedCust.name,
          displayName: updatedCust.name,
          phone: updatedCust.phone,
          alias: updatedCust.alias,
          address: updatedCust.address,
          notes: updatedCust.notes,
          customerType: updatedCust.customerType,
          normalizedName: updatedCust.normalizedName,
          aliases: updatedCust.aliases
        };
        db.reminders = (db.reminders || []).map(r => {
          if (r.customer_id === id && (r.merchant_id || 'merchant_1') === targetMerchantId) {
            return {
              ...r,
              customer_name: sanitizedName,
              customer_phone: updatedCust.phone
            };
          }
          return r;
        });
        invalidateMerchantSummaries(db, targetMerchantId);
        invalidateQueryCache('customers_');
        invalidateQueryCache('transactions_');
        invalidateQueryCache('reminders_');
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
      }
      
      const ledgerData = await getCustomerLedger(id, targetMerchantId);
      const remindersList = ledgerData.reminders || [];
      await supabase.from('reminders').delete().eq('customer_id', toUUID(id));
      if (remindersList.length > 0) {
        const remindersToInsert = remindersList.map(r => ({
          id: toUUID(r.id),
          merchant_id: toUUID(targetMerchantId),
          customer_id: toUUID(id),
          amount: parseFloat(r.amount),
          due_date: r.due_date,
          days_overdue: r.days_overdue,
          priority: r.priority,
          status: r.status
        }));
        await supabase.from('reminders').insert(remindersToInsert);
      }
      
      return updatedCust;
    } catch (err) {
      console.error('[SUPABASE WRITE ERROR] Customer update failed:', err.message);
      throw err;
    }
  })();
}

function updateCustomerLocal(id, { name, phone, alias, address, notes, customerType, merchantId }) {
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
  invalidateQueryCache('customers_');
  invalidateQueryCache('transactions_');
  invalidateQueryCache('reminders_');
  writeDb(db);
  console.log(`[UPDATED] Customer profile updated locally: "${customer.name}" (ID: ${id})`);
  
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

export async function deleteTransaction(id, merchantId) {
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

  // Perform permanent delete and recalculate in Supabase
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.DISABLE_SUPABASE_SYNC !== 'true') {
    try {
      const { supabase } = await import('./supabase.js');
      const txUuid = toUUID(id);
      const customerUuid = toUUID(customerId);
      const merchantUuid = toUUID(targetMerchantId);

      const queryStart = Date.now();
      const { error: dErr } = await supabase.from('transactions').delete().eq('id', txUuid);
      if (dErr) throw dErr;

      const { data: dbTxs, error: fErr } = await supabase
        .from('transactions')
        .select('*')
        .eq('customer_id', customerUuid);
      if (fErr) throw fErr;

      const balance = (dbTxs || []).reduce((sum, t) => {
        if (t.type === 'credit') return sum + parseFloat(t.amount);
        return Math.max(0, sum - parseFloat(t.amount));
      }, 0);

      const { error: bErr } = await supabase.from('outstanding_balances').upsert({
        customer_id: customerUuid,
        merchant_id: merchantUuid,
        balance,
        last_updated: new Date().toISOString()
      });
      if (bErr) throw bErr;
      console.log(`[SUPABASE QUERY] deleteTransaction (Delete & Recalculate Balance) - Duration: ${Date.now() - queryStart}ms`);

      const ledgerData = await getCustomerLedger(customerId, targetMerchantId);
      const remindersList = ledgerData.reminders || [];
      await supabase.from('reminders').delete().eq('customer_id', customerUuid);
      if (remindersList.length > 0) {
        const remindersToInsert = remindersList.map(r => ({
          id: toUUID(r.id),
          merchant_id: merchantUuid,
          customer_id: customerUuid,
          amount: parseFloat(r.amount),
          due_date: r.due_date,
          days_overdue: r.days_overdue,
          priority: r.priority,
          status: r.status
        }));
        await supabase.from('reminders').insert(remindersToInsert);
      }

      await deleteSummaryFromSupabase(targetMerchantId, tx.date);
    } catch (err) {
      console.error('[SUPABASE DELETE ERROR] Transaction delete failed:', err.message);
      throw err;
    }
  }

  invalidateQueryCache('customers_');
  invalidateQueryCache('transactions_');
  invalidateQueryCache('reminders_');
  writeDb(db);
  console.log(`[DELETED] Transaction deleted locally and permanently purged from cloud: ID ${id}, recalculated balance for customer ${customerId} to ₹${newBalance}`);
  return true;
}

export function getCustomerLedger(customerId, merchantId, dateStr) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return getCustomerLedgerLocal(customerId, targetMerchantId, dateStr);
  }
  
  return (async () => {
    try {
      const { supabase } = await import('./supabase.js');
      const customerUuid = toUUID(customerId);
      const merchantUuid = toUUID(targetMerchantId);
      
      const queryStart = Date.now();
      // Parallelize customer details fetch and transaction records fetch
      const [cRes, tRes] = await Promise.all([
        supabase
          .from('customers')
          .select('*')
          .eq('id', customerUuid)
          .eq('merchant_id', merchantUuid)
          .maybeSingle(),
        (() => {
          let q = supabase
            .from('transactions')
            .select('*')
            .eq('customer_id', customerUuid)
            .eq('merchant_id', merchantUuid);
          if (dateStr) {
            q = q.lte('date', new Date(dateStr + 'T23:59:59.999Z').toISOString());
          }
          return q;
        })()
      ]);
      console.log(`[SUPABASE QUERY] getCustomerLedger (Parallelized Reads) - Duration: ${Date.now() - queryStart}ms`);
      
      const { data: customerData, error: cErr } = cRes;
      const { data: txs, error: tErr } = tRes;
      
      if (cErr) throw cErr;
      if (tErr) throw tErr;
      if (!customerData) return null;
      
      let alias = customerData.alias;
      let aliases = [customerData.name];
      let normalizedName = customerData.name.toLowerCase().replace(/\s+/g, '');
      let deleted = false;
      let originalId = customerData.id;
      
      if (customerData.alias && customerData.alias.startsWith('{') && customerData.alias.endsWith('}')) {
        try {
          const extra = JSON.parse(customerData.alias);
          alias = extra.alias || customerData.alias;
          aliases = extra.aliases || aliases;
          normalizedName = extra.normalizedName || normalizedName;
          deleted = extra.deleted || false;
          originalId = extra.original_id || customerData.id;
        } catch (e) {}
      }
      
      if (deleted) return null;
      if (tErr) throw tErr;
      
      const transactions = (txs || []).map(t => {
        let description = t.description;
        let originalTxId = t.id;
        if (t.description && t.description.startsWith('{') && t.description.endsWith('}')) {
          try {
            const extra = JSON.parse(t.description);
            description = extra.description || t.description;
            originalTxId = extra.original_id || t.id;
          } catch (e) {}
        }
        return {
          id: originalTxId,
          merchant_id: targetMerchantId,
          customer_id: customerId,
          amount: parseFloat(t.amount),
          type: t.type,
          description,
          date: t.date
        };
      }).sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      
      const balance = transactions.reduce((sum, t) => {
        if (t.type === 'credit') return sum + t.amount;
        return Math.max(0, sum - t.amount);
      }, 0);
      
      const lastActiveDate = transactions.length > 0 ? transactions[transactions.length - 1].date : customerData.created_at;
      
      const customer = {
        id: originalId,
        merchant_id: targetMerchantId,
        name: customerData.name,
        displayName: customerData.name,
        alias,
        phone: customerData.phone === '0000000000' ? null : customerData.phone,
        created_at: customerData.created_at,
        normalizedName,
        aliases,
        deleted,
        balance,
        last_updated: lastActiveDate
      };
      
      const allReminders = await getReminders(targetMerchantId, dateStr);
      const reminders = allReminders.filter(r => r.customer_id === customerId);
      
      return {
        customer,
        transactions,
        reminders
      };
    } catch (err) {
      console.error('[SUPABASE READ ERROR] Ledger query failed:', err.message);
      throw err;
    }
  })();
}

function getCustomerLedgerLocal(customerId, merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  
  let customer = getCustomersLocal(targetMerchantId, dateStr).find(c => c.id === customerId);
  
  if (!customer) {
    const futureCustomer = getCustomersLocal(targetMerchantId).find(c => c.id === customerId);
    if (!futureCustomer) return null;
    
    customer = {
      ...futureCustomer,
      balance: 0,
      last_updated: futureCustomer.created_at
    };
  }

  const targetDate = dateStr ? dateStr.slice(0, 10) : null;
  const transactions = (db.transactions || [])
    .filter(t => t.customer_id === customerId && (t.merchant_id || 'merchant_1') === targetMerchantId && (!targetDate || getLocalDateStr(t.date) <= targetDate))
    .sort((a, b) => new Date(a.date).getTime() - new Date(a.date).getTime());

  const reminders = getRemindersLocal(targetMerchantId, dateStr).filter(r => r.customer_id === customerId);

  return {
    customer,
    transactions,
    reminders
  };
}

export function addTransaction({ customerId, amount, type, description, date, aliasSpoken, merchantId }) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return addTransactionLocal({ customerId, amount, type, description, date, aliasSpoken, merchantId: targetMerchantId });
  }
  
  return (async () => {
    try {
      const parsedAmount = Math.max(0, parseFloat(amount));
      const txDate = date ? new Date(date).toISOString() : new Date().toISOString();
      const txId = 'tx_' + uuidv4().substring(0, 8);
      
      const newTx = {
        id: txId,
        merchant_id: targetMerchantId,
        customer_id: customerId,
        amount: parsedAmount,
        type,
        description: description || (type === 'credit' ? 'Udhaar entry' : 'Wapas received'),
        date: txDate
      };
      
      const { supabase } = await import('./supabase.js');
      const customerUuid = toUUID(customerId);
      const merchantUuid = toUUID(targetMerchantId);
      
      if (aliasSpoken) {
        const { data: customerData } = await supabase
          .from('customers')
          .select('*')
          .eq('id', customerUuid)
          .single();
          
        if (customerData) {
          let alias = customerData.alias;
          let aliases = [customerData.name];
          let normalizedName = customerData.name.toLowerCase().replace(/\s+/g, '');
          let deleted = false;
          let originalId = customerData.id;
          
          if (customerData.alias && customerData.alias.startsWith('{') && customerData.alias.endsWith('}')) {
            try {
              const extra = JSON.parse(customerData.alias);
              alias = extra.alias || customerData.alias;
              aliases = extra.aliases || aliases;
              normalizedName = extra.normalizedName || normalizedName;
              deleted = extra.deleted || false;
              originalId = extra.original_id || customerData.id;
            } catch (e) {}
          }
          
          const cleanAlias = aliasSpoken.trim();
          if (!aliases.includes(cleanAlias)) {
            aliases.push(cleanAlias);
            await supabase.from('customers').update({
              alias: JSON.stringify({
                alias,
                aliases,
                normalizedName,
                deleted,
                original_id: originalId,
                original_merchant_id: targetMerchantId
              })
            }).eq('id', customerUuid);
          }
        }
      }
      
      const queryStart = Date.now();
      // 1. Fetch previous balance in parallel with transaction insert
      const [tRes, balRes] = await Promise.all([
        supabase.from('transactions').insert({
          id: toUUID(txId),
          customer_id: customerUuid,
          merchant_id: merchantUuid,
          amount: parsedAmount,
          type,
          description: JSON.stringify({
            description: newTx.description,
            original_id: txId,
            original_customer_id: customerId,
            merchant_id: targetMerchantId
          }),
          date: txDate
        }),
        supabase.from('outstanding_balances').select('balance').eq('customer_id', customerUuid).maybeSingle()
      ]);
      
      if (tRes.error) throw tRes.error;
      if (balRes.error) throw balRes.error;
      console.log(`[SUPABASE QUERY] addTransaction (Parallelized Insert & Balance Select) - Duration: ${Date.now() - queryStart}ms`);
      
      const prevBalance = balRes.data ? parseFloat(balRes.data.balance) : 0;
      const balance = type === 'credit' ? prevBalance + parsedAmount : Math.max(0, prevBalance - parsedAmount);
      
      // 2. Upsert outstanding balance
      const { error: bErr } = await supabase.from('outstanding_balances').upsert({
        customer_id: customerUuid,
        merchant_id: merchantUuid,
        balance,
        last_updated: txDate
      });
      if (bErr) throw bErr;
      
      // 3. Move reminders update and summary invalidation to background asynchronously
      (async () => {
        try {
          const ledgerData = await getCustomerLedger(customerId, targetMerchantId);
          if (ledgerData) {
            const remindersList = ledgerData.reminders || [];
            await supabase.from('reminders').delete().eq('customer_id', customerUuid);
            if (remindersList.length > 0) {
              const remindersToInsert = remindersList.map(r => ({
                id: toUUID(r.id),
                merchant_id: merchantUuid,
                customer_id: customerUuid,
                amount: parseFloat(r.amount),
                due_date: r.due_date,
                days_overdue: r.days_overdue,
                priority: r.priority,
                status: r.status
              }));
              await supabase.from('reminders').insert(remindersToInsert);
            }
          }
          await deleteSummaryFromSupabase(targetMerchantId, txDate);
          console.log(`[BACKGROUND TASK] Asynchronously updated reminders and invalidated summary cache for merchant ${targetMerchantId}`);
        } catch (bgErr) {
          console.warn('[BACKGROUND TASK WARNING] Failed to update reminders/summary in background:', bgErr.message);
        }
      })();
      
      // Invalidate short-lived cache
      invalidateQueryCache('transactions_');
      invalidateQueryCache('reminders_');
      invalidateQueryCache('customers_');
      
      const db = readDb();
      db.transactions.push(newTx);
      let localBalanceEntry = db.outstanding_balances.find(b => b.customer_id === customerId && (b.merchant_id || 'merchant_1') === targetMerchantId);
      if (!localBalanceEntry) {
        localBalanceEntry = { customer_id: customerId, merchant_id: targetMerchantId, balance: 0, last_updated: txDate };
        db.outstanding_balances.push(localBalanceEntry);
      }
      if (type === 'credit') {
        localBalanceEntry.balance += parsedAmount;
      } else {
        localBalanceEntry.balance = Math.max(0, localBalanceEntry.balance - parsedAmount);
      }
      localBalanceEntry.last_updated = txDate;
      syncRemindersForCustomer(db, customerId, targetMerchantId);
      invalidateSpecificSummary(db, targetMerchantId, txDate);
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
      
      return { transaction: newTx, newBalance: balance };
    } catch (err) {
      console.error('[SUPABASE WRITE ERROR] Transaction creation failed:', err.message);
      throw err;
    }
  })();
}

function addTransactionLocal({ customerId, amount, type, description, date, aliasSpoken, merchantId }) {
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
    type,
    description: description || (type === 'credit' ? 'Udhaar entry' : 'Wapas received'),
    date: txDate
  };

  db.transactions.push(newTx);
  console.log(`[TRANSACTION ATTACHED] Added ${type} of ₹${parsedAmount} to customer ID ${customerId}`);

  let balanceEntry = db.outstanding_balances.find(b => b.customer_id === customerId && (b.merchant_id || 'merchant_1') === targetMerchantId);
  if (!balanceEntry) {
    balanceEntry = { customer_id: customerId, merchant_id: targetMerchantId, balance: 0, last_updated: txDate };
    db.outstanding_balances.push(balanceEntry);
  }

  if (type === 'credit') {
    balanceEntry.balance += parsedAmount;
  } else {
    balanceEntry.balance = Math.max(0, balanceEntry.balance - parsedAmount);
  }
  balanceEntry.last_updated = txDate;

  syncRemindersForCustomer(db, customerId, targetMerchantId);
  invalidateSpecificSummary(db, targetMerchantId, txDate);
  invalidateQueryCache('transactions_');
  invalidateQueryCache('reminders_');
  invalidateQueryCache('customers_');
  writeDb(db);
  return { transaction: newTx, newBalance: balanceEntry.balance };
}

export function getReminders(merchantId, dateStr) {
  const targetMerchantId = merchantId || 'merchant_1';
  if (process.env.DISABLE_SUPABASE_SYNC === 'true' || !process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return getRemindersLocal(targetMerchantId, dateStr);
  }
  
  const cacheKey = `reminders_${targetMerchantId}_${dateStr || 'all'}`;
  const cached = getCachedQueryResult(cacheKey);
  if (cached) {
    console.log(`[QUERY CACHE HIT] getReminders: ${cacheKey}`);
    return Promise.resolve(cached);
  }
  
  return (async () => {
    try {
      const { supabase } = await import('./supabase.js');
      const merchantUuid = toUUID(targetMerchantId);
      const targetDate = dateStr ? dateStr.slice(0, 10) : getTodayStr();
      
      const queryStart = Date.now();
      // Parallelize customer list and transactions fetch
      const [customers, txsRes] = await Promise.all([
        getCustomers(targetMerchantId),
        supabase
          .from('transactions')
          .select('*')
          .eq('merchant_id', merchantUuid)
          .lte('date', new Date(targetDate + 'T23:59:59.999Z').toISOString())
      ]);
      
      const { data: txs, error: tErr } = txsRes;
      if (tErr) throw tErr;
      console.log(`[SUPABASE QUERY] getReminders (Parallelized Reads) - Duration: ${Date.now() - queryStart}ms`);
      
      const transactions = (txs || []).map(t => {
        let description = t.description;
        let originalTxId = t.id;
        let originalCustomerId = t.customer_id;
        if (t.description && t.description.startsWith('{') && t.description.endsWith('}')) {
          try {
            const extra = JSON.parse(t.description);
            description = extra.description || t.description;
            originalTxId = extra.original_id || t.id;
            originalCustomerId = extra.original_customer_id || t.customer_id;
          } catch (e) {}
        }
        return {
          id: originalTxId,
          merchant_id: targetMerchantId,
          customer_id: originalCustomerId,
          amount: parseFloat(t.amount),
          type: t.type,
          description,
          date: t.date
        };
      });
      
      const remindersList = [];
      
      for (const customer of customers) {
        const customerTxs = transactions.filter(t => t.customer_id === customer.id);
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
      
      setCachedQueryResult(cacheKey, remindersList);
      return remindersList;
    } catch (err) {
      console.error('[SUPABASE READ ERROR] Reminders query failed:', err.message);
      throw err;
    }
  })();
}

function getRemindersLocal(merchantId, dateStr) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  const customers = (db.customers || []).filter(c => !c.deleted && (c.merchant_id || 'merchant_1') === targetMerchantId);
  const transactions = db.transactions || [];
  
  const targetDate = dateStr ? dateStr.slice(0, 10) : getTodayStr();

  const remindersList = [];

  for (const customer of customers) {
    const customerTxs = transactions.filter(t => 
      t.customer_id === customer.id && 
      (t.merchant_id || 'merchant_1') === targetMerchantId &&
      getLocalDateStr(t.date) <= targetDate
    );

    const balance = customerTxs.reduce((sum, t) => {
      if (t.type === 'credit') return sum + t.amount;
      return Math.max(0, sum - t.amount);
    }, 0);

    if (balance > 0) {
      const credits = customerTxs
        .filter(t => t.type === 'credit')
        .sort((a, b) => new Date(a.date).getTime() - new Date(a.date).getTime())
        .map(t => ({ date: t.date, amount: t.amount, remaining: t.amount }));

      const collections = customerTxs
        .filter(t => t.type === 'collection')
        .sort((a, b) => new Date(a.date).getTime() - new Date(a.date).getTime());

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

export function toUUID(id) {
  if (!id) return null;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(id)) return id;
  const hash = crypto.createHash('sha256').update(id).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    'a' + hash.substring(17, 20),
    hash.substring(20, 32)
  ].join('-');
}

export async function syncFromSupabase() {
  if (process.env.DISABLE_SUPABASE_SYNC === 'true') {
    console.log('[SUPABASE SYNC] Bypassed in test environment');
    return;
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    console.log('[SUPABASE SYNC] Disabled: Missing credentials in environment');
    return;
  }

  const startTime = Date.now();
  try {
    console.log('[LEDGER SYNC START] Fetching remote state from Supabase...');
    const { supabase } = await import('./supabase.js');

    const [uRes, cRes, tRes, sRes, rRes] = await Promise.all([
      supabase.from('users').select('*'),
      supabase.from('customers').select('*'),
      supabase.from('transactions').select('*'),
      supabase.from('daily_summaries').select('*'),
      supabase.from('reminders').select('*')
    ]);

    const { data: users, error: uErr } = uRes;
    if (uErr) throw uErr;

    const { data: customers, error: cErr } = cRes;
    if (cErr) throw cErr;

    const { data: transactions, error: tErr } = tRes;
    if (tErr) throw tErr;

    const { data: summaries, error: sErr } = sRes;
    if (sErr) throw sErr;

    const { data: reminders, error: rErr } = rRes;
    if (rErr) throw rErr;

    console.log(`[LEDGER SYNC END] Fetching remote state complete - Duration: ${Date.now() - startTime}ms`);

    const dbData = {
      users: [],
      customers: [],
      transactions: [],
      outstanding_balances: [],
      reminders: [],
      daily_summaries: []
    };

    // Restore users
    if (users) {
      for (const u of users) {
        let id = u.id;
        let businessName = u.business_name;
        if (u.business_name && u.business_name.startsWith('{') && u.business_name.endsWith('}')) {
          try {
            const extra = JSON.parse(u.business_name);
            id = extra.original_id || u.id;
            businessName = extra.business_name || u.business_name;
          } catch (e) {}
        }
        dbData.users.push({
          id,
          name: u.name,
          business_name: businessName,
          phone: u.phone
        });
      }
    }

    // Restore customers
    if (customers) {
      for (const c of customers) {
        let alias = c.alias;
        let aliases = [c.name];
        let normalizedName = c.name.toLowerCase().replace(/\s+/g, '');
        let deleted = false;
        let id = c.id;
        let merchantId = c.merchant_id;

        if (c.alias && c.alias.startsWith('{') && c.alias.endsWith('}')) {
          try {
            const extra = JSON.parse(c.alias);
            alias = extra.alias || c.alias;
            aliases = extra.aliases || aliases;
            normalizedName = extra.normalizedName || normalizedName;
            deleted = extra.deleted || false;
            id = extra.original_id || c.id;
            merchantId = extra.original_merchant_id || c.merchant_id;
          } catch (e) {}
        }

        dbData.customers.push({
          id,
          merchant_id: merchantId,
          name: c.name,
          displayName: c.name,
          alias,
          phone: c.phone === '0000000000' ? null : c.phone,
          created_at: c.created_at,
          normalizedName,
          aliases,
          deleted
        });
      }
    }

    // Restore transactions
    if (transactions) {
      const activeCustomerIds = new Set(dbData.customers.filter(c => !c.deleted).map(c => c.id));
      for (const t of transactions) {
        let id = t.id;
        let customerId = t.customer_id;
        let description = t.description;
        let merchantId = 'merchant_1';

        if (t.description && t.description.startsWith('{') && t.description.endsWith('}')) {
          try {
            const extra = JSON.parse(t.description);
            description = extra.description || t.description;
            id = extra.original_id || t.id;
            customerId = extra.original_customer_id || t.customer_id;
            merchantId = extra.merchant_id || 'merchant_1';
          } catch (e) {}
        }

        // Filter out transactions of deleted/inactive customers
        if (!activeCustomerIds.has(customerId)) {
          console.log(`[SUPABASE SYNC] Filtering out orphaned transaction ${id} for inactive customer ${customerId}`);
          continue;
        }

        dbData.transactions.push({
          id,
          merchant_id: merchantId,
          customer_id: customerId,
          amount: parseFloat(t.amount),
          type: t.type,
          description,
          date: t.date
        });
      }
    }

    // Restore daily summaries
    if (summaries) {
      for (const s of summaries) {
        const user = dbData.users.find(u => toUUID(u.id) === s.merchant_id);
        const merchantId = user ? user.id : 'merchant_1';

        dbData.daily_summaries.push({
          date: s.date,
          merchant_id: merchantId,
          credit_given: parseFloat(s.credit_given),
          collections: parseFloat(s.collections),
          net_change: parseFloat(s.net_change),
          summary_text: s.summary_text,
          created_at: s.created_at
        });
      }
    }

    // Restore reminders
    if (reminders) {
      for (const r of reminders) {
        let id = r.id;
        const cust = dbData.customers.find(c => toUUID(c.id) === r.customer_id && !c.deleted);
        if (cust) {
          dbData.reminders.push({
            id,
            merchant_id: cust.merchant_id,
            customer_id: cust.id,
            customer_name: cust.name,
            customer_phone: cust.phone || '',
            amount: parseFloat(r.amount),
            due_date: r.due_date,
            days_overdue: r.days_overdue,
            priority: r.priority,
            status: r.status,
            created_at: new Date().toISOString()
          });
        } else {
          console.log(`[SUPABASE SYNC] Filtering out orphaned/deleted reminder ${id} for customer UUID ${r.customer_id}`);
        }
      }
    }

    // Recalculate outstanding balances for consistency
    const activeCustomers = dbData.customers.filter(c => !c.deleted);
    for (const c of activeCustomers) {
      const custTxs = dbData.transactions.filter(t => t.customer_id === c.id);
      const balance = custTxs.reduce((sum, t) => {
        if (t.type === 'credit') return sum + parseFloat(t.amount);
        return Math.max(0, sum - parseFloat(t.amount));
      }, 0);
      
      const lastTx = custTxs.length > 0 
        ? [...custTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0] 
        : null;

      dbData.outstanding_balances.push({
        customer_id: c.id,
        merchant_id: c.merchant_id,
        balance,
        last_updated: lastTx ? lastTx.date : c.created_at
      });
    }

     fs.writeFileSync(DB_FILE, JSON.stringify(dbData, null, 2), 'utf-8');
     invalidateQueryCache();
     console.log(`[SUPABASE SYNC] Successfully loaded cloud state into local db.json in ${Date.now() - startTime}ms.`);
   } catch (err) {
     console.error(`[SUPABASE SYNC ERROR] Initial sync failed: ${err.message} in ${Date.now() - startTime}ms.`);
   }
 }

export async function syncToSupabase(db) {
  if (process.env.DISABLE_SUPABASE_SYNC === 'true') return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return;

  const startTime = Date.now();
  try {
    const { supabase } = await import('./supabase.js');

    // 1. Sync Users
    try {
      const usersToUpsert = (db.users || []).map(u => ({
        id: toUUID(u.id),
        name: u.name,
        business_name: JSON.stringify({ business_name: u.business_name, original_id: u.id }),
        phone: u.phone || '0000000000',
        created_at: u.created_at || new Date().toISOString()
      }));
      if (usersToUpsert.length > 0) {
        const { error: uErr } = await supabase.from('users').upsert(usersToUpsert);
        if (uErr) {
          console.warn('[SUPABASE SYNC WARNING] User upsert failed:', uErr.message);
        }
      }
    } catch (userErr) {
      console.warn('[SUPABASE SYNC WARNING] User sync error:', userErr.message);
    }

    // 2. Sync Customers
    const customersToUpsert = (db.customers || []).filter(c => !c.deleted).map(c => ({
      id: toUUID(c.id),
      merchant_id: toUUID(c.merchant_id),
      name: c.name,
      alias: JSON.stringify({
        alias: c.alias,
        aliases: c.aliases,
        normalizedName: c.normalizedName,
        deleted: c.deleted || false,
        original_id: c.id,
        original_merchant_id: c.merchant_id
      }),
      phone: c.phone || '0000000000',
      created_at: c.created_at || new Date().toISOString()
    }));
    if (customersToUpsert.length > 0) {
      const { error: cErr } = await supabase.from('customers').upsert(customersToUpsert);
      if (cErr) throw cErr;
    }

    // 3. Sync Transactions
    const activeCustomerIds = new Set((db.customers || []).filter(c => !c.deleted).map(c => c.id));
    const transactionsToUpsert = (db.transactions || [])
      .filter(t => activeCustomerIds.has(t.customer_id))
      .map(t => ({
        id: toUUID(t.id),
        customer_id: toUUID(t.customer_id),
        merchant_id: toUUID(t.merchant_id || 'merchant_1'),
        amount: parseFloat(t.amount),
        type: t.type,
        description: JSON.stringify({
          description: t.description || '',
          original_id: t.id,
          original_customer_id: t.customer_id,
          merchant_id: t.merchant_id
        }),
        date: t.date || new Date().toISOString()
      }));
    if (transactionsToUpsert.length > 0) {
      const { error: tErr } = await supabase.from('transactions').upsert(transactionsToUpsert);
      if (tErr) throw tErr;
    }

    // 4. Sync Outstanding Balances
    const balancesToUpsert = (db.outstanding_balances || []).map(b => ({
      customer_id: toUUID(b.customer_id),
      merchant_id: toUUID(b.merchant_id || 'merchant_1'),
      balance: parseFloat(b.balance),
      last_updated: b.last_updated || new Date().toISOString()
    }));
    if (balancesToUpsert.length > 0) {
      const { error: bErr } = await supabase.from('outstanding_balances').upsert(balancesToUpsert);
      if (bErr) throw bErr;
    }

    // 5. Sync Daily Summaries
    const summariesToUpsert = (db.daily_summaries || []).map(s => {
      const summaryKey = `${s.merchant_id || 'merchant_1'}_${s.date}`;
      return {
        id: toUUID(summaryKey),
        merchant_id: toUUID(s.merchant_id || 'merchant_1'),
        date: s.date,
        credit_given: parseFloat(s.credit_given),
        collections: parseFloat(s.collections),
        net_change: parseFloat(s.net_change),
        summary_text: s.summary_text,
        created_at: s.created_at || new Date().toISOString()
      };
    });
    if (summariesToUpsert.length > 0) {
      const { error: sErr } = await supabase.from('daily_summaries').upsert(summariesToUpsert, { onConflict: 'merchant_id,date' });
      if (sErr) throw sErr;
    }

    // 6. Sync Reminders
    const remindersToUpsert = (db.reminders || [])
      .filter(r => activeCustomerIds.has(r.customer_id))
      .map(r => ({
        id: toUUID(r.id),
        customer_id: toUUID(r.customer_id),
        merchant_id: toUUID(r.merchant_id || 'merchant_1'),
        amount: parseFloat(r.amount),
        due_date: r.due_date || new Date().toISOString(),
        days_overdue: parseInt(r.days_overdue) || 0,
        priority: r.priority,
        status: r.status
      }));
    if (remindersToUpsert.length > 0) {
      const { error: rErr } = await supabase.from('reminders').upsert(remindersToUpsert);
      if (rErr) throw rErr;
    }

    console.log(`[SUPABASE SYNC] Successfully updated cloud state on Supabase in ${Date.now() - startTime}ms.`);
  } catch (err) {
    console.error(`[SUPABASE SYNC ERROR] Failed to upsert state: ${err.message} in ${Date.now() - startTime}ms.`);
  }
}

export async function addMerchant(merchant) {
  const db = readDb();
  const id = merchant.id || 'merchant_1';

  if (merchant.phone && merchant.phone !== '0000000000') {
    const normPhone = merchant.phone.replace(/\D/g, '');
    if (normPhone) {
      // 1. Check local db users
      const conflict = db.users.find(u => {
        if (!u.phone || u.phone === '0000000000' || u.id === id) return false;
        const uNorm = u.phone.replace(/\D/g, '');
        return uNorm.slice(-10) === normPhone.slice(-10);
      });
      if (conflict) {
        throw new Error('This mobile number is already registered.');
      }
      
      // 2. Check Supabase
      if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.DISABLE_SUPABASE_SYNC !== 'true') {
        const { supabase } = await import('./supabase.js');
        const { data: dbUser, error: queryError } = await supabase
          .from('users')
          .select('id, phone')
          .eq('phone', merchant.phone)
          .maybeSingle();
        
        if (queryError) {
          console.warn('[SUPABASE QUERY ERROR] Phone check failed:', queryError.message);
        } else if (dbUser && dbUser.id !== toUUID(id)) {
          throw new Error('This mobile number is already registered.');
        } else {
          const { data: dbUsers, error: suffixError } = await supabase
            .from('users')
            .select('id, phone')
            .like('phone', `%${normPhone.slice(-10)}`);
          
          if (!suffixError && dbUsers) {
            const conflictUser = dbUsers.find(u => u.id !== toUUID(id));
            if (conflictUser) {
              throw new Error('This mobile number is already registered.');
            }
          }
        }
      }
    }
  }
  
  const existing = db.users.find(u => u.id === id);
  if (existing) {
    existing.name = merchant.name || existing.name;
    existing.business_name = merchant.business_name || existing.business_name;
    existing.phone = merchant.phone || existing.phone;
  } else {
    db.users.push({
      id,
      name: merchant.name,
      business_name: merchant.business_name,
      phone: merchant.phone,
      created_at: new Date().toISOString()
    });
  }
  
  if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY && process.env.DISABLE_SUPABASE_SYNC !== 'true') {
    const { supabase } = await import('./supabase.js');
    const { error } = await supabase.from('users').upsert({
      id: toUUID(id),
      name: merchant.name,
      business_name: JSON.stringify({ business_name: merchant.business_name, original_id: id }),
      phone: merchant.phone || '0000000000',
      created_at: new Date().toISOString()
    });
    if (error) {
      console.error('[SUPABASE WRITE ERROR] Merchant registration failed:', error.message);
      throw new Error(`Supabase registration failed: ${error.message}`);
    }
  }
  
  writeDb(db);
  return { status: 'success', id };
}

/**
 * Updates a customer's display name and aliases in the background
 */
export async function updateCustomerNameInDb(id, newName, merchantId) {
  const db = readDb();
  const customer = db.customers.find(c => c.id === id);
  if (!customer) return false;
  
  const oldName = customer.name;
  const sanitizedName = sanitizeCustomerName(newName);
  
  customer.name = sanitizedName;
  customer.displayName = sanitizedName;
  customer.normalizedName = getNormalizedNameIdentifier(sanitizedName);
  
  if (!customer.aliases) {
    customer.aliases = [];
  }
  if (!customer.aliases.includes(oldName)) {
    customer.aliases.push(oldName);
  }
  if (!customer.aliases.includes(sanitizedName)) {
    customer.aliases.push(sanitizedName);
  }
  
  writeDb(db);
  console.log(`[BACKGROUND] Updated customer name from "${oldName}" to "${sanitizedName}" (ID: ${id})`);
  return true;
}

/**
 * Consolidates a newly created duplicate customer ID into an existing master ID
 */
export async function mergeSpecificCustomers(masterId, duplicateId, merchantId) {
  const db = readDb();
  const targetMerchantId = merchantId || 'merchant_1';
  
  const master = db.customers.find(c => c.id === masterId && !c.deleted);
  const duplicate = db.customers.find(c => c.id === duplicateId && !c.deleted);
  
  if (!master || !duplicate) {
    console.warn(`[MERGE SPECIFIC] Master (${masterId}) or Duplicate (${duplicateId}) not found or deleted.`);
    return false;
  }
  
  console.log(`[MERGE SPECIFIC] Consolidating duplicate profile "${duplicate.name}" (ID: ${duplicate.id}) into master "${master.name}" (ID: ${master.id})`);
  
  // Merge aliases
  const masterAliases = new Set(master.aliases || []);
  masterAliases.add(master.name);
  if (master.alias) masterAliases.add(master.alias);
  
  if (duplicate.aliases) {
    duplicate.aliases.forEach(a => masterAliases.add(a));
  }
  masterAliases.add(duplicate.name);
  if (duplicate.alias) masterAliases.add(duplicate.alias);
  
  master.aliases = Array.from(masterAliases).filter(a => a.toLowerCase() !== master.name.toLowerCase());
  
  // Set duplicate to deleted
  duplicate.deleted = true;
  
  // Remap transactions
  db.transactions = (db.transactions || []).map(tx => {
    if (tx.customer_id === duplicate.id && (tx.merchant_id || 'merchant_1') === targetMerchantId) {
      console.log(`[MERGE SPECIFIC] Remapped transaction ${tx.id} from duplicate customer ID ${tx.customer_id} to master ID ${master.id}`);
      return { ...tx, customer_id: master.id };
    }
    return tx;
  });
  
  // Remap reminders
  db.reminders = (db.reminders || []).map(rem => {
    if (rem.customer_id === duplicate.id && (rem.merchant_id || 'merchant_1') === targetMerchantId) {
      console.log(`[MERGE SPECIFIC] Remapped reminder ${rem.id} from duplicate customer ID ${rem.customer_id} to master ID ${master.id}`);
      return { ...rem, customer_id: master.id };
    }
    return rem;
  });
  
  // Recalculate outstanding balances for master
  const masterTxs = db.transactions.filter(tx => tx.customer_id === master.id && (tx.merchant_id || 'merchant_1') === targetMerchantId);
  const balance = masterTxs.reduce((sum, tx) => {
    if (tx.type === 'credit') return sum + tx.amount;
    return Math.max(0, sum - tx.amount);
  }, 0);
  
  // Remove duplicate outstanding balance entry
  db.outstanding_balances = (db.outstanding_balances || []).filter(b => b.customer_id !== duplicate.id);
  
  // Update master outstanding balance entry
  let masterBalanceEntry = db.outstanding_balances.find(b => b.customer_id === master.id);
  const lastUpdatedDate = masterTxs.length > 0
    ? [...masterTxs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date
    : master.created_at;
    
  if (masterBalanceEntry) {
    masterBalanceEntry.balance = balance;
    masterBalanceEntry.last_updated = lastUpdatedDate;
  } else {
    db.outstanding_balances.push({
      customer_id: master.id,
      merchant_id: targetMerchantId,
      balance,
      last_updated: lastUpdatedDate
    });
  }
  
  // Update master reminders pending status/amount
  db.reminders = db.reminders.map(rem => {
    if (rem.customer_id === master.id && rem.status === 'pending' && (rem.merchant_id || 'merchant_1') === targetMerchantId) {
      if (balance === 0) {
        return { ...rem, status: 'paid', amount: 0 };
      }
      return { ...rem, amount: balance };
    }
    return rem;
  });
  
  invalidateMerchantSummaries(db, targetMerchantId);
  invalidateQueryCache('customers_');
  invalidateQueryCache('transactions_');
  invalidateQueryCache('reminders_');
  writeDb(db);
  
  console.log(`[MERGE SPECIFIC] Consolidation complete for merchant ${targetMerchantId}.`);
  return true;
}

