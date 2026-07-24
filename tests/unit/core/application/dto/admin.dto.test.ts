import { describe, expect, it } from "vitest";

import {
  adminPortfolioItemIdSchema,
  adminReviewIdSchema,
  adminUserIdSchema,
  changeUserRoleSchema,
  listAdminJobsSchema,
  listAdminPortfolioItemsSchema,
  listAdminProfessionalsSchema,
  listAdminQuotesSchema,
  listAdminReviewsSchema,
  listAdminServiceRequestsSchema,
  listAdminUsersSchema,
  moderatePortfolioItemSchema,
  moderateReviewSchema,
  paginationSchema,
} from "@/application/dto/admin.dto";

const VALID_ID = "123e4567-e89b-12d3-a456-426614174000";

describe("paginationSchema", () => {
  it("applies safe default bounds", () => {
    const result = paginationSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(20);
      expect(result.data.offset).toBe(0);
    }
  });

  it("rejects a limit above the max page size", () => {
    expect(paginationSchema.safeParse({ limit: 1000 }).success).toBe(false);
  });

  it("rejects a limit of 0", () => {
    expect(paginationSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects a negative offset", () => {
    expect(paginationSchema.safeParse({ offset: -1 }).success).toBe(false);
  });
});

describe("listAdminUsersSchema", () => {
  it("accepts an optional search string", () => {
    const result = listAdminUsersSchema.safeParse({ search: "alice" });
    expect(result.success).toBe(true);
  });

  it("rejects an overly long search string", () => {
    const result = listAdminUsersSchema.safeParse({ search: "a".repeat(101) });
    expect(result.success).toBe(false);
  });
});

describe("listAdminServiceRequestsSchema / listAdminQuotesSchema / listAdminJobsSchema / listAdminReviewsSchema", () => {
  it("accept a valid status filter", () => {
    expect(listAdminServiceRequestsSchema.safeParse({ status: "PUBLISHED" }).success).toBe(true);
    expect(listAdminQuotesSchema.safeParse({ status: "SENT" }).success).toBe(true);
    expect(listAdminJobsSchema.safeParse({ status: "COMPLETED" }).success).toBe(true);
    expect(listAdminReviewsSchema.safeParse({ status: "REMOVED" }).success).toBe(true);
  });

  it("reject an invalid status value", () => {
    expect(listAdminServiceRequestsSchema.safeParse({ status: "NOT_A_STATUS" }).success).toBe(false);
    expect(listAdminQuotesSchema.safeParse({ status: "NOT_A_STATUS" }).success).toBe(false);
    expect(listAdminJobsSchema.safeParse({ status: "NOT_A_STATUS" }).success).toBe(false);
    expect(listAdminReviewsSchema.safeParse({ status: "NOT_A_STATUS" }).success).toBe(false);
  });
});

describe("listAdminProfessionalsSchema / listAdminPortfolioItemsSchema", () => {
  it("accept empty input with default pagination", () => {
    expect(listAdminProfessionalsSchema.safeParse({}).success).toBe(true);
    expect(listAdminPortfolioItemsSchema.safeParse({}).success).toBe(true);
  });
});

describe("id schemas", () => {
  it("accept a valid UUID", () => {
    expect(adminUserIdSchema.safeParse({ userId: VALID_ID }).success).toBe(true);
    expect(adminReviewIdSchema.safeParse({ reviewId: VALID_ID }).success).toBe(true);
    expect(adminPortfolioItemIdSchema.safeParse({ portfolioItemId: VALID_ID }).success).toBe(true);
  });

  it("reject a non-UUID", () => {
    expect(adminUserIdSchema.safeParse({ userId: "not-a-uuid" }).success).toBe(false);
    expect(adminReviewIdSchema.safeParse({ reviewId: "not-a-uuid" }).success).toBe(false);
    expect(adminPortfolioItemIdSchema.safeParse({ portfolioItemId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("changeUserRoleSchema", () => {
  it("accepts a valid role list", () => {
    const result = changeUserRoleSchema.safeParse({ userId: VALID_ID, roles: ["ADMIN", "CUSTOMER"] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty role list", () => {
    expect(changeUserRoleSchema.safeParse({ userId: VALID_ID, roles: [] }).success).toBe(false);
  });

  it("rejects an unrecognized role key", () => {
    expect(changeUserRoleSchema.safeParse({ userId: VALID_ID, roles: ["SUPREME_LEADER"] }).success).toBe(false);
  });

  it("rejects a non-UUID userId", () => {
    expect(changeUserRoleSchema.safeParse({ userId: "not-a-uuid", roles: ["ADMIN"] }).success).toBe(false);
  });
});

describe("moderateReviewSchema / moderatePortfolioItemSchema", () => {
  it("accept an optional reason", () => {
    expect(moderateReviewSchema.safeParse({ reviewId: VALID_ID, reason: "Spam" }).success).toBe(true);
    expect(moderateReviewSchema.safeParse({ reviewId: VALID_ID }).success).toBe(true);
    expect(moderatePortfolioItemSchema.safeParse({ portfolioItemId: VALID_ID, reason: "Inappropriate" }).success).toBe(
      true,
    );
  });

  it("reject an overly long reason", () => {
    expect(moderateReviewSchema.safeParse({ reviewId: VALID_ID, reason: "a".repeat(501) }).success).toBe(false);
    expect(
      moderatePortfolioItemSchema.safeParse({ portfolioItemId: VALID_ID, reason: "a".repeat(501) }).success,
    ).toBe(false);
  });

  it("never accepts an adminUserId/actorId field", () => {
    const parsed = moderateReviewSchema.parse({ reviewId: VALID_ID, adminUserId: "someone-else" } as never);
    expect(parsed).not.toHaveProperty("adminUserId");
  });
});
