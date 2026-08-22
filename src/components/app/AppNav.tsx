"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FolderKanban, CheckSquare, Target, MoreHorizontal, List } from "lucide-react";
import { Logo } from "./Logo";
import { NavDropdown, type DropdownItem } from "./NavDropdown";
import { ListIcon } from "./ListIcon";
import { useLists, useOpenCounts } from "@/hooks/use-lists";

const navItems = [
  { href: "/", label: "Today", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/goals", label: "Goals", icon: Target },
];

export function AppNav() {
  const pathname = usePathname();

  const { data: lists = [] } = useLists();
  const { data: counts = {} } = useOpenCounts();
  const pinned = lists.filter((l) => l.pinned);
  const adHocCount = lists.filter((l) => !l.pinned).length;

  const listItems: DropdownItem[] = [
    ...pinned.map((l) => ({
      href: `/lists/${l.id}`,
      label: l.name,
      icon: <ListIcon name={l.icon} size={15} />,
      count: counts[l.id] ?? 0,
    })),
    {
      href: "/lists",
      label: "All lists",
      icon: <List size={15} />,
      muted: true,
      count: adHocCount,
      dividerBefore: true,
    },
  ];

  return (
    <nav className="border-b border-border-default bg-elevated">
      <div className="max-w-[1536px] mx-auto flex items-center h-14 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 text-lg font-semibold text-text-primary mr-8">
          <Logo size={22} />
          LifeOS
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
          <NavDropdown
            label="Lists"
            icon={<List size={16} />}
            items={listItems}
            active={pathname.startsWith("/lists")}
          />
          <button className="flex items-center gap-1 px-3 py-2 text-sm text-text-secondary hover:text-text-primary">
            <MoreHorizontal size={16} />
            <span className="hidden sm:inline">More</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
