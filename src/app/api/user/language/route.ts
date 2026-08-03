import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { DomainError } from "@/domain/errors/domain-error";
import { getCurrentUser } from "@/infrastructure/auth/rbac";
import { logger } from "@/infrastructure/observability/logger";
import { REQUEST_ID_HEADER, resolveRequestId } from "@/infrastructure/observability/request-id";
import { updateLanguagePreferenceSchema } from "@/application/dto/i18n.dto";
import { makeUpdateUserLanguagePreferenceUseCase } from "@/application/use-cases/i18n/compose";
import { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME } from "@/shared/i18n/locales";

/**
 * Module 29 — Internationalization: persist the signed-in user's
 * interface language.
 *
 * A Route Handler rather than a Server Action because the caller is
 * `I18nProvider.setLocale` — a fire-and-forget background write issued
 * while a `router.refresh()` transition is already running. A Server
 * Action would enqueue a *second* server round trip in the same action
 * queue as that refresh and serialise behind it; a plain `fetch` does not.
 * `PATCH` because this is a partial update of an existing user resource.
 *
 * It calls the use case, never Prisma — the same rule every other write
 * path in this codebase follows (see docs/ARCHITECTURE.md). Validation is
 * `updateLanguagePreferenceSchema`, which is generated from
 * `SUPPORTED_LOCALES`, so a new language is accepted here automatically
 * and an unsupported one can never reach the database.
 *
 * The response also re-writes the `maestroya_locale` cookie. The browser
 * already wrote it client-side before calling this, so this is belt and
 * braces for the case where client-side cookie writing is unavailable
 * (some privacy modes) — and it keeps the server the authority on the
 * cookie's attributes.
 *
 * `middleware.ts`'s matcher excludes `/api/**`, so — exactly like
 * `/api/health` — this route resolves its own request ID rather than
 * relying on a middleware-injected one.
 */
export async function PATCH(request: NextRequest) {
  const requestId = resolveRequestId(request.headers.get(REQUEST_ID_HEADER));
  const headersWithRequestId = { [REQUEST_ID_HEADER]: requestId };

  const user = await getCurrentUser();
  if (!user) {
    // Guests are not an error case for the *feature* — their language
    // lives in localStorage and never reaches this endpoint — but they
    // are an error case for this endpoint, which exists solely to write
    // a row keyed by user id.
    return NextResponse.json(
      { status: "error", message: "Unauthorized." },
      { status: 401, headers: headersWithRequestId },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body." },
      { status: 400, headers: headersWithRequestId },
    );
  }

  const parsed = updateLanguagePreferenceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { status: "error", message: "Unsupported locale." },
      { status: 400, headers: headersWithRequestId },
    );
  }

  try {
    const { locale } = await makeUpdateUserLanguagePreferenceUseCase().execute(
      user.id,
      parsed.data.locale,
    );

    const response = NextResponse.json(
      { status: "ok", locale },
      { status: 200, headers: headersWithRequestId },
    );
    response.cookies.set({
      name: LOCALE_COOKIE_NAME,
      value: locale,
      path: "/",
      maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
      sameSite: "lax",
      httpOnly: false,
      secure: process.env.NODE_ENV === "production",
    });
    return response;
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json(
        { status: "error", message: error.message },
        { status: 400, headers: headersWithRequestId },
      );
    }
    logger.error("update_language_preference_failed", {
      requestId,
      route: "/api/user/language",
      error,
    });
    return NextResponse.json(
      { status: "error", message: "Could not update language preference." },
      { status: 500, headers: headersWithRequestId },
    );
  }
}
