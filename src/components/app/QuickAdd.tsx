"use client";

import { useState, useRef, useImperativeHandle, forwardRef } from "react";
import { Plus } from "lucide-react";

type Props = {
  onAdd: (title: string) => void;
  onPlusClick?: () => void;
  placeholder?: string;
};

export const QuickAdd = forwardRef<HTMLInputElement, Props>(
  function QuickAdd({ onAdd, onPlusClick, placeholder = "Add task..." }, ref) {
    const [value, setValue] = useState("");
    // The row reads as one control, so clicking anywhere on it focuses the input.
    // That needs the element even when the caller passed no ref, hence an internal
    // one republished through the forwarded ref rather than the forwarded ref alone.
    const inputRef = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

    function handleSubmit() {
      const trimmed = value.trim();
      if (!trimmed) return;
      onAdd(trimmed);
      setValue("");
    }

    return (
      <div
        onClick={() => inputRef.current?.focus()}
        className="flex items-center gap-2 border-t border-dashed border-border-default px-3 py-2 bg-page cursor-text"
      >
        <button
          type="button"
          // Stops the row handler from pulling focus back off the flyout that
          // onPlusClick opens.
          onClick={(e) => { e.stopPropagation(); onPlusClick?.(); }}
          className="shrink-0 text-text-muted hover:text-accent-primary transition-colors cursor-pointer"
        >
          <Plus size={16} />
        </button>
        <input
          ref={inputRef}
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
