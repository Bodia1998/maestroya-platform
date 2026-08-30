import { describe, expect, it } from "vitest";

import { ActivateCompanyOnVerificationApprovedSubscriber } from "@/application/use-cases/company-verification/activate-company-on-verification-approved.subscriber";
import { CompanyVerificationStatusChanged } from "@/domain/events/company-verification-status-changed";
import { FakeCompanyRepository } from "../../../../../integration/company/fakes";

/**
 * Module 83 — Professional Verification Enforcement (H11: "company
 * activation requires an awkward second manual step after verification
 * approval"). Unit tests for the subscriber that closes that gap — same
 * pattern as record-company-verification-audit-log.subscriber.test.ts.
 */
describe("application/use-cases/company-verification/activate-company-on-verification-approved.subscriber", () => {
  async function seedCompany(companies: FakeCompanyRepository, status: "PENDING" | "ACTIVE" | "SUSPENDED" | "DEACTIVATED") {
    const created = await companies.create("owner-1", {
      legalName: "Acme Plumbing SL",
      taxId: "B12345678",
      slug: "acme-plumbing",
    });
    companies.companies.set(created.id, { ...created, status });
    return created.id;
  }

  it("activates a PENDING company on an APPROVED verification", async () => {
    const companies = new FakeCompanyRepository();
    const companyId = await seedCompany(companies, "PENDING");
    const subscriber = new ActivateCompanyOnVerificationApprovedSubscriber(companies);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", companyId, "owner-1", "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect((await companies.findById(companyId))?.status).toBe("ACTIVE");
  });

  it("re-activates a SUSPENDED company on an APPROVED verification (e.g. after a resubmission)", async () => {
    const companies = new FakeCompanyRepository();
    const companyId = await seedCompany(companies, "SUSPENDED");
    const subscriber = new ActivateCompanyOnVerificationApprovedSubscriber(companies);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", companyId, "owner-1", "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect((await companies.findById(companyId))?.status).toBe("ACTIVE");
  });

  it("does NOT reactivate a DEACTIVATED company — that status is the owner's own deliberate choice", async () => {
    const companies = new FakeCompanyRepository();
    const companyId = await seedCompany(companies, "DEACTIVATED");
    const subscriber = new ActivateCompanyOnVerificationApprovedSubscriber(companies);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", companyId, "owner-1", "PENDING", "APPROVED", "admin-1", "APPROVED"),
    );

    expect((await companies.findById(companyId))?.status).toBe("DEACTIVATED");
  });

  it("does nothing for a non-APPROVED transition (e.g. REJECTED)", async () => {
    const companies = new FakeCompanyRepository();
    const companyId = await seedCompany(companies, "PENDING");
    const subscriber = new ActivateCompanyOnVerificationApprovedSubscriber(companies);

    await subscriber.handle(
      new CompanyVerificationStatusChanged("verification-1", companyId, "owner-1", "PENDING", "REJECTED", "admin-1", "REJECTED"),
    );

    expect((await companies.findById(companyId))?.status).toBe("PENDING");
  });

  it("is a no-op when the company can no longer be found (defensive)", async () => {
    const companies = new FakeCompanyRepository();
    const subscriber = new ActivateCompanyOnVerificationApprovedSubscriber(companies);

    await expect(
      subscriber.handle(
        new CompanyVerificationStatusChanged("verification-1", "ghost-company", "owner-1", "PENDING", "APPROVED", "admin-1", "APPROVED"),
      ),
    ).resolves.toBeUndefined();
  });
});
