import "server-only";

import { getTranslations } from "next-intl/server";

import { prisma } from "@/infrastructure/database/prisma/client";
import { localizeCategoryName } from "@/presentation/i18n/service-categories";

/**
 * Module 120 — Multilingual Localization: localised service-category names
 * for the professional area's read models, which only carry the stored
 * (Spanish) `categoryName` and/or `categoryId`, not the `slug` the
 * `services.categories.<slug>` catalog is keyed by.
 *
 * Categories are static reference data (a handful of rows), read directly
 * here — same convention as the page-level category-picker reads — so no
 * application-layer read model had to change. Unknown ids/names fall back
 * to the stored value, exactly like `localizeCategoryName`.
 */
export async function getCategoryNameLocalizer(): Promise<{
  byId: (id: string, fallback: string) => string;
  byName: (name: string) => string;
}> {
  const [t, rows] = await Promise.all([
    getTranslations("services"),
    prisma.serviceCategory.findMany({ select: { id: true, name: true, slug: true } }),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byName = new Map(rows.map((row) => [row.name, row]));
  return {
    byId: (id, fallback) => {
      const category = byId.get(id);
      return category ? localizeCategoryName(t, category) : fallback;
    },
    byName: (name) => {
      const category = byName.get(name);
      return category ? localizeCategoryName(t, category) : name;
    },
  };
}

/** Active categories for the category pickers, with localised names. */
export async function getLocalizedActiveCategories(): Promise<{ id: string; name: string }[]> {
  const [t, rows] = await Promise.all([
    getTranslations("services"),
    prisma.serviceCategory.findMany({
      where: { status: "ACTIVE", deletedAt: null },
      select: { id: true, name: true, slug: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);
  return rows.map((row) => ({ id: row.id, name: localizeCategoryName(t, row) }));
}
