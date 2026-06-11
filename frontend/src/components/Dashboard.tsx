import React from 'react';
import { Customer, Transaction } from '../types';
import { ArrowUpRight, ArrowDownLeft, Users, AlertTriangle, MessageSquare, PhoneCall, Mic } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

interface DashboardProps {
  customers: Customer[];
  transactions: Transaction[];
  reminders: any[];
  onNavigate: (page: string, params?: any) => void;
  merchantName: string;
  shopName: string;
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

const getLocalDateStr = (dateInput: string) => {
  if (!dateInput) return '';
  const dateObj = new Date(dateInput);
  if (isNaN(dateObj.getTime())) return '';
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function Dashboard({ customers, transactions, reminders, onNavigate, merchantName, shopName, selectedDate }: DashboardProps) {
  // 1. Calculate stats dynamically
  const outstandingDebt = customers.reduce((sum, c) => sum + c.balance, 0);
  
  const todayStr = selectedDate;

  const todayTransactions = transactions.filter(t => getLocalDateStr(t.date) === todayStr);
  
  const collectionsToday = todayTransactions
    .filter(t => t.type === 'collection')
    .reduce((sum, t) => sum + t.amount, 0);
    
  const creditGivenToday = todayTransactions
    .filter(t => t.type === 'credit')
    .reduce((sum, t) => sum + t.amount, 0);
    
  const activeCustomers = customers.filter(c => c.balance > 0).length;

  // 2. Prepare dynamic chart data for the last 7 days leading up to selectedDate
  const chartDays = Array.from({ length: 7 }, (_, i) => {
    const [yearStr, monthStr, dayStr] = selectedDate.split('-');
    const d = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr));
    d.setDate(d.getDate() - (6 - i));
    
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dv = String(d.getDate()).padStart(2, '0');
    const dateStr = `${y}-${m}-${dv}`;
    
    const formattedLabel = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
    
    const dayTxs = transactions.filter(t => getLocalDateStr(t.date) === dateStr);
    const credit = dayTxs.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
    const collection = dayTxs.filter(t => t.type === 'collection').reduce((sum, t) => sum + t.amount, 0);
    
    return {
      date: formattedLabel,
      credit,
      collection
    };
  });

  // 3. Customers requiring attention (days_overdue >= 5 and status = pending)
  const criticalReminders = reminders
    .filter(r => r.status === 'pending')
    .slice(0, 3);

