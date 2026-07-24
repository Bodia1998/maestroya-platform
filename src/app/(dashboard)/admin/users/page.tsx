import Link from "next/link";

import { reactivateUserFormAction, suspendUserFormAction } from "@/app/(dashboard)/admin/actions";
import { makeListAdminUsersUseCase } from "@/application/use-cases/admin/compose";
import { DEFAULT_PAGE_SIZE } from "@/domain/services/admin-rules";

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
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="mt-1 text-sm text-foreground/70">
          {users.length} user{users.length === 1 ? "" : "s"} on this page.
        </p>
      </div>

      <form method="get" className="flex gap-2">
        <input
          type="text"
          name="search"
          defaultValue={search}
          placeholder="Search by name or email"
          className="h-10 flex-1 rounded-md border border-border px-3 text-sm"
        />
        <button type="submit" className="h-10 rounded-md border border-border px-4 text-sm">
          Search
        </button>
      </form>

      {users.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          No users found.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground/70">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Roles</th>
              <th className="py-2 pr-4">Pro?</th>
              <th className="py-2 pr-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-border/50">
                <td className="py-2 pr-4">{user.name ?? "—"}</td>
                <td className="py-2 pr-4">{user.email ?? "—"}</td>
                <td className="py-2 pr-4">{user.status}</td>
                <td className="py-2 pr-4">{user.roles.join(", ") || "—"}</td>
                <td className="py-2 pr-4">{user.hasProfessionalProfile ? "Yes" : "No"}</td>
                <td className="py-2 pr-4">
                  <div className="flex gap-2">
                    {user.status === "ACTIVE" && (
                      <form action={suspendUserFormAction.bind(null, user.id)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
                          Suspend
                        </button>
                      </form>
                    )}
                    {(user.status === "SUSPENDED" || user.status === "DEACTIVATED") && (
                      <form action={reactivateUserFormAction.bind(null, user.id)}>
                        <button type="submit" className="rounded-md border border-border px-2 py-1 text-xs">
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
      )}

      <div className="flex justify-between text-sm">
        {page > 1 ? (
          <Link href={`/admin/users?page=${page - 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}>
            ← Previous
          </Link>
        ) : (
          <span />
        )}
        {users.length === DEFAULT_PAGE_SIZE && (
          <Link href={`/admin/users?page=${page + 1}${search ? `&search=${encodeURIComponent(search)}` : ""}`}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
