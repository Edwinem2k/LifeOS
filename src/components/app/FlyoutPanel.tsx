"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { EditableCell } from "./EditableCell";

export type FieldConfig = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "number";
  options?: { value: string; label: string }[];
  section?: string;
  placeholder?: string;
  displayAs?: "pill";
  pillType?: "status" | "area" | "priority";
};

type Props = {
  title: string;
  fields: FieldConfig[];
  data: Record<string, any>;
  stats?: { label: string; value: string | number }[];
  onSave: (field: string, value: string) => Promise<void>;
  onClose: () => void;
};

export function FlyoutPanel({ title, fields, data, stats, onSave, onClose }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const sections = new Map<string, FieldConfig[]>();
  for (const field of fields) {
    const section = field.section ?? "";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(field);
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-elevated border-l border-border-default z-50 overflow-y-auto shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <EditableCell
            value={title}
            onSave={(v) => onSave("name", v)}
            className="text-lg font-semibold"
          />
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-card text-text-secondary"
          >
            <X size={20} />
          </button>
        </div>

        {stats && stats.length > 0 && (
          <div className="flex gap-4 px-4 py-3 border-b border-border-default bg-card">
            {stats.map((stat) => (
              <div key={stat.label} className="text-center">
                <div className="text-lg font-semibold text-text-primary">
                  {stat.value}
                </div>
                <div className="text-xs text-text-secondary">{stat.label}</div>
              </div>
            ))}
          </div>
        )}

        <div className="p-4 space-y-6">
          {Array.from(sections.entries()).map(([sectionName, sectionFields]) => (
            <div key={sectionName}>
              {sectionName && (
                <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                  {sectionName}
                </h3>
              )}
              <div className="space-y-3">
                {sectionFields.map((field) => (
                  <div key={field.key}>
                    <label className="text-xs text-text-secondary mb-1 block">
                      {field.label}
                    </label>
                    <EditableCell
                      value={data[field.key]?.toString() ?? ""}
                      onSave={(v) => onSave(field.key, v)}
                      type={field.type}
                      options={field.options}
                      displayAs={field.displayAs}
                      pillType={field.pillType}
                      placeholder={field.placeholder ?? "—"}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
