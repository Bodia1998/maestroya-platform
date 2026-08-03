"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Globe, Loader2 } from "lucide-react";

import { useI18n } from "@/components/shared/i18n-provider";
import { LOCALE_DESCRIPTORS, getLocaleDescriptor, type Locale } from "@/shared/i18n/locales";
import { cn } from "@/shared/utils/cn";

/**
 * Module 29 — Internationalization: the one language switcher.
 *
 * Mirrors `user-menu.tsx` exactly for the dropdown variant — same
 * click-outside `useRef`/`useEffect`, same `aria-expanded` button, same
 * absolutely-positioned panel and class names — because the header
 * already has an established quick-settings dropdown pattern and a second
 * one would be gratuitous. The `list` variant is the same component with
 * the panel always open, for the Settings page where a dropdown inside a
 * settings section is worse than a visible list of choices.
 *
 * All state and persistence live in `I18nProvider.setLocale` (see its doc
 * comment); this component renders the choice and the pending/failed
 * states, nothing more. Adding a language never touches this file — the
 * options come from `LOCALE_DESCRIPTORS`.
 *
 * Accessibility: the dropdown is a `menu` of `menuitemradio`s, which is
 * the correct role pairing for "pick exactly one of these" inside a
 * button-triggered menu, and each option carries the language's own name
 * with `lang={code}` so a screen reader pronounces "Українська" with
 * Ukrainian phonemes rather than reading it through the page's language.
 */

export type LanguageSwitcherVariant = "dropdown" | "list";

export interface LanguageSwitcherProps {
  variant?: LanguageSwitcherVariant;
  /** Hide the current language's name in the trigger (icon-only, tight headers). */
  compact?: boolean;
  className?: string;
}

function LanguageOption({
  locale,
  isActive,
  isSwitching,
  onSelect,
  label,
}: {
  locale: Locale;
  isActive: boolean;
  isSwitching: boolean;
  onSelect: (locale: Locale) => void;
  label: string;
}) {
  const descriptor = getLocaleDescriptor(locale);

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={isActive}
      aria-label={label}
      disabled={isSwitching}
      onClick={() => onSelect(locale)}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60",
        isActive && "font-medium",
      )}
    >
      <span lang={descriptor.code}>{descriptor.nativeName}</span>
      {isActive && <Check className="h-4 w-4 text-primary" aria-hidden />}
    </button>
  );
}

export function LanguageSwitcher({
  variant = "dropdown",
  compact = false,
  className,
}: LanguageSwitcherProps) {
  const { isSwitching, switchFailed, setLocale } = useI18n();
  const locale = useLocale() as Locale;
  const t = useTranslations("settings");
  const tNav = useTranslations("nav");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant !== "dropdown") return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [variant]);

  const current = getLocaleDescriptor(locale);

  const handleSelect = (next: Locale) => {
    setLocale(next);
    setOpen(false);
  };

  const options = LOCALE_DESCRIPTORS.map((descriptor) => (
    <LanguageOption
      key={descriptor.code}
      locale={descriptor.code}
      isActive={descriptor.code === locale}
      isSwitching={isSwitching}
      onSelect={handleSelect}
      label={t("language.switchTo", { language: descriptor.nativeName })}
    />
  ));

  if (variant === "list") {
    return (
      <div className={cn("flex flex-col gap-1", className)}>
        <div
          role="menu"
          aria-label={t("language.label")}
          className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-1.5"
        >
          {options}
        </div>
        <p aria-live="polite" className="min-h-5 px-1 text-xs text-foreground/60">
          {isSwitching ? t("language.saving") : switchFailed ? t("language.error") : null}
        </p>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={tNav("language")}
        className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-muted"
      >
        {isSwitching ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Globe className="h-4 w-4" aria-hidden />
        )}
        {!compact && <span>{current.nativeName}</span>}
        <ChevronDown
          className={cn("h-4 w-4 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={tNav("language")}
          className="absolute right-0 top-full mt-2 w-48 animate-fade-in rounded-lg border border-border bg-card p-1.5 shadow-lg"
        >
          {options}
        </div>
      )}
    </div>
  );
}
