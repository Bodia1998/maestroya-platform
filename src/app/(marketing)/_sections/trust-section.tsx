import { useTranslations } from "next-intl";
import { MessageCircle, ScrollText, ShieldCheck, Star, Wrench, LifeBuoy } from "lucide-react";

/**
 * Trust signals — each one maps to a real, already-implemented platform
 * capability (verification module, quotes/quote items, chat, reviews,
 * job lifecycle, disputes/support). No invented statistics or fabricated
 * testimonials, per the brief.
 */
const TRUST_POINTS = [
  { icon: ShieldCheck, key: "verified" },
  { icon: ScrollText, key: "quotes" },
  { icon: MessageCircle, key: "communication" },
  { icon: Star, key: "reviews" },
  { icon: Wrench, key: "tracking" },
  { icon: LifeBuoy, key: "support" },
] as const;

export function TrustSection() {
  const t = useTranslations("marketing");
  return (
    <section className="border-y border-border bg-muted/40">
      <div className="container flex flex-col gap-10 py-16">
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {t("trust.title")}
          </h2>
          <p className="max-w-2xl text-muted-foreground">
            {t("trust.subtitle")}
          </p>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {TRUST_POINTS.map((point) => (
            <div key={point.key} className="flex gap-4 rounded-xl bg-background p-5 shadow-xs">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <point.icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-foreground">{t(`trust.${point.key}.title`)}</h3>
                <p className="text-sm text-muted-foreground">{t(`trust.${point.key}.description`)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
