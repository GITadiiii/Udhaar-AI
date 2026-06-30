import React, { useState, useEffect, lazy, Suspense } from 'react';
import { fetchCustomers, fetchReminders, fetchTransactions, createCustomer, deleteCustomer, updateCustomer, fetchLedger, registerMerchant, clearCacheForDate, clearLedgerCache } from './utils/api';
import { Customer, Reminder, Transaction } from './types';
import Dashboard from './components/Dashboard'; // Static load for instant first-paint
import { trackEvent, hashId } from './utils/analytics';
import DatePicker from './components/DatePicker';
import { LayoutDashboard, BookOpen, Mic, BellRing, Sparkles, Settings, LogOut, Store, CreditCard, Key, Smartphone, MapPin, RefreshCw, AlertTriangle, Menu, X } from 'lucide-react';

// Lazy loaded page components
const Customers = lazy(() => import('./components/Customers'));
const CustomerLedger = lazy(() => import('./components/CustomerLedger'));
const VoiceRecorder = lazy(() => import('./components/VoiceRecorder'));
const Summaries = lazy(() => import('./components/Summaries'));
const Reminders = lazy(() => import('./components/Reminders'));

const PageLoader = () => (
  <div className="flex flex-col items-center justify-center min-h-[40vh] space-y-4">
    <div className="relative">
      <div className="w-10 h-10 border-4 border-brand-green border-t-transparent rounded-full animate-spin"></div>
      <Sparkles size={16} className="absolute inset-0 m-auto text-brand-green animate-pulse" />
    </div>
    <p className="text-brand-gray-500 font-bold text-xs uppercase tracking-wider">Loading page content...</p>
  </div>
);

