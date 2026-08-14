import { describe, expect, it } from "vitest";

import { IbanPayoutProvider } from "@/infrastructure/payout/iban-payout-provider";
import { ValidationError } from "@/domain/errors/domain-error";

describe("IbanPayoutProvider (Module 62)", () => {
  it("registers a structurally valid IBAN as PENDING, masked, with a keyed hash", async () => {
    const provider = new IbanPayoutProvider("pepper");

    const result = await provider.registerDestination({
      professionalProfileId: "profile-1",
      accountHolderName: "Jane Doe",
      iban: "ES91 2100 0418 4502 0005 1332",
    });

    expect(result.method).toBe("IBAN");
    expect(result.status).toBe("PENDING");
    expect(result.maskedAccount).toBe("****1332");
    expect(result.accountHash).not.toBeNull();
    expect(result.accountHash).not.toContain("2100");
    expect(result.externalReference).toBeNull();
  });

  it("throws ValidationError for a structurally invalid IBAN", async () => {
    const provider = new IbanPayoutProvider("pepper");

    await expect(
      provider.registerDestination({ professionalProfileId: "profile-1", accountHolderName: "Jane Doe", iban: "not-an-iban" }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when no iban is supplied", async () => {
    const provider = new IbanPayoutProvider("pepper");

    await expect(
      provider.registerDestination({ professionalProfileId: "profile-1", accountHolderName: "Jane Doe" }),
    ).rejects.toThrow(ValidationError);
  });

  it("produces the same hash for the same IBAN regardless of spacing/case", async () => {
    const provider = new IbanPayoutProvider("pepper");

    const a = await provider.registerDestination({
      professionalProfileId: "profile-1",
      accountHolderName: "Jane Doe",
      iban: "es9121000418450200051332",
    });
    const b = await provider.registerDestination({
      professionalProfileId: "profile-1",
      accountHolderName: "Jane Doe",
      iban: "ES91 2100 0418 4502 0005 1332",
    });

    expect(a.accountHash).toBe(b.accountHash);
  });
});
