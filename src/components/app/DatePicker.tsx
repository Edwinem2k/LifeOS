"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

type Props = {
  value: string | null;
  onChange: (date: string | null) => void;
  onClose: () => void;
};

const DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Monday = 0
}

export function DatePicker({ value, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const parsed = value ? new Date(value) : new Date();
  const [viewYear, setViewYear] = useState(parsed.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.getMonth());

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const daysInMonth = getDaysInMonth(viewYear, viewMonth);
  const firstDay = getFirstDayOfWeek(viewYear, viewMonth);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  function prevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function nextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function selectDate(day: number) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    onChange(dateStr);
    onClose();
  }

  const monthName = new Date(viewYear, viewMonth).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  const cells: React.ReactNode[] = [];
  for (let i = 0; i < firstDay; i++) {
    cells.push(<div key={`empty-${i}`} />);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isSelected = dateStr === value;
    const isToday = dateStr === todayStr;
    cells.push(
      <button
        key={day}
        onClick={(e) => {
          e.stopPropagation();
          selectDate(day);
        }}
        className={`w-8 h-8 rounded-full text-xs flex items-center justify-center transition-colors ${
          isSelected
            ? "bg-accent-primary text-white font-medium"
            : isToday
            ? "border border-accent-primary text-accent-primary font-medium hover:bg-accent-primary/10"
            : "text-text-primary hover:bg-card"
        }`}
      >
        {day}
      </button>
    );
  }

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 bg-elevated border border-border-default rounded-md shadow-lg z-50 p-3 w-[280px]"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMonth}
          className="p-1 rounded hover:bg-card text-text-secondary hover:text-text-primary"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium text-text-primary">{monthName}</span>
        <button
          onClick={nextMonth}
          className="p-1 rounded hover:bg-card text-text-secondary hover:text-text-primary"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-0.5 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="w-8 h-6 flex items-center justify-center text-xs text-text-muted font-medium">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-0.5">{cells}</div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-default">
        <button
          onClick={(e) => {
            e.stopPropagation();
            selectDate(today.getDate());
            setViewMonth(today.getMonth());
            setViewYear(today.getFullYear());
          }}
          className="text-xs text-accent-primary hover:underline"
        >
          Today
        </button>
        {value && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onChange(null);
              onClose();
            }}
            className="text-xs text-text-muted hover:text-accent-danger flex items-center gap-1"
          >
            <X size={12} /> Clear
          </button>
        )}
      </div>
    </div>
  );
}
