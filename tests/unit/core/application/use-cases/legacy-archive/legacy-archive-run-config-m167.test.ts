import { describe, expect, it } from "vitest";

import { LegacyArchiveConfigError, parseLegacyArchiveRunConfig } from "@/application/use-cases/legacy-archive/legacy-archive-run-config";

const REPO = "/work/maestroya";
const ENV = { DATABASE_URL: "postgresql://app_user:p%40ss-SECRET@db.example.test:5432/maestroya?schema=public" };
const ok = ["--output-dir", "/secure/archives/m167", "--authorize-database-host", "db.example.test"];
const parse = (argv: string[], env: Record<string, string | undefined> = ENV, repoRoot = REPO) => parseLegacyArchiveRunConfig({ argv, env, repoRoot });
const message = (argv: string[], env: Record<string, string | undefined> = ENV) => {
  try {
    parse(argv, env);
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyArchiveConfigError);
    return (error as Error).message;
  }
  return expect.unreachable("expected the configuration to be rejected");
};

describe("M167 — operator script configuration (fail closed)", () => {
  it("accepts an explicit, authorized export and defaults both content options to off", () => {
    expect(parse(ok)).toEqual({ mode: "export", targetPath: "/secure/archives/m167", databaseHost: "db.example.test", options: { includeInvoiceContent: false, includeNarrative: false } });
  });

  it("accepts --flag=value, the two explicit opt-ins, and a case-insensitive host", () => {
    const cfg = parse(["--output-dir=/secure/a", "--authorize-database-host=DB.Example.TEST", "--include-invoice-content", "--include-narrative"]);
    expect(cfg).toMatchObject({ mode: "export", options: { includeInvoiceContent: true, includeNarrative: true } });
  });

  it("requires an output directory, and an absolute one", () => {
    expect(message(["--authorize-database-host", "db.example.test"])).toMatch(/--output-dir is required/);
    expect(message(["--output-dir", "relative/dir", "--authorize-database-host", "db.example.test"])).toMatch(/absolute/);
    expect(message(["--output-dir"])).toMatch(/requires a value/);
    expect(message(["--output-dir", "--authorize-database-host", "x"])).toMatch(/requires a value/);
  });

  it("refuses an output directory inside the repository (an export must never be placed where it could be committed)", () => {
    expect(message(["--output-dir", `${REPO}/exports/m167`, "--authorize-database-host", "db.example.test"])).toMatch(/outside the repository/);
    expect(message(["--output-dir", REPO, "--authorize-database-host", "db.example.test"])).toMatch(/outside the repository/);
    expect(message(["--output-dir", `${REPO}/../maestroya/exports`, "--authorize-database-host", "db.example.test"])).toMatch(/outside the repository/);
    expect(parse(["--output-dir", `${REPO}-archives/m167`, "--authorize-database-host", "db.example.test"]).mode).toBe("export");
  });

  it("requires explicit authorization of the database host and refuses a mismatch (no accidental production read)", () => {
    expect(message(["--output-dir", "/secure/a"])).toMatch(/--authorize-database-host is required/);
    expect(message(["--output-dir", "/secure/a", "--authorize-database-host", "other.example.test"])).toMatch(/does not match/);
  });

  it("requires DATABASE_URL and a valid one", () => {
    expect(message(ok, {})).toMatch(/DATABASE_URL is not set/);
    expect(message(ok, { DATABASE_URL: "not a url" })).toMatch(/not a valid URL/);
  });

  it("never echoes the connection string, credentials or hosts in any error", () => {
    const all = [
      message(["--output-dir", "/secure/a", "--authorize-database-host", "other.example.test"]),
      message(ok, { DATABASE_URL: "garbage://p%40ss-SECRET" }),
      message(["--output-dir", "/secure/a"]),
    ].join("\n");
    for (const secret of ["p%40ss-SECRET", "p@ss-SECRET", "app_user", "db.example.test", "other.example.test", "postgresql://"]) expect(all, secret).not.toContain(secret);
  });

  it("rejects unknown arguments, duplicates and flags that look like typos", () => {
    expect(message([...ok, "--force"])).toMatch(/Unknown argument/);
    expect(message([...ok, "--include-narative"])).toMatch(/Unknown argument/);
    expect(message([...ok, "--output-dir", "/other"])).toMatch(/more than once/);
    expect(message([...ok, "--include-narrative", "--include-narrative"])).toMatch(/more than once/);
    expect(message(["positional"])).toMatch(/Unknown argument/);
  });

  it("supports verify mode without a database, and refuses to mix it with export arguments", () => {
    expect(parse(["--verify", "/secure/archives/m167"], {})).toEqual({ mode: "verify", archivePath: "/secure/archives/m167", pins: {} });
    expect(message(["--verify", "relative"], {})).toMatch(/absolute/);
    expect(message(["--verify", "/a", "--output-dir", "/b"], {})).toMatch(/cannot be combined/);
    expect(message(["--verify", "/a", "--include-narrative"], {})).toMatch(/cannot be combined/);
  });
});
