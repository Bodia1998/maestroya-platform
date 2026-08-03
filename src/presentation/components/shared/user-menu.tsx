"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LayoutDashboard, LogOut, User } from "lucide-react";

import { cn } from "@/shared/utils/cn";

export interface UserMenuProps {
  label: string;
  isProfessional: boolean;
}

/** Small account dropdown — signed-in state in the header. No new auth logic, just links to existing routes. */
export function UserMenu({ label, isProfessional }: UserMenuProps) {
  const t = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const dashboardHref = isProfessional ? "/dashboard/professional" : "/dashboard";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted"
      >
        <User className="h-4 w-4" aria-hidden />
        <span className="max-w-[10rem] truncate">{label}</span>
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 animate-fade-in rounded-lg border border-border bg-card p-1.5 shadow-lg">
          <Link
            href={dashboardHref}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <LayoutDashboard className="h-4 w-4" aria-hidden />
            {t("dashboard")}
          </Link>
          <Link
            href="/auth/logout"
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
            onClick={() => setOpen(false)}
          >
            <LogOut className="h-4 w-4" aria-hidden />
            {t("logout")}
          </Link>
        </div>
      )}
    </div>
  );
}
