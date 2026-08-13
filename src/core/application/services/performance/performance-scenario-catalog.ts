import { PerformanceScenario, WorkloadProfile } from "@/domain/entities/performance-scenario";

/**
 * Module 57 — Load Testing & Capacity Planning.
 *
 * The full catalog of simulatable workloads, as a **code-defined list**,
 * not a database table — identical reasoning to Module 54's
 * `disaster-recovery-plans.ts`'s own doc comment: a workload definition
 * is a reviewed, deployed engineering artifact exactly as load-bearing as
 * code, and an admin-editable scenario would make capacity reports
 * impossible to compare meaningfully across time (today's report and
 * next month's would silently be measuring different things).
 *
 * `virtualUsers`/`durationSeconds` below are deliberately modest defaults
 * (representative of a single steady-state sample), not the *target*
 * capacity — `CapacityPlanningService` is what extrapolates a scenario's
 * measured behaviour at this baseline concurrency out to the much larger
 * `CAPACITY_USER_TIERS`.
 */
export const PERFORMANCE_SCENARIO_CATALOG: readonly PerformanceScenario[] = [
  PerformanceScenario.define({
    id: "user-registration",
    name: "User Registration",
    category: "USER_REGISTRATION",
    description: "New account creation: form submission, password hashing, verification email dispatch.",
    workloadProfile: new WorkloadProfile(50, 60, 10),
    thinkTimeMs: 500,
  }),
  PerformanceScenario.define({
    id: "authentication",
    name: "Authentication",
    category: "AUTHENTICATION",
    description: "Login: credential lookup, password verification, session/JWT issuance.",
    workloadProfile: new WorkloadProfile(200, 60, 10, 2),
    thinkTimeMs: 200,
  }),
  PerformanceScenario.define({
    id: "password-reset",
    name: "Password Reset",
    category: "PASSWORD_RESET",
    description: "Reset-token issuance, email dispatch, and token redemption.",
    workloadProfile: new WorkloadProfile(20, 60, 5),
    thinkTimeMs: 1000,
  }),
  PerformanceScenario.define({
    id: "search",
    name: "Search",
    category: "SEARCH",
    description: "Full-text/geo search over professionals and service categories (Module 19's search engine).",
    workloadProfile: new WorkloadProfile(300, 60, 10, 3),
    thinkTimeMs: 300,
  }),
  PerformanceScenario.define({
    id: "create-service-request",
    name: "Create Service Request",
    category: "CREATE_SERVICE_REQUEST",
    description: "A customer publishing a new service request, including category/location validation.",
    workloadProfile: new WorkloadProfile(100, 60, 10),
    thinkTimeMs: 800,
  }),
  PerformanceScenario.define({
    id: "browse-professionals",
    name: "Browse Professionals",
    category: "BROWSE_PROFESSIONALS",
    description: "Cache-friendly directory/profile browsing — read-heavy, low write amplification.",
    workloadProfile: new WorkloadProfile(400, 60, 10, 4),
    thinkTimeMs: 400,
  }),
  PerformanceScenario.define({
    id: "submit-quote",
    name: "Submit Quote",
    category: "SUBMIT_QUOTE",
    description: "A professional submitting a quote against a service request.",
    workloadProfile: new WorkloadProfile(80, 60, 10),
    thinkTimeMs: 1000,
  }),
  PerformanceScenario.define({
    id: "accept-quote",
    name: "Accept Quote",
    category: "ACCEPT_QUOTE",
    description: "A customer accepting a quote — triggers booking creation and notification fan-out.",
    workloadProfile: new WorkloadProfile(80, 60, 10),
    thinkTimeMs: 600,
  }),
  PerformanceScenario.define({
    id: "booking",
    name: "Booking",
    category: "BOOKING",
    description: "Booking lifecycle transitions (schedule, confirm, complete).",
    workloadProfile: new WorkloadProfile(100, 60, 10),
    thinkTimeMs: 500,
  }),
  PerformanceScenario.define({
    id: "messaging",
    name: "Messaging",
    category: "MESSAGING",
    description: "In-app messaging between customer and professional, including realtime delivery (Module 30).",
    workloadProfile: new WorkloadProfile(250, 60, 10, 3),
    thinkTimeMs: 250,
  }),
  PerformanceScenario.define({
    id: "notifications",
    name: "Notifications",
    category: "NOTIFICATIONS",
    description: "Notification fan-out across email/push/in-app channels.",
    workloadProfile: new WorkloadProfile(150, 60, 10, 2),
    thinkTimeMs: 300,
  }),
  PerformanceScenario.define({
    id: "stripe-payment-flow",
    name: "Stripe Payment Flow (mock implementation)",
    category: "STRIPE_PAYMENT_FLOW",
    description:
      "Simulates the shape and timing of a payment intent creation, confirmation, and webhook round-trip — " +
      "never a real Stripe API call. See `BenchmarkRunner`'s own doc comment for why this scenario category " +
      "carries deliberately elevated, bimodal latency (mirroring a real payment gateway's network hop).",
    workloadProfile: new WorkloadProfile(60, 60, 10),
    thinkTimeMs: 1500,
  }),
  PerformanceScenario.define({
    id: "admin-dashboard",
    name: "Admin Dashboard",
    category: "ADMIN_DASHBOARD",
    description: "Aggregate-heavy admin analytics/reporting reads (Module 50).",
    workloadProfile: new WorkloadProfile(20, 60, 5),
    thinkTimeMs: 2000,
  }),
  PerformanceScenario.define({
    id: "concurrent-api-traffic",
    name: "Concurrent API Traffic",
    category: "CONCURRENT_API_TRAFFIC",
    description: "Generic high-concurrency mixed API traffic, independent of any one business flow — a raw throughput/saturation probe.",
    workloadProfile: new WorkloadProfile(1000, 60, 15, 5),
    thinkTimeMs: 100,
  }),
  PerformanceScenario.define({
    id: "database-intensive",
    name: "Database Intensive",
    category: "DATABASE_INTENSIVE",
    description: "Write-heavy, multi-table transactional workload (bookings + payments + notifications in one flow) — the scenario most likely to expose connection-pool exhaustion.",
    workloadProfile: new WorkloadProfile(150, 90, 15, 2),
    thinkTimeMs: 200,
  }),
  PerformanceScenario.define({
    id: "mixed-workload",
    name: "Mixed Workload",
    category: "MIXED_WORKLOAD",
    description: "A blended, realistic traffic mix across the platform's core flows, approximating a real production hour.",
    workloadProfile: new WorkloadProfile(500, 120, 20, 3),
    thinkTimeMs: 400,
  }),
];

/** Looks up a scenario by id, or `null` when the id is not in the catalog — a caller-facing lookup should always translate `null` into a typed `NotFoundError`, see `ExecuteLoadTestUseCase`. */
export function findScenarioById(id: string): PerformanceScenario | null {
  return PERFORMANCE_SCENARIO_CATALOG.find((scenario) => scenario.id === id) ?? null;
}
