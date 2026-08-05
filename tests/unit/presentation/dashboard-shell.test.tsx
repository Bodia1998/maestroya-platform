import "@testing-library/jest-dom/vitest";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "@/components/shared/i18n-provider";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { getMessages } from "@/infrastructure/i18n/message-loader";
import { buildDashboardNavGroups } from "@/shared/utils/build-dashboard-nav-groups";

/**
 * Full-render coverage for `DashboardShell` (Module 30.2 — Navigation &
 * Layout). `dashboard-shell-context.test.ts` already locks down
 * `resolveVisibleNavGroups`'s context-switching logic in isolation; this
 * file covers the shell that actually renders around it — sidebar, header,
 * mobile drawer, skip link — as an authenticated user would see it.
 */

const mockUsePathname = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useRouter: () => ({ refresh: mockRefresh }),
}));

// `DashboardShell`'s sign-out button posts to this Server Action. Mocked so
// the test doesn't have to pull in the real `next-auth` signOut() chain —
// this file is only asserting that the shell renders and wires up the
// action, not exercising the auth flow itself.
vi.mock("@/app/auth/logout/actions", () => ({
  logoutAction: vi.fn(),
}));

function renderShell(pathname: string, children: React.ReactNode = <p>Page content</p>) {
  mockUsePathname.mockReturnValue(pathname);
  const navGroups = buildDashboardNavGroups({ isProfessional: true, isAdmin: false });

  return render(
    <I18nProvider locale="en" messages={getMessages("en")} isAuthenticated={false}>
      <DashboardShell navGroups={navGroups} userEmail="pro@example.com">
        {children}
      </DashboardShell>
    </I18nProvider>,
  );
}

beforeEach(() => {
  mockUsePathname.mockReset();
  mockRefresh.mockReset();
});

describe("DashboardShell", () => {
  it("renders the desktop sidebar navigation landmark", () => {
    renderShell("/dashboard");
    expect(screen.getByRole("complementary", { name: "Sidebar" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Dashboard navigation" })).toBeTruthy();
  });

  it("renders the header with a notifications control and account menu", () => {
    renderShell("/dashboard");
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();
  });

  it("renders the language switcher in the header", () => {
    renderShell("/dashboard");
    expect(screen.getByRole("button", { name: "Language" })).toBeTruthy();
  });

  it("renders the page content inside the main landmark", () => {
    renderShell("/dashboard", <p>Unique page marker</p>);
    const main = screen.getByRole("main");
    expect(within(main).getByText("Unique page marker")).toBeTruthy();
  });

  it("exposes a skip-to-content link targeting #main-content", () => {
    renderShell("/dashboard");
    const skipLink = screen.getByText("Skip to main content");
    expect(skipLink.getAttribute("href")).toBe("#main-content");
    expect(screen.getByRole("main").id).toBe("main-content");
  });

  it("renders a banner above the content when provided", () => {
    mockUsePathname.mockReturnValue("/dashboard");
    const navGroups = buildDashboardNavGroups({ isProfessional: false, isAdmin: false });
    render(
      <I18nProvider locale="en" messages={getMessages("en")} isAuthenticated={false}>
        <DashboardShell navGroups={navGroups} userEmail={null} banner={<p>Complete your profile</p>}>
          <p>Content</p>
        </DashboardShell>
      </I18nProvider>,
    );
    expect(screen.getByText("Complete your profile")).toBeTruthy();
  });

  it("opens the user account menu on click, showing the Profile link and a sign-out control", () => {
    renderShell("/dashboard");

    fireEvent.click(screen.getByRole("button", { name: "Account menu" }));

    expect(screen.getByRole("menuitem", { name: /Profile/ })).toHaveAttribute("href", "/profile");
    expect(screen.getByRole("button", { name: /Sign out/ })).toBeTruthy();
  });

  it("does not render the mobile drawer nav until the mobile menu button is clicked", () => {
    renderShell("/dashboard");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the mobile drawer with the same nav groups when 'Open menu' is clicked", () => {
    renderShell("/dashboard");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeTruthy();
    // Two "Dashboard navigation" landmarks now exist: the always-mounted
    // desktop sidebar's, and the drawer's.
    expect(screen.getAllByRole("navigation", { name: "Dashboard navigation" })).toHaveLength(2);
    expect(within(dialog).getAllByRole("link", { name: /Professional dashboard|Companies/ }).length).toBeGreaterThan(0);
  });

  it("closes the mobile drawer via its close button", () => {
    renderShell("/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /cerrar/i }));

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the mobile drawer when a nav link inside it is clicked", () => {
    renderShell("/dashboard");
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const dialog = screen.getByRole("dialog");

    const link = within(dialog).getAllByRole("link")[0]!;
    fireEvent.click(link);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows only the Professional nav group while on a /dashboard/professional/* route, for a dual-role account", () => {
    renderShell("/dashboard/professional/requests");

    expect(screen.getByRole("link", { name: /Available requests/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /^Service requests$/ })).toBeNull();
  });
});
