# Module 91 — Real-DB Test Environment Fix

Diagnosis and configuration-only fix for `npm run test:integration:db` /
`npm run db:migrate:test` / `TEST_DATABASE_URL` wiring. No Module 96
business logic touched. No secrets appear anywhere in this file.

This is the second, corrected pass — it fixes a real bug in the loader
the first pass shipped. See §2 for exactly what was wrong and how it was
found.

## 1. Root cause of the original "Prisma still hits Supabase" report (unchanged from pass 1)

`prisma/schema.prisma`'s datasource block is `url = env("DATABASE_URL")`
— hardcoded, no knowledge of `TEST_DATABASE_URL`. The Prisma CLI also
auto-loads `.env` at the project root itself, independently of this
repo's own code. So a bare `TEST_DATABASE_URL=... npx prisma migrate
deploy` leaves `DATABASE_URL` unset in that shell, and Prisma's own
`.env` auto-load fills it from this repo's real `.env` (the live
Supabase URL). Fixed by `scripts/migrate-test-db.ts`, which resolves and
validates `TEST_DATABASE_URL` first, then spawns `prisma migrate deploy`
as a child process with `DATABASE_URL` set only in that child's own env.

## 2. Root cause of THIS round's bug — `.env.test.local` silently ignored

**Reproduced directly, not guessed.** The previous loader used Node's
built-in `process.loadEnvFile()`. That API's documented behavior is to
**refuse to override a variable that is already "defined" in
`process.env` — including an already-defined empty string.** If
`TEST_DATABASE_URL` is already present in the parent shell as `""` (a
leftover `export TEST_DATABASE_URL=` from earlier debugging, a stray
line in a shell profile, terminal/IDE env passthrough — very plausible
on a real developer machine after experimenting with this same feature),
`loadEnvFile()` silently keeps that empty value and never reads
`.env.test.local` at all — with zero diagnostic output. `resolveTestDatabaseUrl()`
then correctly treats the empty string as "not set" and reports
`Neither TEST_DATABASE_URL nor DATABASE_URL is set` — exactly the
reported symptom, even though the real value was sitting right there in
`.env.test.local`.

Reproduction (in this session, before the fix):

```
TEST_DATABASE_URL= npm run db:migrate:test
```
with a real `TEST_DATABASE_URL=...` line already in `.env.test.local` →
`UnsafeTestDatabaseUrlError: Neither TEST_DATABASE_URL nor DATABASE_URL
is set.` — confirmed the exact failure mode, on demand.

Ruled out along the way (all checked directly, none were the cause):
loader call order (it already ran before `resolveTestDatabaseUrl()` in
both files), `export `-prefixed lines (Node's file parser already
handles those), unquoted values (also handled), and the loaded file's
path resolution (already anchored to the script's own file location via
`import.meta.url`, not `cwd`, so `npm run` invocation directory was never
the issue).

## 3. Exact files changed this round

- **New file `tests/test-utils/db/local-test-env.ts`** — a small,
  dependency-free `.env.test.local` parser (`export `-prefix, `#`
  comments, quoted/unquoted values) whose `loadLocalTestEnv(repoRoot)`
  **force-overrides** `process.env` for every key the file defines —
  the fix. Logs only whether `TEST_DATABASE_URL` was found in the file,
  never its value or any other key's value. Shared by both entry points
  below (no duplicated parsing logic).
- **`vitest.config.integration-db.ts`** — replaced the `process.loadEnvFile()`
  call with `loadLocalTestEnv(__dirname)`. Still runs before
  `resolveTestDatabaseUrl()`, still only ever reads `.env.test.local`.
- **`scripts/migrate-test-db.ts`** — same replacement,
  `loadLocalTestEnv(repoRoot)` in place of the old `existsSync` +
  `process.loadEnvFile()` block; doc comment updated accordingly.
- `.env`, `.env.local`, `.env.production` — untouched (confirmed via
  `git status`, both rounds).
- No changes to `tests/test-utils/db/test-database-url.ts` (the
  `UnsafeTestDatabaseUrlError` guard itself) — fully intact.
- No `git add`/`commit`/`push`, no branch change, no migration files
  renamed, no Module 96 code touched.

## 4. Why the previous implementation failed

It used the right idea (load `.env.test.local` before resolving the
URL) but the wrong primitive: `process.loadEnvFile()`'s "don't clobber
an existing value" default is reasonable for a normal app boot sequence,
but wrong for a purpose-built, git-ignored override file that is meant
to be authoritative regardless of whatever else is floating around in
the developer's shell. The fix keeps the same call-before-resolve
structure and the same two call sites, and only replaces the loading
primitive with one that force-overrides.

## 5. Safety properties preserved (all re-verified this round)

- `UnsafeTestDatabaseUrlError` guard code itself: byte-for-byte
  unchanged.
- Supabase still rejected: reproduced again with a fake
  `db.fakeproject.supabase.co` host in `.env.test.local` →
  `UnsafeTestDatabaseUrlError: ...host "db.fakeproject.supabase.co"
  matches the known managed-Postgres-provider marker "supabase.co"` —
  refused before any process was spawned.
- `TEST_DATABASE_URL` still takes precedence over `DATABASE_URL` for
  this tier (`resolveTestDatabaseUrl()` unchanged).
