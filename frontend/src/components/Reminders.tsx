import React, { useState } from 'react';
import { Reminder } from '../types';
import { MessageSquare, PhoneCall, CheckSquare, BellRing, AlertCircle, Calendar } from 'lucide-react';

interface RemindersProps {
  reminders: Reminder[];
  onNavigate: (page: string, params?: any) => void;
  shopName: string;
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

export default function Reminders({ reminders, onNavigate, shopName }: RemindersProps) {
  const [activeTab, setActiveTab] = useState<'high' | 'medium' | 'soft' | 'all'>('high');

  // Group reminders:
  // Today = High Priority (10 days overdue)
  // Tomorrow = Medium Priority (5 days overdue)
  // This Week = Soft Priority (2 days overdue)
  const highReminders = reminders.filter(r => r.priority === 'High' && r.status === 'pending');
  const mediumReminders = reminders.filter(r => r.priority === 'Medium' && r.status === 'pending');
  const softReminders = reminders.filter(r => r.priority === 'Soft' && r.status === 'pending');

  const sortedAllReminders = [...reminders]
    .filter(r => r.status === 'pending')
    .sort((a, b) => {
      const priorityOrder = { 'High': 1, 'Medium': 2, 'Soft': 3 };
      return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);
    });

  const getActiveList = () => {
    switch (activeTab) {
      case 'high': return highReminders;
      case 'medium': return mediumReminders;
      case 'soft': return softReminders;
      case 'all': return sortedAllReminders;
      default: return [];
    }
  };

  const activeList = getActiveList();

