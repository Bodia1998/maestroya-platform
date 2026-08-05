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

export const metadata = { title: "Admin — Users" };

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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        subtitle={`${users.length} user${users.length === 1 ? "" : "s"} on this page.`}
      />

      <AdminFilterForm aria-label="Search users">
        <SearchInput
          name="search"
          defaultValue={search}
          placeholder="Search by name or email"
          aria-label="Search by name or email"
          className="flex-1 min-w-[200px]"
        />
      </AdminFilterForm>

      {users.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search term." />
      ) : (
        <AdminDataTable caption="Users" minWidth={640}>
          <AdminTableHeadRow>
            <AdminTh>Name</AdminTh>
            <AdminTh>Email</AdminTh>
            <AdminTh>Status</AdminTh>
            <AdminTh>Roles</AdminTh>
            <AdminTh>Pro?</AdminTh>
            <AdminTh>Actions</AdminTh>
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
                <td className="px-4 py-3">{user.hasProfessionalProfile ? "Yes" : "No"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    {user.status === "ACTIVE" && (
                      <form action={suspendUserFormAction.bind(null, user.id)}>
                        <AdminRowActionButton>
                          Suspend<span className="sr-only"> user {user.name ?? user.email ?? ""}</span>
                        </AdminRowActionButton>
                      </form>
                    )}
                    {(user.status === "SUSPENDED" || user.status === "DEACTIVATED") && (
                      <form action={reactivateUserFormAction.bind(null, user.id)}>
                        <AdminRowActionButton>
                          Reactivate<span className="sr-only"> user {user.name ?? user.email ?? ""}</span>
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
