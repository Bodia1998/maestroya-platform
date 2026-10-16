import { describe, expect, it } from "vitest";

import { buildLegacyArchive, verifyLegacyArchive } from "@/domain/services/legacy-archive";
import { parseLegacyArchiveRunConfig, LegacyArchiveConfigError } from "@/application/use-cases/legacy-archive/legacy-archive-run-config";
import { fixtureSnapshot } from "../../../../test-utils/legacy-archive-m167-fixture";

const OPTS = { includeInvoiceContent: false, includeNarrative: false };
const build = (rows: number, at = "2026-10-15T12:00:00.000Z") => buildLegacyArchive(fixtureSnapshot({ rowsPerCategory: rows }), OPTS, new Date(at));
const HEX = "a".repeat(64);

describe("M167 — externally pinned digests", () => {
  it("without pins, a consistently re-forged archive passes (integrity only) and reports that it was not pinned", () => {
    const forged = verifyLegacyArchive(build(3).files);
    expect(forged.ok).toBe(true);
    expect(forged.pinned).toEqual({ manifestSha256: false, archiveDigest: false });
  });

  it("with pins recorded at export time, the genuine archive passes and a consistent forgery is detected", () => {
    const genuine = build(2);
    const pins = { manifestSha256: genuine.manifestSha256, archiveDigest: genuine.manifest.archiveDigest };
    expect(verifyLegacyArchive(genuine.files, pins)).toMatchObject({ ok: true, pinned: { manifestSha256: true, archiveDigest: true } });

    const forged = build(3);
    expect(verifyLegacyArchive(forged.files).ok).toBe(true); // internally consistent
    const codes = verifyLegacyArchive(forged.files, pins).issues.map((i) => i.code);
    expect(codes).toContain("PINNED_MANIFEST_SHA256_MISMATCH");
    expect(codes).toContain("PINNED_ARCHIVE_DIGEST_MISMATCH");
  });

  it("the archive digest pin survives a different generation time; the manifest hash pin does not", () => {
    const a = build(2, "2026-10-15T12:00:00.000Z");
    const b = build(2, "2026-10-16T12:00:00.000Z");
    expect(verifyLegacyArchive(b.files, { archiveDigest: a.manifest.archiveDigest }).ok).toBe(true);
    expect(verifyLegacyArchive(b.files, { manifestSha256: a.manifestSha256 }).ok).toBe(false);
  });

  it("the pin is checked against the RECOMPUTED digest, not the one the manifest claims", () => {
    const a = build(2);
    const files = a.files.map((f) => (f.name === "manifest.json" ? { ...f, content: Buffer.from(f.content.toString("utf8").replace(a.manifest.archiveDigest, "b".repeat(64))) } : f));
    const result = verifyLegacyArchive(files, { archiveDigest: a.manifest.archiveDigest });
    expect(result.ok).toBe(false);
  });

  it("fails closed when the manifest is missing and a pin was requested, and rejects malformed pins", () => {
    const files = build(2).files.filter((f) => f.name !== "manifest.json");
    expect(verifyLegacyArchive(files, { manifestSha256: HEX }).issues.map((i) => i.code)).toContain("PINNED_MANIFEST_SHA256_MISMATCH");
    expect(() => verifyLegacyArchive(build(2).files, { manifestSha256: "xyz" })).toThrow(RangeError);
  });
});

describe("M167 — run config: pins and restore rehearsal", () => {
  const base = { repoRoot: "/repo/maestroya" };
  const env = { DATABASE_URL: "postgresql://u:p@localhost:5432/maestroya_scratch" };
  const parse = (argv: string[], e: Record<string, string | undefined> = env) => parseLegacyArchiveRunConfig({ ...base, argv, env: e });

  it("verify accepts pins, normalises case, and refuses anything else alongside it", () => {
    const c = parse(["--verify", "/a/b", "--expect-manifest-sha256", HEX.toUpperCase(), `--expect-archive-digest=${"c".repeat(64)}`]);
    expect(c).toMatchObject({ mode: "verify", pins: { manifestSha256: HEX, archiveDigest: "c".repeat(64) } });
    expect(() => parse(["--verify", "/a/b", "--output-dir", "/x"])).toThrow(LegacyArchiveConfigError);
    expect(() => parse(["--verify", "/a/b", "--expect-archive-digest", "nothex"])).toThrow(/64 lowercase/);
  });

  it("pins and --keep-scratch-schema are refused on export", () => {
    const argv = ["--output-dir", "/out/a", "--authorize-database-host", "localhost"];
    expect(() => parse([...argv, "--expect-archive-digest", HEX])).toThrow(LegacyArchiveConfigError);
    expect(() => parse([...argv, "--keep-scratch-schema"])).toThrow(LegacyArchiveConfigError);
  });

  it("restore rehearsal requires the authorization, a loopback host and a scratch/test database name", () => {
    const ok = parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "localhost"]);
    expect(ok).toMatchObject({ mode: "restore-rehearsal", keepSchema: false, databaseHost: "localhost" });
    expect(parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "localhost", "--keep-scratch-schema"])).toMatchObject({ keepSchema: true });
    expect(() => parse(["--restore-rehearsal", "/a/b"])).toThrow(/authorize-database-host/);
    expect(() => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "other"])).toThrow(/does not match/);
    expect(() => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "db.example.com"], { DATABASE_URL: "postgresql://u:p@db.example.com/maestroya_scratch" })).toThrow(/loopback/);
    expect(() => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "localhost"], { DATABASE_URL: "postgresql://u:p@localhost/maestroya" })).toThrow(/_scratch/);
    expect(() => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "localhost", "--output-dir", "/x"])).toThrow(LegacyArchiveConfigError);
    expect(() => parse(["--restore-rehearsal", "/a/b", "--verify", "/a/b"])).toThrow(LegacyArchiveConfigError);
  });

  it("accepts only database names that are named as scratch databases (whole _test / _scratch segment), not names that merely contain the letters", () => {
    const withName = (name: string) => () => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "localhost"], { DATABASE_URL: `postgresql://u:p@localhost:5432/${name}?schema=public` });
    for (const ok of ["maestroya_test", "maestroya_scratch", "test", "scratch", "m167_review_test", "app2_scratch"]) expect(withName(ok), ok).not.toThrow();
    for (const bad of ["latest", "contest", "attestation", "testing", "test_prod", "maestroya_test_prod", "maestroya", "maestroya-test", "MaestroYa_Test", "_test", "9_test", "maestroya_test_", "prod.test", ""]) expect(withName(bad), bad).toThrow(LegacyArchiveConfigError);
  });

  it("keeps the loopback and authorized-host checks in force even for a correctly named database", () => {
    expect(() => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "db.example.com"], { DATABASE_URL: "postgresql://u:p@db.example.com/maestroya_test" })).toThrow(/loopback/);
    expect(() => parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "127.0.0.1"], { DATABASE_URL: "postgresql://u:p@localhost/maestroya_test" })).toThrow(/does not match/);
  });

  it("error messages never echo the connection string", () => {
    try {
      parse(["--restore-rehearsal", "/a/b", "--authorize-database-host", "localhost"], { DATABASE_URL: "postgresql://secretuser:secretpw@localhost/prod" });
    } catch (e) {
      expect(String((e as Error).message)).not.toMatch(/secretpw|secretuser/);
    }
  });
});
