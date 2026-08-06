import { describe, expect, it } from "vitest";

import type { NotificationCreator, NotificationEvent } from "@/application/ports/notification-creator";
import { CreateDisputeUseCase } from "@/application/use-cases/dispute/create-dispute.use-case";
import { RecordDisputeCreatedAuditLogSubscriber } from "@/application/use-cases/dispute/record-dispute-created-audit-log.subscriber";
import { NotifyDisputeCreatedSubscriber } from "@/application/use-cases/notification/notify-dispute-created.subscriber";
import { NotFoundError } from "@/domain/errors/domain-error";
import { DisputeCreated } from "@/domain/events/dispute-created";
import type { JobRecord } from "@/domain/repositories/job-repository";
import { SynchronousEventBus } from "@/infrastructure/events/synchronous-event-bus";
import { createAppointmentStore, createJobStore, FakeCustomerProfileRepository, FakeJobRepository } from "../booking/fakes";
import { FakeCompanyMembershipRepository } from "../company/fakes";
import { FakeProfessionalRepository } from "../quotes/fakes";
import { FakeAdminAuditLogRepository, FakeDisputeRepository } from "./fakes";

/**
 * Module 28 — Workflow Completion, "Company Disputes": integration coverage
 * for the previously-unsupported path — a CompanyMember opening a dispute
 * over a Job their company performed (see resolveJobActor's new "company"
 * branch and CreateDisputeUseCase's updated doc comment). Deliberately a
 * separate file from dispute-flows.test.ts (which predates this feature and
 * already has thorough customer/professional coverage) so this new,
 * narrowly-scoped behavior is easy to find and doesn't bloat that file.
 *
 * The Job here is seeded directly into the shared JobStore (bypassing the
 * full accept-quote pipeline, which this codebase's fakes don't model as
 * producing a company-owned Job yet — see FakeQuoteAcceptanceRepository's
 * own `companyProfileId: null` hardcode) since CreateDisputeUseCase only
 * ever reads the Job by id, never re-derives it from a Quote/ServiceRequest.
 */

class FakeNotificationCreator implements NotificationCreator {
  events: NotificationEvent[] = [];
  async notify(event: NotificationEvent): Promise<void> {
    this.events.push(event);
  }
}

function makeRepos() {
  const customerProfiles = new FakeCustomerProfileRepository();
  const professionals = new FakeProfessionalRepository();
  const companyMembers = new FakeCompanyMembershipRepository();
  const jobStore = createJobStore();
  const jobs = new FakeJobRepository(jobStore, createAppointmentStore());
  const disputes = new FakeDisputeRepository();
  const auditLog = new FakeAdminAuditLogRepository();
  const notifications = new FakeNotificationCreator();
  return { customerProfiles, professionals, companyMembers, jobStore, jobs, disputes, auditLog, notifications };
}

/** Module 37 — Domain Event Subscribers: `CreateDisputeUseCase` now
 *  publishes `DisputeCreated` instead of calling repos.auditLog/
 *  repos.notifications directly — wire a real `SynchronousEventBus` with
 *  the real subscribers so this test still exercises the full, genuine
 *  side-effect path, same pattern as dispute-flows.test.ts. */
function makeDisputeEventBus(repos: ReturnType<typeof makeRepos>) {
  const eventBus = new SynchronousEventBus();
  eventBus.subscribe(DisputeCreated, new RecordDisputeCreatedAuditLogSubscriber(repos.auditLog));
  eventBus.subscribe(DisputeCreated, new NotifyDisputeCreatedSubscriber(repos.notifications));
  return eventBus;
}

