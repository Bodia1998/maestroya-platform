import "server-only";

import { getTranslations } from "next-intl/server";

/**
 * Module 120 — Multilingual Localization: `(status) => label` for raw
 * status codes shown outside a `StatusBadge` (filter `<option>`s, prose).
 * Uses the same `enums.status` vocabulary as `StatusBadge`; a code with no
 * catalog entry yet is shown raw (it is an identifier, never prose).
 */
export async function getStatusLabeler(): Promise<(status: string) => string> {
  const t = await getTranslations("enums.status");
  return (status: string) => (t.has(status as never) ? t(status as never) : status);
}
