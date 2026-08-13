import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SourceScanner } from "@/infrastructure/multi-instance-safety/source-scanner";

describe("infrastructure/multi-instance-safety/source-scanner — SourceScanner", () => {
  let dir: string;
  let scanner: SourceScanner;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "m58-source-scanner-"));
    await mkdir(path.join(dir, "src"), { recursive: true });
    await writeFile(path.join(dir, "src", "example.ts"), "export const x = 42; // NX marker", "utf8");
    scanner = new SourceScanner(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("reads an existing file's contents", async () => {
    const content = await scanner.read("src/example.ts");
    expect(content).toContain("export const x = 42;");
  });

  it("returns null for a file that does not exist, rather than throwing", async () => {
    const content = await scanner.read("src/does-not-exist.ts");
    expect(content).toBeNull();
  });

  it("contains() matches a substring pattern", async () => {
    expect(await scanner.contains("src/example.ts", "NX marker")).toBe(true);
    expect(await scanner.contains("src/example.ts", "not present")).toBe(false);
  });

  it("contains() matches a regular expression pattern", async () => {
    expect(await scanner.contains("src/example.ts", /const x = \d+/)).toBe(true);
  });

  it("contains() returns false (not a throw) when the file is absent", async () => {
    expect(await scanner.contains("src/missing.ts", "anything")).toBe(false);
  });

  it("exists() reports presence/absence correctly", async () => {
    expect(await scanner.exists("src/example.ts")).toBe(true);
    expect(await scanner.exists("src/missing.ts")).toBe(false);
  });

  it("defaults repoRoot to process.cwd() when not supplied", async () => {
    const defaultScanner = new SourceScanner();
    expect(await defaultScanner.exists("package.json")).toBe(true);
  });
});
