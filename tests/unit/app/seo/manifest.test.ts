import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

describe("manifest()", () => {
  it("declares the site name, standalone display, and both generated icons", () => {
    const result = manifest();

    expect(result.name).toBe("MaestroYa");
    expect(result.display).toBe("standalone");
    expect(result.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon" }),
        expect.objectContaining({ src: "/apple-icon" }),
      ]),
    );
  });
});
