"use client";

import { useState, useRef, useEffect } from "react";
import { Search, ChevronDown, Check, X } from "lucide-react";
import { StatusPill } from "@/components/app/StatusPill";

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
  pillType,
  autoExclude,
  onRemoveAutoExclude,
  onSelectAll,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (value: string[]) => void;
  pillType?: "status" | "area" | "priority";
  autoExclude?: string[];
  onRemoveAutoExclude?: (value: string) => void;
  onSelectAll?: () => void;
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

  const isActive = selected.length > 0;

  function toggle(val: string) {
    if (selected.includes(val)) {
      onChange(selected.filter((v) => v !== val));
    } else {
      onChange([...selected, val]);
    }
  }

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
        {selected.length === 1 && pillType ? (
          <span className="ml-0.5">
            <StatusPill value={selected[0]} type={pillType} />
          </span>
        ) : selected.length === 1 ? (
          <span className="text-xs font-medium">
            : {options.find((o) => o.value === selected[0])?.label}
          </span>
        ) : selected.length > 1 ? (
          <span className="text-xs font-medium bg-accent-primary/10 text-accent-primary px-1.5 py-0.5 rounded-full ml-0.5">
            {selected.length}
          </span>
        ) : null}
        <ChevronDown size={14} />
      </button>

      {open && (
        <div className="absolute top-full mt-1 left-0 bg-elevated border border-border-default rounded-md shadow-lg z-30 min-w-[160px] py-1">
          <button
            onClick={() => {
              onChange([]);
              onSelectAll?.();
              setOpen(false);
            }}
            className={`w-full text-left px-3 py-1.5 text-sm hover:bg-card ${
              !isActive ? "text-accent-primary" : "text-text-secondary"
            }`}
          >
            All
          </button>
          {options.map((opt) => {
            const isSelected = selected.includes(opt.value);
            const isAutoExcluded = autoExclude?.includes(opt.value) && !isSelected;
            return (
              <button
                key={opt.value}
                onClick={() => {
                  if (isAutoExcluded && onRemoveAutoExclude) {
                    onRemoveAutoExclude(opt.value);
                  } else {
                    toggle(opt.value);
                  }
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-card flex items-center justify-between text-text-primary"
              >
                {pillType ? (
                  <StatusPill value={opt.value} type={pillType} />
                ) : (
                  <span className="text-sm">{opt.label}</span>
                )}
                {isSelected && (
                  <Check size={14} className="text-accent-primary ml-2" />
                )}
                {isAutoExcluded && (
                  <X size={14} className="text-accent-danger ml-2" />
                )}
              </button>
            );
          })}
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
