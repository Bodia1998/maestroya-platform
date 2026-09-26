import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  Award,
  Briefcase,
  CalendarDays,
  FileSignature,
  FileText,
  MessageSquare,
  Search,
  User,
} from "lucide-react";

import { requireAuth, ROLES } from "@/infrastructure/auth/rbac";
import { makeGetCustomerServiceRequestsUseCase } from "@/application/use-cases/service-request/compose";
import { makeListAppointmentsForCustomerUseCase, makeListAppointmentsForProfessionalUseCase } from "@/application/use-cases/booking/compose";
import { makeListJobsForCustomerUseCase, makeListJobsForProfessionalUseCase } from "@/application/use-cases/job/compose";
import { makeListConversationsUseCase } from "@/application/use-cases/chat/compose";
import { makeGetProfessionalByUserIdUseCase } from "@/application/use-cases/professional/compose";
import {
  makeGetAvailableServiceRequestsForProfessionalUseCase,
  makeGetProfessionalQuotesUseCase,
} from "@/application/use-cases/quotes/compose";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/ui/typography";
import { PageHeader } from "@/components/dashboard/page-header";
import { PageContainer } from "@/components/layout/page-container";
import { ResponsiveGrid } from "@/components/layout/responsive-grid";
import { AppointmentStatusBadge } from "@/app/(dashboard)/appointments/appointment-status-badge";
import { QuoteStatusBadge } from "@/app/(dashboard)/dashboard/professional/quotes/quote-status-badge";
import { RequestStatusBadge } from "@/app/(dashboard)/requests/request-status-badge";
import { DashboardStatCard } from "./dashboard-stat-card";

/** Customer-side quick actions — every href is an existing, already-linked route. */
const CUSTOMER_QUICK_ACTIONS = [
  { href: "/requests/new", labelKey: "newRequest", icon: FileText },
  { href: "/appointments", labelKey: "appointments", icon: CalendarDays },
  { href: "/messages", labelKey: "messages", icon: MessageSquare },
  { href: "/profile", labelKey: "profile", icon: User },
] as const;

/** Professional-side quick actions — every href is an existing, already-linked route. */
const PROFESSIONAL_QUICK_ACTIONS = [
  { href: "/dashboard/professional/requests", labelKey: "browseRequests", icon: Search },
  { href: "/dashboard/professional/quotes", labelKey: "myQuotes", icon: FileSignature },
  { href: "/dashboard/professional/appointments", labelKey: "appointments", icon: CalendarDays },
  { href: "/dashboard/professional", labelKey: "professionalProfile", icon: User },
] as const;

/** Quote statuses that mean "sent to the customer, no answer yet". */
const QUOTE_AWAITING_RESPONSE_STATUSES = new Set(["SENT", "VIEWED"]);

export async function generateMetadata() {
  const t = await getTranslations("dashboard");
  return { title: t("title") };
}

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
 *
 * Role isolation: for a PROVIDER account, `/dashboard` is the *Professional*
 * workspace's own overview (see resolve-post-login-destination.ts and
 * dashboard-shell.tsx's `resolveVisibleNavGroups`, which already resolve
 * this exact route to the Professional sidebar context for such accounts).
 * The customer-side stat row and "Your requests"/"Upcoming appointments"
 * cards below are therefore only ever rendered for a non-professional
 * account — a dual-role account still has full customer functionality, but
 * reaches it through the customer-context pages (`/requests`,
 * `/appointments`, ...), never through the Professional workspace's own
 * overview. Customer-only reads (requests/appointments/jobs) are skipped
 * entirely for a professional account rather than fetched and discarded —
 * `conversations` is the one exception, since Messages is a shared module
 * relevant to both contexts (see build-dashboard-nav-groups.ts).
 */
