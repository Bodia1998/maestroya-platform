import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { setTestLocale } from "../../test-utils/intl";

/**
 * Module 120 — Multilingual Localization: the admin panel is localized into
 * Spanish and English only. These tests render admin UI with the Spanish
 * catalog active to prove the strings come from `admin.*`, not from code.
 */

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/users" }));

const mockExecute = vi.fn();
vi.mock("@/application/use-cases/admin/compose", () => ({
  makeGetAdminDashboardOverviewUseCase: () => ({ execute: mockExecute }),
}));

const { AdminTablePager } = await import("@/components/dashboard/admin-table-pager");
const { SeverityBadge, RunStatusBadge } = await import("@/app/(dashboard)/admin/reconciliation/_components/badges");
const { AdminNav } = await import("../../../src/app/(dashboard)/admin/admin-nav");
const AdminOverviewPage = (await import("../../../src/app/(dashboard)/admin/page")).default;

describe("admin panel in Spanish", () => {
  it("renders the table pager in Spanish", () => {
    setTestLocale("es");
    render(<AdminTablePager page={2} hasNextPage buildHref={(p) => `/admin/users?page=${p}`} />);
    expect(screen.getByRole("navigation", { name: "Paginación" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Anterior/ })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Siguiente/ })).toBeTruthy();
    expect(screen.getByText("Página 2")).toBeTruthy();
  });

  it("renders reconciliation badges in Spanish", () => {
    setTestLocale("es");
    render(
      <>
        <SeverityBadge severity="CRITICAL" />
        <RunStatusBadge status="FAILED" />
      </>,
    );
    expect(screen.getByText("Crítica")).toBeTruthy();
    expect(screen.getByText("Fallida")).toBeTruthy();
  });

  it("renders the admin nav landmark in Spanish", () => {
    setTestLocale("es");
    render(<AdminNav items={[{ href: "/admin/users", label: "Usuarios" }]} />);
    expect(screen.getByRole("navigation", { name: "Navegación de administración" })).toBeTruthy();
  });

  it("renders the overview page (Server Component) in Spanish", async () => {
    setTestLocale("es");
    mockExecute.mockResolvedValue({ totalUsers: 12 });
    render(await AdminOverviewPage());
    expect(screen.getByText("Resumen de administración")).toBeTruthy();
    expect(screen.getByText("Actividad del marketplace")).toBeTruthy();
    expect(screen.getByText("Usuarios totales")).toBeTruthy();
  });

  it("keeps English as the default test locale", async () => {
    mockExecute.mockResolvedValue({ totalUsers: 12 });
    render(await AdminOverviewPage());
    expect(screen.getByText("Admin overview")).toBeTruthy();
    expect(screen.getByText("Total users")).toBeTruthy();
  });
});
