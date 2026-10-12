-- Module 156 — read-only fact view over the Module 155 dispute / revocation tables.
--
-- Why a view: Module 155 owns "lead_fee_disputes" and "lead_purchase_revocations" and a boundary test pins every TypeScript access to
-- the M155 repository. The M156 abuse rules only need to COUNT per professional and window, so that dependency is expressed ONCE, here,
-- as a SELECT-only view (no DML is possible through it: it is a UNION ALL). M155 tables, columns and semantics are not changed.
--
-- Additive only. Rollback (manual): DROP VIEW "lead_abuse_professional_dispute_facts";
--
-- kind: DISPUTE_OPENED (at openedAt) | DISPUTE_LOST (at closedAt, status LOST) | REVOCATION (at createdAt)

CREATE VIEW "lead_abuse_professional_dispute_facts" AS
    SELECT 'DISPUTE_OPENED'::text AS "kind", pp."userId" AS "professionalUserId", d."openedAt" AS "occurredAt"
    FROM "lead_fee_disputes" d
    JOIN "lead_purchases" lp ON lp."id" = d."leadPurchaseId"
    JOIN "professional_profiles" pp ON pp."id" = lp."professionalProfileId"
  UNION ALL
    SELECT 'DISPUTE_LOST'::text, pp."userId", d."closedAt"
    FROM "lead_fee_disputes" d
    JOIN "lead_purchases" lp ON lp."id" = d."leadPurchaseId"
    JOIN "professional_profiles" pp ON pp."id" = lp."professionalProfileId"
    WHERE d."status" = 'LOST' AND d."closedAt" IS NOT NULL
  UNION ALL
    SELECT 'REVOCATION'::text, pp."userId", r."createdAt"
    FROM "lead_purchase_revocations" r
    JOIN "lead_purchases" lp ON lp."id" = r."leadPurchaseId"
    JOIN "professional_profiles" pp ON pp."id" = lp."professionalProfileId";
