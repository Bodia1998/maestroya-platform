import "server-only";

import { headers } from "next/headers";

import { REQUEST_ID_HEADER } from "@/infrastructure/observability/request-id";

/**
 * Reads the request ID that `middleware.ts` resolved and injected onto
 * the incoming request headers, for use from Server Components, Server
 * Actions, and Route Handlers that run *after* middleware — the same
 * "one seam" convention as `request-context.ts`'s `getClientIpHash` in
 * Module 24.
 *
 * Returns `null` when there is no active request context (e.g. called
 * outside a request, such as at module load time, in a script, or in a
 * unit test) rather than throwing — callers should fall back to an
 * unscoped log call in that case.
 */
export async function getRequestId(): Promise<string | null> {
  try {
    const headerList = await headers();
    return headerList.get(REQUEST_ID_HEADER);
  } catch {
    return null;
  }
}
