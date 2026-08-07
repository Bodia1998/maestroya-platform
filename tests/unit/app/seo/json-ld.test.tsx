import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JsonLd } from "@/components/seo/json-ld";

describe("JsonLd", () => {
  it("renders an application/ld+json script tag containing the serialized data", () => {
    const { container } = render(
      <JsonLd data={{ "@context": "https://schema.org", "@type": "Organization", name: "MaestroYa" }} />,
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    expect(JSON.parse(script!.innerHTML)).toEqual({
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "MaestroYa",
    });
  });

  it("escapes a literal </script> substring so it cannot break out of the tag", () => {
    const { container } = render(
      <JsonLd data={{ "@type": "Thing", description: "</script><script>alert(1)</script>" }} />,
    );

    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script!.innerHTML).not.toContain("</script><script>");
    expect(JSON.parse(script!.innerHTML).description).toBe("</script><script>alert(1)</script>");
  });
});
