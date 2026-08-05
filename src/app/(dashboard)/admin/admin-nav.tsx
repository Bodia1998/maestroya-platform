"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/shared/utils/cn";

export interface AdminNavItem {
  href: string;
  label: string;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Second-level nav for everything under `/admin` — presentation only, same active-state convention as `DashboardShell`'s `NavLinks`. */
export function AdminNav({ items }: { items: AdminNavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Admin navigation" className="flex flex-col gap-1">
      <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-foreground/50">Admin</p>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-primary/10 text-primary" : "text-foreground/75 hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
