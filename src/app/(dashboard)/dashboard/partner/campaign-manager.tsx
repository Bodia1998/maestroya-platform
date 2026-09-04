"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/typography";
import { createReferralLinkAction, setReferralLinkActiveAction } from "./actions";

const CAMPAIGN_SOURCE_OPTIONS = ["TELEGRAM", "INSTAGRAM", "TIKTOK", "YOUTUBE", "BLOG", "WEBSITE"] as const;

interface CampaignLink {
  id: string;
  code: string;
  label: string | null;
  source: string | null;
  isActive: boolean;
  visits: number;
}

/**
 * Module 96 — Referral & Affiliate Production Wiring: the partner
 * dashboard's campaign-management panel — create a new referral link
 * (with a display-only source label), see every link this partner owns
 * with its own visit count, and activate/deactivate one. All mutations go
 * through Server Actions in `./actions.ts`, which re-derive `partnerId`
 * from the authenticated session server-side — this component never
 * trusts anything it renders as an authorization boundary.
 */
export function CampaignManager({ initialLinks }: { initialLinks: CampaignLink[] }) {
  const [links, setLinks] = useState(initialLinks);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [source, setSource] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createReferralLinkAction({
        code,
        label: label.trim() || undefined,
        source: source || undefined,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setLinks((prev) => [{ ...result.data, visits: 0 }, ...prev]);
      setCode("");
      setLabel("");
      setSource("");
    });
  }

  function handleToggle(link: CampaignLink) {
    setError(null);
    startTransition(async () => {
      const result = await setReferralLinkActiveAction(link.id, !link.isActive);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setLinks((prev) => prev.map((l) => (l.id === link.id ? { ...l, isActive: !l.isActive } : l)));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaign links</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form onSubmit={handleCreate} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1">
            <Text size="xs" tone="muted">
              Code
            </Text>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. telegram_valencia"
              required
              maxLength={40}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Text size="xs" tone="muted">
              Label (optional)
            </Text>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Your own note" maxLength={120} />
          </div>
          <div className="flex flex-col gap-1">
            <Text size="xs" tone="muted">
              Source
            </Text>
            <Select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">None</option>
              {CAMPAIGN_SOURCE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s.charAt(0) + s.slice(1).toLowerCase()}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={isPending || !code.trim()}>
            {isPending ? "Creating…" : "Create link"}
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}

        {links.length === 0 ? (
          <Text size="sm" tone="muted">
            No campaign links yet — create one above to start sharing it.
          </Text>
        ) : (
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">/r/{link.code}</span>
                  {link.source && <Badge variant="secondary">{link.source}</Badge>}
                  {link.label && (
                    <Text size="xs" tone="muted">
                      {link.label}
                    </Text>
                  )}
                  <Badge variant={link.isActive ? "default" : "outline"}>{link.isActive ? "Active" : "Inactive"}</Badge>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{link.visits} visits</span>
                  <Button type="button" variant="outline" size="sm" disabled={isPending} onClick={() => handleToggle(link)}>
                    {link.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
