import React, { useState, useEffect } from 'react';
import { Ledger, Transaction } from '../types';
import { fetchLedger, createTransaction, deleteTransaction } from '../utils/api';
import { ArrowLeft, Phone, Calendar, ArrowUpRight, ArrowDownLeft, AlertCircle, Share2, Clipboard, MessageSquare, Plus, PlusCircle, CheckCircle, Trash2, X, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';

interface CustomerLedgerProps {
  customerId: string;
  onBack: () => void;
  onBalanceChange: () => void;
  onUpdateCustomer: (id: string, customer: { name: string; phone: string; alias: string; address?: string; notes?: string; customerType?: string }) => Promise<void>;
  selectedDate: string;
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

const getDefaultTxDateTime = (dateStr: string) => {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${dateStr}T${hours}:${minutes}`;
};

export default function CustomerLedger({ customerId, onBack, onBalanceChange, onUpdateCustomer, selectedDate }: CustomerLedgerProps) {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Quick Transaction Modal/Form states
  const [showTxModal, setShowTxModal] = useState<false | 'credit' | 'collection'>(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [txDate, setTxDate] = useState(() => getDefaultTxDateTime(selectedDate));
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');

  const [transactionToDelete, setTransactionToDelete] = useState<Transaction | null>(null);
  const [deletingTx, setDeletingTx] = useState(false);

  // Edit Customer Form State
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAlias, setEditAlias] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCustomerType, setEditCustomerType] = useState('Retailer');
  const [editError, setEditError] = useState('');
  const [updating, setUpdating] = useState(false);

  const handleOpenEdit = () => {
    if (!ledger || !ledger.customer) return;
    const { customer } = ledger;
    setEditName(customer.name);
    setEditPhone(customer.phone || '');
    setEditAlias(customer.alias || '');
    setEditAddress(customer.address || '');
    setEditNotes(customer.notes || '');
    setEditCustomerType(customer.customerType || 'Retailer');
    setEditError('');
    setShowEditModal(true);
  };

  const handleUpdateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ledger || !ledger.customer) return;

    if (!editName.trim() || editName.trim().length < 2) {
      setEditError('Customer name must be at least 2 characters');
      return;
    }

    if (editPhone.trim()) {
      const phoneRegex = /^(?:\+?91)?[6-9]\d{9}$/;
      if (!phoneRegex.test(editPhone.trim())) {
        setEditError('Please enter a valid 10-digit Indian mobile number (e.g. +919876543210)');
        return;
      }
    }

    setUpdating(true);
    setEditError('');
    try {
      await onUpdateCustomer(ledger.customer.id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        alias: editAlias.trim(),
        address: editAddress.trim(),
        notes: editNotes.trim(),
        customerType: editCustomerType
      });
      setShowEditModal(false);
      await loadLedger();
      onBalanceChange();
    } catch (err: any) {
      console.error(err);
      setEditError(err.message || 'Failed to update customer');
    } finally {
      setUpdating(false);
    }
  };

  const loadLedger = async () => {
    setLoading(true);
    try {
      const data = await fetchLedger(customerId, selectedDate);
      setLedger(data);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to load ledger');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setTxDate(getDefaultTxDateTime(selectedDate));
  }, [selectedDate]);

  useEffect(() => {
    loadLedger();
  }, [customerId, selectedDate]);

  const handleTransactionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || parseFloat(amount) <= 0 || !showTxModal) return;

    setSubmitting(true);
    try {
      const parsedAmount = parseFloat(amount);
      const formattedDate = new Date(txDate).toISOString();

      await createTransaction({
        customerId,
        amount: parsedAmount,
        type: showTxModal,
        description: description.trim() || undefined,
        date: formattedDate
      });

      // Confetti feedback
      confetti({
        particleCount: 80,
        spread: 60,
        origin: { y: 0.7 }
      });

      setAmount('');
      setDescription('');
      setShowTxModal(false);
      
      // Reload details and trigger parent state update
      await loadLedger();
      onBalanceChange();
      
      setSuccessMsg(`Successfully saved ${showTxModal} entry!`);
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err: any) {
      console.error(err);
      alert('Failed to save transaction');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTransactionConfirm = async () => {
    if (!transactionToDelete) return;
    setDeletingTx(true);
    try {
      await deleteTransaction(transactionToDelete.id);
      setTransactionToDelete(null);
      await loadLedger();
      onBalanceChange();
      setSuccessMsg('Transaction deleted successfully!');
      setTimeout(() => setSuccessMsg(''), 3000);
    } catch (err) {
      console.error(err);
      alert('Error deleting transaction');
    } finally {
      setDeletingTx(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 space-y-4">
        <div className="w-12 h-12 border-4 border-brand-green border-t-transparent rounded-full animate-spin"></div>
        <p className="text-brand-gray-500 font-semibold text-sm">Loading ledger history...</p>
      </div>
    );
  }

  if (error || !ledger) {
    return (
      <div className="bg-red-50 border border-red-200 p-6 rounded-card text-center text-brand-danger">
        <AlertCircle className="mx-auto mb-3" size={32} />
        <h3 className="font-bold text-lg">Error loading ledger</h3>
        <p className="text-sm mt-1">{error || 'Something went wrong.'}</p>
        <button onClick={onBack} className="mt-4 px-4 py-2 bg-brand-dark text-white rounded-xl font-semibold text-xs">
          Go Back
        </button>
      </div>
    );
  }

  const { customer, transactions, reminders } = ledger;
  const hasDue = customer.balance > 0;
  
  // Format payment reminder text
  const shareText = `Dear ${customer.name}, this is a friendly payment reminder for your outstanding balance of Rs. ${customer.balance} at Karan Kirana Store. Please settle your dues at your earliest convenience. Thank you!`;
  const whatsappUrl = customer.phone 
    ? `https://wa.me/${customer.phone.replace(/[+]/g, '')}?text=${encodeURIComponent(shareText)}`
    : '#';

  const handleCopyClipboard = () => {
    navigator.clipboard.writeText(shareText);
    alert('Reminder message copied to clipboard!');
  };

  return (
    <div className="space-y-6">
      {/* Back & Profile Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-brand-gray-200 pb-6">
        <div className="flex items-center gap-4">
          <button
            id="back-to-customers"
            onClick={onBack}
            className="p-2.5 bg-brand-card hover:bg-brand-gray-100 rounded-xl border border-brand-gray-200 text-brand-gray-600 transition-colors shadow-soft cursor-pointer"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-3">
            <div className={`w-11 h-11 ${getAvatarBg(customer.name)} border font-extrabold text-lg flex items-center justify-center rounded-full shrink-0 shadow-sm`}>
              {(customer.name || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-brand-dark tracking-tight">{customer.name}</h1>
                <button
                  id="edit-customer-ledger-btn"
                  onClick={handleOpenEdit}
                  className="px-2.5 py-1 rounded-lg border border-brand-gray-200 text-brand-dark bg-brand-bg hover:bg-brand-gray-50 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs shadow-soft"
                >
                  Edit
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs text-brand-gray-500 font-medium">
                {customer.alias && (
                  <span className="bg-brand-gray-150 px-2 py-0.5 rounded border">Alias: {customer.alias}</span>
                )}
                {customer.phone ? (
                  <span className="flex items-center gap-1"><Phone size={12} /> {customer.phone}</span>
                ) : (
                  <span className="italic text-brand-gray-400">No Phone Number</span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar size={12} /> Joined {new Date(customer.created_at).toLocaleDateString('en-IN')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Ledger Due Card */}
        <div className={`p-4 rounded-2xl border flex items-center gap-4 shadow-soft ${
          hasDue 
            ? 'bg-red-50 border-red-200 text-brand-danger' 
            : customer.balance < 0 
            ? 'bg-green-50 border-green-200 text-brand-green'
            : 'bg-brand-card border-brand-gray-200 text-brand-gray-600'
        }`}>
          <div>
            <p className="text-xs uppercase font-bold tracking-wider opacity-85">
              {hasDue ? 'Net Dues Pending' : customer.balance < 0 ? 'Advance Account' : 'All Dues Settled'}
            </p>
            <p className="text-2xl font-bold mt-0.5">
              ₹{Math.abs(customer.balance).toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      </div>

      {/* Customer Additional Details Panel */}
      {(customer.customerType || customer.address || customer.notes) && (
        <div className="bg-brand-card border border-brand-gray-200 rounded-2xl p-4 shadow-soft grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          {customer.customerType && (
            <div>
              <span className="block text-xs font-bold uppercase tracking-wider text-brand-gray-400">Customer Type</span>
              <span className="font-semibold text-brand-dark">{customer.customerType}</span>
            </div>
          )}
          {customer.address && (
            <div className="md:col-span-1">
              <span className="block text-xs font-bold uppercase tracking-wider text-brand-gray-400">Address</span>
              <span className="font-semibold text-brand-dark">{customer.address}</span>
            </div>
          )}
          {customer.notes && (
            <div className="md:col-span-1">
              <span className="block text-xs font-bold uppercase tracking-wider text-brand-gray-400">Notes</span>
              <span className="font-semibold text-brand-dark">{customer.notes}</span>
            </div>
          )}
        </div>
      )}

      {successMsg && (
        <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl text-brand-success flex items-center gap-2 text-sm font-semibold animate-bounce">
          <CheckCircle size={18} />
          {successMsg}
        </div>
      )}

      {/* Primary Action Buttons */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button
          id="record-credit-btn"
          onClick={() => { setShowTxModal('credit'); setAmount(''); setDescription(''); }}
          className="flex items-center justify-center gap-2 bg-brand-danger hover:bg-red-700 text-white font-bold py-4 rounded-xl shadow-soft hover:shadow-premium transition-all cursor-pointer font-semibold"
        >
          <PlusCircle size={20} />
          Give Udhaar (Credit)
        </button>

        <button
          id="record-collection-btn"
          onClick={() => { setShowTxModal('collection'); setAmount(''); setDescription(''); }}
          className="flex items-center justify-center gap-2 bg-brand-success hover:bg-emerald-700 text-white font-bold py-4 rounded-xl shadow-soft hover:shadow-premium transition-all cursor-pointer font-semibold"
        >
          <CheckCircle size={20} />
          Receive Payment (Wapas)
        </button>

        <div className="flex gap-2">
          <a
            href={customer.phone ? whatsappUrl : undefined}
            onClick={(e) => {
              if (!customer.phone) {
                e.preventDefault();
                alert('This customer does not have a phone number saved.');
              }
            }}
            target={customer.phone ? "_blank" : undefined}
            rel="noopener noreferrer"
            className={`flex-1 flex items-center justify-center gap-2 border font-bold py-4 rounded-xl transition-all ${
              customer.phone 
                ? 'border-brand-green hover:bg-green-50 text-brand-green cursor-pointer' 
                : 'border-brand-gray-200 text-brand-gray-400 bg-brand-gray-50 cursor-not-allowed'
            }`}
          >
            <MessageSquare size={18} />
            Remind on WA
          </a>
          <button
            onClick={handleCopyClipboard}
            className="p-4 border border-brand-gray-200 hover:bg-brand-gray-100 rounded-xl text-brand-gray-600 transition-all cursor-pointer"
            title="Copy Reminder message"
          >
            <Clipboard size={18} />
          </button>
        </div>
      </div>

      {/* Main timeline + Active reminders grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        {/* Ledger Transaction History Timeline (Span 2) */}
        <div className="bg-brand-card border border-brand-gray-200 rounded-card p-6 shadow-soft lg:col-span-2 space-y-6">
          <h2 className="text-xl font-bold text-brand-dark">Transaction Ledger History</h2>
          
          {transactions.length === 0 ? (
            <div className="py-12 text-center text-brand-gray-500 text-sm">
              📝 No transactions found in history. Click above to add some entries!
            </div>
          ) : (
            <div className="relative border-l-2 border-brand-gray-200 pl-6 space-y-6 ml-2">
              {/* Timeline list */}
              {[...transactions].reverse().map((tx) => {
                const isCredit = tx.type === 'credit';
                const circleBg = isCredit ? 'bg-red-100 text-brand-danger' : 'bg-emerald-100 text-brand-success';
                const amountSign = isCredit ? '+' : '-';
                const amountColor = isCredit ? 'text-brand-danger' : 'text-brand-success';

                return (
                  <div key={tx.id} className="relative group">
                    {/* Circle marker */}
                    <span className={`absolute -left-[35px] top-1.5 flex items-center justify-center w-8 h-8 rounded-full border-2 border-white shadow-sm ${circleBg}`}>
                      {isCredit ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                    </span>

                    {/* Transaction block */}
                    <div className="bg-brand-bg hover:bg-brand-gray-100 border border-brand-gray-200 rounded-2xl p-4 transition-colors relative pr-12">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setTransactionToDelete(tx);
                        }}
                        className="absolute right-4 top-4 text-brand-danger hover:text-red-700 transition-colors p-1.5 hover:bg-red-50 rounded-lg cursor-pointer"
                        title="Delete Transaction"
                      >
                        <Trash2 size={16} />
                      </button>

                      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 sm:gap-4">
                        <div>
                          <p className="font-bold text-brand-dark text-sm">{tx.description}</p>
                          <p className="text-xs text-brand-gray-400 mt-1 font-semibold">
                            {new Date(tx.date).toLocaleDateString('en-IN', {
                              day: 'numeric', month: 'short', year: 'numeric'
                            })} at {new Date(tx.date).toLocaleTimeString('en-IN', {
                              hour: '2-digit', minute: '2-digit'
                            })}
                          </p>
                        </div>
                        <div className="text-left sm:text-right">
                          <span className={`font-extrabold text-lg ${amountColor}`}>
                            {amountSign} ₹{tx.amount.toLocaleString('en-IN')}
                          </span>
                          <span className="block text-[10px] uppercase font-bold tracking-wider text-brand-gray-400 mt-0.5">
                            {tx.type === 'credit' ? 'Credit' : 'Collection'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Reminders overview for this customer */}
        <div className="bg-brand-card border border-brand-gray-200 rounded-card p-6 shadow-soft space-y-6">
          <h2 className="text-xl font-bold text-brand-dark">Reminder Engine</h2>
          <p className="text-xs text-brand-gray-500 leading-relaxed">
            Payment reminders are automatically generated and scheduled at regular intervals (Days 2, 5, 10) for accounts with outstanding debt.
          </p>

          {!hasDue ? (
            <div className="py-6 border border-dashed border-brand-gray-200 rounded-2xl text-center text-xs text-brand-success bg-green-50/50 font-semibold">
              ✨ Customer is fully settled. Reminder engine paused.
            </div>
          ) : (
            <div className="space-y-4">
              {reminders.map((rem) => {
                const priorityClass = rem.priority === 'High' 
                  ? 'border-red-200 bg-red-50 text-brand-danger'
                  : rem.priority === 'Medium'
                  ? 'border-amber-200 bg-amber-50 text-brand-warning'
                  : 'border-green-200 bg-green-50 text-brand-green';

                const bullet = rem.priority === 'High' 
                  ? '🔴'
                  : rem.priority === 'Medium'
                  ? '🟠'
                  : '🟢';

                return (
                  <div key={rem.id} className={`p-4 rounded-xl border flex flex-col shadow-sm transition-all duration-200 ${priorityClass}`}>
                    <div className="flex items-center gap-2 text-sm font-extrabold">
                      <span>{bullet}</span>
                      <span>{rem.priority} Priority</span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-brand-gray-500">
                      {rem.days_overdue} {rem.days_overdue === 1 ? 'Day' : 'Days'} Overdue
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Manual Transaction Recording Modal */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
          <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-md p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setShowTxModal(false)}
              className="absolute right-4 top-4 p-1.5 hover:bg-brand-gray-100 rounded-xl text-brand-gray-500 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold text-brand-dark mb-1">
              {showTxModal === 'credit' ? 'Give Udhaar (Credit)' : 'Receive Payment (Collection)'}
            </h2>
            <p className="text-sm text-brand-gray-500 mb-6">
              Add a manual transaction ledger entry for {customer.name}.
            </p>

            <form onSubmit={handleTransactionSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                  Amount (₹) *
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-3 text-lg font-bold text-brand-gray-500">₹</span>
                  <input
                    id="tx-amount-input"
                    type="number"
                    step="0.01"
                    required
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-brand-bg pl-8 pr-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-bold text-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                  Remarks / Description
                </label>
                <input
                  id="tx-desc-input"
                  type="text"
                  placeholder={showTxModal === 'credit' ? 'Groceries, oil, chips' : 'Paid cash, UPI, etc.'}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                  Transaction Date & Time
                </label>
                <input
                  id="tx-date-input"
                  type="datetime-local"
                  value={txDate}
                  onChange={(e) => setTxDate(e.target.value)}
                  className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium cursor-pointer"
                />
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowTxModal(false)}
                  className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="submit-tx-btn"
                  type="submit"
                  disabled={submitting}
                  className={`flex-1 text-white font-semibold py-3 rounded-xl shadow-soft disabled:opacity-50 transition-all cursor-pointer ${
                    showTxModal === 'credit' ? 'bg-brand-danger hover:bg-red-700' : 'bg-brand-success hover:bg-emerald-700'
                  }`}
                >
                  {submitting ? 'Recording...' : 'Record Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Transaction Confirmation Modal */}
      {transactionToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
          <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-md p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
            <button
              onClick={() => setTransactionToDelete(null)}
              className="absolute right-4 top-4 p-1.5 hover:bg-brand-gray-100 rounded-xl text-brand-gray-500 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 text-brand-danger mb-4">
              <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                <AlertCircle size={24} />
              </div>
              <h2 className="text-xl font-bold text-brand-dark">Delete Transaction?</h2>
            </div>

            <div className="text-sm text-brand-gray-750 space-y-1.5 mb-6">
              <p>Are you sure you want to delete this transaction?</p>
              <p>This action cannot be undone.</p>
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setTransactionToDelete(null)}
                className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors cursor-pointer text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteTransactionConfirm}
                disabled={deletingTx}
                className="flex-1 bg-brand-danger hover:bg-red-700 text-white font-semibold py-3 rounded-xl shadow-soft disabled:opacity-50 transition-all cursor-pointer text-sm"
              >
                {deletingTx ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
          <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-lg p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
            <button
              id="close-edit-customer-btn"
              onClick={() => setShowEditModal(false)}
              className="absolute right-4 top-4 p-1.5 hover:bg-brand-gray-100 rounded-xl text-brand-gray-500 transition-colors cursor-pointer"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold text-brand-dark mb-2">Edit Customer Profile</h2>
            <p className="text-sm text-brand-gray-500 mb-6">Modify customer details, contact details, address, and notes.</p>

            {editError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-brand-danger text-sm font-semibold flex items-center gap-2">
                <AlertTriangle size={16} />
                <span>{editError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                    Customer Name *
                  </label>
                  <input
                    id="edit-customer-name"
                    type="text"
                    required
                    placeholder="e.g. Rahul Mechanic"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                    Alias (Short Name)
                  </label>
                  <input
                    id="edit-customer-alias"
                    type="text"
                    placeholder="e.g. Rahul"
                    value={editAlias}
                    onChange={(e) => setEditAlias(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                    Mobile Number
                  </label>
                  <input
                    id="edit-customer-phone"
                    type="text"
                    placeholder="e.g. +919876543210"
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                    Customer Type
                  </label>
                  <select
                    id="edit-customer-type"
                    value={editCustomerType}
                    onChange={(e) => setEditCustomerType(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-semibold cursor-pointer"
                  >
                    <option value="Retailer">Retailer</option>
                    <option value="Wholesaler">Wholesaler</option>
                    <option value="Distributor">Distributor</option>
                    <option value="Consumer">Consumer</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                  Address
                </label>
                <textarea
                  id="edit-customer-address"
                  rows={2}
                  placeholder="Street address, city, state"
                  value={editAddress}
                  onChange={(e) => setEditAddress(e.target.value)}
                  className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                  Notes / Description
                </label>
                <textarea
                  id="edit-customer-notes"
                  rows={2}
                  placeholder="Add outstanding arrangement notes, credit terms, etc."
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium resize-none"
                />
              </div>

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  id="submit-edit-customer-btn"
                  type="submit"
                  disabled={updating}
                  className="flex-1 bg-brand-green hover:bg-green-700 text-white font-semibold py-3 rounded-xl shadow-soft disabled:opacity-50 transition-all cursor-pointer"
                >
                  {updating ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
