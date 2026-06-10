import React, { useState, useRef, useEffect } from 'react';
import { Calendar } from 'lucide-react';

interface DatePickerProps {
  selectedDate: string; // YYYY-MM-DD
  onChange: (date: string) => void;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const YEARS = [2023, 2024, 2025, 2026, 2027];

const getTodayStr = () => {
  const localDate = new Date();
  const year = localDate.getFullYear();
  const month = String(localDate.getMonth() + 1).padStart(2, '0');
  const day = String(localDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function DatePicker({ selectedDate, onChange }: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const parsedDate = new Date(selectedDate);
  const initialMonth = isNaN(parsedDate.getTime()) ? new Date().getMonth() : parsedDate.getMonth();
  const initialYear = isNaN(parsedDate.getTime()) ? new Date().getFullYear() : parsedDate.getFullYear();
  
  const [currentMonth, setCurrentMonth] = useState(initialMonth);
  const [currentYear, setCurrentYear] = useState(initialYear);
  
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = new Date(selectedDate);
    if (!isNaN(d.getTime())) {
      setCurrentMonth(d.getMonth());
      setCurrentYear(d.getFullYear());
    }
  }, [selectedDate]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatFriendlyDate = (dateStr: string) => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
  const totalDays = new Date(currentYear, currentMonth + 1, 0).getDate();

  const dayCells = [];
  for (let i = 0; i < firstDayIndex; i++) {
    dayCells.push(<div key={`empty-${i}`} className="w-8 h-8" />);
  }

  for (let day = 1; day <= totalDays; day++) {
    const dateString = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const isSelected = selectedDate === dateString;
    const isToday = getTodayStr() === dateString;

    dayCells.push(
      <button
        key={day}
        type="button"
        onClick={() => {
          onChange(dateString);
          setIsOpen(false);
        }}
        className={`w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center transition-all cursor-pointer ${
          isSelected
            ? 'bg-brand-green text-white font-extrabold shadow-sm'
            : isToday
            ? 'border border-brand-green text-brand-green hover:bg-green-50'
            : 'text-brand-dark hover:bg-brand-gray-100'
        }`}
      >
        {day}
      </button>
    );
  }

  return (
    <div className="relative inline-block text-left" ref={containerRef}>
      <button
        id="date-filter-picker-btn"
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-brand-card hover:bg-brand-gray-100 text-brand-dark font-bold px-4 py-2.5 rounded-xl border border-brand-gray-200 text-sm shadow-soft transition-all cursor-pointer"
      >
        <Calendar size={16} className="text-brand-green shrink-0" />
        <span>{formatFriendlyDate(selectedDate)}</span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 max-w-[calc(100vw-24px)] sm:w-72 bg-brand-card border border-brand-gray-200 rounded-2xl p-4 shadow-premium z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          <div className="flex gap-2 mb-3">
            <select
              value={currentMonth}
              onChange={(e) => setCurrentMonth(Number(e.target.value))}
              className="flex-1 bg-brand-bg border border-brand-gray-200 rounded-lg p-2 text-xs font-bold text-brand-dark focus:outline-none cursor-pointer"
            >
              {MONTH_NAMES.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </select>

            <select
              value={currentYear}
              onChange={(e) => setCurrentYear(Number(e.target.value))}
              className="bg-brand-bg border border-brand-gray-200 rounded-lg p-2 text-xs font-bold text-brand-dark focus:outline-none cursor-pointer"
            >
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-black text-brand-gray-400 uppercase mb-1">
            <span>Su</span>
            <span>Mo</span>
            <span>Tu</span>
            <span>We</span>
            <span>Th</span>
            <span>Fr</span>
            <span>Sa</span>
          </div>

          <div className="grid grid-cols-7 gap-1.5 justify-items-center">
            {dayCells}
          </div>

          <button
            type="button"
            onClick={() => {
              const today = getTodayStr();
              onChange(today);
              setCurrentMonth(new Date().getMonth());
              setCurrentYear(new Date().getFullYear());
              setIsOpen(false);
            }}
            className="w-full mt-3 py-2 bg-brand-dark hover:bg-brand-gray-800 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer"
          >
            Reset to Today
          </button>
        </div>
      )}
    </div>
  );
}
