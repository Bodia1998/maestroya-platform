import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Route protection rules. Kept as simple prefix arrays rather than a
 * config file — there's no admin/provider UI built yet for the
 * role-gated prefixes below (that's other modules' work), but the
 * gating logic itself is Authentication's responsibility and is ready
 * for when those routes exist.
 */
const PROTECTED_PREFIXES = ["/dashboard"];
const ROLE_GATED_PREFIXES: Array<{ prefix: string; roles: string[] }> = [
  { prefix: "/admin", roles: ["ADMIN", "SUPER_ADMIN"] },
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isSignedIn = !!req.auth?.user;
  const roles = req.auth?.user?.roles ?? [];

  const roleGate = ROLE_GATED_PREFIXES.find((g) => pathname.startsWith(g.prefix));
  if (roleGate) {
    if (!isSignedIn) {
      const loginUrl = new URL("/auth/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }
    if (!roleGate.roles.some((r) => roles.includes(r))) {
      return NextResponse.redirect(new URL("/", req.nextUrl.origin));
    }
    return NextResponse.next();
  }

  const isProtected = PROTECTED_PREFIXES.some((p) => pathname.startsWith(p));
  if (isProtected && !isSignedIn) {
    const loginUrl = new URL("/auth/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

/**
 * `matcher` intentionally excludes static assets and API auth routes —
 * running middleware on every image request would add needless latency.
 */
export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
