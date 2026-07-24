import Link from "next/link";

import { createCompanyFormAction } from "@/app/(dashboard)/dashboard/company/actions";
import { makeListMyCompaniesUseCase } from "@/application/use-cases/company/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";

export const metadata = { title: "My companies" };

/**
 * Module 18 — Company Professional: company context selector (Section 17
 * of the module brief) — URL-based company context. A user may belong to
 * more than one company; this lists every one they're an active member of
 * and lets them create a new one. Company-scoped pages then live under
 * `/dashboard/company/[companyId]/...`, with every server-side action
 * re-deriving the caller's membership/role from the session — never
 * trusting `companyId` alone for authorization.
 */
export default async function CompanyIndexPage() {
  const user = await requireAuth();
  const companies = await makeListMyCompaniesUseCase().execute(user.id);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">My companies</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Operate as a company/team with multiple professionals, alongside any individual professional profile you have.
        </p>
      </div>

      {companies.length === 0 ? (
        <p className="rounded-md border border-dashed border-border p-6 text-center text-sm text-foreground/70">
          You are not a member of any company yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {companies.map((company) => (
            <li key={company.id} className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
              <div>
                <p className="font-medium">{company.tradeName ?? company.legalName}</p>
                <p className="text-foreground/60">Status: {company.status}</p>
              </div>
              <Link href={`/dashboard/company/${company.id}/profile`} className="underline">
                Manage
              </Link>
            </li>
          ))}
        </ul>
      )}

      <section className="rounded-md border border-border p-4">
        <h2 className="text-lg font-medium">Create a company</h2>
        <form action={createCompanyFormAction} className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Legal name (required)</span>
            <input name="legalName" required minLength={2} maxLength={200} className="rounded-md border border-border p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Trade / display name</span>
            <input name="tradeName" maxLength={200} className="rounded-md border border-border p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Tax ID (required)</span>
            <input name="taxId" required maxLength={50} className="rounded-md border border-border p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Description</span>
            <textarea name="description" rows={3} maxLength={5000} className="rounded-md border border-border p-2 text-sm" />
          </label>
          <button type="submit" className="h-10 w-fit rounded-md bg-black px-4 text-sm font-medium text-white">
            Create company
          </button>
        </form>
      </section>
    </div>
  );
}
