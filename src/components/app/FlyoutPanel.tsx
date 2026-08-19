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
  searchable?: boolean;
  inline?: boolean;
  row?: number;
};

export type StatConfig = {
  label: string;
  value: string | number;
  href?: string;
  bold?: boolean;
};

type Props = {
  title: string;
  titleField?: string;
  fields: FieldConfig[];
  data: Record<string, any>;
  stats?: StatConfig[];
  onSave: (field: string, value: string) => Promise<void>;
  onClose: () => void;
  autoFocusTitle?: boolean;
};

export function FlyoutPanel({ title, titleField = "name", fields, data, stats, onSave, onClose, autoFocusTitle = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const inlineFields = fields.filter((f) => f.inline);
  const bodyFields = fields.filter((f) => !f.inline);

  const sections = new Map<string, FieldConfig[]>();
  for (const field of bodyFields) {
    const section = field.section ?? "";
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)!.push(field);
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />
      <div
        ref={panelRef}
        className="fixed top-0 right-0 h-full w-full sm:w-[480px] bg-elevated border-l border-border-default z-50 overflow-y-auto shadow-xl"
      >
        {/* Title */}
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <EditableCell
            value={title}
            onSave={(v) => onSave(titleField, v)}
            className="text-lg font-semibold"
            autoFocus={autoFocusTitle}
          />
          <button onClick={onClose} className="p-1 rounded hover:bg-card text-text-secondary">
            <X size={20} />
          </button>
        </div>

        {/* Inline metadata fields (compact rows under title) */}
        {inlineFields.length > 0 && (() => {
          const rows = new Map<number, FieldConfig[]>();
          for (const f of inlineFields) {
            const r = f.row ?? 0;
            if (!rows.has(r)) rows.set(r, []);
            rows.get(r)!.push(f);
          }
          return (
            <div className="px-4 py-3 border-b border-border-default space-y-2" style={{ backgroundColor: "#f0f0f0" }}>
              {Array.from(rows.entries())
                .sort(([a], [b]) => a - b)
                .map(([rowNum, rowFields]) => (
                  <div key={rowNum} className="flex flex-wrap gap-x-4 gap-y-2">
                    {rowFields.map((field) => (
                      <div key={field.key} className="flex items-center gap-1.5">
                        <span className="text-xs text-text-muted">{field.label}</span>
                        {field.type === "date" ? (
                          <EditableCell
                            value={data[field.key]?.toString() ?? ""}
                            onSave={(v) => onSave(field.key, v)}
                            type="date"
                            placeholder="None"
                          />
                        ) : (
                          <EditableCell
                            value={data[field.key]?.toString() ?? ""}
                            onSave={(v) => onSave(field.key, v)}
                            type={field.type}
                            options={field.options}
                            displayAs={field.displayAs}
                            pillType={field.pillType}
                            placeholder="None"
                            searchable={field.searchable}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          );
        })()}

        {/* Stats bar */}
        {stats && stats.length > 0 && (
          <div className="flex border-b border-border-default bg-card">
            {stats.map((stat) => (
              <div key={stat.label} className="flex-1 text-center py-3">
                {stat.href ? (
                  <a href={stat.href} className="block hover:opacity-80">
                    <div className={`text-sm text-text-primary hover:underline ${stat.bold ? "font-bold" : "font-semibold"}`}>
                      {stat.value}
                    </div>
                    <div className={`text-xs ${stat.bold ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{stat.label}</div>
                  </a>
                ) : (
                  <>
                    <div className={`text-sm text-text-primary ${stat.bold ? "font-bold" : "font-semibold"}`}>
                      {stat.value}
                    </div>
                    <div className={`text-xs ${stat.bold ? "font-semibold text-text-primary" : "text-text-secondary"}`}>{stat.label}</div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Body fields */}
        <div className="p-4 space-y-6">
          {Array.from(sections.entries()).map(([sectionName, sectionFields]) => (
            <div key={sectionName}>
              {sectionName && (
                <h3 className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-3">
                  {sectionName}
                </h3>
              )}
              <div className="space-y-3">
                {sectionFields.map((field) => {
                  return (
                    <div key={field.key}>
                      <label className="text-xs text-text-secondary mb-1 block">{field.label}</label>
                      <EditableCell
                        value={data[field.key]?.toString() ?? ""}
                        onSave={(v) => onSave(field.key, v)}
                        type={field.type}
                        options={field.options}
                        displayAs={field.displayAs}
                        pillType={field.pillType}
                        placeholder={field.placeholder ?? "\u2014"}
                        showEmptyBox={field.type === "textarea" || field.type === "text"}
                        searchable={field.searchable}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
