# Architecture

## Layering & the dependency rule

This project follows Clean Architecture, adapted to Next.js's App Router.
Four layers, one rule: **dependencies only point inward.** Outer layers
know about inner layers; inner layers know nothing about outer ones.

```
┌─────────────────────────────────────────────────────┐
│  presentation/   React components, hooks              │  outer
│  app/            Next.js routes (Server Components,   │
│                   Route Handlers, Server Actions)      │
├─────────────────────────────────────────────────────┤
│  infrastructure/ Prisma, Auth.js, Stripe, Cloudinary   │
│                   — concrete implementations of ports  │
├─────────────────────────────────────────────────────┤
│  application/    Use cases — orchestrate domain +      │
│                   repository interfaces                │
├─────────────────────────────────────────────────────┤
│  domain/         Entities, value objects, repository   │  inner
│                   interfaces, domain errors             │  (core)
└─────────────────────────────────────────────────────┘
```

Concretely, under `src/core/`:

- **`domain/`** — pure business logic and rules. Zero framework imports:
  no Next.js, no Prisma, no React. This is what makes it unit-testable in
  milliseconds with no mocking (see `tests/unit/core/domain/entity.test.ts`
  for a working example). Contains entities, value objects, repository
  *interfaces* (not implementations), and domain-specific errors.

- **`application/`** — use cases that orchestrate domain objects via
  repository interfaces. A use case doesn't know if it's called from a
  Route Handler, a Server Action, or a test file — and doesn't know if
  the repository behind the interface it depends on is backed by Prisma
  or an in-memory fake.

- **`infrastructure/`** — every concrete, swappable implementation detail:
  Prisma client + Prisma-backed repositories, Auth.js configuration,
  Stripe client, Cloudinary client, environment validation. This is the
  only layer allowed to import third-party SDKs directly.

- **`presentation/`** (`src/presentation/`) — React components and hooks.
  `components/ui/` holds generic, app-agnostic primitives (Button, Input);
  `components/shared/` holds composite, app-aware components reused
  across routes.

- **`app/`** — Next.js's routing layer. Route Handlers and Server Actions
  here are thin: they parse input, call a use case, translate the result
  into an HTTP response or redirect. Business logic does not live here.

## Server Components by default

Every component is a Server Component unless it has a `"use client"`
directive at the top of the file. Add that directive only when a
component genuinely needs:
- interactivity (`onClick`, `onChange`, etc.)
- browser-only APIs
- React hooks that require the client (`useState`, `useEffect`, and
  TanStack Query's hooks)

Practically:
- Page-level data fetching happens directly in `async` Server Components,
  calling a use case — **not** via a `useQuery` call.
- TanStack Query is for genuinely client-side, interactive data needs
  (optimistic updates, polling, infinite scroll) — not the default way
  data reaches a page.
- Push `"use client"` as far down the tree as possible. A Server
  Component page can render a small Client Component button; it
  shouldn't itself become a Client Component just because one child
  needs interactivity.

`src/app/providers.tsx` is the one root-level client boundary
(TanStack Query's provider). It does not make its `children` client
components — Server Components can be passed through a Client
Component's `children` prop and still render on the server.

## Path aliases

Configured in `tsconfig.json`:

| Alias | Points to |
|---|---|
| `@/*` | `src/*` |
| `@/domain/*` | `src/core/domain/*` |
| `@/application/*` | `src/core/application/*` |
| `@/infrastructure/*` | `src/core/infrastructure/*` |
| `@/presentation/*`, `@/components/*`, `@/hooks/*` | `src/presentation/*` |
| `@/lib/*` | `src/lib/*` |
| `@/shared/*` | `src/shared/*` |

## Adding a new feature (once marketplace work begins)

For a new bounded concept (e.g. "service requests"):

1. **Domain:** add the entity in `domain/entities/`, any value objects it
   needs, a `ServiceRequestRepository` interface in `domain/repositories/`,
   and any feature-specific errors in `domain/errors/`.
2. **Application:** add use cases in `application/use-cases/`
   (`create-service-request.use-case.ts`, etc.) and DTOs in
   `application/dto/` for their inputs/outputs.
3. **Infrastructure:** implement `ServiceRequestRepository` against Prisma
   in `infrastructure/database/prisma/repositories/`, and add the
   corresponding model to `prisma/schema.prisma`.
4. **Presentation/app:** build the route under `app/`, calling the use
   case from a Server Component or Server Action; add any interactive UI
   pieces under `presentation/`.

This keeps the dependency rule intact: domain never imports from
application, infrastructure, or app; application never imports from
infrastructure or app directly (only through interfaces it defines).

## Known gap: enforcement

The layering above is currently a *convention*, not yet a lint rule.
Once real modules exist, consider adding `eslint-plugin-boundaries` (or
similar) configured to fail CI if e.g. `domain/` imports anything from
`infrastructure/`. Noted here rather than added now, since there's
nothing to enforce boundaries around yet.
