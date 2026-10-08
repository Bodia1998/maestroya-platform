"use client";

import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import type { LeadFeedItemDTO } from "@/application/dto/lead-feed.dto";
import { ListSkeleton } from "@/components/dashboard/skeletons";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { getLeadFeedAction } from "./actions";
import { LeadCard } from "./lead-card";

export interface LeadMarketplaceProps {
  initialItems: LeadFeedItemDTO[];
  /** Opaque Module 134 cursor; passed back unchanged, never parsed or built here. */
  initialNextCursor: string | null;
  initialFailed: boolean;
  /** Localized category names by id (display only); falls back to the feed's own name. */
  categoryNames: Record<string, string>;
}

type FeedPage = { items: LeadFeedItemDTO[]; nextCursor: string | null };

/** The only network call: the Module 134 Server Action. Any failure becomes `null` (never surfaced raw). */
async function fetchPage(cursor: string | null): Promise<FeedPage | null> {
  try {
    const result = await getLeadFeedAction(cursor ? { cursor } : undefined);
    return result.success ? { items: result.items, nextCursor: result.nextCursor } : null;
  } catch {
    return null;
  }
}

/**
 * Module 143 — presentation state for the lead marketplace: first page, retry,
 * keyset "load more". It decides nothing about leads (availability, eligibility,
 * price): it shows exactly the pages the Module 134 boundary returns, in order,
 * and only ever sends back the cursor it was given.
 */
export function LeadMarketplace({ initialItems, initialNextCursor, initialFailed, categoryNames }: LeadMarketplaceProps) {
  const t = useTranslations("professional.leads");
  const [items, setItems] = useState(initialItems);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [phase, setPhase] = useState<"ready" | "loading" | "error">(initialFailed ? "error" : "ready");
  const [moreState, setMoreState] = useState<"idle" | "loading" | "error">("idle");
  // Synchronous guard: state updates are async, so rapid repeated clicks could
  // otherwise fire duplicate requests for the same cursor.
  const inFlight = useRef(false);

  async function retry() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase("loading");
    try {
      const page = await fetchPage(null);
      if (!page) {
        setPhase("error");
        return;
      }
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setMoreState("idle");
      setPhase("ready");
    } finally {
      inFlight.current = false;
    }
  }

  async function loadMore() {
    if (inFlight.current || !nextCursor) return;
    inFlight.current = true;
    setMoreState("loading");
    try {
      const page = await fetchPage(nextCursor);
      if (!page) {
        setMoreState("error");
        return;
      }
      setItems((current) => {
        const seen = new Set(current.map((item) => item.leadId));
        return [...current, ...page.items.filter((item) => !seen.has(item.leadId))];
      });
      setNextCursor(page.nextCursor);
      setMoreState("idle");
    } finally {
      inFlight.current = false;
    }
  }

  if (phase === "loading") {
    return (
      <div role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">{t("status.loading")}</span>
        <ListSkeleton count={4} />
      </div>
    );
  }

  if (phase === "error") {
    return <ErrorState title={t("error.title")} description={t("error.description")} retryLabel={t("error.retry")} onRetry={retry} />;
  }

  if (items.length === 0) {
    return <EmptyState icon={Inbox} title={t("empty.title")} description={t("empty.description")} />;
  }

  return (
    <section aria-label={t("listLabel")} className="flex flex-col gap-4">
      <p role="status" aria-live="polite" className="sr-only">
        {t("status.loaded", { count: items.length })}
      </p>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <LeadCard key={item.leadId} item={item} categoryLabel={categoryNames[item.categoryId] ?? item.categoryName} />
        ))}
      </ul>
      {moreState === "error" && <Alert variant="danger">{t("loadMoreError")}</Alert>}
      {nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={loadMore} disabled={moreState === "loading"} aria-busy={moreState === "loading"}>
            {moreState === "loading" ? t("loadingMore") : moreState === "error" ? t("error.retry") : t("loadMore")}
          </Button>
        </div>
      )}
    </section>
  );
}
