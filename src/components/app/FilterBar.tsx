"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check } from "lucide-react";

export function SearchPill({
  value,
  onChange,
  placeholder = "Search...",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-2 border border-border-default rounded-sm px-3 py-1.5 bg-card">
      <Search size={14} className="text-text-muted" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none w-32 focus:w-48 transition-all"
      />
    </div>
  );
}

export function FilterPill({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string | null;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isActive = selected !== null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 border rounded-sm px-3 py-1.5 text-sm transition-colors ${
          isActive
            ? "border-accent-primary text-accent-primary bg-card"
            : "border-border-default text-text-secondary bg-card hover:text-text-primary"
        }`}
      >
        {label}
        {selected && (
          <span className="text-xs font-medium">
            : {options.find((o) => o.value === selected)?.label}
          </span>
        )}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 bg-elevated border border-border-default rounded-md shadow-lg z-30 min-w-[160px]">
          <button
            onClick={() => {
              onChange(null);
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-2 text-sm hover:bg-card ${
              !selected ? "text-accent-primary" : "text-text-secondary"
            }`}
          >
            All
          </button>
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-card flex items-center justify-between text-text-primary"
            >
              {opt.label}
              {selected === opt.value && (
                <Check size={14} className="text-accent-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 flex-wrap mb-4">{children}</div>
  );
}
