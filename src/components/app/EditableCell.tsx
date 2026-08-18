"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "@/components/app/Toast";
import { StatusPill } from "@/components/app/StatusPill";

type Props = {
  value: string;
  onSave: (newValue: string) => Promise<void>;
  type?: "text" | "textarea" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
  displayAs?: "pill";
  pillType?: "status" | "area" | "priority";
  placeholder?: string;
  className?: string;
};

export function EditableCell({
  value,
  onSave,
  type = "text",
  options,
  displayAs,
  pillType,
  placeholder = "—",
  className = "",
}: Props) {
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    setCurrent(value);
  }, [value]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editing]);

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

  if (!editing) {
    return (
      <div
        className={`cursor-pointer hover:bg-card rounded px-1 py-0.5 transition-colors ${className}`}
        onClick={() => setEditing(true)}
      >
        {saving ? (
          <span className="text-text-muted text-xs">Saving...</span>
        ) : displayAs === "pill" && pillType && current ? (
          <StatusPill value={current} type={pillType} />
        ) : current ? (
          <span>{current}</span>
        ) : (
          <span className="text-text-muted">{placeholder}</span>
        )}
      </div>
    );
  }

  if (type === "select" && options) {
    return (
      <select
        ref={inputRef as React.RefObject<HTMLSelectElement>}
        value={current}
        onChange={(e) => {
          const newVal = e.target.value;
          setCurrent(newVal);
          setEditing(false);
          setSaving(true);
          onSave(newVal)
            .then(() => toast("Saved", "success"))
            .catch(() => {
              setCurrent(value);
              toast("Error saving", "error");
            })
            .finally(() => setSaving(false));
        }}
        onBlur={() => setEditing(false)}
        className="border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (type === "textarea") {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        onBlur={handleSave}
        rows={3}
        className="w-full border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary resize-y"
      />
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
      className="border border-border-default rounded-sm px-2 py-1 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary"
    />
  );
}
