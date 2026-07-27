"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MapPin, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export interface HeroSearchProps {
  categories: Array<{ id: string; name: string; slug: string }>;
}

/**
 * The homepage's primary conversion widget. Submits to the existing
 * `/search` route with the same query params it already reads
 * (`categoryId`, `city`) — see `(marketing)/search/page.tsx`'s
 * `searchDirectorySchema` parsing. No new search logic: this is a thin
 * client form that builds a URL and navigates, exactly like
 * `DirectorySearchForm` already does on `/search` itself.
 */
export function HeroSearch({ categories }: HeroSearchProps) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("");
  const [city, setCity] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (categoryId) params.set("categoryId", categoryId);
    if (city.trim()) params.set("city", city.trim());
    router.push(`/search${params.toString() ? `?${params.toString()}` : ""}`);
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex w-full flex-col gap-3 rounded-2xl border border-border bg-card p-3 shadow-lg sm:flex-row sm:items-center sm:rounded-full sm:p-2"
    >
      <div className="flex flex-1 items-center gap-2 rounded-xl px-2 sm:pl-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Select
          aria-label="¿Qué servicio necesitas?"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          className="h-11 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        >
          <option value="">¿Qué servicio necesitas?</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      </div>

      <div className="hidden h-8 w-px bg-border sm:block" aria-hidden />

      <div className="flex flex-1 items-center gap-2 rounded-xl px-2 sm:pl-2">
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <Input
          aria-label="¿Dónde lo necesitas?"
          placeholder="Ciudad o código postal"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="h-11 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
        />
      </div>

      <Button type="submit" size="lg" className="w-full rounded-full sm:w-auto">
        <Search className="h-4 w-4" aria-hidden />
        Buscar profesionales
      </Button>
    </form>
  );
}

/** Static secondary CTA shown next to the search widget on larger screens. */
export function RequestServiceCta() {
  return (
    <ButtonLink href="/requests/new" variant="outline" size="lg" className="rounded-full">
      Publicar una solicitud
    </ButtonLink>
  );
}
