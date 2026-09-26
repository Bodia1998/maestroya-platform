import { getTranslations } from "next-intl/server";

import { reactivateUserFormAction, suspendUserFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminUsersUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
import { AdminDataTable, AdminTableHeadRow, AdminTh, AdminTableBody, AdminTableRow } from "@/components/dashboard/admin-data-table";
import { AdminFilterForm } from "@/components/dashboard/admin-filter-form";
import { AdminRowActionButton } from "@/components/dashboard/admin-row-action-button";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { EmptyState } from "@/components/ui/empty-state";
import { SearchInput } from "@/components/ui/search-input";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("usersPage.title") }) };
}

type SearchParams = Promise<{ page?: string; search?: string }>;

/**
 * Admin Panel module (Module 16): user management — list, search, paginate,
 * view role/professional-profile status, suspend/reactivate. Role change is
 * intentionally not exposed here as a one-click UI action (it's still fully
 * available as `changeUserRoleAction` for a future richer UI/CLI) to keep
 * this first pass minimal — see docs/MODULE_16_ADMIN_PANEL.md "Deferred
 * Functionality".
 */
export default async function AdminUsersPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const search = params.search?.trim() || undefined;
  const offset = (page - 1) * DEFAULT_PAGE_SIZE;

  const users = await makeListAdminUsersUseCase().execute({ limit: DEFAULT_PAGE_SIZE, offset, search });
  const t = await getTranslations("admin");
  const srOnly = (chunks: React.ReactNode) => <span className="sr-only">{chunks}</span>;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t("usersPage.title")}
        subtitle={t("usersPage.subtitle", { count: users.length })}
      />

      <AdminFilterForm aria-label={t("usersPage.searchLabel")}>
        <SearchInput
          name="search"
          defaultValue={search}
          placeholder={t("usersPage.searchPlaceholder")}
          aria-label={t("usersPage.searchPlaceholder")}
          className="flex-1 min-w-[200px]"
        />
      </AdminFilterForm>

      {users.length === 0 ? (
        <EmptyState title={t("usersPage.empty")} description={t("common.tryDifferentSearch")} />
      ) : (
        <AdminDataTable caption={t("usersPage.title")} minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>{t("common.columns.name")}</AdminTh>
            <AdminTh>{t("common.columns.email")}</AdminTh>
            <AdminTh>{t("common.columns.status")}</AdminTh>
            <AdminTh>{t("usersPage.columns.roles")}</AdminTh>
            <AdminTh>{t("usersPage.columns.isPro")}</AdminTh>
            <AdminTh>{t("common.columns.actions")}</AdminTh>
          </AdminTableHeadRow>
          <AdminTableBody>
            {users.map((user) => (
              <AdminTableRow key={user.id}>
                <td className="px-4 py-3">{user.name ?? "—"}</td>
                <td className="px-4 py-3">{user.email ?? "—"}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={user.status} />
                </td>
                <td className="px-4 py-3">{user.roles.join(", ") || "—"}</td>
                <td className="px-4 py-3">{user.hasProfessionalProfile ? t("common.yes") : t("common.no")}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {user.status === "ACTIVE" && (
                      <form action={suspendUserFormAction.bind(null, user.id)}>
                        <AdminRowActionButton>
                          {t.rich("usersPage.suspend", { name: user.name ?? user.email ?? "", sr: srOnly })}
                        </AdminRowActionButton>
                      </form>
                    )}
                    {(user.status === "SUSPENDED" || user.status === "DEACTIVATED") && (
                      <form action={reactivateUserFormAction.bind(null, user.id)}>
                        <AdminRowActionButton>
                          {t.rich("usersPage.reactivate", { name: user.name ?? user.email ?? "", sr: srOnly })}

                        </AdminRowActionButton>
                      </form>
                    )}
                  </div>
                </td>
              </AdminTableRow>
            ))}
          </AdminTableBody>
        </AdminDataTable>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={users.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/users?page=${p}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
      />
    </div>
  );
}
