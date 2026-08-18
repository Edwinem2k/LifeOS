"use client";

import { useState, useRef, useEffect } from "react";
import { StickyNote } from "lucide-react";
import { toast } from "@/components/app/Toast";

type Props = {
  notes: string | null;
  onSave: (value: string) => Promise<void>;
};

export function NotePopover({ notes, onSave }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setValue(notes ?? ""), [notes]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handleSave();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, value, notes]);

  async function handleSave() {
    if (value !== (notes ?? "")) {
      try {
        await onSave(value);
        toast("Notes saved", "success");
      } catch {
        toast("Error saving notes", "error");
        setValue(notes ?? "");
      }
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            handleSave();
            setOpen(false);
          } else {
            setOpen(true);
          }
        }}
        className={`p-1 rounded hover:bg-card transition-opacity ${
          notes ? "text-text-secondary" : "text-text-muted opacity-30 hover:opacity-100"
        }`}
        title={notes ? "View notes" : "Add notes"}
      >
        <StickyNote size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-elevated border border-border-default rounded-md shadow-lg z-50 p-3">
          <p className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-2">
            Notes
          </p>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={handleSave}
            rows={4}
            autoFocus
            placeholder="Add notes..."
            className="w-full border border-border-default rounded-sm px-2 py-1.5 bg-card text-text-primary text-sm focus:outline-none focus:border-accent-primary resize-y"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
