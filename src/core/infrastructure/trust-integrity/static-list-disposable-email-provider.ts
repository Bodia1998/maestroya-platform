import type { DisposableEmailProvider } from "@/application/ports/disposable-email-provider";

/**
 * Module 65 — Trust & Integrity System: default `DisposableEmailProvider`
 * — a small, bundled, static list of well-known disposable-email domains.
 * Not an external SDK/API call (per the module brief): the list is a
 * plain in-memory `Set`, checked purely against the email's domain suffix.
 * A future provider (e.g. a maintained third-party disposable-domain feed)
 * implements the same interface with a live-updated list, selected in
 * `trust-integrity-provider-factory.ts`.
 */
const KNOWN_DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "throwawaymail.com",
  "getnada.com",
  "fakeinbox.com",
  "sharklasers.com",
  "dispostable.com",
  "maildrop.cc",
  "mintemail.com",
  "moakt.com",
]);

export class StaticListDisposableEmailProvider implements DisposableEmailProvider {
  readonly name = "STATIC_LIST";

  async isDisposable(email: string): Promise<boolean> {
    const domain = email.trim().toLowerCase().split("@").pop();
    if (!domain) return false;
    return KNOWN_DISPOSABLE_DOMAINS.has(domain);
  }
}