- `db:migrate:test` still only sets `DATABASE_URL` inside the spawned
  Prisma child's own `env` object — parent process env and `.env` files
  untouched.
- No value is ever printed — only source (`TEST_DATABASE_URL` vs.
  `DATABASE_URL`) and resolved hostname.
- `.env.test.local` remains git-ignored (`.gitignore` line 31,
  reconfirmed via `git check-ignore -v`).

## 6. Network reachability — re-checked fresh this round, unchanged from pass 1

`device_bash` in this session still executes inside the Cowork desktop
app's isolated Linux VM: `uname -a` → `Linux claude ... aarch64`, while
`get_device_info` reports the actual device as `platform: darwin, arch:
arm64, deviceName: macbook-air-bogdan-local`. `nc -zv localhost 5432`
and `nc -zv 127.0.0.1 5432` → `Connection refused` (re-run fresh at the
start of this round, not assumed). This is a structural sandbox boundary
between this VM and the Mac running Docker Desktop, not a config issue —
distinguished clearly from the loader bug in §2, which IS fixed and
verified.

## 7. Migration result — loader bug fixed and verified; actual migration NOT executed

With the fix in place, and reproducing the user's exact reported
scenario (`TEST_DATABASE_URL=` empty in the parent shell,
`.env.test.local` holding the real local URL):

```
[real-db-tests] .env.test.local loaded (TEST_DATABASE_URL found).
[db:migrate:test] Resolved test database from TEST_DATABASE_URL.
[db:migrate:test] Target host: localhost (only the hostname is ever printed).
```

— confirms the loading bug is fixed. Then running `npm run db:migrate:test`
cleanly (no artificial shell override) reaches the same point and spawns
`prisma migrate deploy`, which fails with:

```
Error: Failed to fetch sha256 checksum at
https://binaries.prisma.sh/.../linux-arm64-openssl-3.0.x/libquery_engine.so.node.gz.sha256
- 403 Forbidden
```

This is the same pre-existing sandbox network restriction on
`binaries.prisma.sh` documented in this repo's own
`MODULE_91_IMPLEMENTATION_REPORT.md` — it fails before any Postgres
connection is attempted, so this run does not additionally confirm or
deny `localhost:5432` reachability beyond §6's direct `nc` check.
**Migrations were NOT applied to `maestroya_test` — this is an
environment/network limitation, not a code defect, and is reported
honestly as "not run", not "passed."**

## 8. `test:integration:db` result

**Not run this round beyond the loader-fix verification.** Per the
explicit instruction to only proceed to it if `db:migrate:test` actually
succeeded, and it did not (§7), this was correctly not attempted as a
full suite run. The loader itself was independently re-verified on the
Vitest entry point too (same stale-empty-env reproduction):

```
[real-db-tests] .env.test.local loaded (TEST_DATABASE_URL found).
[real-db-tests] vitest.config.integration-db.ts resolved DATABASE_URL from TEST_DATABASE_URL.
```

confirming the fix applies identically to both entry points.

## 9. Verification commands actually run, in order

1. `npx tsc --noEmit` — no errors in any file touched this round
   (`local-test-env.ts`, `migrate-test-db.ts`,
   `vitest.config.integration-db.ts`).
2. `git diff --check` — clean, no whitespace errors.
3. Loader fix verification (§7/§8, both entry points) — confirmed
   working, including the exact stale-empty-env regression scenario.
4. Guard re-verification against a fake Supabase host — still refuses,
   unaffected by this change.
5. `npm run db:migrate:test` (real, no artificial overrides) — resolves
   and validates correctly, then fails at the Prisma binary download
   step (§7), not at URL resolution.
6. `npm run test:integration:db` full suite — not run, per §8.

## 10. Number of tests passed/failed

0 run against a real database this round — blocked by §6/§7's
environment limitation, not by any remaining code defect. Test files
present and unmodified: the 15 Module 91/96 real-DB test files listed in
`tests/integration-db/**` (affiliate reversal concurrency, in-flight
payout uniqueness, Stripe fee reconciliation, Decimal money persistence,
transaction/webhook/commission/payment/payout/dispute uniqueness &
idempotency, reconciliation discrepancy/schedule-cursor, GDPR Cloudinary
purge retry, fraud trust-signal persistence).

## 11. Remaining issues

1. **Run it on the Mac itself, not through this device_bash VM.** With
   `docker compose up -d postgres` running, `maestroya_test` created,
   and a real `TEST_DATABASE_URL` line in `.env.test.local`, run `npm
   run db:migrate:test` then `npm run test:integration:db` directly in
   a Terminal on the Mac. Both commands are now correctly wired
   end-to-end (loader bug fixed) and were only unreachable/blocked from
   this particular execution context.
2. If a stray `TEST_DATABASE_URL=` (empty or otherwise) is exported in
   your shell profile (`.zshrc`/`.bash_profile`/etc.) from earlier
   debugging, it's now harmless — `.env.test.local`'s value takes
   priority either way — but worth removing if you find one, for
   clarity.
3. `.env.test.local` currently holds only a commented-out placeholder
   (no live value) after this round's verification — it is git-ignored
   either way; put your real local `TEST_DATABASE_URL` in it before
   running the commands above.
