import Link from "next/link";
import { notFound } from "next/navigation";

import { updateCompanyFormAction } from "@/app/(dashboard)/dashboard/company/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";

export const metadata = { title: "Company profile" };

const NAV = (companyId: string) => [
  { href: `/dashboard/company/${companyId}/profile`, label: "Profile" },
  { href: `/dashboard/company/${companyId}/members`, label: "Members" },
  { href: `/dashboard/company/${companyId}/invitations`, label: "Invitations" },
  { href: `/dashboard/company/${companyId}/verification`, label: "Verification" },
];

/** Module 18 — Company Professional: company profile view/edit. Any active
 *  member can view; the update form is still gated server-side by
 *  UpdateCompanyUseCase (OWNER/ADMIN only) regardless of what this page
 *  renders — the page itself doesn't hide the form from MANAGER/MEMBER
 *  callers, since the Server Action would reject them anyway (defense in
 *  depth over UI-only hiding). */
export default async function CompanyProfilePage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const user = await requireAuth();

  let company;
  try {
    company = await makeGetCompanyForMemberUseCase().execute(user.id, companyId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-4 border-b border-border pb-2 text-sm">
        {NAV(companyId).map((item) => (
          <Link key={item.href} href={item.href} className="hover:underline">
            {item.label}
          </Link>
        ))}
      </nav>

      <div>
        <h1 className="text-2xl font-semibold">{company.tradeName ?? company.legalName}</h1>
        <p className="mt-1 text-sm text-foreground/70">
          Status: {company.status} · {company.isVerified ? "Verified" : "Not verified"}
        </p>
      </div>

      <form action={updateCompanyFormAction.bind(null, companyId)} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">Legal name</span>
          <input name="legalName" defaultValue={company.legalName} maxLength={200} className="rounded-md border border-border p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">Trade / display name</span>
          <input name="tradeName" defaultValue={company.tradeName ?? ""} maxLength={200} className="rounded-md border border-border p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">Description</span>
          <textarea name="description" defaultValue={company.description ?? ""} rows={4} maxLength={5000} className="rounded-md border border-border p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">Website</span>
          <input name="websiteUrl" defaultValue={company.websiteUrl ?? ""} className="rounded-md border border-border p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">Contact email</span>
          <input name="contactEmail" defaultValue={company.contactEmail ?? ""} className="rounded-md border border-border p-2 text-sm" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">Contact phone</span>
          <input name="contactPhone" defaultValue={company.contactPhone ?? ""} className="rounded-md border border-border p-2 text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">City</span>
            <input name="city" defaultValue={company.city ?? ""} className="rounded-md border border-border p-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-foreground/70">Province</span>
            <input name="province" defaultValue={company.province ?? ""} className="rounded-md border border-border p-2 text-sm" />
          </label>
        </div>
        <button type="submit" className="h-10 w-fit rounded-md bg-black px-4 text-sm font-medium text-white">
          Save changes
        </button>
      </form>
    </div>
  );
}
