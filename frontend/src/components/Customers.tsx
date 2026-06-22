import React, { useState } from 'react';
import { Customer } from '../types';
import { Search, UserPlus, Phone, IndianRupee, ArrowRight, X, Trash2, AlertTriangle, List, Grid } from 'lucide-react';

interface CustomersProps {
  customers: Customer[];
  onAddCustomer: (customer: { name: string; phone: string; alias: string }) => Promise<void>;
  onSelectCustomer: (id: string) => void;
  onDeleteCustomer: (id: string) => Promise<void>;
  onUpdateCustomer: (id: string, customer: { name: string; phone: string; alias: string; address?: string; notes?: string; customerType?: string }) => Promise<void>;
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

const formatLastActive = (dateStr: string) => {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const day = date.getDate();
  const month = date.toLocaleString('en-IN', { month: 'long' });
  const time = date.toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return `${day} ${month}, ${time}`;
};

export default function Customers({ customers, onAddCustomer, onSelectCustomer, onDeleteCustomer, onUpdateCustomer }: CustomersProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'due' | 'settled'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'highest_due' | 'lowest_due' | 'recent'>('highest_due');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('udhaar_ledger_view_mode') as 'grid' | 'list') || 'grid';
  });
  
  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [alias, setAlias] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [addError, setAddError] = useState('');

  // Edit form state
  const [customerToEdit, setCustomerToEdit] = useState<Customer | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAlias, setEditAlias] = useState('');
  const [editAddress, setEditAddress] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCustomerType, setEditCustomerType] = useState('Retailer');
  const [editError, setEditError] = useState('');
  const [updating, setUpdating] = useState(false);

  const handleOpenEdit = (customer: Customer) => {
    setCustomerToEdit(customer);
    setEditName(customer.name);
    setEditPhone(customer.phone || '');
    setEditAlias(customer.alias || '');
    setEditAddress(customer.address || '');
    setEditNotes(customer.notes || '');
    setEditCustomerType(customer.customerType || 'Retailer');
    setEditError('');
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerToEdit) return;

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
      await onUpdateCustomer(customerToEdit.id, {
        name: editName.trim(),
        phone: editPhone.trim(),
        alias: editAlias.trim(),
        address: editAddress.trim(),
        notes: editNotes.trim(),
        customerType: editCustomerType
      });
      setCustomerToEdit(null);
    } catch (err: any) {
      console.error(err);
      setEditError(err.message || 'Failed to update customer');
    } finally {
      setUpdating(false);
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    
    setLoading(true);
    setShowWarning(false);
    setAddError('');
    const timeoutId = setTimeout(() => {
      setShowWarning(true);
    }, 10000);

    try {
      await onAddCustomer({ name, phone, alias });
      setName('');
      setPhone('');
      setAlias('');
      setIsAddModalOpen(false);
    } catch (err: any) {
      console.error(err);
      setAddError(err.message || 'Failed to create customer');
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
      setShowWarning(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!customerToDelete) return;
    setDeleting(true);
    try {
      await onDeleteCustomer(customerToDelete.id);
      setCustomerToDelete(null);
    } catch (err) {
      console.error(err);
    } finally {
      setDeleting(false);
    }
  };

  // Filter and Sort Customers
  const filteredCustomers = customers
    .filter(c => {
      // 1. Search term match
      const term = searchTerm.toLowerCase();
      const matchesSearch = (c.name || '').toLowerCase().includes(term) ||
                            (c.alias || '').toLowerCase().includes(term) ||
                            (c.phone || '').includes(term);
                            
      // 2. Filter tabs match
      if (filterType === 'due') {
        return matchesSearch && c.balance > 0;
      }
      if (filterType === 'settled') {
        return matchesSearch && c.balance <= 0;
      }
      return matchesSearch;
    })
    .sort((a, b) => {
      // 3. Sort match
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === 'highest_due') {
        return b.balance - a.balance;
      }
      if (sortBy === 'lowest_due') {
        return a.balance - b.balance;
      }
      if (sortBy === 'recent') {
        return new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime();
      }
      return 0;
    });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-brand-dark tracking-tight">Customer Ledgers</h1>
          <p className="text-brand-gray-500 mt-1">Track outstanding balances, view credit history, and manage accounts.</p>
        </div>
        <button
          id="add-customer-trigger"
          onClick={() => {
            setIsAddModalOpen(true);
            setShowWarning(false);
            setAddError('');
          }}
          className="flex items-center gap-2 bg-brand-green hover:bg-green-700 text-white font-semibold px-5 py-3 rounded-xl shadow-soft hover:shadow-premium transition-all duration-300"
        >
          <UserPlus size={18} />
          Add Customer
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-brand-card p-5 rounded-card border border-brand-gray-200 shadow-soft space-y-4">
        <div className="flex flex-col lg:flex-row gap-4 justify-between">
          {/* Search */}
          <div className="relative flex-1">
            <Search className="absolute left-4 top-3.5 text-brand-gray-400" size={20} />
            <input
              id="customer-search-input"
              type="text"
              placeholder="Search by customer name, alias, or phone number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-brand-bg pl-12 pr-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark font-medium transition-all"
            />
          </div>

          {/* Sort selection */}
          <div className="flex items-center gap-2.5">
            <span className="text-sm font-semibold text-brand-gray-500 whitespace-nowrap">Sort By</span>
            <select
              id="customer-sort-select"
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 text-brand-dark font-semibold focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent cursor-pointer"
            >
              <option value="highest_due">Highest Outstanding Due</option>
              <option value="lowest_due">Lowest Outstanding Due</option>
              <option value="name">Alphabetical (A-Z)</option>
              <option value="recent">Recently Active</option>
            </select>
          </div>
        </div>

        {/* Filter Tabs and View Toggle */}
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center border-t border-brand-gray-100 pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              id="filter-all-btn"
              onClick={() => setFilterType('all')}
              className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all ${
                filterType === 'all'
                  ? 'bg-brand-dark text-white'
                  : 'text-brand-gray-500 hover:bg-brand-gray-100'
              }`}
            >
              All Accounts ({customers.length})
            </button>
            <button
              id="filter-due-btn"
              onClick={() => setFilterType('due')}
              className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all ${
                filterType === 'due'
                  ? 'bg-red-50 text-brand-danger border border-red-100'
                  : 'text-brand-gray-500 hover:bg-brand-gray-100'
              }`}
            >
              Outstanding Dues ({customers.filter(c => c.balance > 0).length})
            </button>
            <button
              id="filter-settled-btn"
              onClick={() => setFilterType('settled')}
              className={`px-4 py-2 text-sm font-semibold rounded-xl transition-all ${
                filterType === 'settled'
                  ? 'bg-green-50 text-brand-green border border-green-100'
                  : 'text-brand-gray-500 hover:bg-brand-gray-100'
              }`}
            >
              Settled / Advance ({customers.filter(c => c.balance <= 0).length})
            </button>
          </div>

          {/* View Toggle Icon */}
          <button
            id="ledger-view-toggle"
            onClick={() => {
              const newMode = viewMode === 'grid' ? 'list' : 'grid';
              setViewMode(newMode);
              localStorage.setItem('udhaar_ledger_view_mode', newMode);
            }}
            title={viewMode === 'grid' ? 'Switch to List View' : 'Switch to Grid View'}
            className="p-2.5 rounded-xl border border-brand-gray-200 hover:bg-brand-gray-100 transition-colors shadow-soft cursor-pointer flex items-center justify-center bg-brand-bg text-brand-gray-650"
          >
            <span className="text-xl leading-none font-extrabold select-none">☰</span>
          </button>
        </div>
      </div>

      {/* Customer Grid / List View */}
      {filteredCustomers.length === 0 ? (
        <div className="bg-brand-card p-12 text-center rounded-card border border-brand-gray-200 shadow-soft text-brand-gray-500">
          <p className="font-semibold text-lg">No customers match your search filters.</p>
          <p className="text-sm mt-1">Try clearing filters or add a new customer record.</p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCustomers.map((customer) => {
            const hasDue = customer.balance > 0;
            const balanceColor = hasDue 
              ? 'text-brand-danger bg-red-50 border-red-100' 
              : customer.balance < 0 
              ? 'text-brand-green bg-green-50 border-green-100'
              : 'text-brand-gray-500 bg-brand-gray-100 border-brand-gray-200';

            return (
              <div
                key={customer.id}
                onClick={() => onSelectCustomer(customer.id)}
                className="bg-brand-card border border-brand-gray-200 rounded-card p-6 shadow-soft hover:shadow-premium cursor-pointer transition-all duration-300 flex flex-col justify-between"
              >
                <div>
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-10 h-10 ${getAvatarBg(customer.name)} border font-extrabold text-base flex items-center justify-center rounded-full shrink-0 shadow-sm`}>
                        {(customer.name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold text-brand-dark tracking-tight truncate">{customer.name}</h3>
                        {customer.alias && (
                          <span className="text-xs text-brand-gray-400 font-medium block truncate">
                            Alias: {customer.alias}
                          </span>
                        )}
                      </div>
                    </div>
                    {customer.phone ? (
                      <div className="flex items-center gap-1.5 text-xs text-brand-gray-500 bg-brand-gray-50 px-2.5 py-1 rounded-lg border border-brand-gray-100 shrink-0">
                        <Phone size={12} />
                        {customer.phone}
                      </div>
                    ) : (
                      <div className="text-xs text-brand-gray-400 bg-brand-gray-50 px-2.5 py-1 rounded-lg border border-brand-gray-100 shrink-0 italic">
                        No Phone Number
                      </div>
                    )}
                  </div>

                  <div className={`mt-6 p-4 rounded-xl border flex justify-between items-center ${balanceColor}`}>
                    <div className="flex flex-col">
                      <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
                        {hasDue ? 'Outstanding Due' : 'Balance Account'}
                      </span>
                      <span className="text-xl font-bold mt-0.5">
                        ₹{Math.abs(customer.balance).toLocaleString('en-IN')}
                      </span>
                    </div>
                    <IndianRupee size={20} className="opacity-80" />
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-brand-gray-100 flex items-center justify-between text-xs font-semibold text-brand-gray-500">
                  <span>
                    Last active: {formatLastActive(customer.last_updated)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      id={`edit-customer-btn-${customer.id}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleOpenEdit(customer);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-brand-gray-200 text-brand-dark bg-brand-gray-50 hover:bg-brand-gray-100 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs"
                    >
                      Edit
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCustomer(customer.id);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-brand-gray-200 text-brand-dark bg-brand-gray-50 hover:bg-brand-gray-100 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs"
                    >
                      View
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setCustomerToDelete(customer);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-red-150 text-brand-danger bg-red-50 hover:bg-red-100 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs"
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-6 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          {filteredCustomers.map((customer) => {
            const hasDue = customer.balance > 0;
            const balanceColor = hasDue 
              ? 'text-brand-danger font-black text-2xl' 
              : customer.balance < 0 
              ? 'text-brand-green font-black text-2xl'
              : 'text-brand-gray-500 font-bold text-2xl';

            return (
              <div
                key={customer.id}
                onClick={() => onSelectCustomer(customer.id)}
                className="bg-brand-card border border-brand-gray-200 rounded-2xl py-4 px-4 sm:py-5 sm:px-7 shadow-soft hover:shadow-premium cursor-pointer transition-all duration-300 flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5"
              >
                {/* Avatar & Mobile Name Row */}
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <div className={`w-12 h-12 sm:w-14 sm:h-14 ${getAvatarBg(customer.name)} border font-black text-base sm:text-lg flex items-center justify-center rounded-full shrink-0 shadow-sm`}>
                    {(customer.name || 'U').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-grow sm:hidden">
                    <h3 className="text-lg font-extrabold text-brand-dark tracking-tight truncate">
                      {customer.name}
                    </h3>
                  </div>
                </div>

                {/* Content Layout */}
                <div className="flex-1 min-w-0 flex flex-col gap-2 w-full">
                  {/* Row 1: Left Customer Name (Desktop), Right Due Amount */}
                  <div className="flex justify-between items-center gap-4">
                    <h3 className="hidden sm:block text-xl font-extrabold text-brand-dark tracking-tight truncate">
                      {customer.name}
                    </h3>
                    <span className={`shrink-0 ${balanceColor}`}>
                      ₹{Math.abs(customer.balance).toLocaleString('en-IN')}{' '}
                      <span className="text-xs font-bold uppercase tracking-wider opacity-85 block text-right mt-0.5">
                        {hasDue ? 'Due' : customer.balance < 0 ? 'Advance' : 'Settled'}
                      </span>
                    </span>
                  </div>

                  {/* Row 2: Left Phone Number & Last Active, Right Action Buttons */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 mt-1">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs sm:text-sm text-brand-gray-400 font-semibold">
                      {customer.phone ? (
                        <div className="flex items-center gap-1.5">
                          <Phone size={13} className="text-brand-gray-400" />
                          <span>{customer.phone}</span>
                        </div>
                      ) : (
                        <span className="italic text-brand-gray-400">No Phone Number</span>
                      )}
                      <span className="hidden sm:inline text-brand-gray-300">•</span>
                      <span className="text-xs font-semibold text-brand-gray-400">Last active: {formatLastActive(customer.last_updated)}</span>
                    </div>

                    <div className="flex gap-2 self-stretch sm:self-auto justify-end">
                      <button
                        id={`edit-customer-btn-${customer.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenEdit(customer);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-brand-gray-200 text-brand-dark bg-brand-gray-50 hover:bg-brand-gray-100 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectCustomer(customer.id);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-brand-gray-200 text-brand-dark bg-brand-gray-50 hover:bg-brand-gray-100 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs"
                      >
                        View
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setCustomerToDelete(customer);
                        }}
                        className="px-2.5 py-1.5 rounded-lg border border-red-150 text-brand-danger bg-red-50 hover:bg-red-100 active:scale-95 transition-all cursor-pointer font-bold flex items-center gap-1 text-xs"
                      >
                        <Trash2 size={12} />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Customer Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
          <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-md p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
            <button
              id="close-add-customer-btn"
              onClick={() => {
                setIsAddModalOpen(false);
                setShowWarning(false);
                setAddError('');
              }}
              className="absolute right-4 top-4 p-1.5 hover:bg-brand-gray-100 rounded-xl text-brand-gray-500 transition-colors"
            >
              <X size={20} />
            </button>

            <h2 className="text-2xl font-bold text-brand-dark mb-2">New Customer</h2>
            <p className="text-sm text-brand-gray-500 mb-6">Create a ledger account to track future credit records.</p>

            {addError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-brand-danger text-sm font-semibold flex items-center gap-2">
                <AlertTriangle size={16} />
                <span>{addError}</span>
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                  Customer Name *
                </label>
                <input
                  id="new-customer-name"
                  type="text"
                  required
                  placeholder="e.g. Rahul Mechanic"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                    Alias (Short Name)
                  </label>
                  <input
                    id="new-customer-alias"
                    type="text"
                    placeholder="e.g. Rahul"
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-brand-gray-600 mb-1.5">
                    Mobile Number
                  </label>
                  <input
                    id="new-customer-phone"
                    type="text"
                    placeholder="e.g. +9198765..."
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full bg-brand-bg px-4 py-3 rounded-xl border border-brand-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-green focus:border-transparent text-brand-dark"
                  />
                </div>
              </div>

              {showWarning && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs font-semibold flex items-start gap-2 animate-in fade-in duration-300">
                  <AlertTriangle size={16} className="shrink-0 text-amber-600 mt-0.5" />
                  <span>The server is waking up. This first request may take up to 50 seconds on Render free tier. Please wait...</span>
                </div>
              )}

              <div className="pt-4 flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setShowWarning(false);
                    setAddError('');
                  }}
                  className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  id="submit-customer-btn"
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-brand-green hover:bg-green-700 text-white font-semibold py-3 rounded-xl shadow-soft disabled:opacity-50 transition-all"
                >
                  {loading ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {customerToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
          <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-md p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
            <button
              id="close-delete-modal-btn"
              onClick={() => setCustomerToDelete(null)}
              className="absolute right-4 top-4 p-1.5 hover:bg-brand-gray-100 rounded-xl text-brand-gray-500 transition-colors"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 text-brand-danger mb-4">
              <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                <AlertTriangle size={24} />
              </div>
              <h2 className="text-xl font-bold text-brand-dark">Delete Customer?</h2>
            </div>

            <div className="text-sm text-brand-gray-750 space-y-1.5 mb-6">
              <p>Are you sure you want to delete this customer?</p>
              <p>This action cannot be undone.</p>
            </div>

            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setCustomerToDelete(null)}
                className="flex-1 border border-brand-gray-200 hover:bg-brand-gray-50 text-brand-gray-700 font-semibold py-3 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                id="confirm-delete-btn"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="flex-1 bg-brand-danger hover:bg-red-700 text-white font-semibold py-3 rounded-xl shadow-soft disabled:opacity-50 transition-all cursor-pointer"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Customer Modal */}
      {customerToEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0F172A]/50 backdrop-blur-sm p-4">
          <div className="bg-brand-card border border-brand-gray-200 rounded-card w-full max-w-lg p-6 shadow-premium relative animate-in fade-in zoom-in duration-200">
            <button
              id="close-edit-customer-btn"
              onClick={() => setCustomerToEdit(null)}
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

            <form onSubmit={handleUpdate} className="space-y-4">
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
                  onClick={() => setCustomerToEdit(null)}
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
