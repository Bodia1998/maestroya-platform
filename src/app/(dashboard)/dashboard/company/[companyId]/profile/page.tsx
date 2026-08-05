import { notFound } from "next/navigation";

import { updateCompanyFormAction } from "@/app/(dashboard)/dashboard/company/actions";
import { makeGetCompanyForMemberUseCase } from "@/application/use-cases/company/compose";
import { NotFoundError } from "@/domain/errors/domain-error";
import { requireAuth } from "@/infrastructure/auth/rbac";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormActions } from "@/components/forms/form-actions";
import { FormSection } from "@/components/forms/form-section";
import { OptionalBadge } from "@/components/forms/field-badges";
import { CompanyTabNav } from "../company-tab-nav";

export const metadata = { title: "Company profile" };

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
    <PageContainer gap="sm">
      <CompanyTabNav companyId={companyId} active="profile" />

      <PageHeader
        title={company.tradeName ?? company.legalName}
        subtitle={`Status: ${company.status} · ${company.isVerified ? "Verified" : "Not verified"}`}
        breadcrumbs={[
          { label: "My companies", href: "/dashboard/company" },
          { label: company.tradeName ?? company.legalName },
        ]}
      />

      <form action={updateCompanyFormAction.bind(null, companyId)} className="flex flex-col gap-8">
        <FormSection title="Company details">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="legalName">Legal name</Label>
            <Input id="legalName" name="legalName" defaultValue={company.legalName} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tradeName">
              Trade / display name <OptionalBadge />
            </Label>
            <Input id="tradeName" name="tradeName" defaultValue={company.tradeName ?? ""} maxLength={200} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="description">
              Description <OptionalBadge />
            </Label>
            <Textarea id="description" name="description" defaultValue={company.description ?? ""} rows={4} maxLength={5000} />
          </div>
        </FormSection>

        <FormSection title="Contact information">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="websiteUrl">
              Website <OptionalBadge />
            </Label>
            <Input id="websiteUrl" name="websiteUrl" defaultValue={company.websiteUrl ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactEmail">
              Contact email <OptionalBadge />
            </Label>
            <Input id="contactEmail" name="contactEmail" defaultValue={company.contactEmail ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="contactPhone">
              Contact phone <OptionalBadge />
            </Label>
            <Input id="contactPhone" name="contactPhone" defaultValue={company.contactPhone ?? ""} />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="city">
                City <OptionalBadge />
              </Label>
              <Input id="city" name="city" defaultValue={company.city ?? ""} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="province">
                Province <OptionalBadge />
              </Label>
              <Input id="province" name="province" defaultValue={company.province ?? ""} />
            </div>
          </div>
        </FormSection>

        <FormActions stickyOnMobile>
          <Button type="submit" className="sm:min-w-40">
            Save changes
          </Button>
        </FormActions>
      </form>
    </PageContainer>
  );
}
