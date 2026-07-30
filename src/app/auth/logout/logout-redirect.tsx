"use client";

import { useEffect, useRef } from "react";

import { logoutAction } from "./actions";

/**
 * Client island for the `/auth/logout` route: on mount, submits a real
 * POST to `logoutAction` (a Server Action) via `requestSubmit()`.
 *
 * This exists so that simply *navigating* to `/auth/logout` — the
 * existing behavior every current entry point (marketing header, mobile
 * nav, the post-account-deletion redirect) already relies on — still
 * signs the user out, without the route's Server Component ever running
 * `signOut()` itself during render. The mutation only happens once this
 * effect fires and the form actually submits, i.e. after the page has
 * mounted client-side, never as a side effect of the route merely being
 * rendered or prefetched.
 */
export function LogoutRedirect() {
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    formRef.current?.requestSubmit();
  }, []);

  return (
    <form ref={formRef} action={logoutAction}>
      <main className="flex min-h-screen flex-col items-center justify-center gap-2 text-sm text-foreground/70">
        Signing you out…
      </main>
    </form>
  );
}
