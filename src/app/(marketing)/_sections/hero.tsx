import { ShieldCheck, Star, Users } from "lucide-react";

import { HeroSearch, RequestServiceCta } from "./hero-search";

export interface HeroProps {
  categories: Array<{ id: string; name: string; slug: string }>;
}

const HERO_HIGHLIGHTS = [
  { icon: ShieldCheck, label: "Profesionales verificados" },
  { icon: Star, label: "Opiniones de clientes reales" },
  { icon: Users, label: "Particulares y empresas" },
] as const;

export function Hero({ categories }: HeroProps) {
  return (
    <section className="border-b border-border bg-gradient-to-b from-muted/60 to-background">
      <div className="container flex flex-col items-center gap-8 py-16 text-center sm:py-24">
        <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          Encuentra profesionales de confianza para tu hogar
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Describe lo que necesitas, compara presupuestos y contrata al profesional adecuado
          cerca de ti, todo desde MaestroYa.
        </p>

        <div className="flex w-full max-w-2xl flex-col items-center gap-4">
          <HeroSearch categories={categories} />
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:gap-4">
            <span className="text-sm text-muted-foreground">o</span>
            <RequestServiceCta />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 pt-4">
          {HERO_HIGHLIGHTS.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm text-muted-foreground">
              <item.icon className="h-4 w-4 text-primary" aria-hidden />
              {item.label}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