export default async function DashboardPage() {
  const user = await requireAuth();
  const isProfessional = user.roles.includes(ROLES.PROVIDER);
  const [t, tMessages] = await Promise.all([
    getTranslations("dashboard.overview"),
    getTranslations("customer.messages"),
  ]);

  const conversations = await makeListConversationsUseCase().execute(user.id);

  const [requests, appointments, jobs] = isProfessional
    ? [[], [], []]
    : await Promise.all([
        makeGetCustomerServiceRequestsUseCase().execute(user.id),
        makeListAppointmentsForCustomerUseCase().execute(user.id, "upcoming"),
        makeListJobsForCustomerUseCase().execute(user.id, "active"),
      ]);

  // Professional-side data only fetched for PROVIDER accounts — a
  // customer-only account has no ProfessionalProfile, and every use case
  // below already treats "no profile" as an empty/absent result rather
  // than an error, same convention as GetCustomerServiceRequestsUseCase
  // above. Reuses the exact same use cases the dedicated professional
  // pages (Available requests, My quotes, My appointments, My jobs) each
  // already call — no new business logic, this page only aggregates their
  // results into an overview.
  const [professional, quotes, availableRequests, professionalAppointments, activeJobs, completedJobs] =
    isProfessional
      ? await Promise.all([
          makeGetProfessionalByUserIdUseCase().execute(user.id),
          makeGetProfessionalQuotesUseCase().execute(user.id),
          makeGetAvailableServiceRequestsForProfessionalUseCase().execute(user.id),
          makeListAppointmentsForProfessionalUseCase().execute(user.id, "upcoming"),
          makeListJobsForProfessionalUseCase().execute(user.id, "active"),
          makeListJobsForProfessionalUseCase().execute(user.id, "completed"),
        ])
      : [null, [], [], [], [], []];

  const quotesAwaitingResponse = quotes.filter((q) => QUOTE_AWAITING_RESPONSE_STATUSES.has(q.status)).length;
  const acceptedQuotes = quotes.filter((q) => q.status === "ACCEPTED").length;

  const unreadMessages = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
  const activeRequestCount = requests.filter((r) => !INACTIVE_REQUEST_STATUSES.has(r.status)).length;

  return (
    <PageContainer maxWidth="6xl">
      <PageHeader
        title={user.email ? t("welcomeBack", { name: user.email }) : t("welcomeBackAnonymous")}
        subtitle={t("subtitle")}
      />

      {isProfessional && (
        <section className="flex flex-col gap-4">
          <div>
            <Heading as="h2" level="h6">
              {t("professionalOverview.title")}
            </Heading>
            <p className="mt-1 text-sm text-muted-foreground">{t("professionalOverview.description")}</p>
          </div>
          <ResponsiveGrid cols="1-2-4">
            <DashboardStatCard
              icon={FileText}
              label={t("stats.availableRequests")}
              value={availableRequests.length}
              href="/dashboard/professional/requests"
            />
            <DashboardStatCard
              icon={Award}
              label={t("stats.quotesAwaitingResponse")}
              value={quotesAwaitingResponse}
              href="/dashboard/professional/quotes"
            />
            <DashboardStatCard
              icon={Award}
              label={t("stats.acceptedQuotes")}
              value={acceptedQuotes}
              href="/dashboard/professional/quotes"
            />
            <DashboardStatCard
              icon={CalendarDays}
              label={t("stats.upcomingAppointments")}
              value={professionalAppointments.length}
              href="/dashboard/professional/appointments"
            />
            <DashboardStatCard
              icon={Briefcase}
              label={t("stats.activeJobs")}
              value={activeJobs.length}
              href="/dashboard/professional/jobs"
            />
            <DashboardStatCard
              icon={Briefcase}
              label={t("stats.completedJobs")}
              value={completedJobs.length}
              href="/dashboard/professional/jobs"
            />
          </ResponsiveGrid>

          <nav aria-label={t("quickActions.ariaLabel")} className="flex flex-wrap gap-2">
            {PROFESSIONAL_QUICK_ACTIONS.map((action) => (
              <ButtonLink key={action.href} href={action.href} variant="outline" size="sm">
                <action.icon className="h-4 w-4" aria-hidden />
                {t(`quickActions.${action.labelKey}`)}
              </ButtonLink>
            ))}
          </nav>
        </section>
      )}

      {/* Customer-side overview — never rendered for a professional account.
          The Professional workspace (this same /dashboard route for a
          PROVIDER account) must show only Professional UI; a dual-role
          account still reaches its full customer functionality through the
          customer-context pages (/requests, /appointments, ...), just not
          from this overview. See the doc comment on DashboardPage above. */}
      {!isProfessional && (
        <>
          <ResponsiveGrid cols="1-2-4">
            <DashboardStatCard icon={FileText} label={t("stats.activeRequests")} value={activeRequestCount} href="/requests" />
            <DashboardStatCard
              icon={CalendarDays}
              label={t("stats.upcomingAppointments")}
              value={appointments.length}
              href="/appointments"
            />
            <DashboardStatCard icon={Briefcase} label={t("stats.activeJobs")} value={jobs.length} href="/jobs" />
            <DashboardStatCard
              icon={MessageSquare}
              label={t("stats.unreadMessages")}
              value={unreadMessages}
              href="/messages"
            />
          </ResponsiveGrid>

          <nav aria-label={t("quickActions.ariaLabel")} className="flex flex-wrap gap-2">
            {CUSTOMER_QUICK_ACTIONS.map((action) => (
              <ButtonLink key={action.href} href={action.href} variant="outline" size="sm">
                <action.icon className="h-4 w-4" aria-hidden />
                {t(`quickActions.${action.labelKey}`)}
              </ButtonLink>
            ))}
          </nav>

          <ResponsiveGrid cols="1-2-lg" gap="lg">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle>{t("cards.yourRequests")}</CardTitle>
                <Link href="/requests" className="text-sm font-medium text-primary hover:underline">
                  {t("cards.viewAll")}
                </Link>
              </CardHeader>
              <CardContent>
                {requests.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title={t("empty.requests.title")}
                    description={t("empty.requests.description")}
                    action={
                      <ButtonLink href="/requests/new" size="sm">
                        {t("quickActions.newRequest")}
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
                <CardTitle>{t("cards.upcomingAppointments")}</CardTitle>
                <Link href="/appointments" className="text-sm font-medium text-primary hover:underline">
                  {t("cards.viewAll")}
                </Link>
              </CardHeader>
              <CardContent>
                {appointments.length === 0 ? (
                  <EmptyState
                    icon={CalendarDays}
                    title={t("empty.appointments.title")}
                    description={t("empty.appointments.description")}
                    action={
                      <ButtonLink href="/requests" size="sm" variant="outline">
                        {t("empty.appointments.action")}
                      </ButtonLink>
                    }
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
          </ResponsiveGrid>
        </>
      )}

      <ResponsiveGrid cols="1-2-lg" gap="lg">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle>{t("cards.messages")}</CardTitle>
            <Link href="/messages" className="text-sm font-medium text-primary hover:underline">
              {t("cards.viewAll")}
            </Link>
          </CardHeader>
          <CardContent>
            {conversations.length === 0 ? (
              <EmptyState
                icon={MessageSquare}
                title={t("empty.messages.title")}
                description={t("empty.messages.description")}
                action={
                  <ButtonLink href="/messages" size="sm" variant="outline">
                    {t("empty.messages.action")}
                  </ButtonLink>
                }
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
                        {conversation.otherParticipant.name ?? tMessages("unknownParticipant")}
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
              <CardTitle>{t("cards.yourQuotes")}</CardTitle>
              <Link
                href="/dashboard/professional/quotes"
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("cards.viewAll")}
              </Link>
            </CardHeader>
            <CardContent>
              {!professional ? (
                <EmptyState
                  icon={Award}
                  title={t("empty.noProfessionalProfile.title")}
                  description={t("empty.noProfessionalProfile.description")}
                  action={
                    <ButtonLink href="/dashboard/professional" size="sm">
                      {t("empty.noProfessionalProfile.action")}
                    </ButtonLink>
                  }
                />
              ) : quotes.length === 0 ? (
                <EmptyState
                  icon={Award}
                  title={t("empty.quotes.title")}
                  description={t("empty.quotes.description")}
                  action={
                    <ButtonLink href="/dashboard/professional/requests" size="sm">
                      {t("quickActions.browseRequests")}
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
      </ResponsiveGrid>
    </PageContainer>
  );
}
