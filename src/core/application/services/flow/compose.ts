import "server-only";

import { PrismaTransactionFlowReader } from "@/infrastructure/database/prisma/repositories/prisma-transaction-flow-reader";
import { TransactionFlowGuard } from "./transaction-flow-guard";

/** Module 121 — process-wide guard shared by every legacy-financial
 *  composition root. */
export const transactionFlowGuard = new TransactionFlowGuard(new PrismaTransactionFlowReader());
