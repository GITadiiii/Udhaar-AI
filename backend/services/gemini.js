import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Dynamically retrieves list of configured Gemini API keys
 */
function getApiKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEYS.split(',')
      .map(k => k.trim())
      .filter(k => k)
      .forEach(k => keys.push(k));
  }
  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }
  for (let i = 1; i <= 10; i++) {
    const k = process.env[`GEMINI_API_KEY_${i}`];
    if (k) {
      keys.push(k.trim());
    }
  }
  return Array.from(new Set(keys));
}

let currentKeyIndex = 0;

// Circuit Breaker State Variables
let circuitState = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF-OPEN'
let consecutiveFailures = 0;
let lastStateChangeTime = Date.now();
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 30000; // 30 seconds

let geminiDisabledUntil = 0;
let quotaLogPrintedThisCooldown = false;

export function isGeminiActive() {
  const now = Date.now();
  if (now < geminiDisabledUntil) {
    const remaining = Math.max(0, geminiDisabledUntil - now);
    if (!quotaLogPrintedThisCooldown) {
      console.warn(`[GEMINI] Provider temporarily disabled. Reason: Quota Exhausted. Retry After: ${Math.ceil(remaining / 1000)}s. Fallback Engine Active.`);
      quotaLogPrintedThisCooldown = true;
    }
    return false;
  }
  
  if (quotaLogPrintedThisCooldown) {
    quotaLogPrintedThisCooldown = false;
  }

  if (circuitState === 'OPEN') {
    if (now - lastStateChangeTime > COOLDOWN_MS) {
      circuitState = 'HALF-OPEN';
      consecutiveFailures = 0;
      console.log(`[CIRCUIT BREAKER] Cooldown expired. Entering HALF-OPEN state.`);
      return true;
    }
    return false;
  }

  return true;
}

function isQuotaError(error) {
  if (!error) return false;
  const msg = (error.message || '').toLowerCase();
  const status = error.status || error.statusCode;
  return status === 429 || 
         msg.includes('429') || 
         msg.includes('resource_exhausted') || 
         msg.includes('resourceexhausted') || 
         msg.includes('quota exceeded') || 
         msg.includes('quota_exceeded') ||
         msg.includes('rate limit') ||
         msg.includes('ratelimit');
}

function parseRetryDelay(error) {
  if (!error) return 60000;
  const msg = error.message || '';
  
  const secMatch = /retry\s*after\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*s/i.exec(msg);
  if (secMatch) {
    return Math.ceil(parseFloat(secMatch[1]) * 1000);
  }
  
  const secWordMatch = /retry\s*after\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*seconds/i.exec(msg);
  if (secWordMatch) {
    return Math.ceil(parseFloat(secWordMatch[1]) * 1000);
  }

  const tryInMatch = /try\s+again\s+in\s+(\d+(?:\.\d+)?)\s*s/i.exec(msg);
  if (tryInMatch) {
    return Math.ceil(parseFloat(tryInMatch[1]) * 1000);
  }
  
  return 60000;
}


// Performance Metrics
export const geminiMetrics = {
  requestCount: 0,
  successCount: 0,
  timeoutCount: 0,
  error503Count: 0,
  otherErrorCount: 0,
  fallbackCount: 0,
  totalDurationMs: 0
};

export function getGeminiMetrics() {
  const successRate = geminiMetrics.requestCount > 0
    ? ((geminiMetrics.successCount / geminiMetrics.requestCount) * 100).toFixed(1) + '%'
    : '0%';
  return {
    ...geminiMetrics,
    successRate,
    circuitState
  };
}

/**
 * Helper to title case a string
 */
function toTitleCase(str) {
  if (!str) return '';
  return str.split(' ').map(w => w.charAt(0).toUpperCase() + w.substring(1)).join(' ');
}

/**
 * Rule-based voice transaction classifier to guarantee correct classification
 */
export function classifyTransaction(transcript) {
  const normalized = (transcript || '').toLowerCase().trim();
  
  const collectionPhrases = [
    'paise wapas diye', 'payment receive hua', 'paisa diya wapas', 'paise lautaye',
    'paisa lautaya', 'paisa lautaye', 'wapas diya', 'wapas diye', 'wapas mila',
    'wapas mile', 'payment received', 'jama karaaya', 'jama karaya', 'chuka diye',
    'chuka diya', 'receive huye', 'receive hua', 'jama kiya', 'jama ki', 'laut aaya',
    'laut aaye', 'laut aae', 'laut aye', 'laut ae', 'se mile', 'ne diye', 'ne die',
    'lautaaye', 'lautaaya', 'lautaye', 'lautaya', 'lotaaye', 'lotaaya', 'lotaya',
    'lotaye', 'received', 'wapas die', 'wapas di', 'paisa mila', 'payment mila',
    'payment diya', 'payment kiya', 'settle kiya', 'paise diye', 'amount diya', 'collection'
  ];
  
  const creditPhrases = [
    'udhaar diya', 'udhaar diye', 'udhar diya', 'udhar diye',
    'ko diya', 'ko die', 'ko diye',
    'de diya', 'de diye', 'de die',
    'credit diya', 'paisa diya', 'maal diya', 'samaan diya', 'udhaar', 'udhar', 'diya', 'diye'
  ];
  
  // Check collection phrases first to prioritize returns/receipts
  for (const phrase of collectionPhrases) {
    if (normalized.includes(phrase)) {
      console.log(`[CLASSIFY] Match collection phrase "${phrase}"`);
      return 'collection';
    }
  }
  
  // Check credit phrases
  for (const phrase of creditPhrases) {
    if (normalized.includes(phrase)) {
      console.log(`[CLASSIFY] Match credit phrase "${phrase}"`);
      return 'credit';
    }
  }
  
  return 'unknown';
}

