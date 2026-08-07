import { describe, expect, it } from "vitest";

import {
  buildBreadcrumbJsonLd,
  buildLocalBusinessJsonLd,
  buildOrganizationJsonLd,
  buildProfessionalServiceJsonLd,
  buildWebSiteJsonLd,
} from "@/shared/seo/structured-data";

describe("buildOrganizationJsonLd", () => {
  it("returns a schema.org Organization", () => {
    const jsonLd = buildOrganizationJsonLd();
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd.name).toBe("MaestroYa");
    expect(typeof jsonLd.url).toBe("string");
  });
});

describe("buildWebSiteJsonLd", () => {
  it("includes a SearchAction targeting /search", () => {
    const jsonLd = buildWebSiteJsonLd();
    expect(jsonLd["@type"]).toBe("WebSite");
    expect(jsonLd.potentialAction["@type"]).toBe("SearchAction");
    expect(jsonLd.potentialAction.target.urlTemplate).toContain("/search?q={search_term_string}");
    expect(jsonLd.potentialAction["query-input"]).toBe("required name=search_term_string");
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("numbers items starting at 1, in the given order", () => {
    const jsonLd = buildBreadcrumbJsonLd([
      { name: "Inicio", path: "/" },
      { name: "Profesionales", path: "/professionals" },
      { name: "Juan Pérez", path: "/professionals/abc" },
    ]);

    expect(jsonLd["@type"]).toBe("BreadcrumbList");
    expect(jsonLd.itemListElement).toHaveLength(3);
    expect(jsonLd.itemListElement[0]).toMatchObject({ position: 1, name: "Inicio" });
    expect(jsonLd.itemListElement[2]).toMatchObject({ position: 3, name: "Juan Pérez" });
    expect(jsonLd.itemListElement[2].item).toContain("/professionals/abc");
  });
});

describe("buildProfessionalServiceJsonLd", () => {
  const base = {
    id: "prof-1",
    name: "Juan Pérez",
    description: "Fontanero con 10 años de experiencia",
    image: "https://res.cloudinary.com/x/y.jpg",
    city: "Madrid",
    province: "Madrid",
    averageRating: 4.8,
    reviewCount: 12,
    path: "/professionals/prof-1",
  };

  it("emits a ProfessionalService with address and aggregateRating", () => {
    const jsonLd = buildProfessionalServiceJsonLd(base);
    expect(jsonLd["@type"]).toBe("ProfessionalService");
    expect(jsonLd.name).toBe("Juan Pérez");
    expect(jsonLd.address).toMatchObject({
      "@type": "PostalAddress",
      addressLocality: "Madrid",
      addressRegion: "Madrid",
      addressCountry: "ES",
    });
    expect(jsonLd.aggregateRating).toMatchObject({
      "@type": "AggregateRating",
      ratingValue: 4.8,
      reviewCount: 12,
    });
  });

  it("omits aggregateRating when there is no rating yet", () => {
    const jsonLd = buildProfessionalServiceJsonLd({ ...base, averageRating: null, reviewCount: 0 });
    expect(jsonLd.aggregateRating).toBeUndefined();
  });

  it("omits aggregateRating when averageRating is set but reviewCount is zero", () => {
    const jsonLd = buildProfessionalServiceJsonLd({ ...base, reviewCount: 0 });
    expect(jsonLd.aggregateRating).toBeUndefined();
  });

  it("omits address when there is no city or province", () => {
    const jsonLd = buildProfessionalServiceJsonLd({ ...base, city: null, province: null });
    expect(jsonLd.address).toBeUndefined();
  });

  it("never includes exact coordinates or a street address", () => {
    const jsonLd = buildProfessionalServiceJsonLd(base);
    expect(JSON.stringify(jsonLd)).not.toMatch(/latitude|longitude|streetAddress/i);
  });
});

describe("buildLocalBusinessJsonLd", () => {
  it("emits a LocalBusiness (not ProfessionalService) for a company", () => {
    const jsonLd = buildLocalBusinessJsonLd({
      id: "company-1",
      name: "Fontaneros Madrid SL",
      description: "Empresa de fontanería",
      image: null,
      city: "Madrid",
      province: null,
      averageRating: null,
      reviewCount: 0,
      path: "/companies/company-1",
    });

    expect(jsonLd["@type"]).toBe("LocalBusiness");
    expect(jsonLd.address).toMatchObject({ addressLocality: "Madrid", addressCountry: "ES" });
    expect(jsonLd.image).toBeUndefined();
  });
});
