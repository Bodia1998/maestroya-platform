import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { setTestLocale } from "../../test-utils/intl";

/**
 * Module 120 — Multilingual Localization: the public marketing site and
 * auth screens render from the catalog in the active locale.
 */
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("next-auth/react", () => ({ signIn: vi.fn() }));
vi.mock("@/application/use-cases/geolocation/compose", () => ({
  makeReverseGeocodeUseCase: () => ({ execute: vi.fn() }),
  makeGeocodeCityUseCase: vi.fn(),
}));

describe("marketing & auth localization", () => {
  it("renders the how-it-works section in Russian", async () => {
    setTestLocale("ru");
    const { HowItWorks } = await import("@/app/(marketing)/_sections/how-it-works");
    render(<HowItWorks />);
    expect(screen.getByRole("heading", { level: 2, name: "Как это работает" })).toBeTruthy();
    expect(screen.getByText("Получите сметы")).toBeTruthy();
  });

  it("renders the login form in Dutch", async () => {
    setTestLocale("nl");
    const { LoginForm } = await import("@/app/auth/login/login-form");
    render(<LoginForm />);
    expect(screen.getByLabelText("Wachtwoord")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Doorgaan met Google" })).toBeTruthy();
    expect(screen.getByText("Onthoud mij")).toBeTruthy();
  });

  it("localizes search ranking reasons and falls back to unknown ones verbatim", async () => {
    setTestLocale("ru");
    const { DirectorySearchResultsList } = await import("@/app/(marketing)/search/results-list");
    render(
      <DirectorySearchResultsList
        results={[
          {
            kind: "COMPANY",
            id: "c1",
            displayName: "Fontaneros Madrid SL",
            city: null,
            province: null,
            averageRating: 4.5,
            reviewCount: 3,
            teamSize: 5,
            rankingReasons: ["Verified professional", "Highly rated (4.5/5 from 3 reviews)", "Some future reason"],
          } as never,
        ]}
      />,
    );
    expect(screen.getByText("Проверенный специалист")).toBeTruthy();
    expect(screen.getByText("Высокий рейтинг (4,5/5, 3 отзыва)")).toBeTruthy();
    expect(screen.getByText("Some future reason")).toBeTruthy();
    expect(screen.getByText("Местоположение не указано", { exact: false })).toBeTruthy();
  });

  it("returns reverse-geocode action errors in the active locale", async () => {
    setTestLocale("nl");
    const { reverseGeocodeAction } = await import("@/app/(marketing)/search/actions");
    const result = await reverseGeocodeAction({ latitude: 999, longitude: 0 });
    expect(result).toEqual({ success: false, error: "Deze locatie lijkt ongeldig." });
  });
});
