import Link from "next/link";
import { Award, Briefcase, CalendarDays, FileText, MessageSquare } from "lucide-react";

import { requireAuth, ROLES } from "@/infrastructure/auth/rbac";
import { makeGetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/compose";
import { makeListAppointmentsForCustomerUseCase } from "@/application/use-cases/booking/compose";
import { makeListJobsForCustomerUseCase } from "@/application/use-cases/job/compose";
import { makeListConversationsUseCase } from "@/application/use-cases/chat/compose";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import { makeGetProfessionalQuotesUseCase } from "@/application/use-cases/quotes/compose";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { QuoteStatusBadge } from "@/app/(dashboard)/dashboard/professional/quotes/quote-status-badge";
import { RequestStatusBadge } from "@/app/(dashboard)/requests/request-status-badge";
import { DashboardStatCard } from "./dashboard-stat-card";

export const metadata = { title: "Dashboard" };

const INACTIVE_REQUEST_STATUSES = new Set(["COMPLETED", "CANCELLED", "EXPIRED"]);

/**
 * Dashboard overview — the landing page after login.
 *
 * Aggregates already-implemented modules' own use cases (service requests,
 * bookings, jobs, chat, and — for professionals — quotes). No new business
 * logic lives here: every number and list on this page is a direct read
 * through an existing `make*UseCase()` composition function, exactly like
 * every other page under (dashboard) already does. Anything a module
 * hasn't implemented yet (e.g. a "reviews I've written" list) is simply
 * left off this page rather than faked.
 */
export default async function DashboardPage() {
  const user = await requireAuth();
  const isProfessional = user.roles.includes(ROLES.PROVIDER);

  const [requests, appointments, jobs, conversations] = await Promise.all([
    makeGetCustomerServiceRequestsUseCase().execute(user.id),
    makeListAppointmentsForCustomerUseCase().execute(user.id, "upcoming"),
    makeListJobsForCustomerUseCase().execute(user.id, "active"),
    makeListConversationsUseCase().execute(user.id),
  ]);

  // Professional-side data only fetched for PROVIDER accounts — a
  // customer-only account has no ProfessionalProfile, and
  // GetProfessionalByUserIdUseCase/GetProfessionalQuotesUseCase both
  // already treat "no profile" as an empty/absent result rather than an
  // error, same convention as GetCustomerServiceRequestsUseCase above.
  const [professional, quotes] = isProfessional
    ? await Promise.all([
        makeGetProfessionalByUserIdUseCase().execute(user.id),
        makeGetProfessionalQuotesUseCase().execute(user.id),
      ])
    : [null, []];

  const unreadMessages = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
  const activeRequestCount = requests.filter((r) => !INACTIVE_REQUEST_STATUSES.has(r.status)).length;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back{user.email ? `, ${user.email}` : ""}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s an overview of your MaestroYa account.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <DashboardStatCard icon={FileText} label="Active requests" value={activeRequestCount} href="/requests" />
        <DashboardStatCard
          icon={CalendarDays}
          label="Upcoming appointments"
          value={appointments.length}
          href="/appointments"
        />
        <DashboardStatCard icon={Briefcase} label="Active jobs" value={jobs.length} href="/jobs" />
        <DashboardStatCard icon={MessageSquare} label="Unread messages" value={unreadMessages} href="/messages" />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Your requests</CardTitle>
            <Link href="/requests" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No service requests yet."
                description="Post a request to start getting quotes from professionals near you."
                action={
                  <ButtonLink href="/requests/new" size="sm">
                    New request
                  </ButtonLink>
                }
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {requests.slice(0, 4).map((request) => (
                  <li key={request.id}>
                    <Link
                      href={`/requests/${request.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 truncate font-medium">{request.title}</span>
                      <RequestStatusBadge status={request.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Upcoming appointments</CardTitle>
            <Link href="/appointments" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {appointments.length === 0 ? (
              <EmptyState
                icon={CalendarDays}
                title="No upcoming appointments."
                description="Appointments appear here once you accept a quote from a professional."
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {appointments.slice(0, 4).map((appointment) => (
                  <li key={appointment.id}>
                    <Link
                      href={`/appointments/${appointment.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 truncate font-medium">{appointment.serviceRequestTitle}</span>
                      <AppointmentStatusBadge status={appointment.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>Messages</CardTitle>
            <Link href="/messages" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title="No new messages."
                description="Conversations with customers and professionals show up here."
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {conversations.slice(0, 4).map((conversation) => (
                  <li key={conversation.id}>
                    <Link
                      href={`/messages/${conversation.id}`}
                      className="flex items-center justify-between gap-3 py-3 text-sm transition-colors hover:bg-muted"
                    >
                      <span className="min-w-0 truncate">
                        {conversation.otherParticipant.name ?? "Marketplace user"}
                      </span>
                      {conversation.unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {isProfessional && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle>Your quotes</CardTitle>
              <Link
                href="/dashboard/professional/quotes"
                className="text-sm font-medium text-primary hover:underline"
              >
                View all
              </Link>
            </CardHeader>
            <CardContent>
              {!professional ? (
                <EmptyState
                  icon={Award}
                  title="Set up your professional profile."
                  description="Create your professional profile to start receiving service requests to quote on."
                  action={
                    <ButtonLink href="/dashboard/professional" size="sm">
                      Get started
                    </ButtonLink>
                  }
                />
              ) : quotes.length === 0 ? (
                <EmptyState
                  icon={Award}
                  title="No quotes submitted yet."
                  description="Browse open service requests and send your first quote."
                  action={
                    <ButtonLink href="/dashboard/professional/requests" size="sm">
                      Browse requests
                    </ButtonLink>
                  }
                />
              ) : (
                <ul className="flex flex-col gap-3">
                  {quotes.slice(0, 4).map((quote) => (
                    <li key={quote.id}>
                      <Link
                        href={`/dashboard/professional/quotes/${quote.id}`}
                        className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm transition-colors hover:bg-muted"
                      >
                        <span className="min-w-0 truncate font-medium">{quote.serviceRequestTitle}</span>
                        <QuoteStatusBadge status={quote.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
