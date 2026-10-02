import { prisma } from "@/infrastructure/database/prisma/client";
import type { TransactionFlowReader } from "@/application/ports/transaction-flow-reader";
import type { TransactionFlowVersion } from "@/domain/services/transaction-flow";

export class PrismaTransactionFlowReader implements TransactionFlowReader {
  async findFlowVersion(serviceRequestId: string): Promise<TransactionFlowVersion | null> {
    const row = await prisma.serviceRequest.findUnique({
      where: { id: serviceRequestId },
      select: { flowVersion: true },
    });
    return row ? (row.flowVersion as TransactionFlowVersion) : null;
  }
}
