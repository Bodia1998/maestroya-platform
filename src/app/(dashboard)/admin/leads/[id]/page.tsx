import { getTranslations } from "next-intl/server";

import { getAdminLeadDetailAction } from "../actions";
import { DecideClaimDialog, RevokePurchaseDialog, StartClaimReviewButton } from "../_components/lead-action-forms";
import { BasisBadge, PrivacyNote, SectionNav, ShortId, formatWhen } from "../_components/lead-ops-ui";
import { AdminDataTable, AdminTableBody, AdminTableHeadRow, AdminTableRow, AdminTh } from "@/components/dashboard/admin-data-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata() {
  const t = await getTranslations("admin");
  return { title: t("common.metaTitle", { page: t("leadOps.detail.title") }) };
}

/**
 * Module 157 — lead investigation view. Read-only except for the controls that call the existing M154 / M155 use cases.
 * Facts, audit entries, derived indicators and heuristic signals are visibly labelled. No contact data is loaded or shown (D26).
 */
export default async function AdminLeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getAdminLeadDetailAction(id);
  const t = await getTranslations("admin.leadOps");

  if (!result.success) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t("detail.title")} />
        <SectionNav active="leads" />
        <p role="alert" className="rounded-md bg-red-100 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      </div>
    );
  }

  const d = result.data;
  const tl = (code: string) => (t.has(`timeline.${code}` as never) ? t(`timeline.${code}` as never) : code);
  const openClaim = (status: string) => status === "SUBMITTED" || status === "UNDER_REVIEW";
  const purchaseOfClaim = new Map(d.purchases.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={t("detail.title")} subtitle={d.lead.id} />
      <SectionNav active="leads" />
      <PrivacyNote />

      <section aria-labelledby="summary" className="flex flex-col gap-2">
        <h2 id="summary" className="text-lg font-semibold">
          {t("detail.summary")} <BasisBadge basis="RECORDED_FACT" />
        </h2>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          <div><dt className="inline text-muted-foreground">{t("columns.status")}: </dt><dd className="inline"><StatusBadge status={d.lead.status} /></dd></div>
          <div><dt className="inline text-muted-foreground">{t("detail.requestStatus")}: </dt><dd className="inline">{d.lead.requestStatus}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("columns.category")}: </dt><dd className="inline">{d.lead.categoryName}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("columns.location")}: </dt><dd className="inline">{[d.lead.city, d.lead.province].filter(Boolean).join(", ") || "—"}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("columns.created")}: </dt><dd className="inline">{formatWhen(d.lead.createdAt)}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("detail.published")}: </dt><dd className="inline">{formatWhen(d.lead.publishedAt)}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("columns.fee")}: </dt><dd className="inline">{d.lead.publicationPrice ? `${d.lead.publicationPrice} ${d.lead.publicationCurrency ?? ""}` : "—"}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("detail.maxBuyers")}: </dt><dd className="inline">{d.lead.maxBuyers ?? "—"}</dd></div>
          <div><dt className="inline text-muted-foreground">{t("detail.flowVersion")}: </dt><dd className="inline">{d.lead.flowVersion}</dd></div>
          <div>
            <dt className="inline text-muted-foreground">{t("detail.customer")}: </dt>
            <dd className="inline"><ShortId id={d.lead.customerUserId} href={`/admin/leads/abuse/${d.lead.customerUserId}`} /></dd>
          </div>
        </dl>
      </section>

      {d.indicators.length > 0 && (
        <section aria-labelledby="indicators" className="flex flex-col gap-2">
          <h2 id="indicators" className="text-lg font-semibold">
            {t("detail.indicators")} <BasisBadge basis="DERIVED" />
          </h2>
          <p className="text-sm text-muted-foreground">{t("detail.indicatorsNote")}</p>
          <ul className="list-disc pl-6 text-sm">
            {d.indicators.map((i) => (
              <li key={`${i.code}-${i.refId}`}>
                {t(`indicators.${i.code}` as never)} {i.refId !== "lead" && <ShortId id={i.refId} />}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="purchases" className="flex flex-col gap-2">
        <h2 id="purchases" className="text-lg font-semibold">{t("detail.purchases")} <BasisBadge basis="RECORDED_FACT" /></h2>
        {d.purchases.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <AdminDataTable caption={t("detail.purchases")} minWidth={900}>
            <AdminTableHeadRow>
              <AdminTh>{t("columns.purchase")}</AdminTh>
              <AdminTh>{t("columns.status")}</AdminTh>
              <AdminTh>{t("detail.professional")}</AdminTh>
              <AdminTh>{t("columns.fee")}</AdminTh>
              <AdminTh>{t("detail.total")}</AdminTh>
              <AdminTh>{t("detail.confirmedAt")}</AdminTh>
              <AdminTh>{t("detail.actions")}</AdminTh>
            </AdminTableHeadRow>
            <AdminTableBody>
              {d.purchases.map((p) => (
                <AdminTableRow key={p.id}>
                  <td className="px-4 py-3"><ShortId id={p.id} /></td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3"><ShortId id={p.professionalUserId} href={`/admin/leads/abuse/${p.professionalUserId}`} /></td>
                  <td className="px-4 py-3">{p.price} {p.currency}</td>
                  <td className="px-4 py-3">{p.totalAmount ? `${p.totalAmount} ${p.currency}` : "—"}</td>
                  <td className="px-4 py-3">{formatWhen(p.confirmedAt)}</td>
                  <td className="px-4 py-3">{p.status === "CONFIRMED" ? <RevokePurchaseDialog leadPurchaseId={p.id} /> : null}</td>
                </AdminTableRow>
              ))}
            </AdminTableBody>
          </AdminDataTable>
        )}
      </section>

      <section aria-labelledby="claims" className="flex flex-col gap-2">
        <h2 id="claims" className="text-lg font-semibold">{t("detail.claims")} <BasisBadge basis="RECORDED_FACT" /></h2>
        <p className="text-sm text-muted-foreground">{t("detail.claimsNote")}</p>
        {d.claims.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {d.claims.map((c) => (
              <li key={c.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <ShortId id={c.id} /> <StatusBadge status={c.status} /> <Badge variant="outline">{c.reasonCode}</Badge>
                  <span className="text-muted-foreground">{t("detail.respondBy")}: {formatWhen(c.respondBy)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{c.description}</p>
                {c.decisionExplanation && <p className="mt-2 text-muted-foreground">{t("detail.decisionExplanation")}: {c.decisionExplanation}</p>}
                {openClaim(c.status) && purchaseOfClaim.has(c.leadPurchaseId) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {c.status === "SUBMITTED" && <StartClaimReviewButton claimId={c.id} />}
                    <DecideClaimDialog claimId={c.id} decision="APPROVED" />
                    <DecideClaimDialog claimId={c.id} decision="REJECTED" />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="disputes" className="flex flex-col gap-2">
        <h2 id="disputes" className="text-lg font-semibold">{t("detail.disputes")} <BasisBadge basis="RECORDED_FACT" /></h2>
        {d.disputes.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {d.disputes.map((x) => (
              <li key={x.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <ShortId id={x.id} /> <StatusBadge status={x.status} />
                  <span>{x.amount} {x.currency}</span>
                  <span className="text-muted-foreground">{t("detail.openedAt")}: {formatWhen(x.openedAt)}</span>
                  <span className="text-muted-foreground">{t("detail.evidence")}: {x.evidenceStatus}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="revocations" className="flex flex-col gap-2">
        <h2 id="revocations" className="text-lg font-semibold">{t("detail.revocations")} <BasisBadge basis="RECORDED_FACT" /></h2>
        {d.revocations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {d.revocations.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <Badge variant="outline">{r.source}</Badge> <span className="text-muted-foreground">{formatWhen(r.createdAt)}</span>
                {r.explanation && <p className="mt-1 whitespace-pre-wrap">{r.explanation}</p>}
                {r.evidenceReference && <p className="text-muted-foreground">{t("detail.evidenceReference")}: {r.evidenceReference}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="signals" className="flex flex-col gap-2">
        <h2 id="signals" className="text-lg font-semibold">{t("detail.signals")} <BasisBadge basis="HEURISTIC_SIGNAL" /></h2>
        <p className="text-sm text-muted-foreground">{t("detail.signalsNote")}</p>
        {d.signals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("detail.none")}</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {d.signals.map((s) => (
              <li key={s.id}>
                {formatWhen(s.occurredAt)} — {s.signalType} ({s.reliability}) · <ShortId id={s.subjectUserId} href={`/admin/leads/abuse/${s.subjectUserId}`} />
                {s.recordOnly && <Badge className="ml-2" variant="outline">{t("detail.recordOnly")}</Badge>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="timeline" className="flex flex-col gap-2">
        <h2 id="timeline" className="text-lg font-semibold">{t("detail.timeline")}</h2>
        <ol className="flex flex-col gap-1 text-sm">
          {d.timeline.map((e) => (
            <li key={`${e.subject}-${e.refId}-${e.code}-${e.at.toISOString()}`} className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-muted-foreground">{formatWhen(e.at)}</span>
              <BasisBadge basis={e.basis} />
              <span>{tl(e.code)}</span>
              {(e.fromStatus || e.toStatus) && <span className="text-muted-foreground">{e.fromStatus ?? "·"} → {e.toStatus ?? "·"}</span>}
              {e.actorUserId && <ShortId id={e.actorUserId} />}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
