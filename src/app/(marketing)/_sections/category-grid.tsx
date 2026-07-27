import Link from "next/link";
import {
  Building2,
  Fan,
  Hammer,
  Home,
  type LucideIcon,
  PaintRoller,
  Shovel,
  Sofa,
  Sparkles,
  Wrench,
  Zap,
} from "lucide-react";

export interface CategoryGridProps {
  categories: Array<{ id: string; name: string; slug: string; iconUrl: string | null }>;
}

/**
 * Slug → icon fallback. `ServiceCategory.iconUrl` exists in the schema
 * but is empty for every seeded category today (see prisma/seed.ts) — a
 * curated `lucide-react` icon per known slug reads better than a generic
 * placeholder icon, while staying purely presentational (no business
 * logic, no schema change). Anything not in this map falls back to a
 * generic house/tool icon so a newly-added category never renders
 * broken.
 */
const ICONS_BY_SLUG: Record<string, LucideIcon> = {
  fontaneria: Wrench,
  electricidad: Zap,
  "aire-acondicionado": Fan,
  pintura: PaintRoller,
  reformas: Hammer,
  "montaje-de-muebles": Sofa,
  limpieza: Sparkles,
  cerrajeria: Building2,
  albanileria: Hammer,
  jardineria: Shovel,
};

export function CategoryGrid({ categories }: CategoryGridProps) {
  if (categories.length === 0) return null;

  return (
    <section className="container flex flex-col gap-8 py-16">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Servicios más solicitados
        </h2>
        <p className="max-w-2xl text-muted-foreground">
          Elige una categoría para ver profesionales verificados cerca de ti.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {categories.map((category) => {
          const Icon = ICONS_BY_SLUG[category.slug] ?? Home;
          return (
            <Link
              key={category.id}
              href={`/search?categoryId=${category.id}`}
              className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-5 text-center shadow-xs transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                <Icon className="h-6 w-6" aria-hidden />
              </span>
              <span className="text-sm font-medium text-foreground">{category.name}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