const getTodayStr = () => {
  const localDate = new Date();
  const offset = 5.5 * 60 * 60 * 1000; // IST offset
  const istDate = new Date(localDate.getTime() + offset);
  const year = istDate.getUTCFullYear();
  const month = String(istDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(istDate.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [selectedDate, setSelectedDate] = useState(getTodayStr);
  const [activePage, setActivePage] = useState('dashboard');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  
  // Responsive sidebar states
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  
  // App state
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  // Performance Log states to track one-time boot metric logs
  const [hasLoggedDashboard, setHasLoggedDashboard] = useState(false);
  const [hasLoggedCustomers, setHasLoggedCustomers] = useState(false);

  // Log App Open -> First Paint metric once
  useEffect(() => {
    const firstPaint = performance.now() - ((window as any).APP_START_TIME || performance.now());
    console.log(`[PERFORMANCE] App Open -> First Paint / Render: ${firstPaint.toFixed(2)}ms`);
    trackEvent('app_open', {
      first_paint_ms: Math.round(firstPaint)
    });
  }, []);

  // Track ledger opened
  useEffect(() => {
    if (activePage === 'customers' && selectedCustomerId) {
      trackEvent('ledger_opened', {
        customer_id: hashId(selectedCustomerId)
      });
    }
  }, [activePage, selectedCustomerId]);

  // Log App Open -> Dashboard Visible once data is present
  useEffect(() => {
    if (!loading && customers.length > 0 && !hasLoggedDashboard) {
      setHasLoggedDashboard(true);
      const visibleTime = performance.now() - ((window as any).APP_START_TIME || performance.now());
      console.log(`[PERFORMANCE] App Open -> Dashboard Visible: ${visibleTime.toFixed(2)}ms`);
    }
  }, [loading, customers, hasLoggedDashboard]);

  // Log App Open -> Customer List Loaded once data is ready
  useEffect(() => {
    if (customers.length > 0 && !hasLoggedCustomers) {
      setHasLoggedCustomers(true);
      const visibleTime = performance.now() - ((window as any).APP_START_TIME || performance.now());
      console.log(`[PERFORMANCE] App Open -> Customer List Loaded: ${visibleTime.toFixed(2)}ms`);
    }
  }, [customers, hasLoggedCustomers]);

  // Initialize default merchant ID if not present
  useEffect(() => {
    if (!localStorage.getItem('udhaar_merchant_id')) {
      localStorage.setItem('udhaar_merchant_id', 'merchant_1');
    }
  }, []);

  // Settings state
  const [shopName, setShopName] = useState(() => localStorage.getItem('udhaar_shop_name') || 'Karan Kirana Store');
  const [merchantName, setMerchantName] = useState(() => localStorage.getItem('udhaar_merchant_name') || 'Karan Kumar');
  const [merchantPhone, setMerchantPhone] = useState(() => localStorage.getItem('udhaar_merchant_phone') || '+919876543210');
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('udhaar_gemini_key') || '');
  const [useLocalSim, setUseLocalSim] = useState(true);

  // Modal states for Login Screen
  const [isEditProfileOpen, setIsEditProfileOpen] = useState(false);
  const [isCreateAccountOpen, setIsCreateAccountOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Profile Form State
  const [editMerchantName, setEditMerchantName] = useState('');
  const [editShopName, setEditShopName] = useState('');
  const [editMerchantPhone, setEditMerchantPhone] = useState('');
  const [editBusinessCategory, setEditBusinessCategory] = useState('');

  // Create Account Form State
  const [createMerchantName, setCreateMerchantName] = useState('');
  const [createShopName, setCreateShopName] = useState('');
  const [createMerchantPhone, setCreateMerchantPhone] = useState('');
  const [createBusinessType, setCreateBusinessType] = useState('Kirana Store');

  const handleOpenEditProfile = () => {
    setEditMerchantName(merchantName);
    setEditShopName(shopName);
    setEditMerchantPhone(merchantPhone);
    setEditBusinessCategory(localStorage.getItem('udhaar_business_category') || '');
    setIsEditProfileOpen(true);
  };

  const handleSaveEditProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentMerchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
    try {
      await registerMerchant({
        id: currentMerchantId,
        name: editMerchantName,
        businessName: editShopName,
        phone: editMerchantPhone
      });
      setMerchantName(editMerchantName);
      setShopName(editShopName);
      setMerchantPhone(editMerchantPhone);
      localStorage.setItem('udhaar_merchant_name', editMerchantName);
      localStorage.setItem('udhaar_shop_name', editShopName);
      localStorage.setItem('udhaar_merchant_phone', editMerchantPhone);
      localStorage.setItem('udhaar_business_category', editBusinessCategory);
      setIsEditProfileOpen(false);
      setIsAuthenticated(true);
      
      trackEvent('merchant_login', {
        method: 'edit_profile'
      });
    } catch (err: any) {
      alert(`Failed to update profile: ${err.message}`);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!createMerchantName || !createShopName || !createMerchantPhone) {
      alert('Please fill in all required fields.');
      return;
    }
    setIsSubmitting(true);
    const newMerchantId = 'merchant_' + Math.random().toString(36).substring(2, 11);
    try {
      await registerMerchant({
        id: newMerchantId,
        name: createMerchantName,
        businessName: createShopName,
        phone: createMerchantPhone
      });
      setMerchantName(createMerchantName);
      setShopName(createShopName);
      setMerchantPhone(createMerchantPhone);
      localStorage.setItem('udhaar_merchant_id', newMerchantId);
      localStorage.setItem('udhaar_merchant_name', createMerchantName);
      localStorage.setItem('udhaar_shop_name', createShopName);
      localStorage.setItem('udhaar_merchant_phone', createMerchantPhone);
      localStorage.setItem('udhaar_business_type', createBusinessType);
      setIsCreateAccountOpen(false);
      setIsAuthenticated(true);

      trackEvent('merchant_registered', {
        business_type: createBusinessType
      });
      trackEvent('merchant_login', {
        method: 'register'
      });
    } catch (err: any) {
      alert(`Registration failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const loadData = async (dateStr?: string, forceRefresh = false) => {
    const targetDate = dateStr || selectedDate;
    const syncStart = performance.now();
    console.log('[DASHBOARD START] Initializing dashboard data fetch...');

    const spinnerTimeout = setTimeout(() => {
      setLoading(false);
      console.warn('[TIMEOUT SAFEGUARD] Loading spinner dismissed after 2.5s timeout safeguard.');
    }, 2500);
    
    try {
      // Step A: Load instantly from cache first (if exists)
      const [cachedCust, cachedRem, cachedTx] = await Promise.all([
        fetchCustomers(targetDate, false),
        fetchReminders(targetDate, false),
        fetchTransactions(targetDate, false)
      ]);
      
      setCustomers(cachedCust);
      setReminders(cachedRem);
      setTransactions(cachedTx);
      
      // If we resolved from cache, hide loader immediately
      if (cachedCust.length > 0 || cachedTx.length > 0) {
        setLoading(false);
        clearTimeout(spinnerTimeout);
        const paintTime = performance.now() - ((window as any).APP_START_TIME || performance.now());
        console.log(`[PERFORMANCE] App Open -> Cached UI painted in ${paintTime.toFixed(2)}ms`);
      }
    } catch (e: any) {
      console.warn('[SWR CACHE READ] Failed to load from cache:', e.message);
    }
    
    setIsSyncing(true);
    try {
      console.log(`[LEDGER SYNC START] Background synchronization started for date: ${targetDate}`);
      const ledSyncStart = performance.now();
      // Step B: Query server in background to sync state quietly
      const [freshCust, freshRem, freshTx] = await Promise.all([
        fetchCustomers(targetDate, true),
        fetchReminders(targetDate, true),
        fetchTransactions(targetDate, true)
      ]);
      console.log(`[LEDGER SYNC END] Background synchronization finished in ${(performance.now() - ledSyncStart).toFixed(2)}ms`);
      
      setCustomers(freshCust);
      setReminders(freshRem);
      setTransactions(freshTx);
      
      const bootSyncTime = performance.now() - ((window as any).APP_START_TIME || performance.now());
      const querySyncTime = performance.now() - syncStart;
      console.log(`[PERFORMANCE] App Open -> Sync Complete: Fresh UI loaded in ${bootSyncTime.toFixed(2)}ms (Sync query took ${querySyncTime.toFixed(2)}ms)`);
    } catch (err: any) {
      console.error('Failed to sync database in background:', err);
      if (err.status === 403 || err.code === 'MERCHANT_MISSING' || err.message?.includes('Merchant record missing')) {
        alert('Your merchant account was not found in the database. Redirecting to registration.');
        localStorage.removeItem('udhaar_merchant_id');
        localStorage.removeItem('udhaar_merchant_name');
        localStorage.removeItem('udhaar_shop_name');
        localStorage.removeItem('udhaar_merchant_phone');
        handleLogout();
      }
    } finally {
      clearTimeout(spinnerTimeout);
      setIsSyncing(false);
      setLoading(false);
      console.log(`[DASHBOARD END] Dashboard loading sequence finished. Total duration: ${(performance.now() - syncStart).toFixed(2)}ms`);
    }
  };

  const handleBalanceChangeIncremental = (customerId: string, newBalance: number, newTx?: Transaction) => {
    // 1. Update customer balance in local state
    setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, balance: newBalance, last_updated: newTx ? newTx.date : c.last_updated } : c));
    
    // 2. Add transaction to state
    if (newTx) {
      setTransactions(prev => [...prev.filter(t => t.id !== newTx.id), newTx]);
    }
    
    // 3. Invalidate caches
    clearCacheForDate(selectedDate);
    clearLedgerCache(customerId);
    
    // 4. Background refresh quietly
    loadData(selectedDate, true);
  };

  const handleVoiceTransactionSaved = (newCustomer: Customer | null, customerId: string, newBalance: number, newTx: Transaction | undefined) => {
    // 1. Invalidate caches
    clearCacheForDate(selectedDate);
    if (newCustomer) {
      clearLedgerCache(newCustomer.id);
    }
    clearLedgerCache(customerId);

    const txDate = newTx?.date || new Date().toISOString();

    // 2. Update states
    if (newCustomer) {
      const formattedCust: Customer = {
        ...newCustomer,
        balance: newBalance,
        last_updated: txDate,
        normalizedName: newCustomer.normalizedName || newCustomer.name.toLowerCase().replace(/\s+/g, ''),
        aliases: newCustomer.aliases || [newCustomer.name],
        deleted: false
      };
      setCustomers(prev => [...prev.filter(c => c.id !== newCustomer.id), formattedCust]);
    } else {
      setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, balance: newBalance, last_updated: txDate } : c));
    }
    
    if (newTx?.id) {
      setTransactions(prev => [...prev.filter(t => t.id !== newTx.id), newTx]);
    }

    // 3. Trigger background refresh
    loadData(selectedDate, true);
  };

  useEffect(() => {
    if (isAuthenticated) {
      loadData(selectedDate);
    }
  }, [isAuthenticated, selectedDate]);

  // Navigate utility supporting ledger opening hooks
  const handleNavigate = (page: string, params?: any) => {
    setActivePage(page);
    setIsMobileSidebarOpen(false); // auto close mobile sidebar on navigation
    if (page === 'customers' && params?.openLedgerId) {
      setSelectedCustomerId(params.openLedgerId);
    } else {
      setSelectedCustomerId(null);
    }
  };

  const handleMockLogin = () => {
    setIsAuthenticated(true);
    trackEvent('merchant_login', {
      method: 'mock_continue'
    });
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCustomers([]);
    setTransactions([]);
    setReminders([]);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentMerchantId = localStorage.getItem('udhaar_merchant_id') || 'merchant_1';
    try {
      await registerMerchant({
        id: currentMerchantId,
        name: merchantName,
        businessName: shopName,
        phone: merchantPhone
      });
      localStorage.setItem('udhaar_shop_name', shopName);
      localStorage.setItem('udhaar_merchant_name', merchantName);
      localStorage.setItem('udhaar_merchant_phone', merchantPhone);
      localStorage.setItem('udhaar_gemini_key', geminiKey);
      alert('Settings saved successfully!');
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message}`);
    }
  };

  if (!isAuthenticated) {
    // Beautiful login dashboard screen mimicking Clerk Auth portal
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-gradient-to-tr from-green-500/10 via-slate-50 to-emerald-500/5 -z-10"></div>
        
        <div className="bg-brand-card border border-brand-gray-200 w-full max-w-md p-8 rounded-card shadow-premium space-y-8 animate-in fade-in zoom-in duration-300">
          {/* Logo & Headline */}
          <div className="text-center space-y-2">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-50 text-brand-green rounded-2xl border border-green-150 mb-3 shadow-sm">
              <Mic size={32} className="animate-pulse" />
            </div>
            <h1 className="text-3xl font-extrabold text-brand-dark tracking-tight">UdhaarAI</h1>
            <p className="text-brand-gray-500 text-sm font-medium">Voice-Powered Credit Assistant for Kirana Merchants</p>
          </div>

          <div className="space-y-4 border border-brand-gray-150 p-4 rounded-2xl bg-brand-bg/60">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-green bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
              Demo Merchant Portal
            </span>
            <div className="space-y-2.5 mt-2.5 text-xs text-brand-gray-600">
              <div className="flex justify-between">
                <span className="font-semibold text-brand-gray-500">Business Profile:</span>
                <span className="font-bold text-brand-dark">{shopName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-brand-gray-500">Merchant User:</span>
                <span className="font-bold text-brand-dark">{merchantName}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-brand-gray-500">Verified Mobile:</span>
                <span className="font-bold text-brand-dark">{merchantPhone || 'Not Configured'}</span>
              </div>
            </div>
          </div>

          {/* Call to action login */}
          <div className="space-y-5">
            <button
              id="mock-login-btn"
              onClick={handleMockLogin}
              className="w-full bg-brand-green hover:bg-green-700 text-white font-bold py-3.5 rounded-xl shadow-soft hover:shadow-premium transition-all duration-300 flex items-center justify-center gap-2 text-sm cursor-pointer"
            >
              <Store size={18} />
              Continue as {merchantName}
            </button>

            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-brand-gray-150"></div>
              <span className="flex-shrink mx-3 text-brand-gray-400 text-[10px] font-extrabold uppercase tracking-wider">Not {merchantName}?</span>
              <div className="flex-grow border-t border-brand-gray-150"></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                id="login-edit-profile-btn"
                onClick={handleOpenEditProfile}
                className="w-full bg-white hover:bg-brand-gray-50 text-brand-dark font-bold py-3 px-2.5 rounded-xl border border-brand-gray-200 shadow-soft hover:shadow-md transition-all duration-300 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
              >
                <Settings size={14} />
                Edit Profile
              </button>
              <button
                id="login-create-account-btn"
                onClick={() => setIsCreateAccountOpen(true)}
                className="w-full bg-white hover:bg-brand-gray-50 text-brand-dark font-bold py-3 px-2.5 rounded-xl border border-brand-gray-200 shadow-soft hover:shadow-md transition-all duration-300 flex items-center justify-center gap-1.5 text-xs cursor-pointer"
              >
                <Store size={14} />
                Create Account
              </button>
            </div>
            
            <p className="text-center text-[10px] text-brand-gray-400">
              Simulating Clerk Authentication Protocol for local sandboxed development.
            </p>
          </div>
        </div>

        {/* Edit Profile Modal */}
        {isEditProfileOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
            <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-md p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
              <h2 className="text-2xl font-bold text-brand-dark mb-2">Edit Merchant Profile</h2>
              <p className="text-sm text-brand-gray-500 mb-6">Modify your profile details and business store name.</p>
              
              <form onSubmit={handleSaveEditProfile} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Merchant Name</label>
                  <input
                    id="edit-profile-merchant-name"
                    type="text"
                    required
                    value={editMerchantName}
                    onChange={(e) => setEditMerchantName(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Business Name</label>
                  <input
                    id="edit-profile-shop-name"
                    type="text"
                    required
                    value={editShopName}
                    onChange={(e) => setEditShopName(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Mobile Number (Optional)</label>
                  <input
                    id="edit-profile-phone"
                    type="text"
                    value={editMerchantPhone}
                    onChange={(e) => setEditMerchantPhone(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Business Category (Optional)</label>
                  <input
                    id="edit-profile-category"
                    type="text"
                    placeholder="e.g. Kirana, Pharmacy, Retail"
                    value={editBusinessCategory}
                    onChange={(e) => setEditBusinessCategory(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                
                <div className="pt-4 flex justify-end gap-3">
                  <button
                    id="edit-profile-cancel-btn"
                    type="button"
                    onClick={() => setIsEditProfileOpen(false)}
                    className="px-5 py-3 rounded-xl border border-brand-gray-200 text-brand-dark hover:bg-brand-gray-50 transition-colors font-semibold text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    id="edit-profile-save-btn"
                    type="submit"
                    className="px-5 py-3 rounded-xl bg-brand-green hover:bg-green-700 text-white transition-colors font-semibold text-sm shadow-soft hover:shadow-premium cursor-pointer"
                  >
                    Save & Continue
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Create Account Modal */}
        {isCreateAccountOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
            <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-md p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
              <h2 className="text-2xl font-bold text-brand-dark mb-2">Create Merchant Account</h2>
              <p className="text-sm text-brand-gray-500 mb-6">Register a new Kirana store or shop profile.</p>
              
              <form onSubmit={handleCreateAccount} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Merchant Name *</label>
                  <input
                    id="create-account-merchant-name"
                    type="text"
                    required
                    placeholder="e.g. Aditi Sinha"
                    value={createMerchantName}
                    onChange={(e) => setCreateMerchantName(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Business Name *</label>
                  <input
                    id="create-account-shop-name"
                    type="text"
                    required
                    placeholder="e.g. Aditi General Store"
                    value={createShopName}
                    onChange={(e) => setCreateShopName(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Mobile Number *</label>
                  <input
                    id="create-account-phone"
                    type="text"
                    required
                    placeholder="e.g. 9876543210"
                    value={createMerchantPhone}
                    onChange={(e) => setCreateMerchantPhone(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Business Type</label>
                  <select
                    id="create-account-type"
                    value={createBusinessType}
                    onChange={(e) => setCreateBusinessType(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium"
                  >
                    <option value="Kirana Store">Kirana Store</option>
                    <option value="Furniture Shop">Furniture Shop</option>
                    <option value="Medical Store">Medical Store</option>
                    <option value="General Store">General Store</option>
                    <option value="Wholesale Store">Wholesale Store</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                
                <div className="pt-4 flex justify-end gap-3">
                  <button
                    id="create-account-cancel-btn"
                    type="button"
                    onClick={() => setIsCreateAccountOpen(false)}
                    className="px-5 py-3 rounded-xl border border-brand-gray-200 text-brand-dark hover:bg-brand-gray-50 transition-colors font-semibold text-sm cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    id="create-account-submit-btn"
                    type="submit"
                    disabled={isSubmitting}
                    className={`px-5 py-3 rounded-xl text-white transition-colors font-semibold text-sm shadow-soft hover:shadow-premium cursor-pointer ${
                      isSubmitting ? 'bg-brand-gray-400 cursor-not-allowed' : 'bg-brand-green hover:bg-green-700'
                    }`}
                  >
                    {isSubmitting ? 'Registering...' : 'Create Account'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg flex relative overflow-hidden">
      {/* Mobile Sidebar Overlay/Backdrop */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-[#0F172A]/50 backdrop-blur-sm z-40 md:hidden transition-opacity duration-300"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar Layout */}
      <aside className={`bg-brand-dark text-white flex flex-col justify-between shrink-0 border-r border-brand-gray-800 transition-all duration-300 z-50
        fixed inset-y-0 left-0 md:static md:flex
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        ${isSidebarCollapsed ? 'w-20 p-4' : 'w-64 p-6'}
      `}>
        <div className="space-y-8">
          {/* Brand Logo & Toggles */}
          <div className={`flex items-center justify-between ${isSidebarCollapsed ? 'flex-col gap-4' : 'px-2'}`}>
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-brand-green rounded-xl shrink-0">
                <Mic size={20} className="text-white" />
              </div>
              {!isSidebarCollapsed && (
                <span className="font-extrabold text-xl tracking-tight">UdhaarAI</span>
              )}
            </div>
            {/* Desktop Hamburger Toggle Button */}
            <button
              id="sidebar-desktop-toggle"
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="hidden md:flex p-1.5 hover:bg-brand-gray-800 rounded-lg text-brand-gray-400 hover:text-white transition-colors cursor-pointer"
              title={isSidebarCollapsed ? "Expand Menu" : "Collapse Menu"}
            >
              <Menu size={18} />
            </button>
            {/* Mobile Close Button */}
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              className="md:hidden p-1.5 hover:bg-brand-gray-800 rounded-lg text-brand-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            <button
              id="nav-dashboard"
              onClick={() => handleNavigate('dashboard')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
              } ${
                activePage === 'dashboard'
                  ? 'bg-brand-green text-white shadow-soft'
                  : 'text-brand-gray-400 hover:bg-brand-gray-800 hover:text-white'
              }`}
              title={isSidebarCollapsed ? "Dashboard" : undefined}
            >
              <LayoutDashboard size={18} className="shrink-0" />
              {!isSidebarCollapsed && <span>Dashboard</span>}
            </button>

            <button
              id="nav-customers"
              onClick={() => handleNavigate('customers')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
              } ${
                activePage === 'customers'
                  ? 'bg-brand-green text-white shadow-soft'
                  : 'text-brand-gray-400 hover:bg-brand-gray-800 hover:text-white'
              }`}
              title={isSidebarCollapsed ? "Customers Ledgers" : undefined}
            >
              <BookOpen size={18} className="shrink-0" />
              {!isSidebarCollapsed && <span>Customers Ledgers</span>}
            </button>

            <button
              id="nav-voice-recorder"
              onClick={() => handleNavigate('voice-recorder')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
              } ${
                activePage === 'voice-recorder'
                  ? 'bg-brand-green text-white shadow-soft'
                  : 'text-brand-gray-400 hover:bg-brand-gray-800 hover:text-white'
              }`}
              title={isSidebarCollapsed ? "Voice Recorder" : undefined}
            >
              <Mic size={18} className="shrink-0" />
              {!isSidebarCollapsed && <span>Voice Recorder</span>}
            </button>

            <button
              id="nav-reminders"
              onClick={() => handleNavigate('reminders')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
              } ${
                activePage === 'reminders'
                  ? 'bg-brand-green text-white shadow-soft'
                  : 'text-brand-gray-400 hover:bg-brand-gray-800 hover:text-white'
              }`}
              title={isSidebarCollapsed ? "Reminders" : undefined}
            >
              <BellRing size={18} className="shrink-0" />
              {!isSidebarCollapsed && <span>Reminders</span>}
            </button>

            <button
              id="nav-summaries"
              onClick={() => handleNavigate('summaries')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
              } ${
                activePage === 'summaries'
                  ? 'bg-brand-green text-white shadow-soft'
                  : 'text-brand-gray-400 hover:bg-brand-gray-800 hover:text-white'
              }`}
              title={isSidebarCollapsed ? "AI Daily Summary" : undefined}
            >
              <Sparkles size={18} className="shrink-0" />
              {!isSidebarCollapsed && <span>AI Daily Summary</span>}
            </button>

            <button
              id="nav-settings"
              onClick={() => handleNavigate('settings')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all ${
                isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
              } ${
                activePage === 'settings'
                  ? 'bg-brand-green text-white shadow-soft'
                  : 'text-brand-gray-400 hover:bg-brand-gray-800 hover:text-white'
              }`}
              title={isSidebarCollapsed ? "Settings" : undefined}
            >
              <Settings size={18} className="shrink-0" />
              {!isSidebarCollapsed && <span>Settings</span>}
            </button>
          </nav>
        </div>

        {/* User Card */}
        <div className="border-t border-brand-gray-800 pt-5 space-y-4">
          <div className={`flex items-center gap-3 ${isSidebarCollapsed ? 'justify-center px-0' : 'px-2'}`}>
            <div className="w-10 h-10 bg-brand-green rounded-xl flex items-center justify-center font-bold text-base text-white uppercase shrink-0 shadow-sm">
              {(merchantName || 'U').split(' ').map(n => n[0]).join('').substring(0, 2)}
            </div>
            {!isSidebarCollapsed && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate text-white">{merchantName}</p>
                <p className="text-xs text-brand-gray-500 truncate">{shopName}</p>
              </div>
            )}
          </div>

          <button
            onClick={handleLogout}
            className={`w-full flex items-center gap-3 py-2.5 rounded-xl text-xs font-semibold text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors ${
              isSidebarCollapsed ? 'justify-center px-2' : 'px-4'
            }`}
            title={isSidebarCollapsed ? "Logout" : undefined}
          >
            <LogOut size={14} className="shrink-0" />
            {!isSidebarCollapsed && <span>Logout (Simulated)</span>}
          </button>
        </div>
      </aside>

      {/* Main Content Pane */}
      <main className="flex-1 p-3 sm:p-6 md:p-8 overflow-y-auto overflow-x-hidden max-w-7xl mx-auto w-full space-y-6">
        {/* Global Top Header Bar (Desktop & Mobile) */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-brand-card border border-brand-gray-200 p-3 sm:p-5 rounded-2xl shadow-soft">
          <div className="flex items-center gap-3">
            {/* Mobile Sidebar Toggle */}
            <button
              onClick={() => setIsMobileSidebarOpen(true)}
              className="md:hidden p-2 hover:bg-brand-gray-100 rounded-xl border border-brand-gray-200 text-brand-gray-600 transition-colors cursor-pointer"
            >
              <Menu size={20} />
            </button>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-brand-green bg-green-50 px-2.5 py-1 rounded-full border border-green-100">
                  {shopName}
                </span>
                {isSyncing && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-green bg-emerald-50 px-2 py-0.5 rounded-full border border-green-100 animate-pulse">
                    <RefreshCw size={10} className="animate-spin" />
                    Syncing updates...
                  </span>
                )}
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-brand-dark tracking-tight mt-1">
                {activePage === 'dashboard' && 'Dashboard'}
                {activePage === 'customers' && (selectedCustomerId ? 'Customer Ledger' : 'Customer Ledgers')}
                {activePage === 'voice-recorder' && 'Voice Recorder'}
                {activePage === 'reminders' && 'Reminders'}
                {activePage === 'summaries' && 'AI Daily Summary'}
                {activePage === 'settings' && 'Settings'}
              </h2>
            </div>
          </div>
          <div className="flex items-center gap-3 justify-between md:justify-end">
            <DatePicker selectedDate={selectedDate} onChange={setSelectedDate} />
            <div className="w-8 h-8 bg-brand-green rounded-lg flex items-center justify-center font-bold text-xs text-white uppercase shrink-0">
              {(merchantName || 'U').split(' ').map(n => n[0]).join('').substring(0, 2)}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <div className="w-12 h-12 border-4 border-brand-green border-t-transparent rounded-full animate-spin"></div>
            <p className="text-brand-gray-500 font-semibold text-sm">Loading latest updates...</p>
          </div>
        ) : (
          <>
            {/* Active view mapper */}
            {activePage === 'dashboard' && (
              <Dashboard 
                customers={customers} 
                transactions={transactions} 
                reminders={reminders}
                onNavigate={handleNavigate}
                merchantName={merchantName}
                shopName={shopName}
                selectedDate={selectedDate}
              />
            )}

            <Suspense fallback={<PageLoader />}>
              {activePage === 'customers' && (
                selectedCustomerId ? (
                  <CustomerLedger 
                    customerId={selectedCustomerId} 
                    onBack={() => setSelectedCustomerId(null)}
                    onBalanceChange={handleBalanceChangeIncremental}
                    onUpdateCustomer={async (id, data) => {
                      // Optimistic update
                      setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
                      clearCacheForDate(selectedDate);
                      clearLedgerCache(id);
                      try {
                        await updateCustomer(id, data);
                        loadData(selectedDate, true);
                        trackEvent('customer_updated', {
                          customer_id: hashId(id)
                        });
                      } catch (err) {
                        loadData(selectedDate, true);
                        throw err;
                      }
                    }}
                    selectedDate={selectedDate}
                  />
                ) : (
                  <Customers 
                    customers={customers}
                    onAddCustomer={async (newC) => {
                      try {
                        const result = await createCustomer(newC.name, newC.phone, newC.alias);
                        if (result.status === 'multiple_matches') {
                          trackEvent('duplicate_customer_detected', {
                            candidates_count: result.candidates?.length || 0,
                            entry_method: 'manual'
                          });
                          alert(`A customer with a similar name already exists: ${result.candidates.map((c: any) => c.name).join(', ')}. Please use a unique name.`);
                          throw new Error('Duplicate customer exists');
                        }
                        
                        clearCacheForDate(selectedDate);
                        
                        const newCreatedCustomer = {
                          id: result.id,
                          merchant_id: localStorage.getItem('udhaar_merchant_id') || 'merchant_1',
                          name: result.name,
                          displayName: result.name,
                          alias: result.alias || '',
                          phone: result.phone || '',
                          created_at: result.created_at || new Date().toISOString(),
                          balance: 0,
                          last_updated: result.created_at || new Date().toISOString(),
                          normalizedName: result.name.toLowerCase().replace(/\s+/g, ''),
                          aliases: [result.name],
                          deleted: false
                        };
                        setCustomers(prev => [...prev.filter(c => c.id !== result.id), newCreatedCustomer]);
                        
                        loadData(selectedDate, true);

                        trackEvent('customer_created', {
                          customer_created_from_voice: false
                        });
                        
                        if (result.was_existing) {
                          alert(`Customer "${result.name}" already exists. Opening their ledger.`);
                          handleNavigate('customers', { openLedgerId: result.id });
                        }
                        return result;
                      } catch (err: any) {
                        if (err.status === 403 || err.code === 'MERCHANT_MISSING' || err.message?.includes('Merchant record missing')) {
                          alert('Your merchant account was not found in the database. Redirecting to registration.');
                          localStorage.removeItem('udhaar_merchant_id');
                          localStorage.removeItem('udhaar_merchant_name');
                          localStorage.removeItem('udhaar_shop_name');
                          localStorage.removeItem('udhaar_merchant_phone');
                          handleLogout();
                        }
                        throw err;
                      }
                    }}
                    onSelectCustomer={(id) => setSelectedCustomerId(id)}
                    onDeleteCustomer={async (id) => {
                      // Optimistic delete
                      setCustomers(prev => prev.filter(c => c.id !== id));
                      clearCacheForDate(selectedDate);
                      clearLedgerCache(id);
                      try {
                        await deleteCustomer(id);
                        loadData(selectedDate, true);
                        trackEvent('customer_deleted', {
                          customer_id: hashId(id)
                        });
                      } catch (err) {
                        loadData(selectedDate, true);
                        alert('Failed to delete customer');
                      }
                    }}
                    onUpdateCustomer={async (id, data) => {
                      // Optimistic update
                      setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...data } : c));
                      clearCacheForDate(selectedDate);
                      clearLedgerCache(id);
                      try {
                        await updateCustomer(id, data);
                        loadData(selectedDate, true);
                        trackEvent('customer_updated', {
                          customer_id: hashId(id)
                        });
                      } catch (err) {
                        loadData(selectedDate, true);
                        alert('Failed to update customer');
                      }
                    }}
                  />
                )
              )}

              {activePage === 'voice-recorder' && (
                <VoiceRecorder 
                  customers={customers}
                  onTransactionSaved={handleVoiceTransactionSaved}
                  onNavigate={handleNavigate}
                />
              )}

              {activePage === 'reminders' && (
                <Reminders 
                  reminders={reminders} 
                  onNavigate={handleNavigate} 
                  shopName={shopName}
                />
              )}

              {activePage === 'summaries' && (
                <Summaries selectedDate={selectedDate} />
              )}
            </Suspense>

            {activePage === 'settings' && (
              <div className="space-y-6 max-w-2xl">
                <div>
                  <h1 className="text-3xl font-bold text-brand-dark tracking-tight">Business Settings</h1>
                  <p className="text-brand-gray-500 mt-1">Configure your profile, notification rules, and Gemini keys.</p>
                </div>

                <div className="bg-brand-card border border-brand-gray-200 rounded-card p-6 shadow-soft space-y-6">
                  <form onSubmit={handleSaveSettings} className="space-y-4">
                    <h3 className="font-bold text-brand-dark text-lg border-b border-brand-gray-150 pb-3 flex items-center gap-2">
                      <Store size={18} className="text-brand-green" /> Merchant Profile Settings
                    </h3>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Shop / Business Name</label>
                        <input
                          type="text"
                          value={shopName}
                          onChange={(e) => setShopName(e.target.value)}
                          className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Merchant Name</label>
                        <input
                          type="text"
                          value={merchantName}
                          onChange={(e) => setMerchantName(e.target.value)}
                          className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Registered Mobile</label>
                        <input
                          type="text"
                          value={merchantPhone}
                          onChange={(e) => setMerchantPhone(e.target.value)}
                          className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">Default Region / Currency</label>
                        <input
                          type="text"
                          disabled
                          value="INR (₹) - India"
                          className="w-full bg-brand-gray-100 px-4 py-3 rounded-xl border border-brand-gray-200 text-brand-gray-500 font-medium"
                        />
                      </div>
                    </div>

                    <h3 className="font-bold text-brand-dark text-lg border-b border-brand-gray-150 pt-4 pb-3 flex items-center gap-2">
                      <Key size={18} className="text-brand-green" /> Gemini AI Integration
                    </h3>

                    <div>
                      <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                        Gemini API Key
                      </label>
                      <input
                        type="password"
                        placeholder="••••••••••••••••••••••••••••"
                        value={geminiKey}
                        onChange={(e) => setGeminiKey(e.target.value)}
                        className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                      />
                      <p className="text-[10px] text-brand-gray-400 mt-1.5">
                        Leave blank to use the local regex/rule-based NLP parser. You can also specify GEMINI_API_KEY in the backend `.env` file.
                      </p>
                    </div>

                    <div className="pt-4 flex justify-end">
                      <button
                        type="submit"
                        className="bg-brand-green hover:bg-green-700 text-white font-semibold px-6 py-3 rounded-xl shadow-soft"
                      >
                        Save Settings
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
