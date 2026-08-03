import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/shared/i18n-provider";
import { LanguageSwitcher } from "@/components/shared/language-switcher";
import { getMessages } from "@/infrastructure/i18n/message-loader";
import { LOCALE_STORAGE_KEY, type Locale } from "@/shared/i18n/locales";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function renderSwitcher(locale: Locale, isAuthenticated: boolean, variant?: "dropdown" | "list") {
  return render(
    <I18nProvider locale={locale} messages={getMessages(locale)} isAuthenticated={isAuthenticated}>
      <LanguageSwitcher variant={variant} />
    </I18nProvider>,
  );
}

const fetchMock = vi.fn();

beforeEach(() => {
  refresh.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("rendering", () => {
  it("shows the active language and every shipped option in its own name", () => {
    renderSwitcher("es", false, "list");

    expect(screen.getByRole("menuitemradio", { name: /Español/ })).toHaveProperty(
      "ariaChecked",
      "true",
    );
    expect(screen.getByText("Українська")).toBeTruthy();
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(10);
  });

  it("renders its own labels in the active language", () => {
    const { unmount } = renderSwitcher("en", false, "list");
    expect(screen.getByRole("menu", { name: "Language" })).toBeTruthy();
    unmount();

    renderSwitcher("de", false, "list");
    expect(screen.getByRole("menu", { name: "Sprache" })).toBeTruthy();
  });

  it("opens and closes the dropdown variant", () => {
    renderSwitcher("es", false);
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Idioma" }));
    expect(screen.getByRole("menu")).toBeTruthy();
  });
});

describe("switching as a guest", () => {
  it("persists to localStorage and the mirror cookie, and refreshes without a reload", async () => {
    renderSwitcher("es", false, "list");

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Polski/ }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("pl");
    expect(document.cookie).toContain("NEXT_LOCALE=pl");
    // A guest's language is never written to the account.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flips the checked option immediately, before the refresh lands", async () => {
    renderSwitcher("es", false, "list");

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Italiano/ }));

    await waitFor(() =>
      expect(screen.getByRole("menuitemradio", { name: /Italiano/ })).toHaveProperty(
        "ariaChecked",
        "true",
      ),
    );
  });

  it("ignores a click on the language already active", () => {
    renderSwitcher("es", false, "list");
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Español/ }));
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("switching while signed in", () => {
  it("writes the account preference through the API and still refreshes", async () => {
    renderSwitcher("es", true, "list");

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Українська/ }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/user/language");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ locale: "uk" });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    // The cookie is written regardless, so the UI is correct even if the
    // account write is what fails.
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("uk");
  });

  it("surfaces a failed account write without reverting the UI", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderSwitcher("en", true, "list");

    fireEvent.click(screen.getByRole("menuitemradio", { name: /Français/ }));

    await waitFor(() => expect(screen.getByText("We couldn't save your language.")).toBeTruthy());
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("fr");
  });
});
