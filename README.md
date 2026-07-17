# MaestroYa Platform

Home services marketplace for Spain. This repository contains the
**project structure only** — the Clean Architecture scaffolding, tooling,
and configuration needed before any marketplace feature (bookings,
provider profiles, payments, etc.) is built.

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for the layering rules
and where new code should go.

## Stack

- **Framework:** Next.js 15 (App Router, Server Components by default)
- **Language:** TypeScript (strict mode)
- **UI:** React 19, Tailwind CSS
- **Data:** Prisma + PostgreSQL
- **Auth:** Auth.js
- **Payments:** Stripe Connect
- **Media:** Cloudinary
- **Forms/validation:** React Hook Form + Zod
- **Server state (client-side):** TanStack Query
- **Testing:** Vitest (unit), Playwright (e2e)

## Getting started

### 1. Prerequisites
- Node.js 20+ (see `.nvmrc`)
- Docker (for local PostgreSQL) — or your own Postgres instance

### 2. Install
```bash
npm install
```

### 3. Environment variables
```bash
cp .env.example .env.local
```
Fill in the values — see comments in `.env.example` for what each one is
for. `src/core/infrastructure/config/env.ts` validates these at startup
and will fail fast with a clear message if something's missing.

### 4. Database
```bash
docker compose up -d          # start local Postgres
npm run prisma:migrate        # apply migrations
npm run prisma:seed           # seed languages, service categories, roles
```

### 5. Run
```bash
npm run dev
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` / `npm run start` | Production build / serve |
| `npm run lint` / `npm run lint:fix` | ESLint |
| `npm run format` / `npm run format:check` | Prettier |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run test` / `npm run test:watch` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run prisma:studio` | Browse the database |
| `npm run prisma:seed` | Seed languages, service categories, roles |

## Project status

This is a **structure-only** scaffold. No marketplace domain logic
(providers, bookings, service categories, reviews, payments flows) has
been implemented yet — see `docs/ARCHITECTURE.md` for how those should be
added when that work begins.