async function seedCompanyJob(
  repos: ReturnType<typeof makeRepos>,
  customerUserId: string,
  companyId: string,
  status: JobRecord["status"] = "IN_PROGRESS",
) {
  const customer = await repos.customerProfiles.findOrCreateByUserId(customerUserId);
  const job: JobRecord = {
    id: `company-job-${companyId}-${customerUserId}`,
    serviceRequestId: "service-request-1",
    quoteId: "quote-1",
    customerId: customer.id,
    professionalProfileId: null,
    companyProfileId: companyId,
    status,
    startedAt: status === "IN_PROGRESS" ? new Date() : null,
    startedByUserId: null,
    completedAt: null,
    completedByUserId: null,
    cancelledAt: null,
    cancelledByUserId: null,
    cancellationReason: null,
    cancellationNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  repos.jobStore.set(job.id, job);
  return job;
}

describe("Company disputes (Module 28 — Workflow Completion)", () => {
  it("an OWNER may open a dispute for a job their company performed", async () => {
    const repos = makeRepos();
    const job = await seedCompanyJob(repos, "customer-1", "company-1");
    repos.companyMembers.seed({ companyId: "company-1", userId: "owner-user", role: "OWNER" });

    const useCase = new CreateDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      makeDisputeEventBus(repos),
    );

    const dispute = await useCase.execute("owner-user", {
      jobId: job.id,
      reason: "SERVICE_QUALITY",
      title: "Work incomplete",
      description: "The company left the job unfinished.",
    });

    expect(dispute.jobId).toBe(job.id);
    expect(dispute.raisedByUserId).toBe("owner-user");
    // The respondent side is the customer (implicit via job.customerId) —
    // respondent professional/company fields stay null, same as any
    // non-customer raiser (see CreateDisputeUseCase's ternary).
    expect(dispute.respondentProfessionalProfileId).toBeNull();
    expect(dispute.respondentCompanyProfileId).toBeNull();

    // The customer is notified (professional/company-raised branch).
    expect(repos.notifications.events).toHaveLength(1);
    expect(repos.notifications.events[0]?.type).toBe("DISPUTE_CREATED");
  });

  it("an ADMIN or MANAGER may also open a dispute on the company's behalf", async () => {
    for (const role of ["ADMIN", "MANAGER"] as const) {
      const repos = makeRepos();
      const job = await seedCompanyJob(repos, `customer-${role}`, `company-${role}`);
      repos.companyMembers.seed({ companyId: `company-${role}`, userId: `${role}-user`, role });

      const useCase = new CreateDisputeUseCase(
        repos.disputes,
        repos.jobs,
        repos.customerProfiles,
        repos.professionals,
        repos.companyMembers,
        makeDisputeEventBus(repos),
      );

      const dispute = await useCase.execute(`${role}-user`, {
        jobId: job.id,
        reason: "OTHER",
        title: "Issue",
        description: "Some issue.",
      });
      expect(dispute.raisedByUserId).toBe(`${role}-user`);
    }
  });

  it("a plain MEMBER cannot open a dispute on the company's behalf (same NotFoundError as an unrelated user)", async () => {
    const repos = makeRepos();
    const job = await seedCompanyJob(repos, "customer-2", "company-2");
    repos.companyMembers.seed({ companyId: "company-2", userId: "member-user", role: "MEMBER" });

    const useCase = new CreateDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      makeDisputeEventBus(repos),
    );

    await expect(
      useCase.execute("member-user", {
        jobId: job.id,
        reason: "OTHER",
        title: "Issue",
        description: "Some issue.",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("a removed (former) member cannot open a dispute even with a privileged role", async () => {
    const repos = makeRepos();
    const job = await seedCompanyJob(repos, "customer-3", "company-3");
    repos.companyMembers.seed({
      companyId: "company-3",
      userId: "ex-owner",
      role: "OWNER",
      removedAt: new Date(),
    });

    const useCase = new CreateDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      makeDisputeEventBus(repos),
    );

    await expect(
      useCase.execute("ex-owner", {
        jobId: job.id,
        reason: "OTHER",
        title: "Issue",
        description: "Some issue.",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("an unrelated user still gets NotFoundError for a company-owned job (unchanged behavior)", async () => {
    const repos = makeRepos();
    const job = await seedCompanyJob(repos, "customer-4", "company-4");

    const useCase = new CreateDisputeUseCase(
      repos.disputes,
      repos.jobs,
      repos.customerProfiles,
      repos.professionals,
      repos.companyMembers,
      makeDisputeEventBus(repos),
    );

    await expect(
      useCase.execute("stranger", {
        jobId: job.id,
        reason: "OTHER",
        title: "Issue",
        description: "Some issue.",
      }),
    ).rejects.toThrow(NotFoundError);
  });
});
