"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "@/components/app/Toast";
import { StatusPill } from "@/components/app/StatusPill";
import { DatePicker } from "@/components/app/DatePicker";
import { Search } from "lucide-react";

type Props = {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  type?: "text" | "textarea" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
  displayAs?: "pill";
  pillType?: "status" | "area" | "priority";
  placeholder?: string;
  className?: string;
  showEmptyBox?: boolean;
  searchable?: boolean;
  autoFocus?: boolean;
};

export function EditableCell({
  value,
  onSave,
  type = "text",
  options,
  displayAs,
  pillType,
  placeholder = "\u2014",
  className = "",
  showEmptyBox = false,
  searchable = false,
  autoFocus = false,
}: Props) {
  const [editing, setEditing] = useState(autoFocus);
  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setSearchQuery("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  useEffect(() => {
    if (dropdownOpen && searchable && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [dropdownOpen, searchable]);

  async function handleSave() {
    setEditing(false);
    if (current === value) return;
    setSaving(true);
    try {
      await onSave(current);
      toast("Saved", "success");
    } catch {
      setCurrent(value);
      toast("Error saving", "error");
    } finally {
      setSaving(false);
    }
  }

  // SELECT: single click opens custom dropdown with colored options
  if (type === "select" && options) {
    const filteredOptions = useMemo(() => {
      if (!searchQuery) return options;
      const q = searchQuery.toLowerCase();
      return options.filter((o) => o.label.toLowerCase().includes(q));
    }, [options, searchQuery]);

    return (
      <div ref={dropdownRef} className={`relative ${className}`}>
        <div
          className="cursor-pointer hover:bg-card rounded px-1 py-0.5 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(!dropdownOpen);
            setSearchQuery("");
          }}
        >
          {saving ? (
            <span className="text-text-muted text-xs">Saving...</span>
          ) : displayAs === "pill" && pillType && current ? (
            <StatusPill value={current} type={pillType} />
          ) : current ? (
            <span className="text-xs">
              {options.find((o) => o.value === current)?.label || current}
            </span>
          ) : (
            <span className="text-text-muted text-xs">{placeholder}</span>
          )}
        </div>
        {dropdownOpen && (
          <div className="absolute top-full left-0 mt-1 bg-elevated border border-border-default rounded-md shadow-lg z-50 min-w-[160px] py-1">
            {searchable && (
              <div className="px-2 pb-1 pt-0.5">
                <div className="flex items-center gap-1.5 border border-border-default rounded-sm px-2 py-1 bg-card">
                  <Search size={12} className="text-text-muted shrink-0" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className="bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none w-full"
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              </div>
            )}
            {filteredOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={(e) => {
                  e.stopPropagation();
                  setDropdownOpen(false);
                  setSearchQuery("");
                  if (opt.value !== current) {
                    setCurrent(opt.value);
                    setSaving(true);
                    onSave(opt.value)
                      .then(() => toast("Saved", "success"))
                      .catch(() => {
                        setCurrent(value);
                        toast("Error saving", "error");
                      })
                      .finally(() => setSaving(false));
                  }
                }}
                className={`w-full text-left px-3 py-1.5 hover:bg-card flex items-center gap-2 ${
                  current === opt.value ? "bg-card" : ""
                }`}
              >
                {pillType ? (
                  <StatusPill value={opt.value} type={pillType} />
                ) : (
                  <span className="text-xs">{opt.label}</span>
                )}
              </button>
            ))}
            {searchable && filteredOptions.length === 0 && (
              <div className="px-3 py-2 text-xs text-text-muted">No results</div>
            )}
          </div>
        )}
      </div>
    );
  }

  // TEXTAREA
  if (type === "textarea") {
    if (!editing) {
      return (
        <div
          className={`cursor-pointer hover:bg-card rounded px-1 py-0.5 transition-colors ${className}`}
          onClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {saving ? (
            <span className="text-text-muted text-xs">Saving...</span>
          ) : current ? (
            showEmptyBox ? (
              <div className="border border-border-default rounded-sm px-2 py-2 text-sm min-h-[60px] whitespace-pre-wrap">
                {current}
              </div>
            ) : (
              <span className="text-sm whitespace-pre-wrap">{current}</span>
            )
          ) : showEmptyBox ? (
            <div className="border border-dashed border-border-default rounded-sm px-2 py-2 text-text-muted text-sm min-h-[60px]">
              Click to add...
            </div>
          ) : (
            <span className="text-text-muted">{placeholder}</span>
          )}
        </div>
      );
    }
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        onBlur={handleSave}
        rows={3}
        className="w-full border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary resize-y"
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  // DATE: use DatePicker calendar
  if (type === "date") {
    function getDateStyle(dateStr: string) {
      const now = new Date();
      const d = new Date(dateStr);
      const daysUntil = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntil < 0) return { color: "var(--color-accent-danger)", fontWeight: 500 as const };
      if (daysUntil <= 7) return { color: "var(--color-accent-warning)", fontWeight: 500 as const };
      return { color: "var(--color-accent-success)" };
    }
    function formatDateDisplay(dateStr: string) {
      return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }
    return (
      <div ref={dropdownRef} className={`relative ${className}`}>
        <div
          className="cursor-pointer hover:bg-card rounded px-1 py-0.5 transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            setDropdownOpen(!dropdownOpen);
          }}
        >
          {saving ? (
            <span className="text-text-muted text-xs">Saving...</span>
          ) : current ? (
            <span className="text-xs" style={getDateStyle(current)}>{formatDateDisplay(current)}</span>
          ) : (
            <span className="text-text-muted text-xs">{placeholder}</span>
          )}
        </div>
        {dropdownOpen && (
          <DatePicker
            value={current || null}
            onChange={(date) => {
              const newVal = date ?? "";
              setCurrent(newVal);
              setDropdownOpen(false);
              if (newVal !== value) {
                setSaving(true);
                onSave(newVal)
                  .then(() => toast("Saved", "success"))
                  .catch(() => {
                    setCurrent(value);
                    toast("Error saving", "error");
                  })
                  .finally(() => setSaving(false));
              }
            }}
            onClose={() => setDropdownOpen(false)}
          />
        )}
      </div>
    );
  }

  // TEXT, NUMBER
  if (!editing) {
    return (
      <div
        className={`cursor-pointer hover:bg-card rounded px-1 py-0.5 transition-colors ${className}`}
        onClick={(e) => {
          e.stopPropagation();
          setEditing(true);
        }}
      >
        {saving ? (
          <span className="text-text-muted text-xs">Saving...</span>
        ) : current ? (
          <span>{current}</span>
        ) : (
          <span className="text-text-muted">{placeholder}</span>
        )}
      </div>
    );
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type}
      value={current}
      onChange={(e) => setCurrent(e.target.value)}
      onBlur={handleSave}
      onKeyDown={(e) => e.key === "Enter" && handleSave()}
      onClick={(e) => e.stopPropagation()}
      className="border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary w-full"
    />
  );
}
