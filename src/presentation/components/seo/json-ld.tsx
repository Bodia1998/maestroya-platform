import type { JsonLdObject } from "@/shared/seo/structured-data";

/**
 * Module 43 — SEO Infrastructure: renders one JSON-LD `<script>` tag for
 * a structured-data object built by `shared/seo/structured-data.ts`.
 *
 * `JSON.stringify` output is safe to inline here without HTML-escaping:
 * unlike a `<script>` containing JS, a `application/ld+json` payload is
 * never executed, and the one realistic injection vector (a `</script>`
 * substring inside a user-supplied string field, e.g. a professional's
 * bio) is neutralized by escaping `<` — the only character that can break
 * out of the tag — which is exactly what the replace below does.
 */
export function JsonLd({ data }: { data: JsonLdObject }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");

  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
