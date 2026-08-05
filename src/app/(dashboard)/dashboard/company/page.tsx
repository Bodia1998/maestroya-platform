import { Building2 } from "lucide-react";

import { createCompanyFormAction } from "@/app/(dashboard)/dashboard/company/actions";
import { makeListMyCompaniesUseCase } from "@/application/use-cases/company/compose";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { CompanyCard } from "@/components/dashboard/cards/company-card";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

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
      <PageHeader
        title="My companies"
        subtitle="Operate as a company/team with multiple professionals, alongside any individual professional profile you have."
      />

      {companies.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No companies yet"
          description="You are not a member of any company yet. Create one below to start operating as a team."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {companies.map((company) => (
            <li key={company.id}>
              <CompanyCard
                href={`/dashboard/company/${company.id}/profile`}
                name={company.tradeName ?? company.legalName}
                status={company.status}
              />
            </li>
          ))}
        </ul>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Create a company</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createCompanyFormAction} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="legalName">Legal name (required)</Label>
              <Input id="legalName" name="legalName" required minLength={2} maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tradeName">Trade / display name</Label>
              <Input id="tradeName" name="tradeName" maxLength={200} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="taxId">Tax ID (required)</Label>
              <Input id="taxId" name="taxId" required maxLength={50} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" rows={3} maxLength={5000} />
            </div>
            <Button type="submit" className="w-fit">
              Create company
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
