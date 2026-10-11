import { ExecuteLeadFeeRefundUseCase } from "@/application/use-cases/lead-fee-refund/execute-lead-fee-refund.use-case";
import { TransitionLeadPurchaseUseCase } from "@/application/use-cases/lead-purchase/transition-lead-purchase.use-case";
import { resolveLeadFeeRefundConfig } from "@/domain/services/lead-fee-refund";
import { eventBus } from "@/infrastructure/events/compose";
import { PrismaAdminRepository } from "@/infrastructure/database/prisma/repositories/prisma-admin-repository";
import { PrismaLeadFeeRefundRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-fee-refund-repository";
import { PrismaLeadPurchaseRepository } from "@/infrastructure/database/prisma/repositories/prisma-lead-purchase-repository";
import { stripe } from "@/infrastructure/payments/stripe/client";
import { StripeLeadFeePaymentGatewayAdapter } from "@/infrastructure/payments/stripe/stripe-lead-fee-payment-gateway";

/**
 * Module 153 — composition root of the lead-fee refund executor (plain factory, no DI container).
 *
 * TRUSTED-INTERNAL: nothing in the application calls this today (no route, Server Action, webhook, job, queue,
 * subscriber or admin console before M157), and it must never be reachable from the browser. The switches are read from
 * the environment on EVERY call and fail CLOSED: both are OFF unless explicitly set to "true" (the automatic one also
 * needs the master one), so a missing or malformed value blocks real-money refunds. See docs/MODULE_153_LEAD_FEE_REFUND_EXECUTION.md.
 */
export function makeExecuteLeadFeeRefundUseCase() {
  const purchases = new PrismaLeadPurchaseRepository();
  return new ExecuteLeadFeeRefundUseCase(
    purchases,
    new PrismaLeadFeeRefundRepository(),
    new StripeLeadFeePaymentGatewayAdapter(stripe),
    new PrismaAdminRepository(),
    new TransitionLeadPurchaseUseCase(purchases),
    () => resolveLeadFeeRefundConfig(process.env),
    eventBus,
  );
}