/**
 * Dynamic import helper to avoid circular dependency with db.js
 */
async function importTransliterateHindi(name) {
  try {
    const { transliterateHindiToEnglish } = await import('../db.js');
    return transliterateHindiToEnglish(name);
  } catch (err) {
    return name;
  }
}

async function importSanitizeCustomerName(name) {
  try {
    const { sanitizeCustomerName } = await import('../db.js');
    return sanitizeCustomerName(name);
  } catch (err) {
    return name;
  }
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${ms}ms`));
    }, ms);
    promise.then(
      (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

let cachedModelName = null;

async function getBestModel(genAI) {
  if (cachedModelName) {
    return genAI.getGenerativeModel({ model: cachedModelName }, { apiVersion: 'v1beta' });
  }

  const candidateModels = [
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ];

  const testPromises = candidateModels.map(async (modelName) => {
    try {
      const testModel = genAI.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
      await withTimeout(testModel.generateContent('ping'), 1200);
      return modelName;
    } catch (err) {
      throw err;
    }
  });

  try {
    cachedModelName = await Promise.any(testPromises);
    console.log(`[GEMINI] Verified and cached model: ${cachedModelName}`);
  } catch (err) {
    console.warn('[GEMINI] All candidate models failed to resolve. Using default gemini-2.5-flash');
    cachedModelName = 'gemini-2.5-flash';
  }

  return genAI.getGenerativeModel({ model: cachedModelName }, { apiVersion: 'v1beta' });
}

/**
 * Wraps Gemini API calls with round-robin load balancing, automatic failover, retry logic, and circuit breaker protection
 */
export async function callWithGemini(operation, timeoutMs = 3000, maxRetries) {
  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    throw new Error('No Gemini API keys configured.');
  }

  // Quota & Circuit Breaker pre-checks using isGeminiActive()
  if (!isGeminiActive()) {
    geminiMetrics.fallbackCount++;
    const remaining = Math.max(0, geminiDisabledUntil - Date.now());
    if (remaining > 0) {
      throw new Error(`Gemini temporarily disabled due to quota exhaustion. Retry after ${Math.ceil(remaining / 1000)}s.`);
    } else {
      throw new Error('Circuit breaker is OPEN. Gemini calls bypassed.');
    }
  }

  geminiMetrics.requestCount++;

  // If maxRetries is not explicitly provided:
  // - If only 1 key is configured, retry 1 time (total 2 attempts) to handle transient errors
  // - If multiple keys are configured, failover immediately to the next key (0 retries per key, total attempts = number of keys)
  const retriesPerKey = maxRetries !== undefined ? maxRetries : 1;
  let lastError = null;
  let wasQuota = false;

  for (let keyIdx = 0; keyIdx < apiKeys.length; keyIdx++) {
    // Ensure index is in bounds
    if (currentKeyIndex >= apiKeys.length) {
      currentKeyIndex = 0;
    }
    const idx = (currentKeyIndex + keyIdx) % apiKeys.length;
    const apiKey = apiKeys[idx];
    const maskedKey = apiKey.length > 10
      ? apiKey.substring(0, 6) + '...' + apiKey.substring(apiKey.length - 4)
      : 'short_key';

    let delay = 150; // Starting backoff delay in ms

    for (let attempt = 0; attempt <= retriesPerKey; attempt++) {
      const startTime = Date.now();
      try {
        console.log(`[GEMINI] Using key index ${idx} (Key: ${maskedKey}) - Attempt ${attempt + 1}/${retriesPerKey + 1} - State: ${circuitState}`);
        const genAI = new GoogleGenerativeAI(apiKey);
        const result = await withTimeout(operation(genAI), timeoutMs);
        
        const duration = Date.now() - startTime;
        console.log(`[GEMINI SUCCESS] Key index ${idx} succeeded in ${duration}ms (State: ${circuitState})`);
        
        // Metrics & Circuit Breaker Reset
        geminiMetrics.successCount++;
        geminiMetrics.totalDurationMs += duration;
        
        if (circuitState === 'HALF-OPEN') {
          circuitState = 'CLOSED';
          console.log(`[CIRCUIT BREAKER] Service recovered. Resetting to CLOSED state.`);
        }
        consecutiveFailures = 0;
        
        // Success: save the current successful key index to start next time
        currentKeyIndex = idx;
        return result;
      } catch (error) {
        lastError = error;
        const duration = Date.now() - startTime;
        
        if (isQuotaError(error)) {
          wasQuota = true;
          const retryDelayMs = parseRetryDelay(error);
          geminiDisabledUntil = Date.now() + retryDelayMs;
          quotaLogPrintedThisCooldown = false;
          console.warn(`[GEMINI] Provider temporarily disabled. Reason: Quota Exhausted. Retry After: ${Math.ceil(retryDelayMs / 1000)}s. Fallback Engine Active.`);
          
          // Throw immediately to skip retries/other keys
          throw error;
        }

        const isTimeout = error.message.includes('Timeout');
        const is503 = error.message.includes('503');
        
        if (isTimeout) {
          geminiMetrics.timeoutCount++;
        } else if (is503) {
          geminiMetrics.error503Count++;
        } else {
          geminiMetrics.otherErrorCount++;
        }
        
        // Clean single line log to reduce spam
        console.error(`[GEMINI ERROR] Key index ${idx} attempt ${attempt + 1} failed in ${duration}ms: ${error.message} (Timeout: ${isTimeout}, 503: ${is503})`);
        
        // If it's the last attempt for this key, don't wait
        if (attempt < retriesPerKey) {
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2;
        }
      }
    }
  }

  // All keys and attempts failed
  geminiMetrics.fallbackCount++;
  
  if (wasQuota) {
    throw new Error(`Gemini API quota exhausted. Last error: ${lastError ? lastError.message : 'Unknown'}`);
  }

  // Only increment system consecutive failures for timeouts/503s
  consecutiveFailures++;
  if (circuitState === 'HALF-OPEN' || consecutiveFailures >= FAILURE_THRESHOLD) {
    circuitState = 'OPEN';
    lastStateChangeTime = Date.now();
    console.error(`[CIRCUIT BREAKER] Tripped to OPEN state due to ${consecutiveFailures} consecutive system failures.`);
  }

  throw new Error(`All configured Gemini API keys failed. Last error: ${lastError ? lastError.message : 'Unknown'}`);
}

/**
 * Normalizes and extracts transaction amount from transcript using Hindi/Hinglish number expressions
 */
export function extractAmountFromText(text) {
  if (!text) return 0;
  const normalized = text.toLowerCase().trim();

  const HINDI_NUMBERS = {
    'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5, 'छह': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
    'ek': 1, 'do': 2, 'teen': 3, 'char': 4, 'chaar': 4, 'panch': 5, 'paanch': 5, 'chhe': 6, 'che': 6, 'saat': 7, 'aath': 8, 'nau': 9, 'das': 10, 'dass': 10
  };

  const FRACTION_MULTIPLIERS = {
    'डेढ़': 1.5, 'dedh': 1.5, 'derh': 1.5,
    'ढाई': 2.5, 'dhai': 2.5, 'adhai': 2.5,
    'सवा': 1.25, 'sawa': 1.25, 'savva': 1.25,
    'पौने': 0.75, 'paune': 0.75
  };

  const UNIT_MULTIPLIERS = {
    'सौ': 100, 'sau': 100, 'so': 100,
    'हज़ार': 1000, 'हजार': 1000, 'हजारों': 1000, 'hazar': 1000, 'hajar': 1000, 'hazaar': 1000, 'hzaar': 1000, 'hjaar': 1000, 'thousand': 1000,
    'लाख': 100000, 'lakh': 100000, 'lac': 100000,
    'करोड़': 10000000, 'crore': 10000000, 'karor': 10000000
  };

  // 1. Combined Fraction Prefix + Number + Unit: e.g., "paune do hazar", "sawa teen lakh"
  const combFracUnitRegex = /(?:^|\s|[.,\/#!$%\^&\*;:{}=\-_`~()])(sawa|savva|paune|सवा|पौने)\s+(ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|dass|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)\s*(sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|सौ|हज़ार|हजार|हजारों|लाख|करोड़)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  let match = combFracUnitRegex.exec(normalized);
  if (match) {
    const frac = match[1].toLowerCase();
    const numWord = match[2].toLowerCase();
    const unit = match[3].toLowerCase();
    const numVal = HINDI_NUMBERS[numWord] || 1;
    const unitMult = UNIT_MULTIPLIERS[unit] || 1;
    let fracOffset = 0;
    if (frac === 'paune' || frac === 'पौने') {
      fracOffset = -0.25;
    } else if (frac === 'sawa' || frac === 'savva' || frac === 'सवा') {
      fracOffset = 0.25;
    }
    return (numVal + fracOffset) * unitMult;
  }
  combFracUnitRegex.lastIndex = 0;

  // 2. Numeric + Unit: e.g., "1.5 hazar", "5 lakh"
  const numUnitRegex = /(\d+(?:\.\d+)?)\s*(sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|सौ|हज़ार|हजार|हजारों|लाख|करोड़)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  match = numUnitRegex.exec(normalized);
  if (match) {
    const val = parseFloat(match[1]);
    const unit = match[2].toLowerCase();
    const mult = UNIT_MULTIPLIERS[unit] || 1;
    return val * mult;
  }
  numUnitRegex.lastIndex = 0;

  // 3. Fraction + Unit: e.g., "derh hazar", "ढाई सौ"
  const fracUnitRegex = /(?:^|\s|[.,\/#!$%\^&\*;:{}=\-_`~()])(derh|dedh|dhai|adhai|sawa|savva|paune|डेढ़|ढाई|सवा|पौने)\s*(sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|सौ|हज़ार|हजार|हजारों|लाख|करोड़)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  match = fracUnitRegex.exec(normalized);
  if (match) {
    const frac = match[1].toLowerCase();
    const unit = match[2].toLowerCase();
    const fracVal = FRACTION_MULTIPLIERS[frac] || 1;
    const mult = UNIT_MULTIPLIERS[unit] || 1;
    return fracVal * mult;
  }
  fracUnitRegex.lastIndex = 0;

  // 4. Word + Unit: e.g., "paanch hazar", "पाँच सौ"
  const wordUnitRegex = /(?:^|\s|[.,\/#!$%\^&\*;:{}=\-_`~()])(ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|dass|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)\s*(sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|सौ|हज़ार|हजार|हजारों|लाख|करोड़)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  match = wordUnitRegex.exec(normalized);
  if (match) {
    const word = match[1].toLowerCase();
    const unit = match[2].toLowerCase();
    const wordVal = HINDI_NUMBERS[word] || 1;
    const mult = UNIT_MULTIPLIERS[unit] || 1;
    return wordVal * mult;
  }
  wordUnitRegex.lastIndex = 0;

  // 5. Bare Unit: e.g., "hazar", "हज़ार"
  const bareUnitRegex = /(?:^|\s|[.,\/#!$%\^&\*;:{}=\-_`~()])(sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|सौ|हज़ार|हजार|हजारों|लाख|करोड़)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  match = bareUnitRegex.exec(normalized);
  if (match) {
    const unit = match[1].toLowerCase();
    return UNIT_MULTIPLIERS[unit] || 0;
  }
  bareUnitRegex.lastIndex = 0;

  // 6. Standard Digits: e.g., "500", "1500"
  const standardDigitRegex = /(\d+(?:\.\d+)?)\s*(?:rs\.?|inr|₹|rupaye|rupees|amount|udhaar|wapas|diye|diya|le|se|ne|mile|mila|paise|paisa)?(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  match = standardDigitRegex.exec(normalized);
  if (match) {
    return parseFloat(match[1]);
  }
  standardDigitRegex.lastIndex = 0;

  // 7. Combined Fraction (no unit): e.g., "paune do" -> 1.75
  const combFracRegex = /(?:^|\s|[.,\/#!$%\^&\*;:{}=\-_`~()])(sawa|savva|paune|सवा|पौने)\s+(ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|dass|एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi;
  match = combFracRegex.exec(normalized);
  if (match) {
    const frac = match[1].toLowerCase();
    const numWord = match[2].toLowerCase();
    const numVal = HINDI_NUMBERS[numWord] || 1;
    let fracOffset = 0;
    if (frac === 'paune' || frac === 'पौने') {
      fracOffset = -0.25;
    } else if (frac === 'sawa' || frac === 'savva' || frac === 'सवा') {
      fracOffset = 0.25;
    }
    return numVal + fracOffset;
  }
  combFracRegex.lastIndex = 0;

  // 8. Direct match for single number words or fractions if no units exist (e.g. "डेढ़" -> 1.5, "पाँच" -> 5)
  for (const [key, val] of Object.entries(FRACTION_MULTIPLIERS)) {
    if (new RegExp('(?:^|\\s|[.,\\/#!$%\\^&\\*;:{}=\\-_`~()])' + key + '(?=\\s|[.,\\/#!$%\\^&\\*;:{}=\\-_`~()]|$)', 'i').test(normalized)) {
      return val;
    }
  }
  for (const [key, val] of Object.entries(HINDI_NUMBERS)) {
    if (new RegExp('(?:^|\\s|[.,\\/#!$%\\^&\\*;:{}=\\-_`~()])' + key + '(?=\\s|[.,\\/#!$%\\^&\\*;:{}=\\-_`~()]|$)', 'i').test(normalized)) {
      return val;
    }
  }

  return 0;
}

/**
 * Fallback local parser using regex when Gemini API is not configured
 */
async function localParseVoice(transcript, customers) {
  const amount = extractAmountFromText(transcript);

  // Determine type using rule-based classification
  let type = classifyTransaction(transcript);
  if (type === 'unknown') {
    type = 'credit'; // Smart default to credit if confidence is low
  }

  // Extract name by removing common keywords, numbers and stop words
  let cleanName = transcript;
  
  // Remove numbers
  cleanName = cleanName.replace(/\d+/g, '');
  
  // Remove currency markers and transaction markers
  // Sort from longest phrase to shortest to avoid partial matches
  const stopPhrases = [
    // Multi-word phrases (longest first)
    /\bpaise\s+wapas\s+diye\b/gi,
    /\bpayment\s+receive\s+hua\b/gi,
    /\bpaisa\s+diya\s+wapas\b/gi,
    /\bpaise\s+lautaye\b/gi,
    /\bpaisa\s+lautaya\b/gi,
    /\bpaisa\s+lautaye\b/gi,
    /\bcredit\s+diya\b/gi,
    /\budhaar\s+diya\b/gi,
    /\budhaar\s+diye\b/gi,
    /\bwapas\s+mila\b/gi,
    /\bwapas\s+mile\b/gi,
    /\bpaisa\s+diya\b/gi,
    /\bpaisa\s+liya\b/gi,
    /\bde\s+diya\b/gi,
    /\bde\s+diye\b/gi,
    /\bde\s+die\b/gi,
    /\bse\s+liya\b/gi,
    /\bko\s+diye\b/gi,
    /\bko\s+diya\b/gi,
    /\bko\s+die\b/gi,
    /\blaut\s+aaya\b/gi,
    /\blaut\s+aaye\b/gi,
    /\blaut\s+aae\b/gi,
    /\blaut\s+aye\b/gi,
    /\blaut\s+ae\b/gi,
    /\bse\s+mile\b/gi,
    /\bne\s+diye\b/gi,
    /\bne\s+die\b/gi,
    /\bjama\s+karaya\b/gi,
    /\bjama\s+karaaya\b/gi,
    /\bchuka\s+diya\b/gi,
    /\bchuka\s+diye\b/gi,
    /rs\.?/gi, /inr/gi, /₹/gi,
    
    // Single-word stops
    /\brupaye\b/gi, /\brupees\b/gi, /\budhaar\b/gi, /\budhar\b/gi, /\bwapas\b/gi, 
    /\bdiye\b/gi, /\bdiya\b/gi, /\bko\b/gi, /\bne\b/gi, /\bse\b/gi, 
    /\bpayment\b/gi, /\breceived\b/gi, /\bpaid\b/gi, /\bcash\b/gi, /\bjama\b/gi, /\bcredit\b/gi, /\bcollection\b/gi,
    /\blotaaye\b/gi, /\blotaye\b/gi, /\blotaya\b/gi, /\blautaaye\b/gi, /\blautaaya\b/gi, /\blautaye\b/gi, /\blautaya\b/gi,
    /\bchuka\b/gi, /\ble\b/gi, /\blie\b/gi, /\bliye\b/gi, /\bliya\b/gi, /\bdie\b/gi,
    /\bkiya\b/gi, /\bkia\b/gi, /\bkar\b/gi, /\bdi\b/gi, /\bdii\b/gi, /\bki\b/gi, /\bke\b/gi,
    /\bamount\b/gi, /\bhazaar\b/gi, /\bmaal\b/gi, /\bsamaan\b/gi, /\bpaise\b/gi, /\bsettle\b/gi,
    /\bhzaar\b/gi, /\bhjaar\b/gi, /\bhajar\b/gi, /\bhazar\b/gi,

    // Number words, fraction terms and units to clean customer names from amount words
    /\b(ek|do|teen|char|chaar|panch|paanch|chhe|che|saat|aath|nau|das|dass|derh|dedh|dhai|adhai|sawa|savva|paune)\b/gi,
    /\b(sau|so|hazar|hajar|hazaar|hzaar|hjaar|thousand|lakh|lac|crore|karor|amount)\b/gi,
    /(?:^|\s)(एक|दो|तीन|चार|पाँच|पांच|छह|सात|आठ|नौ|दस|सौ|हज़ार|हजार|हजारों|लाख|करोड़|डेढ़|ढाई|सवा|पौने)(?=\s|[.,\/#!$%\^&\*;:{}=\-_`~()]|$)/gi
  ];
  
  stopPhrases.forEach(regex => {
    cleanName = cleanName.replace(regex, '');
  });

  // Clean trailing punctuation and whitespaces
  cleanName = cleanName.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").replace(/\s+/g, " ").trim();

  // If we have an empty string, set default name
  if (!cleanName || cleanName.length < 2) {
    cleanName = "Unknown Customer";
  }

  // Generate local canonical name using transliteration + title casing
  const transliterated = await importTransliterateHindi(cleanName);
  const rawCanonical = toTitleCase(transliterated);

  const cleanNameSanitized = await importSanitizeCustomerName(cleanName);
  const canonicalNameSanitized = await importSanitizeCustomerName(rawCanonical);

  // Try to find the closest match in current customers
  let matchedCustomer = null;
  if (customers && customers.length > 0) {
    const exacts = customers.filter(c => c.name.toLowerCase() === canonicalNameSanitized.toLowerCase());
    if (exacts.length === 1) {
      matchedCustomer = exacts[0];
    }
  }

  return {
    name: cleanNameSanitized,
    canonicalName: canonicalNameSanitized,
    amount,
    type,
    matchedCustomer,
    isAiFallback: true
  };
}

/**
 * Extract transaction structure from voice transcript using Gemini
 */
export async function extractTransactionFromVoice(transcript, customers) {
  if (!isGeminiActive()) {
    return localParseVoice(transcript, customers);
  }

  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    return localParseVoice(transcript, customers);
  }

  try {
    return await callWithGemini(async (genAI) => {
      const model = await getBestModel(genAI);
      
      const customerListString = customers.map(c => 
        `ID: ${c.id}, Name: ${c.name}, Aliases: [${(c.aliases || []).join(', ')}]`
      ).join('\n');
      
      const prompt = `
You are UdhaarAI, a credit recording assistant for small Indian shopkeepers (Kirana merchants).
Your task is to analyze a voice transcript and extract transaction details, including standardizing the customer name to a canonical English form.

Here is the list of existing customers in our database:
${customerListString || 'No current customers.'}

Voice Transcript: "${transcript}"

Extract the following details:
1. "customerName": The extracted clean customer name in English Title Case.
   - Ignore and remove any transaction filler/action words such as "ko", "ko diye", "ko diya", "udhaar diya", "udhaar diye", "rupaye", "rupees", "se", "se liya", "wapas mila", "wapas mile", "paisa diya", "paisa liya", "diye", "diya", "wapas".
   - Never include transaction action verbs, prepositions, numbers, or numeric multiplier words (e.g., "hazar", "hazaar", "sau", "derh", "dhai", "sawa", "lakh", "crore", "amount", "हज़ार", "सौ", "डेढ़", "ढाई", "सवा", "लाख") in the customer name. E.g. for "Raju ko derh hazar diye", "customerName" must be exactly "Raju" (and NOT "Raju Derh Hazar"). For "Reshap ko 500 rupaye diye", "customerName" must be exactly "Reshap". For "Raj ko 500 diye", "customerName" must be exactly "Raj". For "Rahul Mechanic ko 1000 udhaar diye", "customerName" must be exactly "Rahul Mechanic" (preserving the business description suffix).
   - If the transcript refers to an existing customer in the database (considering phonetic similarity, Hindi-to-English translations like "मिस्त्री"/"मिस्री" to "Mechanic", spelling variations, or different scripts), this MUST exactly match that existing customer's display name (e.g. "Rahul Mechanic").
   - If it is a new customer not in the list, return a clean English Title Case version of the name (e.g. "Rahul").
2. "amount": The transaction value in Indian Rupees as a number.
   - Recognize and normalize Hindi/Hinglish amount terms, units, and multipliers. For example, "हज़ार"/"hazar"/"hajar"/"thousand" acts as a 1000 multiplier, "lakh"/"लाख" as 100000, "sau"/"सौ" as 100.
   - Recognize fraction multipliers: "derh"/"डेढ़" is 1.5, "dhai"/"ढाई" is 2.5, "sawa"/"सवा" is 1.25, "paune"/"पौने" is 0.75.
   - Support combined fraction patterns like "paune do hazar" -> 1750, "sawa do hazar" -> 2250, "पौने दो हज़ार" -> 1750, "सवा दो हज़ार" -> 2250.
   - E.g., "पाँच हज़ार" or "paanch hazar" -> 5000; "डेढ़ हज़ार" or "derh hazar" -> 1500; "ढाई हज़ार" or "dhai hazar" -> 2500; "सवा सौ" or "sawa sau" -> 125.
   - If no amount is mentioned, use 0.
3. "transactionType": Must be "credit" (if the merchant gave goods/money on credit, e.g. "udhaar", "diye", "ko diya", "paisa diya", "maal diya", "samaan diya") OR "collection" (if the customer paid money, e.g. "wapas", "se liya", "wapas mile", "wapas mila", "paise diye", "payment diya", "payment kiya", "settle kiya", "amount diya", "collection"). If unclear, use "unknown".

Return ONLY a JSON object matching this schema (no markdown wrapping, no backticks):
{
  "customerName": "clean_english_name",
  "amount": 500,
  "transactionType": "credit" | "collection" | "unknown"
}
`;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      });

      const responseText = result.response.text();
      const parsed = JSON.parse(responseText.trim());
      
      const sanitizedGeminiName = await importSanitizeCustomerName(parsed.customerName);
      
      // Determine type using rule-based classification as safeguard
      let finalType = parsed.transactionType;
      const ruleType = classifyTransaction(transcript);
      if (ruleType !== 'unknown') {
        finalType = ruleType;
      } else if (finalType === 'unknown' || !finalType) {
        finalType = 'credit'; // Default fallback is credit (Udhaar) if confidence is low
      }

      const mapped = {
        name: sanitizedGeminiName,
        canonicalName: sanitizedGeminiName,
        amount: parsed.amount,
        type: finalType
      };

      // Match with existing customer in the list if the returned canonicalName is an exact match
      let matchedCustomer = null;
      if (mapped.canonicalName && customers.length > 0) {
        const match = customers.find(c => c.name.toLowerCase() === mapped.canonicalName.toLowerCase());
        if (match) {
          matchedCustomer = match;
          mapped.canonicalName = match.name; // Use exact database casing
          mapped.name = match.name;
        }
      }

      return {
        ...mapped,
        matchedCustomer,
        isAiFallback: false
      };
    }, 5000);
  } catch (error) {
    console.error('Gemini voice processing failed, using fallback:', error);
    return localParseVoice(transcript, customers);
  }
}

function getLocalDateStr(dateInput) {
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

/**
 * Generate a narrative business summary of the day's transactions
 */
export async function generateDailySummary(dateStr, transactions, customers) {
  // Compute summary figures locally first
  const todayTxs = transactions.filter(t => getLocalDateStr(t.date) === dateStr);
  const creditGiven = todayTxs.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
  const collections = todayTxs.filter(t => t.type === 'collection').reduce((sum, t) => sum + t.amount, 0);
  const netChange = creditGiven - collections;

  const activeDebtCustomers = customers.filter(c => c.balance > 0);
  
  // Find top debtor
  let topDebtorText = "None";
  if (activeDebtCustomers.length > 0) {
    const sorted = [...activeDebtCustomers].sort((a, b) => b.balance - a.balance);
    topDebtorText = `${sorted[0].name} (₹${sorted[0].balance})`;
  }

  const defaultText = `Today's Business Summary (Local Engine):
You gave ₹${creditGiven} in credit today and collected ₹${collections}.
Outstanding debt changed by ₹${netChange >= 0 ? '+' : ''}${netChange}.
There are ${activeDebtCustomers.length} customer(s) with outstanding dues.
Highest outstanding debtor is ${topDebtorText}.
Suggested action: Review pending reminders and send payment follow-ups today.`;

  if (!isGeminiActive()) {
    return defaultText;
  }

  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    return defaultText;
  }

  try {
    return await callWithGemini(async (genAI) => {
      const model = await getBestModel(genAI);
      
      const customerDetails = customers.map(c => `- ${c.name} (Balance: ₹${c.balance})`).join('\n');
      const txDetails = todayTxs.map(t => {
        const customer = customers.find(c => c.id === t.customer_id);
        return `- ${customer ? customer.name : 'Unknown'}: ₹${t.amount} (${t.type}) - ${t.description}`;
      }).join('\n');

      const prompt = `
You are UdhaarAI, a helpful AI daily summaries assistant for a Kirana store owner.
Generate a friendly, concise, and professional bulleted summary of today's business.
Here are the stats for today (${dateStr}):
- Credit Given Today: ₹${creditGiven}
- Collections Today: ₹${collections}
- Net Balance Change: ₹${netChange} (${netChange >= 0 ? 'outstanding increased' : 'outstanding decreased'})
- Total Active Customers with Dues: ${activeDebtCustomers.length}

Detailed customer outstanding balances:
${customerDetails || 'No customers with outstanding balances.'}

Transactions that happened today:
${txDetails || 'No transactions recorded today.'}

Create a summary that matches this persona:
- Start with a clear headline.
- Give a brief executive overview of credit given vs collections.
- Highlight any customer requiring immediate attention (e.g. highest outstanding or overdue).
- Provide a concrete "Suggested action" (e.g. Call [Customer Name] today).
- Format in clean, readable text. Use ₹ symbol for Rupees. Keep it conversational yet highly professional.
`;

      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }, 8000);
  } catch (error) {
    console.error('Gemini daily summary generation failed, using local engine output:', error);
    return defaultText;
  }
}

const semanticMatchCache = new Map();
const SEMANTIC_CACHE_TTL_MS = 300000; // 5 minutes

export function clearSemanticMatchCache() {
  semanticMatchCache.clear();
  canonicalNameCache.clear();
  console.log('[GEMINI CACHE] Cleared semantic match and canonical name caches.');
}

/**
 * Resolve semantic matches (translations, script variants) using Gemini
 */
export async function resolveSemanticMatch(queryName, customers) {
  const cleanInput = (queryName || '').toLowerCase().trim();
  const cached = semanticMatchCache.get(cleanInput);
  if (cached && Date.now() - cached.timestamp < SEMANTIC_CACHE_TTL_MS) {
    console.log(`[SEMANTIC CACHE HIT] resolveSemanticMatch: "${queryName}" -> "${cached.matchedCustomerId}"`);
    return cached.matchedCustomerId;
  }

  if (!isGeminiActive()) {
    return null;
  }

  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    return null;
  }

  try {
    const resultId = await callWithGemini(async (genAI) => {
      const model = await getBestModel(genAI);
      
      const customerListString = customers.map(c => 
        `ID: ${c.id}, Name: ${c.name}, Aliases: [${(c.aliases || []).join(', ')}]`
      ).join('\n');

      const prompt = `
You are the Multilingual Customer Resolution Core for UdhaarAI.
Your task is to analyze a search query name (which may be in English, Hindi, or Hinglish) and determine if it confidently refers to the same person/customer identity in our database.

Here is the list of existing customers:
${customerListString}

Query Name: "${queryName}"

Instructions:
- Devanagari Hindi names should match their English phonetic counterparts (e.g. "राहुल मेकेनिक" matches "Rahul Mechanic").
- Spelling variations or Hinglish matches should be resolved if they are typos of the same name (e.g. "Rahul Mekanik" matches "Rahul Mechanic").
- Semantic translations of terms should match (e.g. "राहुल मिस्त्री" matches "Rahul Mechanic", because "मिस्त्री" is Hindi for "mechanic").
- Do NOT match names that are different people, even if they sound very similar or differ by only one or two characters. For example: "Pingu" and "Mingu" are different people; "Sonu" and "Monu" are different people; "Ramesh" and "Dinesh" are different people; "Pawan" and "Pankaj" are different people; "Aditi" and "Aarti" are different; "Raju" and "Rajesh" are different; "Ankit" and "Ankita" are different; "Rohan" and "Mohan" are different; "Pooja" and "Puja" are different.
- Determine if the query name confidently refers to the same person/customer identity.

Return ONLY a JSON response in the following schema:
{
  "sameCustomer": true | false,
  "matchedCustomerId": "customer_id_here" | null,
  "confidence": number
}
`;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      });

      const responseText = result.response.text();
      const parsed = JSON.parse(responseText.trim());
      
      if (parsed.sameCustomer === true && parsed.matchedCustomerId && parsed.confidence >= 0.95) {
        console.log(`[GEMINI SEMANTIC MATCH] Query "${queryName}" resolved to ID ${parsed.matchedCustomerId} with confidence ${parsed.confidence}`);
        return parsed.matchedCustomerId;
      }
      
      return null;
    }, 3000);

    semanticMatchCache.set(cleanInput, { matchedCustomerId: resultId, timestamp: Date.now() });
    return resultId;
  } catch (error) {
    console.error('Gemini semantic lookup failed:', error);
    return null;
  }
}

/**
 * Standardize any input name to a canonical English form
 */
const canonicalNameCache = new Map();
const CANONICAL_CACHE_TTL_MS = 300000; // 5 minutes

export async function getCanonicalName(name, customers) {
  const cleanInput = (name || '').toLowerCase().trim();
  const cached = canonicalNameCache.get(cleanInput);
  if (cached && Date.now() - cached.timestamp < CANONICAL_CACHE_TTL_MS) {
    console.log(`[CANONICAL CACHE HIT] getCanonicalName: "${name}" -> "${cached.canonicalName}"`);
    return cached.canonicalName;
  }

  if (!isGeminiActive()) {
    const transliterated = await importTransliterateHindi(name);
    const canonical = toTitleCase(transliterated);
    canonicalNameCache.set(cleanInput, { canonicalName: canonical, timestamp: Date.now() });
    return canonical;
  }

  const apiKeys = getApiKeys();
  if (apiKeys.length === 0) {
    const transliterated = await importTransliterateHindi(name);
    const canonical = toTitleCase(transliterated);
    canonicalNameCache.set(cleanInput, { canonicalName: canonical, timestamp: Date.now() });
    return canonical;
  }

  try {
    const canonical = await callWithGemini(async (genAI) => {
      const model = await getBestModel(genAI);
      const customerNames = customers.map(c => c.name).join(', ');
      
      const prompt = `
You are the Canonical Name Standardization Engine for UdhaarAI.
Your task is to take a customer name (which might be in Hindi Devanagari script, English, Hinglish, or have spelling variations) and convert it into a standardized, canonical English name.

If the input name refers to or matches an existing customer in our database (considering phonetic similarity, Hindi-to-English translations like "मिस्त्री" to "Mechanic", spelling variations, or different scripts), you MUST return that existing customer's EXACT display name.

Here is the list of existing customer names:
[${customerNames}]

Input name to standardize: "${name}"

Instructions:
1. Translate Hindi terms if appropriate (e.g. "मिस्त्री" -> "Mechanic", "दूधवाला" -> "Milkman"), or phoneticize them into standard English representation.
2. If it refers to an existing customer in the list, return that exact name.
3. If it is a new customer, return a clean English Title Case version of the name.

Return ONLY a JSON response in the following schema (no markdown, no backticks):
{
  "canonicalName": "standardized_english_name"
}
`;

      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      });

      const responseText = result.response.text();
      const parsed = JSON.parse(responseText.trim());
      return parsed.canonicalName;
    }, 3000);

    canonicalNameCache.set(cleanInput, { canonicalName: canonical, timestamp: Date.now() });
    return canonical;
  } catch (error) {
    console.error('Failed to generate canonical name with Gemini:', error);
    const transliterated = await importTransliterateHindi(name);
    const canonical = toTitleCase(transliterated);
    canonicalNameCache.set(cleanInput, { canonicalName: canonical, timestamp: Date.now() });
    return canonical;
  }
}