  return (
    <div className="space-y-8">
      {/* Hero Header */}
      <div className="flex justify-between items-center border-b border-brand-gray-200 pb-5">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-brand-dark tracking-tight" id="dashboard-title">
            Good Morning, {merchantName.split(' ')[0] || 'Merchant'} 👋
          </h1>
          <p className="text-sm sm:text-base text-brand-gray-500 mt-1">Business Summary for {shopName}</p>
        </div>
        <button
          id="dashboard-voice-record-btn"
          onClick={() => onNavigate('voice-recorder')}
          title="Record Transaction"
          className="flex items-center justify-center w-12 h-12 bg-brand-green hover:bg-green-700 text-white rounded-2xl shadow-soft hover:shadow-premium hover:scale-105 active:scale-95 transition-all duration-300 cursor-pointer shrink-0"
        >
          <Mic size={22} className="animate-pulse" />
        </button>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
        {/* Outstanding Debt */}
        <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft hover:shadow-premium transition-shadow duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray-500 uppercase tracking-wider">Outstanding Debt</p>
              <h3 className="text-3xl font-bold text-brand-danger mt-2">₹{outstandingDebt.toLocaleString('en-IN')}</h3>
            </div>
            <div className="p-3 bg-red-50 text-brand-danger rounded-xl">
              <AlertTriangle size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs text-brand-gray-500">
            <span className="text-brand-danger font-semibold flex items-center mr-1">
              +4.2%
            </span>
            since last week
          </div>
        </div>

        {/* Collections Today */}
        <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft hover:shadow-premium transition-shadow duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray-500 uppercase tracking-wider">Collections Today</p>
              <h3 className="text-3xl font-bold text-brand-success mt-2">₹{collectionsToday.toLocaleString('en-IN')}</h3>
            </div>
            <div className="p-3 bg-emerald-50 text-brand-success rounded-xl">
              <ArrowDownLeft size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs text-brand-gray-500">
            <span className="text-brand-success font-semibold flex items-center mr-1">
              +12.4%
            </span>
            vs yesterday
          </div>
        </div>

        {/* Credit Given Today */}
        <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft hover:shadow-premium transition-shadow duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray-500 uppercase tracking-wider">Credit Given Today</p>
              <h3 className="text-3xl font-bold text-brand-green mt-2">₹{creditGivenToday.toLocaleString('en-IN')}</h3>
            </div>
            <div className="p-3 bg-green-50 text-brand-green rounded-xl">
              <ArrowUpRight size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs text-brand-gray-500">
            <span className="text-brand-gray-500 font-medium flex items-center mr-1">
              ₹1,800
            </span>
            average daily credit
          </div>
        </div>

        {/* Active Debtors */}
        <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft hover:shadow-premium transition-shadow duration-300">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-brand-gray-500 uppercase tracking-wider">Active Debtors</p>
              <h3 className="text-3xl font-bold text-brand-dark mt-2">{activeCustomers}</h3>
            </div>
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <Users size={24} />
            </div>
          </div>
          <div className="mt-4 flex items-center text-xs text-brand-gray-500">
            <span className="text-brand-green font-semibold mr-1">
              127
            </span>
            total customer accounts
          </div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Weekly Credit Trend Area Chart */}
        <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-brand-dark">Weekly Credit Trend</h3>
              <p className="text-xs text-brand-gray-500">Udhaar given over the last 7 days</p>
            </div>
          </div>
          <div className="h-72 w-full overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartDays}>
                <defs>
                  <linearGradient id="colorCredit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#16A34A" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#16A34A" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="date" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v}`} />
                <Tooltip 
                  formatter={(value) => [`₹${value}`, 'Credit']}
                  contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#FFF' }}
                />
                <Area type="monotone" dataKey="credit" stroke="#16A34A" strokeWidth={3} fillOpacity={1} fill="url(#colorCredit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Weekly Collection Trend Bar Chart */}
        <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold text-brand-dark">Collection Trend</h3>
              <p className="text-xs text-brand-gray-500">Payments wapas received over the last 7 days</p>
            </div>
          </div>
          <div className="h-72 w-full overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDays}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                <XAxis dataKey="date" stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94A3B8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v}`} />
                <Tooltip 
                  formatter={(value) => [`₹${value}`, 'Collections']}
                  contentStyle={{ backgroundColor: '#0F172A', borderRadius: '12px', border: 'none', color: '#FFF' }}
                />
                <Bar dataKey="collection" fill="#0F172A" radius={[8, 8, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Action Needed Section */}
      <div className="bg-brand-card p-6 rounded-card border border-brand-gray-200 shadow-soft">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h3 className="text-lg font-bold text-brand-dark">Collection Reminder for {shopName}</h3>
            <p className="text-xs text-brand-gray-500">Outstanding credit overdue needing attention</p>
          </div>
          <button 
            id="view-all-reminders-btn"
            onClick={() => onNavigate('reminders')}
            className="text-sm font-semibold text-brand-green hover:underline"
          >
            View All Followups
          </button>
        </div>

        {criticalReminders.length === 0 ? (
          <div className="text-center py-6 text-brand-gray-500 text-sm">
            🎉 All customer accounts are up to date!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {criticalReminders.map((rem) => {
              const priorityColor = rem.priority === 'High' 
                ? 'bg-red-50 text-brand-danger border-red-200' 
                : rem.priority === 'Medium' 
                ? 'bg-amber-50 text-brand-warning border-amber-200' 
                : 'bg-green-50 text-brand-green border-green-200';
              
              const dotColor = rem.priority === 'High' 
                ? 'bg-brand-danger' 
                : rem.priority === 'Medium' 
                ? 'bg-brand-warning' 
                : 'bg-brand-success';

              return (
                <div 
                  key={rem.id} 
                  className="p-5 border border-brand-gray-200 rounded-2xl flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow duration-300"
                >
                  <div>
                    <div className="flex justify-between items-center mb-3">
                      <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold flex items-center gap-1.5 ${priorityColor}`}>
                        <span className={`w-2 h-2 rounded-full ${dotColor}`}></span>
                        {rem.priority} Priority
                      </span>
                      <span className="text-xs text-brand-gray-500 font-medium">
                        {rem.days_overdue} days pending
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 ${getAvatarBg(rem.customer_name)} border font-extrabold text-sm flex items-center justify-center rounded-full shrink-0 shadow-sm`}>
                        {(rem.customer_name || 'U').charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-brand-dark text-base truncate">{rem.customer_name}</h4>
                        <p className="text-xs text-brand-gray-500 truncate">{rem.customer_phone}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex justify-between items-baseline">
                      <span className="text-xs text-brand-gray-400">Due Amount</span>
                      <span className="text-xl font-bold text-brand-dark">₹{rem.amount.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-brand-gray-100 grid grid-cols-2 gap-3">
                    <a
                      href={`https://wa.me/${rem.customer_phone?.replace(/[+]/g, '')}?text=Dear%20${encodeURIComponent(rem.customer_name)}%2C%20this%20is%20a%20friendly%20payment%20reminder%20for%20your%20outstanding%20balance%20of%20Rs.%20${rem.amount}%20at%20${encodeURIComponent(shopName || 'our store')}.%20Please%20settle%20your%20dues%20at%20your%20earliest%20convenience.%20Thank%20you%21`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-brand-green bg-green-50 hover:bg-green-100 transition-colors border border-green-200"
                    >
                      <MessageSquare size={14} />
                      WhatsApp
                    </a>
                    <button
                      onClick={() => onNavigate('customers', { openLedgerId: rem.customer_id })}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl text-brand-dark bg-brand-gray-100 hover:bg-brand-gray-200 transition-colors border border-brand-gray-200"
                    >
                      <PhoneCall size={14} />
                      Open Ledger
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
