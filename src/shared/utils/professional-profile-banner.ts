import { computeProfileCompleteness, type ProfileCompletenessSignals } from "@/domain/services/profile-completeness";

/**
 * Persistent "complete your professional profile" banner — decision logic.
 *
 * Root cause this exists to fix: the previous "Set up your professional
 * profile" prompt only ever appeared as one card on `/dashboard` itself
 * (see dashboard/page.tsx's pre-existing conditional card), so it
 * disappeared the moment a professional navigated to any other page (My
 * quotes, Available requests, Messages, ...). This function is called once
 * from `(dashboard)/layout.tsx` — which wraps every page under the route
 * group — so the banner it drives can be rendered by `DashboardShell` on
 * every professional page, not just the dashboard home. It never blocks
 * navigation: it is a dismissible-by-navigating-away notice, not a gate
 * (the existing middleware.ts onboarding redirect remains the only actual
 * gate, and is untouched by this file).
 *
 * Reuses the existing `computeProfileCompleteness` domain service (Search &
 * Ranking module) rather than inventing a second scoring function — see
 * that module's own doc comment for the exact signal set. This file only
 * adds the *decision* of when that score should surface as a banner, plus
 * the copy, which is presentation concern the ranking module has no
 * business owning.
 */
export interface ProfessionalProfileBannerInfo {
  show: boolean;
  message: string;
  ctaLabel: string;
  ctaHref: string;
}

const COMPLETE_PROFESSIONAL_PROFILE_HREF = "/dashboard/professional";

/**
 * No ProfessionalProfile row at all yet (a CUSTOMER account that hasn't
 * started onboarding as a professional, or a PROVIDER role granted without
 * a profile ever being created) — always show the banner; there is nothing
 * to score.
 */
export function buildNoProfessionalProfileBanner(): ProfessionalProfileBannerInfo {
  return {
    show: true,
    message: "Complete your professional profile to start receiving customer requests.",
    ctaLabel: "Complete professional profile",
    ctaHref: COMPLETE_PROFESSIONAL_PROFILE_HREF,
  };
}

/**
 * A ProfessionalProfile already exists — score it with the same signals
 * `computeProfileCompleteness` already uses for search ranking, and show
 * the banner until it's fully complete (score of 1). Below 1, the banner
 * always reads as "finish" rather than distinguishing "still missing
 * critical fields" vs "just missing a nice-to-have" — the caller
 * (layout.tsx) is responsible for sourcing accurate signals so this
 * doesn't linger longer than genuinely warranted.
 */
export function buildProfessionalProfileBanner(
  signals: ProfileCompletenessSignals,
): ProfessionalProfileBannerInfo {
  const completeness = computeProfileCompleteness(signals);

  if (completeness >= 1) {
    return {
      show: false,
      message: "",
      ctaLabel: "",
      ctaHref: COMPLETE_PROFESSIONAL_PROFILE_HREF,
    };
  }

  return {
    show: true,
    message: "Your professional profile is incomplete. Finish it so customers see your best profile.",
    ctaLabel: "Complete professional profile",
    ctaHref: COMPLETE_PROFESSIONAL_PROFILE_HREF,
  };
}
