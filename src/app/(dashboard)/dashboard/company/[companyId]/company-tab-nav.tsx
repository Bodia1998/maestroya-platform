import Link from "next/link";

import { cn } from "@/shared/utils/cn";

const TABS = [
  { segment: "profile", label: "Profile" },
  { segment: "members", label: "Members" },
  { segment: "invitations", label: "Invitations" },
  { segment: "verification", label: "Verification" },
] as const;

export type CompanyTabSegment = (typeof TABS)[number]["segment"];

/**
 * Module 18 — Company Professional: the tab bar linking the four company
 * sub-pages. Previously only rendered on the Profile page itself — Members,
 * Invitations, and Verification each had no way back to the others short of
 * the browser back button. Extracted here so it renders consistently on
 * all four (Module 30.6 — Profile & Settings UX), with `aria-current="page"`
 * on the active tab for screen readers, matching the convention
 * `DashboardShell`'s own sidebar nav already uses.
 */
export function CompanyTabNav({ companyId, active }: { companyId: string; active: CompanyTabSegment }) {
  return (
    <nav aria-label="Company sections" className="flex gap-4 text-sm">
      {TABS.map((tab) => {
        const isActive = tab.segment === active;
        return (
          <Link
            key={tab.segment}
            href={`/dashboard/company/${companyId}/${tab.segment}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "border-b-2 pb-2 transition-colors",
              isActive
                ? "border-primary font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:underline",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
