import React, { useState, useEffect, useRef } from 'react';
import { processVoice, createTransaction, createCustomer } from '../utils/api';
import { Customer } from '../types';
import { Mic, MicOff, AlertCircle, RefreshCw, CheckCircle, Info, User, HelpCircle } from 'lucide-react';
import confetti from 'canvas-confetti';

interface VoiceRecorderProps {
  customers: Customer[];
  onTransactionSaved: () => void;
  onNavigate: (page: string, params?: any) => void;
}

// Extend Window interface for Web Speech API in TypeScript
interface IWindow extends Window {
  webkitSpeechRecognition: any;
  SpeechRecognition: any;
}

function sanitizeCustomerName(name: string): string {
  if (!name) return '';
  
  // 1. Remove numbers
  let clean = name.replace(/\d+/g, '');

  // 2. Remove blacklisted transaction words (whole words only)
  const blacklistRegex = /\b(ko\s+diye|ko\s+diya|ko\s+die|de\s+diya|de\s+diye|de\s+die|le\s+liye|se\s+liya|wapas\s+mila|wapas\s+mile|paisa\s+diya|paisa\s+liya|laut\s+aae|laut\s+aye|laut\s+ae|se\s+mile|ne\s+diye|ne\s+die|laut\s+aaya|laut\s+aaye|paise\s+lautaye|paisa\s+lautaya|paisa\s+lautaye|payment\s+receive\s+hua|receive\s+hua|receive\s+huye|jama\s+karaya|chuka\s+diya|chuka\s+diye|paise\s+wapas\s+diye|paisa\s+diya\s+wapas|credit\s+diya|ko|ki|ke|ne|le|lie|liye|liya|die|diya|diye|udhaar|udhar|rupaye|rupees|paisa|se|mila|mile|wapas|wps|received|paid|payment|lotaaye|lotaye|lotaya|lautaaya|lautaaye|lautaye|lautaya|chuka)\b/gi;
  clean = clean.replace(blacklistRegex, '');

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

const getAvatarBg = (name: string) => {
  const firstLetter = (name || 'A').trim().charAt(0).toUpperCase();
  
  if (firstLetter === 'A') return 'bg-blue-100 text-blue-800 border-blue-200';
  if (firstLetter === 'S') return 'bg-emerald-100 text-emerald-800 border-emerald-200';
  if (firstLetter === 'R') return 'bg-orange-100 text-orange-800 border-orange-200';
  if (firstLetter === 'P') return 'bg-purple-100 text-purple-800 border-purple-200';
  if (firstLetter === 'K') return 'bg-teal-100 text-teal-800 border-teal-200';

  const charCode = firstLetter.charCodeAt(0);
  const groups = [
    'bg-blue-100 text-blue-800 border-blue-200',
    'bg-emerald-100 text-emerald-800 border-emerald-200',
    'bg-orange-100 text-orange-800 border-orange-200',
    'bg-purple-100 text-purple-800 border-purple-200',
    'bg-teal-100 text-teal-800 border-teal-200'
  ];
  return groups[charCode % groups.length];
};

export default function VoiceRecorder({ customers, onTransactionSaved, onNavigate }: VoiceRecorderProps) {
  const [recorderState, setRecorderState] = useState<'idle' | 'recording' | 'extracting' | 'confirming' | 'multiple_matches'>('idle');
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Extracted details
  const [extractedName, setExtractedName] = useState('');
  const [extractedAmount, setExtractedAmount] = useState<number>(0);
  const [extractedType, setExtractedType] = useState<'credit' | 'collection' | 'unknown'>('unknown');
  const [matchedCustomer, setMatchedCustomer] = useState<Customer | null>(null);
  const [isAiFallback, setIsAiFallback] = useState(false);
  const [explicitConfirmNew, setExplicitConfirmNew] = useState(false);
  
  // Smart Customer Resolution Candidates
  const [candidates, setCandidates] = useState<Customer[]>([]);
  
  const isSpellingSuggestion = candidates.length > 0 && candidates.some(c => {
    const cName = c.name.toLowerCase().trim();
    const qName = extractedName.toLowerCase().trim();
    return !cName.includes(qName) && !qName.includes(cName);
  });
  
  const recognitionRef = useRef<any>(null);
  const transcriptRef = useRef('');
  const interimTranscriptRef = useRef('');
  const silenceTimeoutRef = useRef<any>(null);
  const maxDurationTimeoutRef = useRef<any>(null);

  // Initialize Speech Recognition
  useEffect(() => {
    const windowObj = (window as unknown as IWindow);
    const SpeechRecognition = windowObj.SpeechRecognition || windowObj.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMsg('Web Speech API is not supported in this browser. Please use Google Chrome or Microsoft Edge.');
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = false; // Auto-stop on silence
    rec.interimResults = true;
    rec.lang = 'hi-IN'; // Hindi/Hinglish language model optimizes transcription for Indian accents

    const SpeechGrammarList = (windowObj as any).SpeechGrammarList || (windowObj as any).webkitSpeechGrammarList;
    if (SpeechGrammarList && customers.length > 0) {
      const gList = new SpeechGrammarList();
      const names = customers
        .map(c => c.name ? c.name.trim() : '')
        .filter(Boolean)
        .map(name => name.replace(/[^a-zA-Z0-9\s]/g, ''))
        .filter(name => name.length > 0);

      if (names.length > 0) {
        const grammar = `#JSGF V1.0; grammar customerNames; public <customerName> = ${names.join(' | ')} ;`;
        try {
          gList.addFromString(grammar, 1);
          rec.grammars = gList;
          console.log('[SPEECH GRAMMAR] Registered grammar:', grammar);
        } catch (e) {
          console.error('[SPEECH GRAMMAR] Failed to load speech grammar:', e);
        }
      }
    }

    rec.onstart = () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      transcriptRef.current = '';
      interimTranscriptRef.current = '';
      setTranscript('');
      setInterimTranscript('');
      setErrorMsg(null);
    };

    rec.onresult = (event: any) => {
      // Clear silence timer on every new sound input result
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }

      let interim = '';
      let final = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }

      const updatedFinal = (transcriptRef.current + final);
      transcriptRef.current = updatedFinal;
      interimTranscriptRef.current = interim;

      setTranscript(updatedFinal);
      setInterimTranscript(interim);

      // Start silence timer: if no new speech is transcribed for 6.5 seconds, auto-stop recording
      silenceTimeoutRef.current = setTimeout(() => {
        console.log('[SILENCE DETECTION] 6.5 seconds of silence detected. Auto-stopping and processing...');
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch (e) {
            console.error('[SILENCE DETECT ERROR]', e);
          }
        }
      }, 6500);
    };

    rec.onerror = (event: any) => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      console.error('Speech recognition error:', event.error);
      if (event.error === 'not-allowed') {
        setErrorMsg('Microphone access is denied. Please enable microphone permissions in your browser.');
      } else {
        setErrorMsg(`Speech recognition error: ${event.error}`);
      }
      setRecorderState('idle');
    };

    rec.onend = () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      // Trigger extraction if we have captured transcript
      setRecorderState(current => {
        if (current === 'recording') {
          return 'extracting';
        }
        return current;
      });
    };

    recognitionRef.current = rec;

    return () => {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
      }
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch (e) {
          // ignore
        }
      }
    };
  }, [customers]);

  // Watch for transition to 'extracting' and trigger API call
  useEffect(() => {
    if (recorderState === 'extracting') {
      const fullTranscript = (transcriptRef.current + ' ' + interimTranscriptRef.current).trim();
      if (!fullTranscript) {
        setErrorMsg('No speech detected. Please speak clearly.');
        setRecorderState('idle');
        return;
      }
      handleExtract(fullTranscript);
    }
  }, [recorderState]);

  const startRecording = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
    }
    if (!recognitionRef.current) return;
    try {
      setRecorderState('recording');
      recognitionRef.current.start();
      
      // Start 75-second maximum session duration timeout
      maxDurationTimeoutRef.current = setTimeout(() => {
        console.log('[MAX DURATION] 75 seconds maximum recording limit reached. Stopping...');
        stopRecording();
      }, 75000);
    } catch (e) {
      console.error(e);
      setErrorMsg('Failed to start recording. Please try again.');
      setRecorderState('idle');
    }
  };

  const stopRecording = () => {
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
    }
    if (maxDurationTimeoutRef.current) {
      clearTimeout(maxDurationTimeoutRef.current);
    }
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch (e) {
      console.error(e);
    }
  };

  const handleExtract = async (text: string) => {
    try {
      const result = await processVoice(text);
      
      setExtractedName(sanitizeCustomerName(result.name));
      setExtractedAmount(result.amount);
      setExtractedType(result.type);
      setMatchedCustomer(result.matchedCustomer);
      setIsAiFallback(!!result.isAiFallback);

      if (result.status === 'multiple_matches' && result.candidates) {
        setCandidates(result.candidates);
        setRecorderState('multiple_matches');
      } else {
        setRecorderState('confirming');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg('Failed to analyze transcript. Please enter details manually.');
      setRecorderState('idle');
    }
  };

  // Smart Resolution selection handler
  const handleSelectCandidate = (customer: Customer) => {
    setMatchedCustomer(customer);
    setExtractedName(sanitizeCustomerName(customer.name));
    setRecorderState('confirming');
  };

  const handleDiscard = () => {
    setTranscript('');
    setInterimTranscript('');
    setExtractedName('');
    setExtractedAmount(0);
    setExtractedType('unknown');
    setMatchedCustomer(null);
    setCandidates([]);
    setExplicitConfirmNew(false);
    setRecorderState('idle');
  };

  const handleConfirmSave = async () => {
    const cleanName = sanitizeCustomerName(extractedName);
    if (!cleanName.trim() || extractedAmount <= 0) {
      alert('Please fill out a valid customer name and transaction amount.');
      return;
    }
    if (extractedType === 'unknown') {
      alert('Please select a transaction type (Give Credit or Receive Payment).');
      return;
    }

    try {
      let customerId = matchedCustomer ? matchedCustomer.id : '';

      // If customer doesn't exist, create customer ledger first with uniqueness safety
      if (!customerId) {
        const result = await createCustomer(cleanName, '', undefined, explicitConfirmNew);
        
        if (result.status === 'multiple_matches' && result.candidates) {
          setCandidates(result.candidates);
          setRecorderState('multiple_matches');
          return; // Stop and let merchant resolve duplicate candidates
        }
        
        customerId = result.id;
      }

      // Record transaction
      await createTransaction({
        customerId,
        amount: extractedAmount,
        type: extractedType as 'credit' | 'collection',
        description: `Voice: "${transcript || interimTranscript}"`,
        aliasSpoken: cleanName
      });

      // Show confetti on success
      confetti({
        particleCount: 150,
        spread: 80,
        origin: { y: 0.6 }
      });

      onTransactionSaved();
      
      // Navigate to ledger on completion
      onNavigate('customers', { openLedgerId: customerId });
      handleDiscard();
    } catch (err) {
      console.error(err);
      alert('Error saving transaction. Please try again.');
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-brand-dark tracking-tight">Voice Transaction Recorder</h1>
        <p className="text-brand-gray-500 mt-2">Instantly log credits and payments by speaking in Hindi, Hinglish, or English.</p>
      </div>

      {/* Mic Box Section */}
      <div className="bg-brand-card border border-brand-gray-200 rounded-card p-8 shadow-soft flex flex-col items-center justify-center space-y-6 relative overflow-hidden">
        {/* Dynamic State Layout */}
        {recorderState === 'idle' && (
          <>
            <button
              id="start-voice-record-btn"
              onClick={startRecording}
              className="w-24 h-24 sm:w-28 sm:h-28 bg-brand-green hover:bg-green-700 text-white rounded-full flex items-center justify-center shadow-premium hover:scale-105 transition-transform duration-300 relative group cursor-pointer"
            >
              <Mic size={36} className="sm:size-[40px] group-hover:scale-110 transition-transform" />
            </button>

            <div className="text-center space-y-2 max-w-sm">
              <p className="font-bold text-brand-dark text-lg">Tap to start recording</p>
              <p className="text-xs text-brand-gray-400">Microphone will activate and listen for credit or collection phrases.</p>
            </div>

            {/* Speaking Tips */}
            <div className="w-full bg-brand-bg rounded-2xl p-4 border border-brand-gray-200 flex gap-3 text-xs text-brand-gray-600 items-start">
              <HelpCircle size={18} className="text-brand-green shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-bold text-brand-dark">Try saying something like:</span>
                <ul className="list-disc pl-4 space-y-1 text-brand-gray-500">
                  <li>"Rahul Mechanic ko 500 rupaye udhaar de diya"</li>
                  <li>"Raju Milkman ne 300 rupaye wapas diye"</li>
                  <li>"Amit Sharma ko 1000 credit"</li>
                </ul>
              </div>
            </div>
          </>
        )}

        {recorderState === 'recording' && (
          <div className="w-full flex flex-col items-center space-y-6 animate-in fade-in duration-300">
            {/* Pulsing indicator with microphone */}
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 text-brand-danger rounded-full text-xs font-bold animate-pulse">
              <span className="w-2.5 h-2.5 rounded-full bg-brand-danger animate-ping"></span>
              <span>🎤 Recording...</span>
            </div>

            {/* Stop button and waveform */}
            <div className="flex items-center justify-center gap-5 py-2 w-full max-w-md">
              <button
                id="stop-voice-record-btn"
                onClick={stopRecording}
                className="w-16 h-16 sm:w-20 sm:h-20 bg-brand-danger hover:bg-red-700 text-white rounded-full flex items-center justify-center shadow-premium hover:scale-105 transition-transform duration-300 cursor-pointer shrink-0"
                title="Stop Recording"
              >
                <MicOff size={24} className="sm:size-8" />
              </button>

              {/* Wave animation container */}
              <div className="flex items-end h-12 sm:h-16 gap-1 px-4 py-2 bg-brand-bg rounded-2xl border border-brand-gray-200 shadow-inner flex-1 justify-center">
                <span className="wave-bar" style={{ animationDelay: '0.1s', height: '24px' }}></span>
                <span className="wave-bar" style={{ animationDelay: '0.4s', height: '36px' }}></span>
                <span className="wave-bar" style={{ animationDelay: '0.2s', height: '28px' }}></span>
                <span className="wave-bar" style={{ animationDelay: '0.6s', height: '40px' }}></span>
                <span className="wave-bar" style={{ animationDelay: '0.3s', height: '32px' }}></span>
                <span className="wave-bar" style={{ animationDelay: '0.7s', height: '26px' }}></span>
                <span className="wave-bar" style={{ animationDelay: '0.5s', height: '38px' }}></span>
              </div>
            </div>

            <div className="w-full text-center space-y-4">
              <p className="font-bold text-brand-green text-lg animate-pulse tracking-wide">Listening...</p>
              
              {/* Transcript Preview */}
              <div className="w-full max-w-lg mx-auto bg-brand-bg border border-brand-gray-200 p-5 rounded-2xl max-h-36 overflow-y-auto text-sm text-brand-dark font-medium italic leading-relaxed shadow-inner">
                {transcript || interimTranscript ? (
                  <span>
                    {transcript}
                    <span className="text-brand-gray-400">{interimTranscript}</span>
                  </span>
                ) : (
                  <span className="text-brand-gray-400">Speak now, transaction text will appear here...</span>
                )}
              </div>

              {/* Done Speaking Premium Button */}
              <div className="pt-2 flex justify-center">
                <button
                  id="done-speaking-btn"
                  onClick={stopRecording}
                  className="w-full max-w-xs px-8 py-4 bg-brand-green hover:bg-green-700 text-white font-extrabold text-base rounded-2xl shadow-soft hover:shadow-premium transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer border-b-4 border-green-800"
                >
                  <CheckCircle size={20} />
                  <span>Done Speaking</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {recorderState === 'extracting' && (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <RefreshCw size={40} className="text-brand-green animate-spin" />
            <p className="font-bold text-brand-dark">AI Extracting details...</p>
            <p className="text-xs text-brand-gray-400">Gemini is parsing your speech into ledger records.</p>
          </div>
        )}

        {/* Smart Customer Resolution Modal (Within mic card wrapper for flow consistency) */}
        {recorderState === 'multiple_matches' && (
          <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom duration-300">
            <div className="text-center">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-warning bg-amber-50 px-3 py-1 rounded-full border border-amber-200">
                Smart Customer Resolution
              </span>
              <h2 className="text-xl font-bold text-brand-dark mt-2">
                {isSpellingSuggestion ? 'Did you mean?' : 'Multiple Customers Found'}
              </h2>
              <p className="text-xs text-brand-gray-500 mt-1">
                {isSpellingSuggestion 
                  ? 'We found a similar existing customer in the database.' 
                  : `We found multiple accounts matching "${extractedName}". Please select one.`}
              </p>
            </div>

            <div className="grid grid-cols-1 gap-3 max-h-60 overflow-y-auto p-1">
              {candidates.map((c) => (
                <button
                  key={c.id}
                  onClick={() => handleSelectCandidate(c)}
                  className="w-full bg-brand-bg hover:bg-brand-gray-150 border border-brand-gray-200 rounded-xl p-4 text-left flex justify-between items-center transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-10 h-10 ${getAvatarBg(c.name)} border font-extrabold text-sm flex items-center justify-center rounded-full shrink-0 shadow-sm`}>
                      {(c.name || 'U').charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-brand-dark text-sm truncate">
                        {isSpellingSuggestion ? `✓ ${c.name}` : `○ ${c.name}`}
                      </p>
                      <p className="text-xs text-brand-gray-400 mt-0.5 truncate">{c.phone}</p>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-xs font-bold text-brand-gray-500">Outstanding:</span>
                    <span className="block font-bold text-sm text-brand-dark">₹{c.balance}</span>
                  </div>
                </button>
              ))}

              {/* Create new customer option instead */}
              <button
                onClick={() => {
                  setMatchedCustomer(null);
                  setExplicitConfirmNew(true);
                  setRecorderState('confirming');
                }}
                className="w-full border border-dashed border-brand-green hover:bg-green-50/50 rounded-xl p-4 text-left flex justify-between items-center text-brand-green font-semibold text-sm transition-colors"
              >
                <span>
                  {isSpellingSuggestion 
                    ? `Create a NEW account named "${extractedName}"` 
                    : `○ Create a NEW account named "${extractedName}"`}
                </span>
                <User size={16} />
              </button>
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleDiscard}
                className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                Cancel / Start Over
              </button>
            </div>
          </div>
        )}

        {/* Confirmation Card */}
        {recorderState === 'confirming' && (
          <div className="w-full space-y-6 animate-in fade-in slide-in-from-bottom duration-300">
            <div className="text-center">
              <span className="text-xs font-bold uppercase tracking-wider text-brand-success bg-green-50 px-3 py-1 rounded-full border border-green-200 flex items-center gap-1.5 w-fit mx-auto">
                <CheckCircle size={12} />
                Extracted Successfully
              </span>
              <h2 className="text-xl font-bold text-brand-dark mt-3">Confirm Transaction Details</h2>
              <p className="text-xs text-brand-gray-500 mt-1 italic">Voice transcript: "{transcript}"</p>
            </div>

            <div className="space-y-4 border border-brand-gray-200 p-5 rounded-2xl bg-brand-bg/50">
              {/* Customer input fields */}
              <div>
                <label className="block text-xs font-bold text-brand-gray-500 uppercase tracking-wider mb-1">Customer Name</label>
                <input
                  id="extracted-name-input"
                  type="text"
                  value={extractedName}
                  onChange={(e) => {
                    setExtractedName(e.target.value);
                    setExplicitConfirmNew(false);
                  }}
                  onBlur={() => {
                    setExtractedName(sanitizeCustomerName(extractedName));
                  }}
                  className="w-full bg-brand-card px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-semibold text-sm"
                />
                <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium">
                  {matchedCustomer ? (
                    <span className="text-brand-green flex items-center gap-1">
                      <Info size={12} /> Matches existing ledger account (ID: {matchedCustomer.id})
                    </span>
                  ) : (
                    <span className="text-brand-warning flex items-center gap-1">
                      <Info size={12} /> Will create a NEW customer account
                    </span>
                  )}
                </div>
              </div>

              {/* Amount and Type row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-brand-gray-500 uppercase tracking-wider mb-1">Amount (₹)</label>
                  <input
                    id="extracted-amount-input"
                    type="number"
                    value={extractedAmount || ''}
                    onChange={(e) => setExtractedAmount(parseFloat(e.target.value) || 0)}
                    className="w-full bg-brand-card px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-bold text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-brand-gray-500 uppercase tracking-wider mb-1">Transaction Type</label>
                  <select
                    id="extracted-type-select"
                    value={extractedType}
                    onChange={(e: any) => setExtractedType(e.target.value)}
                    className="w-full bg-brand-card px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-semibold text-sm cursor-pointer"
                  >
                    <option value="unknown" disabled>Select Transaction Type...</option>
                    <option value="credit">Give Credit (Udhaar)</option>
                    <option value="collection">Receive Payment (Wapas)</option>
                  </select>
                </div>
              </div>

              {isAiFallback && (
                <div className="p-3 bg-brand-gray-100 rounded-xl flex items-start gap-2 text-[10px] text-brand-gray-500 leading-normal">
                  <Info size={14} className="shrink-0 text-brand-gray-400 mt-0.5" />
                  Using local NLP parser fallback. Enter your Gemini API key in the backend environment file for high-precision extraction.
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex gap-4">
              <button
                onClick={handleDiscard}
                className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors text-sm"
              >
                Discard / Try Again
              </button>
              <button
                id="confirm-voice-save-btn"
                onClick={handleConfirmSave}
                className="flex-1 bg-brand-green hover:bg-green-700 text-white font-bold py-3 rounded-xl shadow-soft hover:shadow-premium transition-all text-sm"
              >
                Confirm & Save Entry
              </button>
            </div>
          </div>
        )}

        {/* Error notification block */}
        {errorMsg && (
          <div className="w-full p-4 border border-red-200 bg-red-50 rounded-2xl flex gap-3 text-xs text-brand-danger items-start mt-4">
            <AlertCircle size={18} className="shrink-0" />
            <div>
              <p className="font-bold">Error</p>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
