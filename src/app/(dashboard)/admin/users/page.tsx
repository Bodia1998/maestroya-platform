import { reactivateUserFormAction, suspendUserFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminUsersUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";
import { PageHeader } from "@/components/dashboard/page-header";
import { AdminTablePager } from "@/components/dashboard/admin-table-pager";
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

      <form method="get" className="flex gap-2">
        <SearchInput name="search" defaultValue={search} placeholder="Search by name or email" className="flex-1" />
        <button type="submit" className="h-10 shrink-0 rounded-md border border-border px-4 text-sm font-medium transition-colors hover:bg-muted">
          Search
        </button>
      </form>

      {users.length === 0 ? (
        <EmptyState title="No users found" description="Try a different search term." />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3">Pro?</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {users.map((user) => (
                <tr key={user.id} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">{user.name ?? "—"}</td>
                  <td className="px-4 py-3">{user.email ?? "—"}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={user.status} />
                  </td>
                  <td className="px-4 py-3">{user.roles.join(", ") || "—"}</td>
                  <td className="px-4 py-3">{user.hasProfessionalProfile ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {user.status === "ACTIVE" && (
                        <form action={suspendUserFormAction.bind(null, user.id)}>
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted">
                            Suspend
                          </button>
                        </form>
                      )}
                      {(user.status === "SUSPENDED" || user.status === "DEACTIVATED") && (
                        <form action={reactivateUserFormAction.bind(null, user.id)}>
                          <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-muted">
                            Reactivate
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AdminTablePager
        page={page}
        hasNextPage={users.length === DEFAULT_PAGE_SIZE}
        buildHref={(p) => `/admin/users?page=${p}${search ? `&search=${encodeURIComponent(search)}` : ""}`}
      />
    </div>
  );
}
