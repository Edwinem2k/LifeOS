"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderKanban, CheckSquare, Target, MoreHorizontal } from "lucide-react";

const navItems = [
  { href: "/", label: "Today", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/goals", label: "Goals", icon: Target },
];

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-border-default bg-elevated px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex items-center h-14">
        <Link href="/" className="text-lg font-semibold text-text-primary mr-8">
          Life OS
        </Link>
        <div className="flex items-center gap-1 ml-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
                  isActive
                    ? "text-accent-primary border-b-2 border-accent-primary"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                <Icon size={16} />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
          <button className="flex items-center gap-1 px-3 py-2 text-sm text-text-secondary hover:text-text-primary">
            <MoreHorizontal size={16} />
            <span className="hidden sm:inline">More</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