  const renderReminderList = (list: Reminder[], title: string, badgeStyle: string) => {
    if (list.length === 0) {
      return (
        <div className="py-8 text-center text-brand-gray-400 text-xs border border-dashed border-brand-gray-200 rounded-2xl bg-brand-bg/50">
          No reminders scheduled in this period.
        </div>
      );
    }

    return (
      <div className="space-y-4 max-w-5xl mx-auto">
        {list.map((rem) => {
          const shareText = `Dear ${rem.customer_name}, this is a friendly payment reminder for your outstanding balance of Rs. ${rem.amount} at ${shopName || 'our store'}. Please settle your dues at your earliest convenience. Thank you!`;
          const whatsappUrl = `https://wa.me/${rem.customer_phone?.replace(/[+]/g, '')}?text=${encodeURIComponent(shareText)}`;

          return (
            <div 
              key={rem.id} 
              onClick={() => onNavigate('customers', { openLedgerId: rem.customer_id })}
              className="bg-brand-card border border-brand-gray-200 rounded-card p-6 shadow-soft hover:shadow-premium hover:border-brand-green/30 transition-all duration-300 flex flex-col md:flex-row md:items-center justify-between gap-6 cursor-pointer"
            >
              <div className="flex items-center gap-4 flex-1 min-w-0">
                {/* Dark Initials Avatar */}
                <div className={`w-11 h-11 ${getAvatarBg(rem.customer_name || 'U')} border font-extrabold text-base flex items-center justify-center rounded-full shrink-0 shadow-sm`}>
                  {(rem.customer_name || 'U').charAt(0).toUpperCase()}
                </div>
                
                {/* Details Stacked Vertically */}
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-extrabold text-brand-dark text-base md:text-lg tracking-tight truncate">
                      {rem.customer_name}
                    </h4>
                    {/* Priority Badge */}
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      rem.priority === 'High' 
                        ? 'bg-red-100 text-brand-danger border border-red-200'
                        : rem.priority === 'Medium'
                        ? 'bg-amber-100 text-brand-warning border border-amber-200'
                        : 'bg-green-100 text-brand-green border border-green-200'
                    }`}>
                      {rem.priority} Priority
                    </span>
                  </div>
                  {/* Amount Due and Days Overdue */}
                  <div className="flex items-center gap-2 flex-wrap text-xs font-bold">
                    <span className="text-brand-danger text-base font-extrabold">
                      ₹{rem.amount.toLocaleString('en-IN')} Due
                    </span>
                    <span className="text-brand-gray-300 font-normal text-sm">•</span>
                    <span className="text-brand-gray-500 font-semibold bg-brand-gray-100 border border-brand-gray-200 px-2.5 py-0.5 rounded-lg">
                      {rem.days_overdue} Days Overdue
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 w-full md:w-auto justify-end md:justify-start shrink-0">
                <a
                  href={`tel:${rem.customer_phone}`}
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold rounded-xl text-brand-dark bg-brand-gray-100 hover:bg-brand-gray-200 transition-colors border border-brand-gray-200 cursor-pointer shadow-sm"
                  title="Call Customer"
                >
                  <PhoneCall size={16} />
                  <span>Call</span>
                </a>
                
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-center gap-2 px-5 py-3 text-sm font-bold rounded-xl text-white bg-brand-green hover:bg-green-700 transition-all shadow-soft cursor-pointer"
                  title="Send WhatsApp Reminder"
                >
                  <MessageSquare size={16} />
                  <span>WhatsApp</span>
                </a>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-brand-dark tracking-tight">Reminders Center</h1>
        <p className="text-brand-gray-500 mt-1">
          Collection Reminder for {shopName}
        </p>
      </div>

      {/* Rules Info */}
      <div className="bg-brand-card border border-brand-gray-200 p-5 rounded-card shadow-soft flex gap-4 items-start">
        <div className="p-3 bg-green-50 text-brand-green rounded-xl border border-green-100">
          <BellRing size={22} className="animate-bounce" />
        </div>
        <div>
          <h3 className="font-bold text-brand-dark text-sm">Automated Reminder Rule Engine</h3>
          <p className="text-xs text-brand-gray-500 mt-1 leading-relaxed">
            Every credit entry spawns three reminder dates automatically:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-4 mt-3 text-[10px] font-bold uppercase tracking-wider text-brand-gray-500">
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand-green"></span>Day 2: Soft reminder</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand-warning"></span>Day 5: Medium priority</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand-danger"></span>Day 10: High priority</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 border-b border-brand-gray-200 pb-px overflow-x-auto no-scrollbar sm:flex-wrap">
        <button
          onClick={() => setActiveTab('high')}
          className={`flex-1 min-w-[70px] pb-3 text-xs sm:text-sm font-bold text-center border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'high'
              ? 'border-brand-danger text-brand-danger'
              : 'border-transparent text-brand-gray-400 hover:text-brand-dark'
          }`}
        >
          High<span className="hidden sm:inline"> Priority</span> ({highReminders.length})
        </button>
        <button
          onClick={() => setActiveTab('medium')}
          className={`flex-1 min-w-[70px] pb-3 text-xs sm:text-sm font-bold text-center border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'medium'
              ? 'border-brand-warning text-brand-warning'
              : 'border-transparent text-brand-gray-400 hover:text-brand-dark'
          }`}
        >
          Medium<span className="hidden sm:inline"> Priority</span> ({mediumReminders.length})
        </button>
        <button
          onClick={() => setActiveTab('soft')}
          className={`flex-1 min-w-[70px] pb-3 text-xs sm:text-sm font-bold text-center border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'soft'
              ? 'border-brand-green text-brand-green'
              : 'border-transparent text-brand-gray-400 hover:text-brand-dark'
          }`}
        >
          Soft<span className="hidden sm:inline"> Priority</span> ({softReminders.length})
        </button>
        <button
          onClick={() => setActiveTab('all')}
          className={`flex-1 min-w-[70px] pb-3 text-xs sm:text-sm font-bold text-center border-b-2 transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'all'
              ? 'border-brand-dark text-brand-dark'
              : 'border-transparent text-brand-gray-400 hover:text-brand-dark'
          }`}
        >
          All<span className="hidden sm:inline"> Reminders</span> ({reminders.filter(r => r.status === 'pending').length})
        </button>
      </div>

      {/* Group Lists */}
      <div className="space-y-6">
        {renderReminderList(activeList, activeTab, '')}
      </div>
    </div>
  );
}
