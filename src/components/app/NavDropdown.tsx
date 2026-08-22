"use client";

import { useState, useRef, useEffect, useId } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";

export type DropdownItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  muted?: boolean;
  dividerBefore?: boolean;
};

/**
 * A disclosure wrapping a group of navigation links — deliberately NOT the
 * WAI-ARIA menu pattern. role="menu"/"menuitem" commits the component to
 * arrow-key navigation, roving tabindex, Home/End and typeahead; announcing
 * "menu, 5 items" and then ignoring Down is worse than no role at all. As a
 * disclosure, Tab walking the links in DOM order is the whole keyboard story.
 */
export function NavDropdown({ label, icon, items, active }: {
  label: string;
  icon: React.ReactNode;
  items: DropdownItem[];
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const pathname = usePathname();

  // Close on outside click and on Escape, so keyboard users are not trapped.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !open) return;
      // Unmounting the panel while focus is inside it drops focus to <body> and
      // loses the user's place in the nav, so hand focus back to the trigger.
      // Only when focus was in here: Escape pressed while the menu happens to be
      // open on hover and focus is elsewhere must not steal it.
      const focusWasInside = hostRef.current?.contains(document.activeElement);
      setOpen(false);
      if (focusWasInside) buttonRef.current?.focus();
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div
      ref={hostRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        // Click opens, it never toggles. A toggle fights the hover: onMouseEnter has
        // already set open, so clicking the trigger — the obvious gesture — closed the
        // menu the hover had just opened. On touch WebKit synthesises mouseenter before
        // click, so the toggle made a tap open then instantly close and the dropdown
        // never opened at all on mobile. Closing is left entirely to outside-click,
        // Escape and mouseleave, which is one less piece of state than tracking whether
        // the menu was opened by hover or by an explicit click.
        onClick={() => setOpen(true)}
        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
          active
            ? "text-accent-primary border-b-2 border-accent-primary"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        // The 6px gap under the trigger is padding INSIDE this wrapper, not margin
        // outside the panel. As margin it belonged to neither element, so a
        // normal-speed move from the button down to the menu crossed unhovered space
        // and mouseleave unmounted the panel mid-travel; the items were only reachable
        // by moving fast enough to skip an intermediate mousemove. As padding the
        // pointer stays inside the host the whole way down.
        <div id={panelId} className="absolute top-full left-0 pt-1.5 z-50">
          <div className="min-w-[236px] bg-elevated border border-border-default rounded-md shadow-lg p-1.5">
            <ul>
              {items.map((item) => (
                <li key={item.href}>
                  {item.dividerBefore && <div className="h-px bg-border-default my-1.5 mx-1" />}
                  <Link
                    href={item.href}
                    aria-current={pathname === item.href ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-sm hover:bg-card ${
                      item.muted ? "text-text-secondary" : "text-text-primary"
                    }`}
                  >
                    {item.icon}
                    <span className="flex-1">{item.label}</span>
                    {item.count !== undefined && (
                      <span className="text-xs text-text-muted tabular-nums">
                        {item.count}
                        <span className="sr-only"> open items</span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
