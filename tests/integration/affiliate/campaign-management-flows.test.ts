import { describe, expect, it } from "vitest";

import { GeneratePartnerReferralLinkUseCase } from "@/application/use-cases/affiliate/generate-partner-referral-link.use-case";
import { CreateReferralCodeUseCase } from "@/application/use-cases/referral/create-referral-code.use-case";
import { SetReferralCodeActiveUseCase } from "@/application/use-cases/affiliate/set-referral-code-active.use-case";
import { ListPartnerReferralCodesUseCase } from "@/application/use-cases/affiliate/list-partner-referral-codes.use-case";
import { RecordAffiliateCommissionUseCase } from "@/application/use-cases/affiliate/record-affiliate-commission.use-case";
import { UnauthorizedError, ValidationError } from "@/domain/errors/domain-error";

import { FakePartnerRepository, FakeAffiliateCommissionRepository } from "./fakes";
import { FakeReferralCodeRepository, FakeReferralVisitRepository, FakeMarketingAttributionRepository } from "../referral/fakes";

async function makePartner(repo: FakePartnerRepository, userId: string) {
  const partner = await repo.create({
    userId,
    type: "INDIVIDUAL",
    displayName: `Partner ${userId}`,
    contactEmail: `${userId}@example.com`,
  });
  return repo.updateStatus(partner.id, { status: "APPROVED", approvedAt: new Date(), approvedByUserId: "admin-1" });
}

describe("Module 96 — Campaign management (partner-owned referral links)", () => {
  it("lets an approved partner create a link with a source label, and lists it back with a visit count", async () => {
    const partners = new FakePartnerRepository();
    const codes = new FakeReferralCodeRepository();
    const visits = new FakeReferralVisitRepository();
    const partner = await makePartner(partners, "user-a");

    const generate = new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(codes));
    const link = await generate.execute({ partnerId: partner.id, code: "telegram_valencia", source: "TELEGRAM" });
    expect(link.source).toBe("TELEGRAM");
    expect(link.isActive).toBe(true);

    await visits.create({
      visitorId: "v1",
      referralCode: "telegram_valencia",
      utmSource: null,
      utmMedium: null,
      utmCampaign: null,
      utmContent: null,
      utmTerm: null,
      marketingSource: "TELEGRAM",
      ipHash: null,
      userAgentTruncated: null,
      landingPage: "/",
    });

    const list = new ListPartnerReferralCodesUseCase(partners, codes, visits);
    const items = await list.execute(partner.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ code: "telegram_valencia", source: "TELEGRAM", isActive: true, visits: 1 });
  });

  it("rejects an unknown campaign source", async () => {
    const partners = new FakePartnerRepository();
    const codes = new FakeReferralCodeRepository();
    const partner = await makePartner(partners, "user-b");
    const generate = new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(codes));

    await expect(generate.execute({ partnerId: partner.id, code: "bad_source", source: "SNAPCHAT" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("lets a partner deactivate their own link, and RecordAffiliateCommissionUseCase stops paying through it", async () => {
    const partners = new FakePartnerRepository();
    const codes = new FakeReferralCodeRepository();
    const attributions = new FakeMarketingAttributionRepository();
    const commissions = new FakeAffiliateCommissionRepository();
    const partner = await makePartner(partners, "user-c");

    const generate = new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(codes));
    const link = await generate.execute({ partnerId: partner.id, code: "deactivate_me" });

    await attributions.upsertTouchState("visitor-1", {
      firstReferralCode: "deactivate_me",
      lastReferralCode: "deactivate_me",
      firstSource: "REFERRAL",
      lastSource: "REFERRAL",
      firstCampaign: null,
      lastCampaign: null,
      firstVisitAt: new Date(),
      lastVisitAt: new Date(),
    });

    const toggle = new SetReferralCodeActiveUseCase(partners, codes);
    await toggle.execute({ partnerId: partner.id, referralCodeId: link.id, isActive: false });

    const recordCommission = new RecordAffiliateCommissionUseCase(attributions, codes, partners, commissions);
    const result = await recordCommission.execute({
      visitorId: "visitor-1",
      conversionEventId: "conv-1",
      platformCommissionRefId: "commission-1",
      platformCommissionAmount: 100,
    });
    expect(result).toBeNull();
  });

  it("never lets partner B toggle partner A's referral link (isolation / IDOR)", async () => {
    const partners = new FakePartnerRepository();
    const codes = new FakeReferralCodeRepository();
    const partnerA = await makePartner(partners, "user-a2");
    const partnerB = await makePartner(partners, "user-b2");

    const generate = new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(codes));
    const linkA = await generate.execute({ partnerId: partnerA.id, code: "partner_a_link" });

    const toggle = new SetReferralCodeActiveUseCase(partners, codes);
    await expect(
      toggle.execute({ partnerId: partnerB.id, referralCodeId: linkA.id, isActive: false }),
    ).rejects.toBeInstanceOf(UnauthorizedError);

    const stillActive = await codes.findById(linkA.id);
    expect(stillActive?.isActive).toBe(true);
  });

  it("never lets partner B's campaign listing include partner A's links (isolation)", async () => {
    const partners = new FakePartnerRepository();
    const codes = new FakeReferralCodeRepository();
    const visits = new FakeReferralVisitRepository();
    const partnerA = await makePartner(partners, "user-a3");
    const partnerB = await makePartner(partners, "user-b3");

    const generate = new GeneratePartnerReferralLinkUseCase(partners, new CreateReferralCodeUseCase(codes));
    await generate.execute({ partnerId: partnerA.id, code: "a3_link" });
    await generate.execute({ partnerId: partnerB.id, code: "b3_link" });

    const list = new ListPartnerReferralCodesUseCase(partners, codes, visits);
    const itemsB = await list.execute(partnerB.id);
    expect(itemsB.map((l) => l.code)).toEqual(["b3_link"]);
  });
});
