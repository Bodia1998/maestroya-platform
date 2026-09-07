import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";
import type { ProfessionalRecord } from "@/domain/repositories/professional-repository";
import type { CreateInvoiceDraftData } from "@/domain/repositories/invoice-repository";
import { GrantSelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/grant-self-billing-authorization.use-case";
import { RevokeSelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/revoke-self-billing-authorization.use-case";
import { GrantMySelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/grant-my-self-billing-authorization.use-case";
import { RevokeMySelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/revoke-my-self-billing-authorization.use-case";
import { GetMySelfBillingAuthorizationUseCase } from "@/application/use-cases/invoicing/get-my-self-billing-authorization.use-case";
import { ListInvoicesForCustomerUseCase } from "@/application/use-cases/invoicing/list-invoices-for-customer.use-case";
import { ListInvoicesForProfessionalUseCase } from "@/application/use-cases/invoicing/list-invoices-for-professional.use-case";
import { ListInvoicesForCompanyUseCase } from "@/application/use-cases/invoicing/list-invoices-for-company.use-case";
import { GetCustomerReceiptUseCase } from "@/application/use-cases/invoicing/get-customer-receipt.use-case";
import { GetProfessionalInvoiceUseCase } from "@/application/use-cases/invoicing/get-professional-invoice.use-case";
import {
  FakeCompanyMembershipRepository,
  FakeCreditNoteRepository,
  FakeCustomerProfileRepository,
  FakeEventBus,
  FakeInvoiceRepository,
  FakeProfessionalRepository,
  FakeSelfBillingAuthorizationRepository,
} from "./fakes";

/**
 * Module 99 — Self-Billing Authorization Entry Point & Financial Document
 * Access.
 *
 * Covers the two things this module actually added on top of the
 * already-tested Module 79/85 core (see invoicing-use-cases.test.ts and
 * module-85-activation.test.ts, both left unmodified):
 *
 *  1. The "my own identity, never a client-supplied id" wrappers around
 *     grant/revoke/status (Workstream A) — including the IDOR case the
 *     brief calls out explicitly: a professional must never be able to
 *     revoke another professional's or company's authorization.
 *  2. Ownership-scoped read access to receipts/invoices (Workstreams B/C)
 *     — including the type-scoping bug this module fixed
 *     (`listForProfessional` previously leaking `CUSTOMER_RECEIPT` rows)
 *     and cross-tenant IDOR on both the customer and professional sides.
 */

function makeProfessional(overrides: Partial<ProfessionalRecord> = {}): ProfessionalRecord {
  return {
    id: "professional-1",
    userId: "professional-user-1",
    businessName: "Fontanería García",
    bio: null,
    headline: null,
    yearsExperience: null,
    hourlyRate: null,
    serviceRadiusKm: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    taxId: "12345678Z",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    verifiedAt: new Date(),
    isAcceptingRequests: true,
    categoryIds: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ProfessionalRecord;
}

function baseDraftData(overrides: Partial<CreateInvoiceDraftData> = {}): CreateInvoiceDraftData {
  return {
    type: "PROFESSIONAL_SELF_BILLED",
    jobId: "job-1",
    quoteId: "quote-1",
    paymentId: "payment-1",
    professionalProfileId: "professional-1",
    companyProfileId: null,
    customerId: "customer-1",
    issuerLegalName: "MaestroYa",
    issuerTaxId: "X00000000Y",
    recipientLegalName: "Fontanería García",
    recipientTaxId: "12345678Z",
    selfBillingAuthorizationId: "sba-1",
    invoiceDate: new Date(),
    currency: "EUR",
    lineItems: [{ description: "Job payout", quantity: 1, unitPrice: 100, amount: 100, category: "LABOR" }],
    taxableBase: 82.64,
    vatRateBps: 2100,
    vatAmount: 17.36,
    commissionBase: 100,
    commissionRateBps: 0,
    commissionAmount: 0,
    irpfWithholdingRateBps: 0,
    irpfWithholdingAmount: 0,
    totalAmount: 100,
    ...overrides,
  };
}

describe("Module 99 — self-billing authorization entry point (grant/revoke/status)", () => {
  let professionals: FakeProfessionalRepository;
  let companyMembers: FakeCompanyMembershipRepository;
  let authorizations: FakeSelfBillingAuthorizationRepository;
  let eventBus: FakeEventBus;
  let grant: GrantMySelfBillingAuthorizationUseCase;
  let revoke: RevokeMySelfBillingAuthorizationUseCase;
  let getStatus: GetMySelfBillingAuthorizationUseCase;

  beforeEach(() => {
    professionals = new FakeProfessionalRepository();
    companyMembers = new FakeCompanyMembershipRepository();
    authorizations = new FakeSelfBillingAuthorizationRepository();
    eventBus = new FakeEventBus();

    const grantCore = new GrantSelfBillingAuthorizationUseCase(authorizations, eventBus);
    const revokeCore = new RevokeSelfBillingAuthorizationUseCase(authorizations);

    grant = new GrantMySelfBillingAuthorizationUseCase(professionals as never, companyMembers as never, grantCore);
    revoke = new RevokeMySelfBillingAuthorizationUseCase(professionals as never, companyMembers as never, authorizations, revokeCore);
    getStatus = new GetMySelfBillingAuthorizationUseCase(professionals as never, companyMembers as never, authorizations);

    professionals.seed(makeProfessional());
    professionals.seed(makeProfessional({ id: "professional-2", userId: "professional-user-2" }));
  });

  it("has no ACTIVE authorization before anything is granted", async () => {
    const status = await getStatus.execute({ userId: "professional-user-1" });
    expect(status).toBeNull();
  });

  it("lets a professional grant their own solo self-billing authorization", async () => {
    const granted = await grant.execute({
      userId: "professional-user-1",
      agreementVersion: "self-billing-agreement-es-v1",
      acceptanceIpAddress: "203.0.113.5",
      acceptanceUserAgent: "test-agent",
    });
    expect(granted.professionalProfileId).toBe("professional-1");
    expect(granted.status).toBe("ACTIVE");

    const status = await getStatus.execute({ userId: "professional-user-1" });
    expect(status?.id).toBe(granted.id);
  });

  it("lets a professional revoke their own authorization without ever supplying an authorizationId", async () => {
    await grant.execute({ userId: "professional-user-1", agreementVersion: "self-billing-agreement-es-v1" });
    const revoked = await revoke.execute({ userId: "professional-user-1" });
    expect(revoked.status).toBe("REVOKED");

    const status = await getStatus.execute({ userId: "professional-user-1" });
    expect(status).toBeNull();
  });

  it("rejects revocation when the caller has no active authorization to revoke", async () => {
    await expect(revoke.execute({ userId: "professional-user-1" })).rejects.toBeInstanceOf(ValidationError);
  });

  // The exact IDOR case the brief calls out: professional A must never be
  // able to revoke professional B's authorization. Since
  // RevokeMySelfBillingAuthorizationUseCase never accepts a client-supplied
  // authorizationId at all, this is verified structurally: professional A's
  // own revoke call only ever resolves and revokes ITS OWN active row,
  // never touching professional B's, regardless of ordering.
  it("never revokes another professional's authorization when both have one active", async () => {
    const grantedA = await grant.execute({ userId: "professional-user-1", agreementVersion: "self-billing-agreement-es-v1" });
    const grantedB = await grant.execute({ userId: "professional-user-2", agreementVersion: "self-billing-agreement-es-v1" });

    await revoke.execute({ userId: "professional-user-1" });

    const reloadedA = authorizations.rows.find((r) => r.id === grantedA.id);
    const reloadedB = authorizations.rows.find((r) => r.id === grantedB.id);
    expect(reloadedA?.status).toBe("REVOKED");
    expect(reloadedB?.status).toBe("ACTIVE");
  });

  it("rejects granting/revoking/viewing when the caller has no professional profile at all", async () => {
    await expect(
      grant.execute({ userId: "no-such-user", agreementVersion: "self-billing-agreement-es-v1" }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(revoke.execute({ userId: "no-such-user" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(getStatus.execute({ userId: "no-such-user" })).rejects.toBeInstanceOf(NotFoundError);
  });

  describe("company path", () => {
    beforeEach(() => {
      companyMembers.seedActiveMember("company-1", "owner-user-1", "OWNER");
      companyMembers.seedActiveMember("company-1", "admin-user-1", "ADMIN");
      companyMembers.seedActiveMember("company-1", "manager-user-1", "MANAGER");
    });

    it("lets a company OWNER grant and revoke the company's self-billing authorization", async () => {
      const granted = await grant.execute({
        userId: "owner-user-1",
        companyId: "company-1",
        agreementVersion: "self-billing-agreement-es-v1",
      });
      expect(granted.companyProfileId).toBe("company-1");

      const revoked = await revoke.execute({ userId: "owner-user-1", companyId: "company-1" });
      expect(revoked.status).toBe("REVOKED");
    });

    it("lets a company ADMIN grant on the company's behalf", async () => {
      const granted = await grant.execute({
        userId: "admin-user-1",
        companyId: "company-1",
        agreementVersion: "self-billing-agreement-es-v1",
      });
      expect(granted.companyProfileId).toBe("company-1");
    });

    // Workstream A's permission decision under test: granting/revoking is a
    // legal/financial commitment gated by canManageCompanyProfile
    // (OWNER/ADMIN only) — a MANAGER must be rejected even though MANAGERs
    // can act on Jobs.
    it("rejects a company MANAGER granting or revoking self-billing authorization", async () => {
      await expect(
        grant.execute({ userId: "manager-user-1", companyId: "company-1", agreementVersion: "self-billing-agreement-es-v1" }),
      ).rejects.toBeInstanceOf(UnauthorizedError);

      await grant.execute({ userId: "owner-user-1", companyId: "company-1", agreementVersion: "self-billing-agreement-es-v1" });
      await expect(revoke.execute({ userId: "manager-user-1", companyId: "company-1" })).rejects.toBeInstanceOf(UnauthorizedError);
    });

    it("rejects granting/revoking/viewing on behalf of a company the caller is not a member of", async () => {
      await expect(
        grant.execute({ userId: "stranger-user", companyId: "company-1", agreementVersion: "self-billing-agreement-es-v1" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      await expect(getStatus.execute({ userId: "stranger-user", companyId: "company-1" })).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});

describe("Module 99 — ownership-scoped document access (receipts & invoices)", () => {
  let invoices: FakeInvoiceRepository;
  let creditNotes: FakeCreditNoteRepository;
  let professionals: FakeProfessionalRepository;
  let companyMembers: FakeCompanyMembershipRepository;
  let customerProfiles: FakeCustomerProfileRepository;

  let listForCustomer: ListInvoicesForCustomerUseCase;
  let listForProfessional: ListInvoicesForProfessionalUseCase;
  let listForCompany: ListInvoicesForCompanyUseCase;
  let getReceipt: GetCustomerReceiptUseCase;
  let getProfessionalInvoice: GetProfessionalInvoiceUseCase;

  beforeEach(() => {
    invoices = new FakeInvoiceRepository();
    creditNotes = new FakeCreditNoteRepository();
    professionals = new FakeProfessionalRepository();
    companyMembers = new FakeCompanyMembershipRepository();
    customerProfiles = new FakeCustomerProfileRepository();

    listForCustomer = new ListInvoicesForCustomerUseCase(invoices as never, customerProfiles as never);
    listForProfessional = new ListInvoicesForProfessionalUseCase(invoices as never, professionals as never);
    listForCompany = new ListInvoicesForCompanyUseCase(invoices as never, companyMembers as never);
    getReceipt = new GetCustomerReceiptUseCase(invoices as never, creditNotes as never, customerProfiles as never);
    getProfessionalInvoice = new GetProfessionalInvoiceUseCase(invoices as never, creditNotes as never, professionals as never, companyMembers as never);

    professionals.seed(makeProfessional());
    professionals.seed(makeProfessional({ id: "professional-2", userId: "professional-user-2" }));

    customerProfiles.seed({ id: "customer-1", userId: "customer-user-1", customerType: "INDIVIDUAL" as never });
    customerProfiles.seed({ id: "customer-2", userId: "customer-user-2", customerType: "INDIVIDUAL" as never });
  });

  it("lists only a customer's own CUSTOMER_RECEIPT invoices, never a professional's self-billed invoices", async () => {
    await invoices.createDraft(baseDraftData({ type: "CUSTOMER_RECEIPT", customerId: "customer-1", jobId: "job-1" }));
    await invoices.createDraft(baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", customerId: "customer-1", jobId: "job-1" }));
    await invoices.createDraft(baseDraftData({ type: "CUSTOMER_RECEIPT", customerId: "customer-2", jobId: "job-2" }));

    const forCustomer1 = await listForCustomer.execute("customer-user-1");
    expect(forCustomer1).toHaveLength(1);
    expect(forCustomer1[0]?.type).toBe("CUSTOMER_RECEIPT");
    expect(forCustomer1[0]?.customerId).toBe("customer-1");
  });

  // The exact bug this module fixed: listForProfessional previously had no
  // type filter and would have leaked CUSTOMER_RECEIPT rows sharing the
  // same denormalized professionalProfileId into "my invoices".
  it("lists only a professional's own PROFESSIONAL_SELF_BILLED invoices, never CUSTOMER_RECEIPT rows", async () => {
    await invoices.createDraft(baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", professionalProfileId: "professional-1" }));
    await invoices.createDraft(baseDraftData({ type: "CUSTOMER_RECEIPT", professionalProfileId: "professional-1" as never }));

    const forProfessional1 = await listForProfessional.execute("professional-user-1");
    expect(forProfessional1).toHaveLength(1);
    expect(forProfessional1[0]?.type).toBe("PROFESSIONAL_SELF_BILLED");
  });

  it("never lists another professional's self-billed invoices", async () => {
    await invoices.createDraft(baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", professionalProfileId: "professional-1" }));
    await invoices.createDraft(baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", professionalProfileId: "professional-2" }));

    const forProfessional1 = await listForProfessional.execute("professional-user-1");
    expect(forProfessional1).toHaveLength(1);
    expect(forProfessional1.every((i) => i.professionalProfileId === "professional-1")).toBe(true);
  });

  // IDOR: a customer must not be able to open another customer's receipt
  // by id, and a CUSTOMER_RECEIPT id must not be openable via the
  // professional-invoice lookup (and vice versa).
  it("404s (identically to a nonexistent id) when a customer requests another customer's receipt", async () => {
    const receipt = await invoices.createDraft(baseDraftData({ type: "CUSTOMER_RECEIPT", customerId: "customer-1" }));

    await expect(getReceipt.execute("customer-user-2", receipt.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getReceipt.execute("customer-user-1", "does-not-exist")).rejects.toBeInstanceOf(NotFoundError);

    const ownReceipt = await getReceipt.execute("customer-user-1", receipt.id);
    expect(ownReceipt.invoice.id).toBe(receipt.id);
  });

  it("404s when a professional requests another professional's self-billed invoice", async () => {
    const invoice = await invoices.createDraft(baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", professionalProfileId: "professional-1" }));

    await expect(getProfessionalInvoice.execute("professional-user-2", invoice.id)).rejects.toBeInstanceOf(NotFoundError);

    const own = await getProfessionalInvoice.execute("professional-user-1", invoice.id);
    expect(own.invoice.id).toBe(invoice.id);
  });

  it("404s when a professional requests a CUSTOMER_RECEIPT id via the professional-invoice lookup", async () => {
    const receipt = await invoices.createDraft(baseDraftData({ type: "CUSTOMER_RECEIPT", professionalProfileId: "professional-1" as never }));
    await expect(getProfessionalInvoice.execute("professional-user-1", receipt.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  describe("company path", () => {
    beforeEach(() => {
      companyMembers.seedActiveMember("company-1", "owner-user-1", "OWNER");
      companyMembers.seedActiveMember("company-1", "manager-user-1", "MANAGER");
    });

    it("lets an OWNER/ADMIN/MANAGER view the company's own self-billed invoices", async () => {
      await invoices.createDraft(baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", professionalProfileId: null, companyProfileId: "company-1" }));

      const asOwner = await listForCompany.execute("owner-user-1", "company-1");
      const asManager = await listForCompany.execute("manager-user-1", "company-1");
      expect(asOwner).toHaveLength(1);
      expect(asManager).toHaveLength(1);
    });

    it("never lists another company's invoices and 404s on cross-company detail access", async () => {
      const otherCompanyInvoice = await invoices.createDraft(
        baseDraftData({ type: "PROFESSIONAL_SELF_BILLED", professionalProfileId: null, companyProfileId: "company-2" }),
      );

      const forCompany1 = await listForCompany.execute("owner-user-1", "company-1");
      expect(forCompany1).toHaveLength(0);

      await expect(getProfessionalInvoice.execute("owner-user-1", otherCompanyInvoice.id)).rejects.toBeInstanceOf(NotFoundError);
    });

    it("404s when a non-member requests the company's invoice list", async () => {
      await expect(listForCompany.execute("stranger-user", "company-1")).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
