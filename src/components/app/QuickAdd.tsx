"use client";

import { useState, forwardRef } from "react";
import { Plus } from "lucide-react";

type Props = {
  onAdd: (title: string) => void;
  placeholder?: string;
};

export const QuickAdd = forwardRef<HTMLInputElement, Props>(
  function QuickAdd({ onAdd, placeholder = "Add task..." }, ref) {
    const [value, setValue] = useState("");

    function handleSubmit() {
      const trimmed = value.trim();
      if (!trimmed) return;
      onAdd(trimmed);
      setValue("");
    }

    return (
      <div className="flex items-center gap-2 border-t border-dashed border-border-default px-3 py-2 bg-page">
        <Plus size={16} className="text-text-muted" />
        <input
          ref={ref}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSubmit();
            if (e.key === "Escape") setValue("");
          }}
          placeholder={placeholder}
          className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
      </div>
    );
  }
);
