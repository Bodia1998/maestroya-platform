import { useTranslations } from "next-intl";

import { ButtonLink } from "@/components/ui/button-link";

const STEPS = [
  { number: 1, key: "one" },
  { number: 2, key: "two" },
  { number: 3, key: "three" },
  { number: 4, key: "four" },
] as const;

export function HowItWorks() {
  const t = useTranslations("marketing");
  return (
    <section id="como-funciona" className="container flex flex-col gap-10 py-16 scroll-mt-20">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("howItWorks.title")}</h2>
        <p className="max-w-2xl text-muted-foreground">
          {t("howItWorks.subtitle")}
        </p>
      </div>

      <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step) => (
          <div key={step.number} className="flex flex-col gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-base font-semibold text-primary-foreground">
              {step.number}
            </span>
            <h3 className="font-semibold text-foreground">{t(`howItWorks.steps.${step.key}.title`)}</h3>
            <p className="text-sm text-muted-foreground">{t(`howItWorks.steps.${step.key}.description`)}</p>
          </div>
        ))}
      </div>

      <div>
        <ButtonLink href="/requests/new" size="lg">
          {t("howItWorks.cta")}
        </ButtonLink>
      </div>
    </section>
  );
}
